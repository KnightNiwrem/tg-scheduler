import { isRedisInstance, Queue, UnrecoverableError, Worker } from 'bullmq';
import type { Cluster, Redis } from 'ioredis';
import { z } from 'zod';
import type { BaseSchedulerOptions } from '../base-scheduler-options.ts';
import { reportInternalError, toError } from '../diagnostics.ts';
import type { SettledJobOutcome } from '../jobs.ts';
import {
  type BotJob,
  type BotQueue,
  encodeJobFailure,
  type StoredJobData,
  type StoredJobSuccess,
} from './stored-job.ts';

const defaultQueuePrefix = 'tg-scheduler';

const botIdSchema = z
  .string()
  .regex(/^[A-Za-z0-9_-]{1,64}$/, 'Expected 1-64 letters, digits, underscores, or hyphens');
const queuePrefixSchema = z
  .string()
  .regex(/^[^\s{}]{1,100}$/, 'Expected 1-100 characters without whitespace or braces');
const connectionSchema = z.custom<Redis | Cluster>(
  isRedisInstance,
  'Expected an ioredis connection accepted by BullMQ',
);

/** Validated queue identity and the caller-owned connection used to access one bot's queues. */
export interface BotQueueConfig {
  botId: string;
  connection: Redis | Cluster;
  queuePrefix: string;
  /**
   * The bot's single dispatch queue for both priorities. The bot ID is a cluster hash tag, keeping
   * the queue's keys in one slot.
   */
  dispatchQueueName: string;
}

/**
 * Validate the shared scheduler options and derive the bot's queue identity without connecting.
 *
 * @throws {TypeError} when an option is invalid. Messages omit connection details and credentials.
 */
export function resolveBotQueueConfig(options: BaseSchedulerOptions): BotQueueConfig {
  const parsedBotId = botIdSchema.safeParse(options.botId);
  if (!parsedBotId.success) {
    throw new TypeError(`Invalid botId: ${z.prettifyError(parsedBotId.error)}`);
  }
  const parsedPrefix = queuePrefixSchema.safeParse(options.queuePrefix ?? defaultQueuePrefix);
  if (!parsedPrefix.success) {
    throw new TypeError(`Invalid queuePrefix: ${z.prettifyError(parsedPrefix.error)}`);
  }
  const parsedConnection = connectionSchema.safeParse(options.connection);
  if (!parsedConnection.success) {
    throw new TypeError('Invalid connection: expected an ioredis instance accepted by BullMQ');
  }
  return {
    botId: parsedBotId.data,
    connection: parsedConnection.data,
    queuePrefix: parsedPrefix.data,
    dispatchQueueName: `{${parsedBotId.data}}.dispatch`,
  };
}

/** Native BullMQ queues borrowing the caller's connection. */
export interface BotQueues {
  dispatch: BotQueue;
  close(): Promise<void>;
}

/**
 * Open the bot's queues using the caller's connection and its configured connection behavior.
 *
 * @param reportQueueError Receives queue error events, which no awaited operation reports.
 */
export function openBotQueues(
  config: BotQueueConfig,
  reportQueueError: (error: Error) => void,
): BotQueues {
  const dispatch: BotQueue = new Queue<StoredJobData, StoredJobSuccess>(config.dispatchQueueName, {
    connection: config.connection,
    prefix: config.queuePrefix,
  });
  dispatch.on('error', reportQueueError);
  return {
    dispatch,
    async close() {
      await dispatch.close();
    },
  };
}

export interface BotJobProcessorOptions {
  /** Shared across every worker and both priorities for the bot, not only this process. */
  dispatchConcurrency: number;
  /** Settle one claimed job. A rejection is recorded as an interrupted failure. */
  processJob(job: BotJob): Promise<SettledJobOutcome>;
}

/** A running BullMQ worker and its owned connections. */
export interface BotJobProcessor {
  /** Stop claiming jobs, wait for active jobs to settle, and release connections. */
  close(): Promise<void>;
}

function isClusterConnection(connection: Redis | Cluster): connection is Cluster {
  return connection.isCluster;
}

/**
 * Wait for the worker's connection to be ready, set the bot's queue-wide capacity, then start
 * claiming jobs. Unawaited worker and queue faults are reported through local diagnostics.
 *
 * @throws when BullMQ cannot start or configure capacity; owned resources are released.
 */
export async function startBotJobProcessor(
  config: BotQueueConfig,
  options: BotJobProcessorOptions,
): Promise<BotJobProcessor> {
  // BullMQ creates a blocking duplicate before rejecting an invalid retry setting. Check the
  // same requirement first so a failed constructor cannot leave that duplicate behind.
  const connectionOptions = isClusterConnection(config.connection)
    ? config.connection.options.redisOptions
    : config.connection.options;
  if (connectionOptions?.maxRetriesPerRequest) {
    throw new TypeError('Invalid worker connection: BullMQ requires maxRetriesPerRequest: null');
  }
  const queues = openBotQueues(config, reportInternalError);
  let worker: Worker<StoredJobData, StoredJobSuccess> | undefined;

  async function close(): Promise<void> {
    try {
      await worker?.close();
    } finally {
      await queues.close();
    }
  }

  try {
    worker = new Worker<StoredJobData, StoredJobSuccess>(
      config.dispatchQueueName,
      async (job) => {
        let outcome: SettledJobOutcome;
        try {
          outcome = await options.processJob(job);
        } catch (error) {
          reportInternalError(toError(error));
          // BullMQ stores this message as the job's failure reason, which job snapshots expose;
          // the original error may carry details that do not belong in stored job data.
          throw new Error('Unexpected processing error, reported in worker diagnostics');
        }
        if (outcome.state === 'failed') {
          // A terminal Telegram failure must reach the native failed set without retransmission.
          throw new UnrecoverableError(encodeJobFailure(outcome.error));
        }
        return outcome;
      },
      {
        autorun: false,
        connection: config.connection,
        prefix: config.queuePrefix,
        concurrency: options.dispatchConcurrency,
        // Default stalled recovery would run an abandoned attempt again and could retransmit a
        // request Telegram already accepted. With zero, BullMQ fails the job without replay.
        maxStalledCount: 0,
      },
    );
    worker.on('error', reportInternalError);
    await worker.waitUntilReady();
    // Worker-local concurrency alone lets several workers exceed the bot's shared capacity.
    await queues.dispatch.setGlobalConcurrency(options.dispatchConcurrency);
    // run() settles only when the worker closes; claim-loop failures are emitted as `error`.
    worker.run().catch((error: unknown) => reportInternalError(toError(error)));
  } catch (error) {
    await close().catch((cleanupError: unknown) => reportInternalError(toError(cleanupError)));
    throw error;
  }
  return { close };
}
