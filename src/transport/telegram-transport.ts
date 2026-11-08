import type { JobError } from '../jobs.ts';
import type { TelegramMethod, TelegramRequest, TelegramResult } from '../telegram.ts';

export type TelegramAttemptOutcome =
  | { kind: 'succeeded'; result: TelegramResult<TelegramMethod> }
  // Telegram's raw `retry_after`, in seconds. The bot cooldown will validate it and convert it to
  // milliseconds once; until then the coordinator only reports a valid value to callers.
  | { kind: 'rate-limited'; retryAfterSeconds?: unknown }
  // A terminal error does not prove Telegram did not perform the call.
  | { kind: 'failed'; error: JobError };

export interface TelegramTransport {
  /**
   * Make exactly one outgoing attempt; retries and cooldowns belong to the coordinator. Telegram
   * and network errors are reported as outcomes rather than rejections.
   */
  attempt(request: TelegramRequest): Promise<TelegramAttemptOutcome>;
}
