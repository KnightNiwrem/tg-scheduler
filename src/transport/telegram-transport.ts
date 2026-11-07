import type { JobError } from '../jobs.ts';
import type { TelegramMethod, TelegramRequest, TelegramResult } from '../telegram.ts';

/** Resolve credentials only at the worker edge; no token belongs in a stored job. */
export type BotTokenResolver = (botId: string) => string | Promise<string>;

export type TelegramAttemptOutcome =
  | { kind: 'succeeded'; result: TelegramResult<TelegramMethod> }
  // The coordinator validates this external value and converts seconds to milliseconds once.
  | { kind: 'rate-limited'; retryAfterSeconds?: unknown }
  // Telegram definitely did not perform the call.
  | { kind: 'failed'; error: JobError }
  // Telegram may have performed the call, so it must not be retransmitted automatically.
  | { kind: 'uncertain'; error: JobError };

export interface TelegramTransport {
  /**
   * Make exactly one outgoing attempt; retries and cooldowns belong to the coordinator. Telegram
   * and network errors are reported as outcomes rather than rejections.
   */
  attempt(request: TelegramRequest): Promise<TelegramAttemptOutcome>;
}
