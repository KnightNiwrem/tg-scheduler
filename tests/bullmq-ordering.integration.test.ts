import { type Processor, Queue, Worker } from 'bullmq';
import { Redis } from 'ioredis';
import { expect, test } from 'vitest';

const integrationTest = test.runIf(Boolean(process.env.VALKEY_TEST_URL));

interface OrderingData {
  label: string;
}

function orderingFixture() {
  const configuredValkeyUrl = process.env.VALKEY_TEST_URL;
  if (!configuredValkeyUrl)
    throw new Error('VALKEY_TEST_URL is required for backend integration tests');
  const valkeyUrl: string = configuredValkeyUrl;
  const errors: Error[] = [];
  const connections: Redis[] = [];
  const workers: Worker<OrderingData, string>[] = [];
  const queueName = `ordering-test-${crypto.randomUUID()}`;
  const onError = (error: Error) => errors.push(error);

  function connection(worker: boolean) {
    const client = new Redis(valkeyUrl, {
      maxRetriesPerRequest: worker ? null : 1,
      connectTimeout: 1_000,
    });
    client.on('error', onError);
    connections.push(client);
    return client;
  }

  const queue = new Queue<OrderingData, string>(queueName, { connection: connection(false) });
  queue.on('error', onError);

  return {
    queue,
    errors,
    manualWorker(processor: Processor<OrderingData, string> = async (job) => job.data.label) {
      const worker = new Worker<OrderingData, string>(queueName, processor, {
        connection: connection(true),
        autorun: false,
      });
      worker.on('error', onError);
      workers.push(worker);
      return worker;
    },
    async close() {
      try {
        await Promise.all(workers.map((worker) => worker.close(true)));
      } finally {
        try {
          await queue.obliterate({ force: true });
        } finally {
          try {
            await queue.close();
          } finally {
            for (const client of connections) client.disconnect();
          }
        }
      }
    },
  };
}

async function claimNext(worker: Worker<OrderingData, string>) {
  const token = crypto.randomUUID();
  const job = await worker.getNextJob(token, { block: false });
  if (!job) throw new Error('Expected an eligible job');
  return { job, token };
}

async function completeNext(worker: Worker<OrderingData, string>) {
  const { job, token } = await claimNext(worker);
  await job.moveToCompleted(job.data.label, token, false);
  return job.data.label;
}

integrationTest(
  'native ordinary FIFO preserves submission order and future work does not block it',
  async () => {
    const fixture = orderingFixture();
    const worker = fixture.manualWorker();
    try {
      await Promise.all([fixture.queue.waitUntilReady(), worker.waitUntilReady()]);
      const future = await fixture.queue.add('request', { label: 'future' }, { delay: 60_000 });
      const first = await fixture.queue.add('request', { label: 'first' });
      const second = await fixture.queue.add('request', { label: 'second' });

      expect(await completeNext(worker)).toBe('first');
      expect(await completeNext(worker)).toBe('second');
      expect(await worker.getNextJob(crypto.randomUUID(), { block: false })).toBeUndefined();
      expect(await future.getState()).toBe('delayed');
      expect((await fixture.queue.getJob(first.id ?? ''))?.returnvalue).toBe('first');
      expect((await fixture.queue.getJob(second.id ?? ''))?.returnvalue).toBe('second');
      expect(fixture.errors).toEqual([]);
    } finally {
      await fixture.close();
    }
  },
);

integrationTest(
  'native delayed promotion places an older due job behind a newer ready backlog',
  async () => {
    const fixture = orderingFixture();
    const worker = fixture.manualWorker();
    try {
      await Promise.all([fixture.queue.waitUntilReady(), worker.waitUntilReady()]);
      const nowMs = Date.now();
      // Explicit timestamps model work accumulated while no worker was running.
      const delayed = await fixture.queue.add(
        'request',
        { label: 'older-delayed' },
        {
          timestamp: nowMs - 10_000,
          delay: 5_000,
        },
      );
      const ready = await fixture.queue.add(
        'request',
        { label: 'newer-ready' },
        {
          timestamp: nowMs - 1_000,
        },
      );
      expect(delayed.timestamp + 5_000).toBeLessThan(ready.timestamp);
      expect(await delayed.getState()).toBe('delayed');

      // BullMQ FIFO orders the ready list by insertion, not all eligible jobs by original due time.
      expect(await completeNext(worker)).toBe('newer-ready');
      expect(await completeNext(worker)).toBe('older-delayed');
      expect(fixture.errors).toEqual([]);
    } finally {
      await fixture.close();
    }
  },
);

integrationTest.each([
  {
    responseOrder: 'admission order',
    returnFirst: 'first',
    expected: ['second', 'first', 'third'],
  },
  {
    responseOrder: 'reverse admission order',
    returnFirst: 'second',
    expected: ['first', 'second', 'third'],
  },
])(
  'native 429 replies in $responseOrder retry the last-returned job first',
  async ({ returnFirst, expected }) => {
    const fixture = orderingFixture();
    const rateLimited: Processor<OrderingData, string> = async () => {
      await fixture.queue.rateLimit(500);
      throw Worker.RateLimitError();
    };
    const firstWorker = fixture.manualWorker(rateLimited);
    const secondWorker = fixture.manualWorker(rateLimited);
    try {
      await Promise.all([
        fixture.queue.waitUntilReady(),
        firstWorker.waitUntilReady(),
        secondWorker.waitUntilReady(),
      ]);
      await fixture.queue.setGlobalRateLimit(100, 60_000);
      await fixture.queue.add('request', { label: 'first' });
      await fixture.queue.add('request', { label: 'second' });
      await fixture.queue.add('request', { label: 'third' });
      const first = await claimNext(firstWorker);
      const second = await claimNext(secondWorker);
      expect([first.job.data.label, second.job.data.label]).toEqual(['first', 'second']);
      const attempts =
        returnFirst === 'first'
          ? [
              { worker: firstWorker, ...first },
              { worker: secondWorker, ...second },
            ]
          : [
              { worker: secondWorker, ...second },
              { worker: firstWorker, ...first },
            ];

      // Both requests were already admitted. Settle their simulated 429 responses in a chosen order.
      for (const { worker, job, token } of attempts) {
        await worker.processJob(job, token, () => false);
      }
      expect(await first.job.getState()).toBe('waiting');
      expect(await second.job.getState()).toBe('waiting');
      await Promise.all([firstWorker.close(), secondWorker.close()]);
      await expect.poll(async () => (await fixture.queue.getRateLimitTtl()) <= 0).toBe(true);

      // A new worker observes the persisted retry order after cooldown expiry, without a submission.
      const replacement = fixture.manualWorker();
      await replacement.waitUntilReady();
      const labels: string[] = [];
      for (let index = 0; index < 3; index += 1) labels.push(await completeNext(replacement));
      expect(labels).toEqual(expected);
      expect(fixture.errors).toEqual([]);
    } finally {
      await fixture.close();
    }
  },
);
