import { type Job, type Processor, Queue, Worker, type WorkerOptions } from 'bullmq';
import { Redis } from 'ioredis';
import { expect, onTestFinished, test } from 'vitest';
import { readEnvironment } from '../src/environment.ts';

const integrationTest = test.runIf(Boolean(process.env.VALKEY_TEST_URL));

async function openQueue() {
  const environment = readEnvironment({
    VALKEY_URL: process.env.VALKEY_TEST_URL,
    QUEUE_NAME: `admission-test-${crypto.randomUUID()}`,
  });
  const connections: Redis[] = [];
  const producers: Queue[] = [];
  const workers: Worker[] = [];
  const errors: Error[] = [];
  const onError = (error: Error) => errors.push(error);

  function connect(worker: boolean) {
    const connection = new Redis(environment.VALKEY_URL, {
      maxRetriesPerRequest: worker ? null : 1,
    });
    connection.on('error', onError);
    connections.push(connection);
    return connection;
  }

  function producer() {
    const queue = new Queue(environment.QUEUE_NAME, { connection: connect(false) });
    queue.on('error', onError);
    producers.push(queue);
    return queue;
  }

  function worker(
    options: Omit<WorkerOptions, 'connection' | 'autorun'> = {},
    processor?: Processor,
  ) {
    const consumer = new Worker(environment.QUEUE_NAME, processor, {
      ...options,
      connection: connect(true),
      autorun: processor !== undefined,
    });
    consumer.on('error', onError);
    workers.push(consumer);
    return consumer;
  }

  const queue = producer();
  onTestFinished(async () => {
    try {
      await Promise.all(workers.map((consumer) => consumer.close(true)));
      await queue.obliterate({ force: true });
    } finally {
      try {
        await Promise.all(producers.map((producer) => producer.close()));
      } finally {
        for (const connection of connections) connection.disconnect();
      }
    }
    expect(errors).toEqual([]);
  });
  await queue.waitUntilReady();
  return { queue, producer, worker };
}

function requireJob(job: Job | undefined): Job {
  if (!job) throw new Error('Expected a native BullMQ claim');
  return job;
}

integrationTest.each([1, 2])(
  'global concurrency %i bounds competing claims across workers and producers',
  async (capacity) => {
    const { queue, producer, worker } = await openQueue();
    const secondProducer = producer();
    await queue.setGlobalConcurrency(capacity);
    await Promise.all(
      Array.from({ length: 8 }, (_, index) =>
        (index % 2 === 0 ? queue : secondProducer).add('ordinary', { index }),
      ),
    );
    const workers = Array.from({ length: 8 }, () => worker());
    await Promise.all(workers.map((consumer) => consumer.waitUntilReady()));
    const claims = await Promise.all(
      workers.map((consumer, index) => consumer.getNextJob(`attempt-${index}`, { block: false })),
    );
    const admitted = claims.filter((job) => Boolean(job));
    expect(admitted).toHaveLength(capacity);
    expect(new Set(admitted.map((job) => job.id)).size).toBe(capacity);
    expect(await queue.getActiveCount()).toBe(capacity);
    expect(await queue.getWaitingCount()).toBe(8 - capacity);

    const completed = requireJob(admitted[0]);
    if (!completed.token) throw new Error('Expected the current claim ownership token');
    await completed.moveToCompleted({ delivered: true }, completed.token, false);
    const next = requireJob(await workers[0].getNextJob('replacement-attempt', { block: false }));
    expect(next.id).not.toBe(completed.id);
    expect(await queue.getActiveCount()).toBe(capacity);
    expect(await queue.getWaitingCount()).toBe(7 - capacity);
  },
);

integrationTest('worker-local concurrency alone does not impose a shared queue limit', async () => {
  const { queue, worker } = await openQueue();
  const finish = Promise.withResolvers<void>();
  const processAttempt = async () => {
    await finish.promise;
    return { delivered: true };
  };
  await queue.addBulk([
    { name: 'ordinary', data: { index: 0 } },
    { name: 'ordinary', data: { index: 1 } },
  ]);
  worker({ concurrency: 1 }, processAttempt);
  worker({ concurrency: 1 }, processAttempt);
  try {
    await expect.poll(() => queue.getActiveCount()).toBe(2);
  } finally {
    finish.resolve();
  }
  await expect.poll(() => queue.getCompletedCount()).toBe(2);
});

integrationTest('competing native claims give one current owner to a single job', async () => {
  const { queue, worker } = await openQueue();
  const submitted = await queue.add('ordinary', {});
  const workers = Array.from({ length: 8 }, () => worker());
  const claims = await Promise.all(
    workers.map((consumer, index) => consumer.getNextJob(`attempt-${index}`, { block: false })),
  );
  expect(claims.filter((job) => Boolean(job)).map((job) => job.id)).toEqual([submitted.id]);
  expect(await queue.getActiveCount()).toBe(1);
});

integrationTest(
  'queue-wide cooldown blocks other workers while admitted work can settle',
  async () => {
    const bot = await openQueue();
    const otherBot = await openQueue();
    await bot.queue.setGlobalConcurrency(2);
    await bot.queue.setGlobalRateLimit(100, 60_000);
    const admitted = await bot.queue.add('ordinary', { message: 'already admitted' });
    const waiting = await bot.queue.add('ordinary', { message: 'waiting' });
    const firstWorker = bot.worker();
    const active = requireJob(await firstWorker.getNextJob('first-attempt', { block: false }));
    expect(active.id).toBe(admitted.id);

    await bot.queue.rateLimit(60_000);
    const secondWorker = bot.worker();
    expect(await secondWorker.getNextJob('blocked-attempt', { block: false })).toBeUndefined();
    await active.moveToCompleted({ delivered: true }, 'first-attempt', false);
    expect(await admitted.getState()).toBe('completed');
    expect(await waiting.getState()).toBe('waiting');
    expect(await bot.queue.getRateLimitTtl()).toBeGreaterThan(0);

    const independent = await otherBot.queue.add('ordinary', { message: 'another bot' });
    const independentClaim = requireJob(
      await otherBot.worker().getNextJob('independent-attempt', { block: false }),
    );
    expect(independentClaim.id).toBe(independent.id);
  },
);

integrationTest('native rateLimit replaces a longer cooldown with a shorter expiry', async () => {
  const { queue, producer } = await openQueue();
  const secondProducer = producer();
  await queue.rateLimit(60_000);
  const originalTtlMs = await secondProducer.getRateLimitTtl();
  expect(originalTtlMs).toBeGreaterThan(30_000);
  await secondProducer.rateLimit(5_000);
  const shortenedTtlMs = await queue.getRateLimitTtl();
  expect(shortenedTtlMs).toBeGreaterThan(0);
  expect(shortenedTtlMs).toBeLessThanOrEqual(5_000);
  expect(shortenedTtlMs).toBeLessThan(originalTtlMs);

  await queue.rateLimit(60_000);
  expect(await secondProducer.getRateLimitTtl()).toBeGreaterThan(30_000);
});

integrationTest(
  'a manual native cooldown requires a configured limiter to gate claims',
  async () => {
    const { queue, worker } = await openQueue();
    const submitted = await queue.add('ordinary', {});
    await queue.rateLimit(60_000);
    expect(await queue.getRateLimitTtl()).toBeGreaterThan(0);
    const claim = requireJob(await worker().getNextJob('ungated-attempt', { block: false }));
    expect(claim.id).toBe(submitted.id);
  },
);

integrationTest(
  'stored cooldown survives worker replacement and expires without another submission',
  async () => {
    const { queue, worker } = await openQueue();
    await queue.setGlobalRateLimit(100, 60_000);
    const submitted = await queue.add('ordinary', {});
    const previousWorker = worker();
    await previousWorker.waitUntilReady();
    const blockedAtMs = Date.now();
    const cooldownMs = 1_000;
    await queue.rateLimit(cooldownMs);
    expect(await previousWorker.getNextJob('blocked-attempt', { block: false })).toBeUndefined();
    await previousWorker.close();

    worker({}, async () => ({ delivered: true }));
    await expect.poll(() => submitted.getState(), { timeout: 5_000 }).toBe('completed');
    const stored = await queue.getJob(submitted.id ?? '');
    expect(stored?.returnvalue).toEqual({ delivered: true });
    expect(stored?.processedOn).toBeGreaterThanOrEqual(blockedAtMs + cooldownMs);
  },
);
