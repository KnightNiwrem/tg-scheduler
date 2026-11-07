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
 * object. The returned payload is a new value built from what validation read, so it cannot differ
 * from what was validated, whatever happens to the caller's object later. Field-level payload
 * semantics are left to Telegram, which reports violations as failed calls.
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
  const ownedPayload = parseDurableObject(payload, 'payload', new Set([payload]));
  // Parsing establishes the durable JSON shape; per-method field types cannot be checked at
  // runtime without duplicating the Bot API schema.
  return { method, payload: ownedPayload } as TelegramRequest;
}

type DurableJson = null | string | boolean | number | DurableJson[] | DurableJsonObject;
type DurableJsonObject = { [key: string]: DurableJson };

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
 * alter, or fail to encode. Properties are read from their descriptors, so no getter or hook runs.
 */
function parseDurableJson(value: unknown, path: string, ancestors: Set<object>): DurableJson {
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
    return Array.isArray(value)
      ? parseDurableArray(value, path, ancestors)
      : parseDurableObject(value, path, ancestors);
  } finally {
    ancestors.delete(value);
  }
}

/**
 * Indices come from the non-configurable `length`, so a caller-defined `keys` method cannot skip
 * elements, and they are read one at a time, so a huge sparse array fails at its first hole without
 * first listing every index. Non-index properties are not copied because JSON does not encode them.
 */
function parseDurableArray(array: unknown[], path: string, ancestors: Set<object>): DurableJson[] {
  rejectToJsonHook(array, path);
  const copy: DurableJson[] = [];
  const { length } = array;
  for (let index = 0; index < length; index++) {
    const elementPath = `${path}[${index}]`;
    const descriptor = Object.getOwnPropertyDescriptor(array, index);
    const element = descriptor === undefined ? undefined : dataValue(descriptor, elementPath);
    // JSON encodes holes and undefined elements as null.
    if (element === undefined) throw invalidPayload(`${elementPath} must not be undefined`);
    copy.push(parseDurableJson(element, elementPath, ancestors));
  }
  return copy;
}

/**
 * Each own property's descriptor is read once. Symbol-keyed and non-enumerable properties are not
 * copied because JSON does not encode them, and properties set to `undefined` are omitted, matching
 * an absent option.
 */
function parseDurableObject(
  object: object,
  path: string,
  ancestors: Set<object>,
): DurableJsonObject {
  rejectToJsonHook(object, path);
  const entries: [string, DurableJson][] = [];
  for (const key of Reflect.ownKeys(object)) {
    if (typeof key !== 'string') continue;
    const descriptor = Object.getOwnPropertyDescriptor(object, key);
    if (descriptor === undefined || !descriptor.enumerable) continue;
    const propertyPath = `${path}.${key}`;
    const value = dataValue(descriptor, propertyPath);
    if (value !== undefined) entries.push([key, parseDurableJson(value, propertyPath, ancestors)]);
  }
  // `fromEntries` defines own properties, so a `__proto__` key stays data instead of setting the
  // copy's prototype.
  return Object.fromEntries(entries);
}

function dataValue(descriptor: PropertyDescriptor, path: string): unknown {
  if (!('value' in descriptor)) {
    throw invalidPayload(`${path} must be a data property, not a getter or setter`);
  }
  return descriptor.value;
}

/**
 * JSON.stringify calls a callable `toJSON`, even a non-enumerable or inherited one, and encodes its
 * result instead of the container's contents, so a hook means the caller's value does not encode
 * as its copy would. An accessor counts as a hook because reading it runs code; a non-callable data
 * value is an ordinary property.
 */
function rejectToJsonHook(container: object, path: string): void {
  for (let owner: object | null = container; owner !== null; owner = Object.getPrototypeOf(owner)) {
    const descriptor = Object.getOwnPropertyDescriptor(owner, 'toJSON');
    if (descriptor === undefined) continue;
    if (!('value' in descriptor) || typeof descriptor.value === 'function') {
      throw invalidPayload(`${path} must not define a toJSON hook`);
    }
    return;
  }
}
