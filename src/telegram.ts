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

/** List the values JSON would encode inside an array or plain object, keyed by their paths. */
function jsonContents(
  container: object,
  path: string,
): { items: [string, unknown][] } | { problem: string } {
  if (Array.isArray(container)) {
    // JSON.stringify would encode the hook's return value instead of the elements checked here.
    if ('toJSON' in container) {
      return { problem: `${path} must not define a toJSON hook` };
    }
    // JSON encodes holes and undefined elements as null. `map` and `indexOf` skip holes.
    // biome-ignore lint/complexity/useIndexOf: findIndex visits holes, which must be rejected.
    const undefinedIndex = container.findIndex((item) => item === undefined);
    if (undefinedIndex !== -1)
      return { problem: `${path}[${undefinedIndex}] must not be undefined` };
    return { items: container.map((item, index) => [`${path}[${index}]`, item]) };
  }
  if (!isPlainObject(container)) {
    return {
      problem: `${path} must be plain JSON; InputFile uploads and other class instances are not supported`,
    };
  }
  return {
    items: Object.entries(container)
      .filter(([, item]) => item !== undefined)
      .map(([key, item]) => [`${path}.${key}`, item]),
  };
}
