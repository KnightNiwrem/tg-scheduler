import { isRedisInstance, Queue, UnrecoverableError, Worker } from 'bullmq';
import type { Cluster, Redis } from 'ioredis';
import { z } from 'zod';
import { type ErrorHandler, toError } from '../error-handler.ts';
import type { SettledJobOutcome } from '../jobs.ts';
import { type BotJob, type BotQueue, encodeJobFailure, type StoredJobData } from './stored-job.ts';

export interface BullMqBackendOptions {
  /** Caller-owned ioredis instance, passed to BullMQ. Closing the scheduler leaves it open. */
  connection: Redis | Cluster;
  /**
   * Shared key namespace for producers and workers; bot identity supplies per-bot isolation.
   * Defaults to `tg-scheduler`. Whitespace and braces are not allowed.
   */
  queuePrefix?: string;
}

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
export interface BotBackendConfig {
  botId: string;
  connection: Redis | Cluster;
  queuePrefix: string;
  /** The bot ID is a cluster hash tag, keeping the queue's keys in one slot. */
  ordinaryQueueName: string;
}

/**
 * Validate backend options and derive the bot's queue identity without connecting.
 *
 * @throws {TypeError} when an option is invalid. Messages omit connection details and credentials.
 */
export function resolveBotBackendConfig(
  botId: unknown,
  backend: BullMqBackendOptions,
): BotBackendConfig {
  const parsedBotId = botIdSchema.safeParse(botId);
  if (!parsedBotId.success) {
    throw new TypeError(`Invalid botId: ${z.prettifyError(parsedBotId.error)}`);
  }
  const parsedPrefix = queuePrefixSchema.safeParse(backend.queuePrefix ?? defaultQueuePrefix);
  if (!parsedPrefix.success) {
    throw new TypeError(`Invalid queuePrefix: ${z.prettifyError(parsedPrefix.error)}`);
  }
  const parsedConnection = connectionSchema.safeParse(backend.connection);
  if (!parsedConnection.success) {
    throw new TypeError('Invalid connection: expected an ioredis instance accepted by BullMQ');
  }
  return {
    botId: parsedBotId.data,
    connection: parsedConnection.data,
    queuePrefix: parsedPrefix.data,
    ordinaryQueueName: `{${parsedBotId.data}}.ordinary`,
  };
}

/** Native BullMQ queues borrowing the caller's connection. */
export interface BotQueues {
  ordinary: BotQueue;
  close(): Promise<void>;
}

/**
 * Open the bot's queues using the caller's connection and its configured connection behavior.
 */
export function openBotQueues(config: BotBackendConfig, onError: ErrorHandler): BotQueues {
  const ordinary: BotQueue = new Queue<StoredJobData, SettledJobOutcome>(config.ordinaryQueueName, {
    connection: config.connection,
    prefix: config.queuePrefix,
  });
  ordinary.on('error', onError);
  return {
    ordinary,
    async close() {
      await ordinary.close();
    },
  };
}

export interface BotJobProcessorOptions {
  /** Shared across every worker for the bot, not only this process. */
  ordinaryConcurrency: number;
  /** Settle one claimed job. A rejection is recorded as an interrupted failure. */
  processJob(job: BotJob): Promise<SettledJobOutcome>;
  onError: ErrorHandler;
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
 * claiming ordinary jobs.
 *
 * @throws when BullMQ cannot start or configure capacity; owned resources are released.
 */
export async function startBotJobProcessor(
  config: BotBackendConfig,
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
  const queues = openBotQueues(config, options.onError);
  let worker: Worker<StoredJobData, SettledJobOutcome> | undefined;

  async function close(): Promise<void> {
    try {
      await worker?.close();
    } finally {
      await queues.close();
    }
  }

  try {
    worker = new Worker<StoredJobData, SettledJobOutcome>(
      config.ordinaryQueueName,
      async (job) => {
        let outcome: SettledJobOutcome;
        try {
          outcome = await options.processJob(job);
        } catch (error) {
          options.onError(toError(error));
          // BullMQ stores this message as the job's failure reason, which job snapshots expose;
          // the original error may carry details that do not belong in stored job data.
          throw new Error('Unexpected processing error, reported to the worker error handler');
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
        concurrency: options.ordinaryConcurrency,
        // Default stalled recovery would run an abandoned attempt again and could retransmit a
        // request Telegram already accepted. With zero, BullMQ fails the job without replay.
        maxStalledCount: 0,
      },
    );
    worker.on('error', options.onError);
    await worker.waitUntilReady();
    // Worker-local concurrency alone lets several workers exceed the bot's shared capacity.
    await queues.ordinary.setGlobalConcurrency(options.ordinaryConcurrency);
    // run() settles only when the worker closes; claim-loop failures are emitted as `error`.
    worker.run().catch((error: unknown) => options.onError(toError(error)));
  } catch (error) {
    await close().catch((cleanupError: unknown) => options.onError(toError(cleanupError)));
    throw error;
  }
  return { close };
}
