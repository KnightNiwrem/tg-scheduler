import type { BullMqBackendOptions } from './backend/bullmq.ts';

/**
 * Options that every producer and worker for one bot must share, so all of them use the same
 * coordination authority.
 */
export interface SharedBotOptions {
  /** Stable public bot identity. */
  botId: string;
  backend: BullMqBackendOptions;
}
