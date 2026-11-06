import type { JobError } from '../jobs.ts';
import type { TelegramMethod, TelegramPayload, TelegramResult } from '../telegram.ts';
import { UnimplementedError } from '../unimplemented-error.ts';

export type BotTokenResolver = (botId: string) => string | Promise<string>;

export type TelegramAttemptOutcome<Method extends TelegramMethod = TelegramMethod> =
  | { kind: 'succeeded'; result: TelegramResult<Method> }
  // The coordinator validates this external value and converts seconds to milliseconds once.
  | { kind: 'rate-limited'; retryAfterSeconds?: unknown }
  | { kind: 'failed'; error: JobError }
  | { kind: 'uncertain'; error: JobError };

export interface TelegramTransport {
  /** Make exactly one outgoing attempt; retries and cooldowns belong to the coordinator. */
  attempt<Method extends TelegramMethod>(
    method: Method,
    payload: TelegramPayload<Method>,
  ): Promise<TelegramAttemptOutcome<Method>>;
}

/** Resolve credentials only at the worker edge; no token belongs in a stored job. */
export function createGrammyTransport(
  _botId: string,
  _resolveBotToken: BotTokenResolver,
): TelegramTransport {
  return {
    async attempt(_method, _payload) {
      throw new UnimplementedError('TelegramTransport.attempt');
    },
  };
}
