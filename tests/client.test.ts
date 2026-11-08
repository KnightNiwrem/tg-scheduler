import { InputFile } from 'grammy';
import { Cluster, Redis } from 'ioredis';
import { afterAll, afterEach, expect, test } from 'vitest';
import { z } from 'zod';
import { SchedulerClient, type SchedulerClientOptions, UnimplementedError } from '../src/index.ts';

// Nothing listens on port 1. Validation failures must reject before any command is sent.
const connection = new Redis('redis://127.0.0.1:1', {
  lazyConnect: true,
  enableOfflineQueue: false,
  maxRetriesPerRequest: 1,
});
const openClients: SchedulerClient[] = [];

afterEach(async () => {
  await Promise.all(openClients.splice(0).map((client) => client.close()));
});
afterAll(() => connection.disconnect());

function openClient(overrides: Partial<SchedulerClientOptions> = {}): SchedulerClient {
  const client = new SchedulerClient({
    botId: '123456',
    connection,
    ...overrides,
  });
  openClients.push(client);
  return client;
}

test.each([
  ['an empty bot ID', { botId: '' }, 'Invalid botId'],
  ['a bot ID containing a key separator', { botId: 'bot:1' }, 'Invalid botId'],
  ['a bot ID containing a dot', { botId: 'bot.1' }, 'Invalid botId'],
  ['an empty queue prefix', { queuePrefix: '' }, 'Invalid queuePrefix'],
  ['a missing connection', { connection: undefined as never }, 'Invalid connection'],
  [
    'connection options instead of an instance',
    { connection: { host: 'localhost' } as never },
    'Invalid connection',
  ],
])('construction rejects %s', (_case, overrides, message) => {
  expect(() => openClient(overrides)).toThrow(new RegExp(`^${message}`));
});

test.each(['scheduler{}', 'scheduler{', 'scheduler}', '{shared}'])(
  'construction rejects braces in queue prefix %s',
  (queuePrefix) => {
    expect(() => openClient({ queuePrefix })).toThrow(/^Invalid queuePrefix/);
  },
);

test('construction and close perform no Valkey I/O', async () => {
  const originalOptions = { ...connection.options };
  const client = openClient();
  await client.close();
  await client.close();
  expect(connection.status).toBe('wait');
  expect(connection.options).toEqual(originalOptions);
});

test('a caller-owned lazy cluster is accepted without opening it', async () => {
  const cluster = new Cluster([{ host: '127.0.0.1', port: 1 }], {
    lazyConnect: true,
    redisOptions: { maxRetriesPerRequest: null },
  });
  try {
    const client = openClient({ connection: cluster });
    await client.close();
    expect(cluster.status).toBe('wait');
  } finally {
    cluster.disconnect();
  }
});

class Upload {}

const circular: Record<string, unknown> = { text: 'loop' };
circular.self = circular;

test.each([
  ['an InputFile upload', { chat_id: 1, photo: new InputFile(new Uint8Array([1])) }],
  ['a class instance', { chat_id: 1, document: new Upload() }],
  ['a Date', { chat_id: 1, text: 'x', date: new Date(0) }],
  ['a function', { chat_id: 1, text: 'x', callback: () => {} }],
  ['a bigint', { chat_id: 1n, text: 'x' }],
  ['a non-finite number', { chat_id: Number.NaN, text: 'x' }],
  ['an undefined property', { chat_id: 1, text: 'x', reply_markup: undefined }],
  ['an undefined array element', { chat_id: 1, text: 'x', entities: [undefined] }],
  // biome-ignore lint/suspicious/noSparseArray: the hole is the case under test.
  ['a sparse array', { chat_id: 1, text: 'x', entities: [, {}] }],
])('submit rejects a payload with %s', async (_case, payload) => {
  const client = openClient();
  const rejection = client.submit('sendMessage', payload as never);
  await expect(rejection).rejects.toThrow(/^Invalid payload: expected a plain object of /);
  await expect(rejection).rejects.toHaveProperty('cause', expect.any(z.ZodError));
});

test('submit rejects a payload with a circular reference', async () => {
  const client = openClient();
  await expect(
    client.submit('sendMessage', { chat_id: 1, nested: circular } as never),
  ).rejects.toThrow(/^Invalid payload: cannot be encoded as JSON/);
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
  ['an unknown priority', { priority: 'high' }],
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
    client.submit('answerCallbackQuery', { callback_query_id: '1' }, { priority: 'urgent' }),
  ).rejects.toThrow(UnimplementedError);
});

test('schedule operations are not implemented yet', async () => {
  const client = openClient();
  await expect(
    client.createSchedule('sendMessage', { chat_id: 1, text: 'x' }, { every: 60_000 }),
  ).rejects.toThrow(UnimplementedError);
  await expect(client.deleteSchedule('schedule')).rejects.toThrow(UnimplementedError);
  await expect(client.listScheduleJobs('schedule')).rejects.toThrow(UnimplementedError);
  expect(connection.status).toBe('wait');
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
