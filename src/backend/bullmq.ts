import { Queue, Worker } from 'bullmq';
import { z } from 'zod';
import { type ErrorHandler, toError } from '../error-handler.ts';
import type { SettledJobOutcome } from '../jobs.ts';
import type { BotJob, BotQueue, StoredJobData } from './stored-job.ts';
import {
  createValkeyConnection,
  parseValkeyUrl,
  type ValkeyConnectionRole,
} from './valkey-connection.ts';

export interface BullMqBackendOptions {
  /**
   * `redis://` or `rediss://` URL with optional credentials and database number. Query parameters
   * and fragments are rejected because ioredis would apply them as connection options.
   */
  valkeyUrl: string;
  /**
   * Shared key namespace for producers and workers; bot identity supplies per-bot isolation.
   * Defaults to `tg-scheduler`.
   */
  queuePrefix?: string;
}

const defaultQueuePrefix = 'tg-scheduler';

const botIdSchema = z
  .string()
  .regex(/^[A-Za-z0-9_-]{1,64}$/, 'Expected 1-64 letters, digits, underscores, or hyphens');
const queuePrefixSchema = z.string().regex(/^\S{1,100}$/, 'Expected 1-100 non-space characters');

/** Validated identity of one bot's queues; every producer and worker for the bot must match. */
export interface BotBackendConfig {
  botId: string;
  valkeyUrl: string;
  queuePrefix: string;
  /** BullMQ queue names cannot contain `:`; bot IDs cannot contain `.`, so names stay distinct. */
  ordinaryQueueName: string;
}

/**
 * Validate backend options and derive the bot's queue identity without connecting.
 *
 * @throws {TypeError} when an option is invalid. Messages omit the Valkey URL and credentials.
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
  return {
    botId: parsedBotId.data,
    valkeyUrl: parseValkeyUrl(backend.valkeyUrl),
    queuePrefix: parsedPrefix.data,
    ordinaryQueueName: `${parsedBotId.data}.ordinary`,
  };
}

function connectionName(config: BotBackendConfig, purpose: string): string {
  return `${config.queuePrefix}:${config.botId}:${purpose}`;
}

/** Native BullMQ queues backed by Valkey, with the connection this module owns. */
export interface BotQueues {
  ordinary: BotQueue;
  close(): Promise<void>;
}

/**
 * Open the bot's queues on a dedicated connection. BullMQ begins connecting immediately; commands
 * report connection failures according to the connection role.
 */
export function openBotQueues(
  config: BotBackendConfig,
  role: ValkeyConnectionRole,
  onError: ErrorHandler,
): BotQueues {
  const connection = createValkeyConnection({
    valkeyUrl: config.valkeyUrl,
    role,
    connectionName: connectionName(config, `${role}-queue`),
    onError,
  });
  const ordinary: BotQueue = new Queue<StoredJobData, SettledJobOutcome>(config.ordinaryQueueName, {
    connection,
    prefix: config.queuePrefix,
  });
  ordinary.on('error', onError);
  return {
    ordinary,
    async close() {
      try {
        await ordinary.close();
      } finally {
        connection.disconnect();
      }
    },
  };
}

export interface BotJobProcessorOptions {
  /** Shared across every worker for the bot, not only this process. */
  ordinaryConcurrency: number;
  /** Settle one claimed job. A rejection is treated as an interrupted, uncertain attempt. */
  processJob(job: BotJob): Promise<SettledJobOutcome>;
  onError: ErrorHandler;
}

/** A running BullMQ worker and its owned connections. */
export interface BotJobProcessor {
  /** Stop claiming jobs, wait for active jobs to settle, and release connections. */
  close(): Promise<void>;
}

/**
 * Configure queue-wide capacity and start claiming the bot's ordinary jobs. Capacity changes only
 * after the worker's connection is ready, so a worker that cannot start leaves it unchanged, and
 * claiming begins only after the capacity is set.
 *
 * @throws when Valkey is unreachable or rejects the capacity update; opened resources are released.
 */
export async function startBotJobProcessor(
  config: BotBackendConfig,
  options: BotJobProcessorOptions,
): Promise<BotJobProcessor> {
  const queues = openBotQueues(config, 'producer', options.onError);
  let worker: Worker<StoredJobData, SettledJobOutcome> | undefined;
  const workerConnection = createValkeyConnection({
    valkeyUrl: config.valkeyUrl,
    role: 'worker',
    connectionName: connectionName(config, 'worker'),
    onError: options.onError,
  });

  async function close(): Promise<void> {
    try {
      await worker?.close();
    } finally {
      workerConnection.disconnect();
      await queues.close();
    }
  }

  try {
    worker = new Worker<StoredJobData, SettledJobOutcome>(
      config.ordinaryQueueName,
      async (job) => {
        try {
          return await options.processJob(job);
        } catch (error) {
          options.onError(toError(error));
          // BullMQ stores this message as the job's failure reason, which job snapshots expose;
          // the original error may carry details that do not belong in stored job data.
          throw new Error('Unexpected processing error, reported to the worker error handler');
        }
      },
      {
        autorun: false,
        connection: workerConnection,
        prefix: config.queuePrefix,
        concurrency: options.ordinaryConcurrency,
        // Default stalled recovery would run an abandoned attempt again and could retransmit a
        // request Telegram already accepted. With zero, BullMQ fails the job instead, which job
        // snapshots report as uncertain.
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
