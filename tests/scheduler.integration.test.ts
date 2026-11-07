import { Redis } from 'ioredis';
import { afterEach, beforeEach, expect, test } from 'vitest';
import { createSchedulerClient, type JobSnapshot, type SchedulerClient } from '../src/index.ts';
import type { TelegramRequest } from '../src/telegram.ts';
import type {
  TelegramAttemptOutcome,
  TelegramTransport,
} from '../src/transport/telegram-transport.ts';
import { createSchedulerWorkerWithTransport, type SchedulerWorker } from '../src/worker.ts';

const valkeyTestUrl = process.env.VALKEY_TEST_URL;
const integrationTest = test.runIf(Boolean(valkeyTestUrl));
const botId = '123456';

let queuePrefix: string;
let inspector: Redis;
let backendErrors: Error[];
const ownedResources: { close(): Promise<void> }[] = [];

beforeEach(() => {
  if (!valkeyTestUrl) return;
  queuePrefix = `tg-scheduler-test-${crypto.randomUUID()}`;
  backendErrors = [];
  inspector = new Redis(valkeyTestUrl, { maxRetriesPerRequest: 1 });
  inspector.on('error', (error) => backendErrors.push(error));
});

afterEach(async () => {
  if (!valkeyTestUrl) return;
  try {
    await Promise.all(ownedResources.splice(0).map((resource) => resource.close()));
    await deleteKeys(`${queuePrefix}:*`);
    expect(backendErrors).toEqual([]);
  } finally {
    inspector.disconnect();
  }
});

async function deleteKeys(pattern: string): Promise<void> {
  let cursor = '0';
  do {
    const [nextCursor, keys] = await inspector.scan(cursor, 'MATCH', pattern, 'COUNT', 1000);
    if (keys.length > 0) await inspector.del(...keys);
    cursor = nextCursor;
  } while (cursor !== '0');
}

function sharedOptions() {
  if (!valkeyTestUrl) throw new Error('VALKEY_TEST_URL is required');
  return {
    botId,
    backend: { valkeyUrl: valkeyTestUrl, queuePrefix },
    onError: (error: Error) => backendErrors.push(error),
  };
}

function openClient(): SchedulerClient {
  const client = createSchedulerClient(sharedOptions());
  ownedResources.push(client);
  return client;
}

function openWorker(transport: TelegramTransport, ordinaryConcurrency = 1): SchedulerWorker {
  const worker = createSchedulerWorkerWithTransport(
    { ...sharedOptions(), policy: { ordinaryConcurrency } },
    transport,
  );
  ownedResources.push(worker);
  return worker;
}

interface RecordedAttempt {
  request: TelegramRequest;
  startedAtMs: number;
}

/** Fake Telegram API that records attempts and answers with a caller-supplied outcome. */
class FakeTelegram implements TelegramTransport {
  readonly attempts: RecordedAttempt[] = [];
  inFlight = 0;
  maxInFlight = 0;

  constructor(
    private readonly respond: (
      request: TelegramRequest,
    ) => TelegramAttemptOutcome | Promise<TelegramAttemptOutcome> = (request) => ({
      kind: 'succeeded',
      result: { delivered: request.method } as never,
    }),
  ) {}

  async attempt(request: TelegramRequest): Promise<TelegramAttemptOutcome> {
    this.attempts.push({ request, startedAtMs: Date.now() });
    this.inFlight++;
    this.maxInFlight = Math.max(this.maxInFlight, this.inFlight);
    try {
      return await this.respond(request);
    } finally {
      this.inFlight--;
    }
  }
}

function deferred(): { promise: Promise<void>; resolve(): void } {
  let resolve!: () => void;
  const promise = new Promise<void>((settle) => {
    resolve = settle;
  });
  return { promise, resolve };
}

async function settledJob(client: SchedulerClient, jobId: string): Promise<JobSnapshot> {
  await expect
    .poll(async () => (await client.getJob(jobId))?.state, { timeout: 5_000 })
    .toMatch(/^(succeeded|failed|uncertain)$/);
  const job = await client.getJob(jobId);
  if (!job) throw new Error(`Job ${jobId} disappeared`);
  return job;
}

integrationTest(
  'accepted work runs after the producer exits and its result is retrievable',
  async () => {
    const producer = openClient();
    const beforeSubmitMs = Date.now();
    const handle = await producer.submit('sendMessage', { chat_id: 1, text: 'hello' });
    const afterSubmitMs = Date.now();
    await producer.close();
    expect(handle.method).toBe('sendMessage');

    const telegram = new FakeTelegram();
    await openWorker(telegram).start();
    const reader = openClient();
    const job = await settledJob(reader, handle.id);

    expect(job).toMatchObject({
      id: handle.id,
      method: 'sendMessage',
      botId,
      lane: 'ordinary',
      state: 'succeeded',
      result: { delivered: 'sendMessage' },
    });
    expect(job.originalDueAtMs).toBeGreaterThanOrEqual(beforeSubmitMs);
    expect(job.originalDueAtMs).toBeLessThanOrEqual(afterSubmitMs);
    expect(telegram.attempts.map((attempt) => attempt.request)).toEqual([
      { method: 'sendMessage', payload: { chat_id: 1, text: 'hello' } },
    ]);
  },
);

integrationTest('delayed work stays queued until its run time', async () => {
  const client = openClient();
  const runAtMs = Date.now() + 500;
  const handle = await client.submit('sendMessage', { chat_id: 1, text: 'later' }, { runAtMs });
  // Asserted before any worker runs, so the check cannot race the delayed claim.
  expect(await client.getJob(handle.id)).toMatchObject({
    state: 'queued',
    originalDueAtMs: runAtMs,
  });

  const telegram = new FakeTelegram();
  await openWorker(telegram).start();
  expect((await settledJob(client, handle.id)).state).toBe('succeeded');
  expect(telegram.attempts).toHaveLength(1);
  expect(telegram.attempts[0]?.startedAtMs).toBeGreaterThanOrEqual(runAtMs);
});

integrationTest(
  'failed, uncertain, and rate-limited attempts stay visible and are not retried',
  async () => {
    const telegram = new FakeTelegram((request) => {
      const text = request.method === 'sendMessage' ? request.payload.text : '';
      switch (text) {
        case 'rejected':
          return {
            kind: 'failed',
            error: { message: 'Bad Request: chat not found', telegramErrorCode: 400 },
          };
        case 'ambiguous':
          return { kind: 'uncertain', error: { message: 'Network request failed' } };
        case 'flooded without a valid delay':
          return { kind: 'rate-limited', retryAfterSeconds: 'soon' };
        default:
          return { kind: 'rate-limited', retryAfterSeconds: 5 };
      }
    });
    await openWorker(telegram).start();
    const client = openClient();
    const rejected = await client.submit('sendMessage', { chat_id: 1, text: 'rejected' });
    const ambiguous = await client.submit('sendMessage', { chat_id: 1, text: 'ambiguous' });
    const rateLimited = await client.submit('sendMessage', { chat_id: 1, text: 'flooded' });
    const invalidDelay = await client.submit('sendMessage', {
      chat_id: 1,
      text: 'flooded without a valid delay',
    });

    expect(await settledJob(client, rejected.id)).toMatchObject({
      state: 'failed',
      error: { message: 'Bad Request: chat not found', telegramErrorCode: 400 },
    });
    expect(await settledJob(client, ambiguous.id)).toMatchObject({
      state: 'uncertain',
      error: { message: 'Network request failed' },
    });
    const rateLimitedJob = await settledJob(client, rateLimited.id);
    expect(rateLimitedJob).toMatchObject({ state: 'failed', error: { telegramErrorCode: 429 } });
    expect(rateLimitedJob.state === 'failed' && rateLimitedJob.error.message).toContain(
      'retry after 5 seconds',
    );
    const invalidDelayJob = await settledJob(client, invalidDelay.id);
    expect(invalidDelayJob).toMatchObject({ state: 'failed', error: { telegramErrorCode: 429 } });
    expect(invalidDelayJob.state === 'failed' && invalidDelayJob.error.message).not.toContain(
      'retry after',
    );
    expect(telegram.attempts).toHaveLength(4);
  },
);

integrationTest(
  'an attempt interrupted by a processing error is uncertain, reported, and not retried',
  async () => {
    const telegram = new FakeTelegram(() => {
      throw new Error('transport broke its contract with secret details');
    });
    await openWorker(telegram).start();
    const client = openClient();
    const handle = await client.submit('sendMessage', { chat_id: 1, text: 'hello' });

    const job = await settledJob(client, handle.id);
    expect(job.state).toBe('uncertain');
    // The stored reason is generic; the original error goes only to the worker's handler.
    const message = job.state === 'uncertain' ? job.error.message : '';
    expect(message).toContain('Unexpected processing error');
    expect(message).not.toContain('secret details');
    expect(telegram.attempts).toHaveLength(1);
    expect(backendErrors.splice(0).map((error) => error.message)).toEqual([
      'transport broke its contract with secret details',
    ]);
  },
);

integrationTest(
  'a claimed job is in flight, and closing the worker waits for it to settle',
  async () => {
    const release = deferred();
    const telegram = new FakeTelegram(async () => {
      await release.promise;
      return { kind: 'succeeded', result: true };
    });
    const worker = openWorker(telegram);
    await worker.start();
    const client = openClient();
    const handle = await client.submit('sendChatAction', { chat_id: 1, action: 'typing' });

    let closed = false;
    let closing: Promise<void> | undefined;
    try {
      await expect.poll(async () => (await client.getJob(handle.id))?.state).toBe('in-flight');
      closing = worker.close().then(() => {
        closed = true;
      });
      await new Promise((resolve) => setTimeout(resolve, 100));
      expect(closed).toBe(false);
    } finally {
      release.resolve();
    }
    await closing;
    expect(await client.getJob(handle.id)).toMatchObject({ state: 'succeeded', result: true });
  },
);

integrationTest('ordinary capacity is shared by every worker for the bot', async () => {
  const release = deferred();
  const telegram = new FakeTelegram(async () => {
    await release.promise;
    return { kind: 'succeeded', result: true };
  });
  await Promise.all([openWorker(telegram, 2).start(), openWorker(telegram, 2).start()]);
  const client = openClient();
  const handles = await Promise.all(
    [1, 2, 3, 4].map((chat_id) => client.submit('sendChatAction', { chat_id, action: 'typing' })),
  );

  try {
    await expect.poll(() => telegram.inFlight).toBe(2);
    // Give a third claim time to happen if the shared limit did not hold.
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(telegram.inFlight).toBe(2);
  } finally {
    release.resolve();
  }
  for (const handle of handles) {
    expect((await settledJob(client, handle.id)).state).toBe('succeeded');
  }
  expect(telegram.maxInFlight).toBe(2);
  expect(telegram.attempts).toHaveLength(4);
});

integrationTest('getJob returns undefined for an unknown job', async () => {
  expect(await openClient().getJob('does-not-exist')).toBeUndefined();
});

integrationTest('closing the client and worker releases every backend connection', async () => {
  const telegram = new FakeTelegram();
  const worker = openWorker(telegram);
  await worker.start();
  const client = openClient();
  const handle = await client.submit('sendMessage', { chat_id: 1, text: 'hello' });
  await settledJob(client, handle.id);

  const ownedClientIds = async () => {
    const clients = await inspector.client('LIST');
    if (typeof clients !== 'string') throw new Error('Expected a Valkey client list');
    return clients
      .trim()
      .split('\n')
      .filter((line) => line.match(/\bname=([^ ]*)/)?.[1]?.startsWith(`${queuePrefix}:`));
  };
  // Client queue, worker queue, worker, and the worker's duplicated blocking connection.
  expect(await ownedClientIds()).toHaveLength(4);
  await Promise.all([client.close(), worker.close()]);
  await expect.poll(ownedClientIds).toEqual([]);
  await expect(client.getJob(handle.id)).rejects.toThrow('SchedulerClient is closed');
  await expect(worker.start()).rejects.toThrow('SchedulerWorker is closed');
});
