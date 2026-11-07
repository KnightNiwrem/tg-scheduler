import type { InputFile } from 'grammy';
import type { ApiMethods, Opts } from 'grammy/types';

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
 * The method must be a Bot API method name outside the inbound set, and the payload a plain JSON
 * object. The returned payload is a new value copied from the caller's, so later changes to the
 * caller's object do not affect the stored job. Field-level payload semantics are left to Telegram,
 * which reports violations as failed calls.
 *
 * @throws {TypeError} naming the first unsupported value, such as an `InputFile` upload.
 */
export function parseTelegramRequest(method: unknown, payload: unknown): TelegramRequest {
  if (typeof method !== 'string' || !methodNamePattern.test(method)) {
    throw new TypeError('Invalid method: expected a Telegram Bot API method name');
  }
  if (inboundMethodNames.has(method)) {
    throw new TypeError(
      `Invalid method: ${method} handles inbound updates, which are out of scope`,
    );
  }
  if (!isPlainObject(payload)) {
    throw new TypeError('Invalid payload: expected a plain object');
  }
  const ownedPayload = copyDurableJson(payload, 'payload', new Set());
  // Copying establishes the durable JSON shape; per-method field types cannot be checked at
  // runtime without duplicating the Bot API schema.
  return { method, payload: ownedPayload } as TelegramRequest;
}

type DurableJson =
  | null
  | string
  | boolean
  | number
  | DurableJson[]
  | { [key: string]: DurableJson };

function invalidPayload(problem: string): TypeError {
  return new TypeError(`Invalid payload: ${problem}`);
}

function isPlainObject(value: unknown): value is object {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

/**
 * Copy a value that JSON storage encodes faithfully, rejecting the first value it would drop,
 * alter, or fail to encode. Object properties set to `undefined` are omitted, matching an absent
 * option; JSON would encode an `undefined` array element as `null`, so it is rejected.
 */
function copyDurableJson(value: unknown, path: string, ancestors: Set<object>): DurableJson {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') {
    if (Number.isFinite(value)) return value;
    throw invalidPayload(`${path} must be a finite number`);
  }
  if (typeof value !== 'object') {
    throw invalidPayload(`${path} has unsupported type ${typeof value}`);
  }
  if (ancestors.has(value)) throw invalidPayload(`${path} is a circular reference`);
  if (!Array.isArray(value) && !isPlainObject(value)) {
    throw invalidPayload(
      `${path} must be plain JSON; InputFile uploads and other class instances are not supported`,
    );
  }
  ancestors.add(value);
  try {
    if (Array.isArray(value)) {
      const copy: DurableJson[] = [];
      for (let index = 0; index < value.length; index++) {
        const elementPath = `${path}[${index}]`;
        const element: unknown = value[index];
        if (element === undefined) throw invalidPayload(`${elementPath} must not be undefined`);
        copy.push(copyDurableJson(element, elementPath, ancestors));
      }
      return copy;
    }
    const entries: [string, DurableJson][] = [];
    for (const [key, property] of Object.entries(value)) {
      if (property !== undefined) {
        entries.push([key, copyDurableJson(property, `${path}.${key}`, ancestors)]);
      }
    }
    // `fromEntries` defines own properties, so a `__proto__` key stays data instead of setting the
    // copy's prototype.
    return Object.fromEntries(entries);
  } finally {
    ancestors.delete(value);
  }
}
