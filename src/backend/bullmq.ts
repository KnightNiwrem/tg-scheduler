import type { Job, Queue } from 'bullmq';
import type { SettledJobOutcome } from '../jobs.ts';
import type { TelegramRequest } from '../telegram.ts';
import { UnimplementedError } from '../unimplemented-error.ts';

export interface BullMqBackendOptions {
  /**
   * `redis://` or `rediss://` URL with optional credentials and database number. Query parameters
   * and fragments are rejected because ioredis would apply them as connection options.
   */
  valkeyUrl: string;
  /** Shared namespace for producers and workers; bot identity supplies per-bot isolation. */
  queuePrefix?: string;
}

/**
 * A stored job holds its Telegram request and, once settled, its outcome as the BullMQ result. A
 * definite 429 requeues the job without setting a result.
 */
export type BotJob = Job<TelegramRequest, SettledJobOutcome>;
export type BotQueue = Queue<TelegramRequest, SettledJobOutcome>;

/** Native BullMQ queues backed by Valkey; connection ownership belongs to this module. */
export interface BotQueues {
  ordinary: BotQueue;
  urgent?: BotQueue;
  close(): Promise<void>;
}

/** Open the per-bot queues using BullMQ's supported injectable ioredis connection. */
export async function openBotQueues(
  _options: BullMqBackendOptions,
  _botId: string,
  _urgentBypassEnabled = false,
): Promise<BotQueues> {
  throw new UnimplementedError('openBotQueues');
}
