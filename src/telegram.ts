import type { InputFile } from 'grammy';
import type { ApiMethods, Opts } from 'grammy/types';

/**
 * Outgoing Bot API methods include lifecycle calls. Inbound update processing and webhook
 * management are outside the scheduler.
 */
export type TelegramMethod = Exclude<
  keyof ApiMethods,
  'getUpdates' | 'setWebhook' | 'deleteWebhook' | 'getWebhookInfo'
>;

type WithoutInputFiles<Value> = Value extends InputFile
  ? never
  : Value extends object
    ? { [Key in keyof Value]: WithoutInputFiles<Value[Key]> }
    : Value;

/** File IDs remain strings; new uploads require persistence that is outside this slice. */
export type TelegramPayload<Method extends TelegramMethod> = WithoutInputFiles<Opts<Method>>;

export type TelegramResult<Method extends TelegramMethod> = ReturnType<ApiMethods[Method]>;

/** The mapped union keeps each method paired with its own payload. */
export type TelegramRequest = {
  [Method in TelegramMethod]: {
    method: Method;
    payload: TelegramPayload<Method>;
  };
}[TelegramMethod];
