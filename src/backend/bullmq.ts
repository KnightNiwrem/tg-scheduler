import type { Queue } from 'bullmq';
import type { TelegramRequest } from '../telegram.ts';
import type { TelegramAttemptOutcome } from '../transport/grammy.ts';
import { UnimplementedError } from '../unimplemented-error.ts';

export interface BullMqBackendOptions {
  valkeyUrl: string;
  /** Shared namespace for producers and workers; bot identity supplies per-bot isolation. */
  queuePrefix?: string;
}

/** Native BullMQ queues backed by Valkey; connection ownership belongs to this module. */
export interface BotQueues {
  ordinary: Queue<TelegramRequest, TelegramAttemptOutcome>;
  urgent?: Queue<TelegramRequest, TelegramAttemptOutcome>;
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
