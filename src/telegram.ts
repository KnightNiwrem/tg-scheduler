import type { InputFile } from 'grammy';
import type { ApiMethods, Opts } from 'grammy/types';
import { z } from 'zod';

/** Inbound update processing and webhook management are outside the scheduler. */
const inboundMethods = ['getUpdates', 'setWebhook', 'deleteWebhook', 'getWebhookInfo'] as const;

/** Outgoing Bot API methods, including the `logOut` and `close` lifecycle calls. */
export type TelegramMethod = Exclude<keyof ApiMethods, (typeof inboundMethods)[number]>;

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

const methodNamePattern = /^[a-z][A-Za-z0-9]*$/;
const inboundMethodNames: ReadonlySet<string> = new Set(inboundMethods);

/**
 * Parse a request that must remain replayable after the submitting process exits.
 *
 * The method must be a Bot API method name outside the inbound set, and the payload a plain object
 * of JSON values. The returned payload is a JSON-encoded copy of the caller's, so later changes to
 * the caller's object do not affect the stored job. Field-level payload semantics are left to
 * Telegram, which reports violations as failed calls.
 *
 * @throws {TypeError} when the payload is not a plain object of JSON values, such as one containing
 * an `InputFile` upload, or cannot be encoded as JSON.
 */
export function parseTelegramRequest(method: unknown, payload: unknown): TelegramRequest {
  const outgoingMethod = parseTelegramMethod(method);
  const ownedPayload = copyJsonPayload(payload);
  // Per-method field types cannot be checked at runtime without duplicating the Bot API schema.
  return { method: outgoingMethod, payload: ownedPayload } as TelegramRequest;
}

/**
 * Parse an outgoing Bot API method name. Names are not checked against the full method list;
 * Telegram rejects an unknown method as a failed call.
 *
 * @throws {TypeError} when the value is not a method name or names an inbound method.
 */
export function parseTelegramMethod(method: unknown): TelegramMethod {
  if (typeof method !== 'string' || !methodNamePattern.test(method)) {
    throw new TypeError('Invalid method: expected a Telegram Bot API method name');
  }
  if (inboundMethodNames.has(method)) {
    throw new TypeError(
      `Invalid method: ${method} handles inbound updates, which are out of scope`,
    );
  }
  return method as TelegramMethod;
}

/**
 * Validation only: the copy comes from JSON encoding, which also rejects the cycles `z.json()` does
 * not detect, so the stored payload is exactly what JSON encodes.
 */
const jsonPayloadSchema = z.record(z.string(), z.json());

function copyJsonPayload(payload: unknown): Record<string, unknown> {
  if (!jsonPayloadSchema.safeParse(payload).success) {
    throw new TypeError(
      'Invalid payload: expected a plain object of strings, booleans, finite numbers, null, ' +
        'arrays and plain objects; InputFile uploads, class instances and undefined values are ' +
        'not supported',
    );
  }
  let encodedPayload: string;
  try {
    encodedPayload = JSON.stringify(payload);
  } catch (error) {
    throw new TypeError(
      'Invalid payload: cannot be encoded as JSON, such as a circular reference',
      {
        cause: error,
      },
    );
  }
  const copiedPayload: Record<string, unknown> = JSON.parse(encodedPayload);
  return copiedPayload;
}
