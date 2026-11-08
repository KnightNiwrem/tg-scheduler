import { Api } from 'grammy';
import { Redis } from 'ioredis';
import { afterEach, expect, test } from 'vitest';
import { createSchedulerWorker, type SchedulerWorkerOptions } from '../src/index.ts';

const connections: Redis[] = [];
afterEach(() => {
  for (const connection of connections.splice(0)) connection.disconnect();
});

function workerOptions(overrides: Partial<SchedulerWorkerOptions> = {}): SchedulerWorkerOptions {
  const connection = new Redis('redis://127.0.0.1:1', {
    lazyConnect: true,
    maxRetriesPerRequest: null,
    retryStrategy: () => null,
  });
  connection.on('error', () => {});
  connections.push(connection);
  return {
    botId: '123456',
    // Nothing listens on port 1, so any backend command would fail.
    backend: { connection },
    api: new Api('123456:token'),
    ...overrides,
  };
}

test.each([
  ['zero dispatch concurrency', { policy: { dispatchConcurrency: 0 } }, 'Invalid policy'],
  ['fractional dispatch concurrency', { policy: { dispatchConcurrency: 1.5 } }, 'Invalid policy'],
  ['an unknown policy setting', { policy: { concurrency: 2 } as never }, 'Invalid policy'],
  ['a missing API instance', { api: undefined as never }, 'Invalid api'],
  ['a token string instead of an API instance', { api: '123456:token' as never }, 'Invalid api'],
  ['an invalid bot ID', { botId: 'bot:1' }, 'Invalid botId'],
])('construction rejects %s', (_case, overrides, message) => {
  expect(() => createSchedulerWorker(workerOptions(overrides))).toThrow(message);
});

test('closing a worker that was never started performs no backend I/O', async () => {
  const options = workerOptions();
  const worker = createSchedulerWorker(options);
  await worker.close();
  expect(options.backend.connection.status).toBe('wait');
  await expect(worker.start()).rejects.toThrow('SchedulerWorker is closed');
});

test('start rejects when Valkey is unreachable', async () => {
  const worker = createSchedulerWorker(workerOptions());
  await expect(worker.start()).rejects.toThrow();
  await worker.close();
});
