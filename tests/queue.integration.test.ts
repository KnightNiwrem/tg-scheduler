import { Redis } from 'ioredis';
import { expect, test } from 'vitest';
import { readEnvironment } from '../src/environment.ts';
import {
  type HealthcheckData,
  type HealthcheckResult,
  processHealthcheck,
} from '../src/healthcheck.ts';
import { createQueue, createWorker } from '../src/queue.ts';

const integrationTest = test.runIf(Boolean(process.env.VALKEY_TEST_URL));

function testEnvironment() {
  return readEnvironment({
    VALKEY_URL: process.env.VALKEY_TEST_URL,
    QUEUE_NAME: `test-${crypto.randomUUID()}`,
  });
}

async function clientIds(connection: Redis, names?: Set<string>): Promise<Set<string>> {
  const clients = await connection.client('LIST');
  if (typeof clients !== 'string') {
    throw new Error('Expected a Valkey client list');
  }
  const ids = new Set<string>();
  for (const line of clients.trim().split('\n')) {
    const id = line.match(/^id=(\d+)\b/)?.[1];
    const name = line.match(/\bname=([^ ]*)/)?.[1];
    if (id && (!names || (name !== undefined && names.has(name)))) ids.add(id);
  }
  return ids;
}

integrationTest(
  'enqueues, claims, activates delayed jobs, retrieves results, and releases every client',
  async () => {
    const environment = testEnvironment();
    const errors: Error[] = [];
    const onError = (error: Error) => errors.push(error);
    const inspector = new Redis(environment.VALKEY_URL, { maxRetriesPerRequest: 1 });
    inspector.on('error', onError);
    const producer = createQueue<HealthcheckData, HealthcheckResult>(environment, onError);
    const consumer = createWorker(environment, processHealthcheck, onError);
    let ownedIds: string[] = [];
    try {
      try {
        await Promise.all([producer.queue.waitUntilReady(), consumer.worker.waitUntilReady()]);
        ownedIds = Array.from(
          await clientIds(
            inspector,
            new Set([
              `${environment.QUEUE_NAME}-producer`,
              `${environment.QUEUE_NAME}-worker`,
              consumer.worker.getBackend().clientName(),
            ]),
          ),
        );
        expect(ownedIds.length).toBe(3);

        const immediate = await producer.queue.add('healthcheck', { message: 'immediate' });
        const delayed = await producer.queue.add(
          'healthcheck',
          { message: 'delayed' },
          { delay: 300 },
        );
        await expect
          .poll(async () => (await producer.queue.getJob(immediate.id ?? ''))?.getState())
          .toBe('completed');
        await expect
          .poll(async () => (await producer.queue.getJob(delayed.id ?? ''))?.getState())
          .toBe('completed');
        expect((await producer.queue.getJob(immediate.id ?? ''))?.returnvalue).toEqual({
          status: 'ok',
          message: 'immediate',
        });
        const delayedResult = await producer.queue.getJob(delayed.id ?? '');
        expect(delayedResult?.returnvalue).toEqual({ status: 'ok', message: 'delayed' });
        expect(delayedResult?.processedOn).toBeGreaterThanOrEqual(delayed.timestamp + 300);
      } finally {
        await consumer.close();
        try {
          await producer.queue.obliterate({ force: true });
        } finally {
          await producer.close();
        }
      }
      await expect
        .poll(async () => {
          const remaining = await clientIds(inspector);
          return ownedIds.filter((id) => remaining.has(id));
        })
        .toEqual([]);
      expect(errors).toEqual([]);
    } finally {
      inspector.disconnect();
    }
  },
);

integrationTest(
  'graceful close drains active work, stops claiming, and permits a new worker to resume',
  async () => {
    const environment = testEnvironment();
    const errors: Error[] = [];
    const onError = (error: Error) => errors.push(error);
    const producer = createQueue<HealthcheckData, HealthcheckResult>(environment, onError);
    const started = Promise.withResolvers<void>();
    const finish = Promise.withResolvers<HealthcheckResult>();
    const consumer = createWorker<HealthcheckData, HealthcheckResult>(
      environment,
      async () => {
        started.resolve();
        return finish.promise;
      },
      onError,
      { autorun: false },
    );
    let replacement:
      | ReturnType<typeof createWorker<HealthcheckData, HealthcheckResult>>
      | undefined;
    try {
      await Promise.all([producer.queue.waitUntilReady(), consumer.worker.waitUntilReady()]);
      const active = await producer.queue.add('healthcheck', { message: 'active' });
      expect(await active.getState()).toBe('waiting');
      expect(consumer.worker.isRunning()).toBe(false);
      const running = consumer.worker.run();
      void running.catch(onError);
      await started.promise;
      const waiting = await producer.queue.add('healthcheck', { message: 'waiting' });
      let closed = false;
      const closing = consumer.close();
      expect(consumer.close()).toBe(closing);
      void closing.then(() => {
        closed = true;
      });
      await new Promise((resolve) => setTimeout(resolve, 30));
      expect(closed).toBe(false);
      finish.resolve({ status: 'ok', message: 'active' });
      await closing;
      await running;
      expect(await active.getState()).toBe('completed');
      expect(await waiting.getState()).toBe('waiting');

      replacement = createWorker<HealthcheckData, HealthcheckResult>(
        environment,
        processHealthcheck,
        onError,
      );
      await replacement.worker.waitUntilReady();
      await expect.poll(() => waiting.getState()).toBe('completed');
      expect((await producer.queue.getJob(waiting.id ?? ''))?.returnvalue).toEqual({
        status: 'ok',
        message: 'waiting',
      });
      expect(errors).toEqual([]);
    } finally {
      finish.resolve({ status: 'ok', message: 'active' });
      await consumer.close();
      await replacement?.close();
      await producer.queue.obliterate({ force: true });
      await producer.close();
    }
  },
);
