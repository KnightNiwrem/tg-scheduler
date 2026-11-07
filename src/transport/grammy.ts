import { Api, type ApiClientOptions, GrammyError, HttpError } from 'grammy';
import type { JobError } from '../jobs.ts';
import type { TelegramMethod, TelegramRequest, TelegramResult } from '../telegram.ts';
import type {
  BotTokenResolver,
  TelegramAttemptOutcome,
  TelegramTransport,
} from './telegram-transport.ts';

/**
 * grammY client settings the transport accepts. Webhook replies and transformers stay excluded
 * because they would hide the observed result or add retries.
 */
export type GrammyTransportOptions = Pick<ApiClientOptions, 'fetch'>;

/** grammY implementation of the transport; it adds no automatic retry layer. */
export function createGrammyTransport(
  botId: string,
  resolveBotToken: BotTokenResolver,
  apiOptions: GrammyTransportOptions = {},
): TelegramTransport {
  // Tokens are resolved per attempt so rotation takes effect; the client is reused while unchanged.
  let client: { token: string; api: Api } | undefined;

  return {
    async attempt(request) {
      let token: unknown;
      try {
        token = await resolveBotToken(botId);
      } catch {
        // The resolver's error is not stored: it is caller-defined and may describe credentials.
        return failedBeforeSending('Bot token resolution failed');
      }
      if (typeof token !== 'string' || token.length === 0) {
        return failedBeforeSending('Bot token resolver did not return a non-empty string');
      }
      if (client?.token !== token) client = { token, api: new Api(token, apiOptions) };

      try {
        return { kind: 'succeeded', result: await callRawMethod(client.api, request) };
      } catch (error) {
        return classifyAttemptError(error, token);
      }
    },
  };
}

function failedBeforeSending(reason: string): TelegramAttemptOutcome {
  return { kind: 'failed', error: { message: `${reason}; no request was sent` } };
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

function classifyAttemptError(error: unknown, token: string): TelegramAttemptOutcome {
  const describe = (message: string, telegramErrorCode?: number): JobError => ({
    // grammY omits the request URL from its messages; redaction guards other error sources.
    message: message.replaceAll(token, '[bot token]'),
    ...(telegramErrorCode === undefined ? {} : { telegramErrorCode }),
  });

  if (error instanceof GrammyError) {
    if (error.error_code === 429) {
      return { kind: 'rate-limited', retryAfterSeconds: error.parameters?.retry_after };
    }
    // A Telegram server error does not prove that the call had no effect.
    const kind = error.error_code >= 500 ? 'uncertain' : 'failed';
    return { kind, error: describe(error.description, error.error_code) };
  }
  if (error instanceof HttpError) {
    // The request may have reached Telegram before the connection failed or timed out.
    return { kind: 'uncertain', error: describe(error.message) };
  }
  return {
    kind: 'uncertain',
    error: describe(error instanceof Error ? error.message : 'Unknown transport error'),
  };
}
