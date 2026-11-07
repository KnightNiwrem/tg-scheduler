import { Redis } from 'ioredis';
import { afterEach, expect, test } from 'vitest';
import {
  createSchedulerWorker,
  type SchedulerWorkerOptions,
  UnimplementedError,
} from '../src/index.ts';

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
    resolveBotToken: () => 'token',
    onError: () => {},
    ...overrides,
  };
}

test.each([
  ['zero ordinary concurrency', { policy: { ordinaryConcurrency: 0 } }, 'Invalid policy'],
  ['fractional ordinary concurrency', { policy: { ordinaryConcurrency: 1.5 } }, 'Invalid policy'],
  ['an unknown policy setting', { policy: { concurrency: 2 } as never }, 'Invalid policy'],
  ['a missing token resolver', { resolveBotToken: undefined as never }, 'Invalid resolveBotToken'],
  ['an invalid bot ID', { botId: 'bot:1' }, 'Invalid botId'],
])('construction rejects %s', (_case, overrides, message) => {
  expect(() => createSchedulerWorker(workerOptions(overrides))).toThrow(message);
});

test('closing a worker that was never started performs no backend I/O', async () => {
  const errors: Error[] = [];
  const worker = createSchedulerWorker(workerOptions({ onError: (error) => errors.push(error) }));
  await worker.close();
  expect(errors).toEqual([]);
  await expect(worker.start()).rejects.toThrow('SchedulerWorker is closed');
});

test('urgent bypass is not implemented yet', async () => {
  const worker = createSchedulerWorker(workerOptions({ policy: { urgentBypassEnabled: true } }));
  await expect(worker.start()).rejects.toThrow(UnimplementedError);
  await worker.close();
});

test('start rejects when Valkey is unreachable', async () => {
  const worker = createSchedulerWorker(workerOptions());
  await expect(worker.start()).rejects.toThrow();
  await worker.close();
});
