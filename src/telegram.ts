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
 * Validate a request that must remain replayable after the submitting process exits.
 *
 * The method must be a Bot API method name outside the inbound set, and the payload a plain JSON
 * object. Field-level payload semantics are left to Telegram, which reports violations as failed
 * calls.
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
  const problem = findNonDurableValue(payload, 'payload', new Set());
  if (problem !== undefined) {
    throw new TypeError(`Invalid payload: ${problem}`);
  }
  // The checks above establish the durable JSON shape; per-method field types cannot be checked
  // at runtime without duplicating the Bot API schema.
  return { method, payload } as TelegramRequest;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

/**
 * Describe the first value that JSON storage would drop, alter, or fail to encode. Object
 * properties set to `undefined` are allowed because JSON omits them, matching an absent option.
 */
function findNonDurableValue(
  value: unknown,
  path: string,
  ancestors: Set<object>,
): string | undefined {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return undefined;
  if (typeof value === 'number') {
    return Number.isFinite(value) ? undefined : `${path} must be a finite number`;
  }
  if (typeof value !== 'object') return `${path} has unsupported type ${typeof value}`;
  if (ancestors.has(value)) return `${path} is a circular reference`;

  const contents = jsonContents(value, path);
  if ('problem' in contents) return contents.problem;
  ancestors.add(value);
  try {
    for (const [itemPath, item] of contents.items) {
      const problem = findNonDurableValue(item, itemPath, ancestors);
      if (problem !== undefined) return problem;
    }
    return undefined;
  } finally {
    ancestors.delete(value);
  }
}

/**
 * List the values JSON would encode inside an array or plain object, keyed by their paths. Values
 * are read from property descriptors, so no getter or hook runs during validation.
 */
function jsonContents(
  container: object,
  path: string,
): { items: [string, unknown][] } | { problem: string } {
  const isArray = Array.isArray(container);
  if (!isArray && !isPlainObject(container)) {
    return {
      problem: `${path} must be plain JSON; InputFile uploads and other class instances are not supported`,
    };
  }
  if (definesToJsonHook(container)) {
    return { problem: `${path} must not define a toJSON hook` };
  }
  // `keys()` includes array holes; `Object.keys` lists the object properties JSON encodes.
  const keys = isArray ? Array.from(container.keys(), String) : Object.keys(container);
  const items: [string, unknown][] = [];
  for (const key of keys) {
    const itemPath = isArray ? `${path}[${key}]` : `${path}.${key}`;
    const descriptor = Object.getOwnPropertyDescriptor(container, key);
    // JSON encodes holes and undefined elements as null.
    if (descriptor === undefined) return { problem: `${itemPath} must not be undefined` };
    if (!('value' in descriptor)) {
      return { problem: `${itemPath} must be a data property, not a getter or setter` };
    }
    if (descriptor.value === undefined) {
      if (isArray) return { problem: `${itemPath} must not be undefined` };
      continue;
    }
    items.push([itemPath, descriptor.value]);
  }
  return { items };
}

/**
 * JSON.stringify calls a callable `toJSON`, even a non-enumerable or inherited one, and encodes its
 * result instead of the contents checked here. An accessor counts as a hook because reading it runs
 * code; a non-callable data value is encoded like any other property.
 */
function definesToJsonHook(container: object): boolean {
  for (let owner: object | null = container; owner !== null; owner = Object.getPrototypeOf(owner)) {
    const descriptor = Object.getOwnPropertyDescriptor(owner, 'toJSON');
    if (descriptor !== undefined) {
      return !('value' in descriptor) || typeof descriptor.value === 'function';
    }
  }
  return false;
}
