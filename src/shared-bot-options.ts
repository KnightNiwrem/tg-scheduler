import type { BullMqBackendOptions } from './backend/bullmq.ts';

/**
 * Options identifying one bot's coordination authority. Connections may be separate instances
 * targeting the same backend; the bot identity and queue prefix must match across participants.
 */
export interface SharedBotOptions {
  /** Stable public bot identity. */
  botId: string;
  backend: BullMqBackendOptions;
}
