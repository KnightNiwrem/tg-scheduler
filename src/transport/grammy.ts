import type { Api } from 'grammy';
import type { JobError } from '../jobs.ts';
import type { TelegramMethod, TelegramRequest, TelegramResult } from '../telegram.ts';
import type { TelegramAttemptOutcome, TelegramTransport } from './telegram-transport.ts';

/**
 * grammY implementation of the transport, calling the caller-owned API instance by reference.
 * The library adds no retry layer and leaves the instance's configuration and transformers as
 * supplied; the caller keeps them free of hidden retries, throttling and webhook replies.
 */
export function createGrammyTransport(api: Api): TelegramTransport {
  return {
    async attempt(request) {
      try {
        return { kind: 'succeeded', result: await callRawMethod(api, request) };
      } catch (error) {
        return classifyAttemptError(error, api.token);
      }
    },
  };
}

type RawMethodCall = (
  payload?: TelegramRequest['payload'],
) => Promise<TelegramResult<TelegramMethod>>;

function callRawMethod(
  api: Api,
  { method, payload }: TelegramRequest,
): Promise<TelegramResult<TelegramMethod>> {
  // grammY declares each raw method separately, so a method chosen at runtime needs one shared
  // call signature.
  const call = api.raw[method] as RawMethodCall;
  // grammY supplies `{}` itself to zero-parameter methods and would read a passed payload as an
  // AbortSignal; other methods treat a missing payload as `{}`.
  return Object.keys(payload).length === 0 ? call() : call(payload);
}

/** The fields of grammY's `GrammyError` that classification reads. */
interface TelegramApiError {
  error_code: number;
  description: string;
  parameters?: { retry_after?: unknown };
}

/**
 * Recognize a Telegram API error by its fields rather than by constructor identity, which differs
 * when the caller's API instance comes from another grammY installation.
 */
function isTelegramApiError(error: unknown): error is TelegramApiError {
  if (!(error instanceof Error)) return false;
  const fields = error as Partial<Record<keyof TelegramApiError, unknown>>;
  return (
    typeof fields.error_code === 'number' &&
    typeof fields.description === 'string' &&
    (fields.parameters === undefined ||
      (typeof fields.parameters === 'object' && fields.parameters !== null))
  );
}

function classifyAttemptError(error: unknown, token: string): TelegramAttemptOutcome {
  const describe = (message: string, telegramErrorCode?: number): JobError => ({
    // grammY omits the request URL from its messages; redaction guards other error sources.
    message: token.length === 0 ? message : message.replaceAll(token, '[bot token]'),
    ...(telegramErrorCode === undefined ? {} : { telegramErrorCode }),
  });

  if (isTelegramApiError(error)) {
    if (error.error_code === 429) {
      return { kind: 'rate-limited', retryAfterSeconds: error.parameters?.retry_after };
    }
    return { kind: 'failed', error: describe(error.description, error.error_code) };
  }
  return {
    kind: 'failed',
    error: describe(error instanceof Error ? error.message : 'Unknown transport error'),
  };
}
