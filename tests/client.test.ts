import { InputFile } from 'grammy';
import { afterEach, expect, test } from 'vitest';
import {
  createSchedulerClient,
  type SchedulerClient,
  type SchedulerClientOptions,
  UnimplementedError,
} from '../src/index.ts';

// Nothing listens on port 1. Validation failures must reject before any command is sent.
const unreachableBackend = { valkeyUrl: 'redis://127.0.0.1:1' };
const openClients: SchedulerClient[] = [];

afterEach(async () => {
  await Promise.all(openClients.splice(0).map((client) => client.close()));
});

function openClient(overrides: Partial<SchedulerClientOptions> = {}): SchedulerClient {
  const client = createSchedulerClient({
    botId: '123456',
    backend: unreachableBackend,
    onError: () => {},
    ...overrides,
  });
  openClients.push(client);
  return client;
}

test.each([
  ['an empty bot ID', { botId: '' }, 'Invalid botId'],
  ['a bot ID containing a key separator', { botId: 'bot:1' }, 'Invalid botId'],
  ['a bot ID containing a dot', { botId: 'bot.1' }, 'Invalid botId'],
  [
    'an empty queue prefix',
    { backend: { ...unreachableBackend, queuePrefix: '' } },
    'Invalid queuePrefix',
  ],
  ['an invalid Valkey URL', { backend: { valkeyUrl: 'https://valkey' } }, 'Invalid valkeyUrl'],
])('construction rejects %s', (_case, overrides, message) => {
  expect(() => openClient(overrides)).toThrow(new RegExp(`^${message}`));
});

test('construction and close perform no backend I/O', async () => {
  const errors: Error[] = [];
  const client = openClient({ onError: (error) => errors.push(error) });
  await client.close();
  await client.close();
  expect(errors).toEqual([]);
});

class Upload {}
const circular: Record<string, unknown> = { text: 'loop' };
circular.self = circular;

test.each([
  [
    'an InputFile upload',
    { chat_id: 1, photo: new InputFile(new Uint8Array([1])) },
    'payload.photo',
  ],
  ['a class instance', { chat_id: 1, document: new Upload() }, 'payload.document'],
  ['a Date', { chat_id: 1, text: 'x', date: new Date(0) }, 'payload.date'],
  ['a function', { chat_id: 1, text: 'x', callback: () => {} }, 'payload.callback'],
  ['a bigint', { chat_id: 1n, text: 'x' }, 'payload.chat_id'],
  ['a non-finite number', { chat_id: Number.NaN, text: 'x' }, 'payload.chat_id'],
  [
    'an undefined array element',
    { chat_id: 1, text: 'x', entities: [undefined] },
    'payload.entities[0]',
  ],
  // biome-ignore lint/suspicious/noSparseArray: the hole is the case under test.
  ['a sparse array', { chat_id: 1, text: 'x', entities: [, {}] }, 'payload.entities[0]'],
  ['a circular reference', { chat_id: 1, nested: circular }, 'payload.nested.self'],
])('submit rejects a payload with %s', async (_case, payload, path) => {
  const client = openClient();
  await expect(client.submit('sendMessage', payload as never)).rejects.toThrow(
    new RegExp(`^Invalid payload: ${path.replaceAll(/[.[\]]/g, '\\$&')} `),
  );
});

test.each([
  ['a non-object payload', 'sendMessage', 'hello', 'Invalid payload'],
  ['an array payload', 'sendMessage', [], 'Invalid payload'],
  ['an inbound method', 'getUpdates', {}, 'Invalid method: getUpdates'],
  ['an invalid method name', 'send message', {}, 'Invalid method'],
])('submit rejects %s', async (_case, method, payload, message) => {
  const client = openClient();
  await expect(client.submit(method as never, payload as never)).rejects.toThrow(message);
});

test.each([
  ['a fractional run time', { runAtMs: 1.5 }],
  ['a negative run time', { runAtMs: -1 }],
  ['an unknown lane', { lane: 'priority' }],
  ['an unknown option', { runAt: 1 }],
])('submit rejects %s', async (_case, options) => {
  const client = openClient();
  await expect(
    client.submit('sendMessage', { chat_id: 1, text: 'x' }, options as never),
  ).rejects.toThrow(/^Invalid submit options/);
});

test('urgent submission is not implemented yet', async () => {
  const client = openClient();
  await expect(
    client.submit('answerCallbackQuery', { callback_query_id: '1' }, { lane: 'urgent' }),
  ).rejects.toThrow(UnimplementedError);
});

test('getJob rejects an empty job ID', async () => {
  await expect(openClient().getJob('')).rejects.toThrow('Invalid jobId');
});

test('operations reject after close', async () => {
  const client = openClient();
  await client.close();
  await expect(client.submit('sendMessage', { chat_id: 1, text: 'x' })).rejects.toThrow(
    'SchedulerClient is closed',
  );
});
