import { Redis, type RedisOptions } from 'ioredis';
import { afterEach, beforeEach, expect, test } from 'vitest';
import {
  type BotPolicy,
  createSchedulerClient,
  type JobSnapshot,
  type SchedulerClient,
} from '../src/index.ts';
import type { TelegramRequest } from '../src/telegram.ts';
import { createGrammyTransport } from '../src/transport/grammy.ts';
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
const connections: Redis[] = [];

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
    for (const connection of connections.splice(0)) connection.disconnect();
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

function openConnection(options: RedisOptions = {}): Redis {
  if (!valkeyTestUrl) throw new Error('VALKEY_TEST_URL is required');
  const connection = new Redis(valkeyTestUrl, {
    lazyConnect: true,
    maxRetriesPerRequest: null,
    connectionName: `${queuePrefix}:caller:${connections.length}`,
    ...options,
  });
  connection.on('error', (error: Error) => backendErrors.push(error));
  connections.push(connection);
  return connection;
}

function sharedOptions(connection: Redis) {
  return {
    botId,
    backend: { connection, queuePrefix },
    onError: (error: Error) => backendErrors.push(error),
  };
}

function openClient(connection = openConnection()): SchedulerClient {
  const client = createSchedulerClient(sharedOptions(connection));
  ownedResources.push(client);
  return client;
}

function openWorker(
  transport: TelegramTransport,
  policy?: BotPolicy,
  connection = openConnection(),
): SchedulerWorker {
  const worker = createSchedulerWorkerWithTransport(
    { ...sharedOptions(connection), policy },
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
    .toMatch(/^(succeeded|failed)$/);
  const job = await client.getJob(jobId);
  if (!job) throw new Error(`Job ${jobId} disappeared`);
  return job;
}

async function expectNativeFinishedState(
  jobId: string,
  state: 'completed' | 'failed',
): Promise<void> {
  const queueKey = `${queuePrefix}:${botId}.ordinary`;
  expect(await inspector.zscore(`${queueKey}:${state}`, jobId)).not.toBeNull();
  const otherState = state === 'completed' ? 'failed' : 'completed';
  expect(await inspector.zscore(`${queueKey}:${otherState}`, jobId)).toBeNull();
  expect(Number(await inspector.hget(`${queueKey}:${jobId}`, 'finishedOn'))).toBeGreaterThan(0);
}

integrationTest(
  'accepted work runs after the producer exits and its result is retrievable',
  async () => {
    const connection = openConnection();
    const producer = openClient(connection);
    const beforeSubmitMs = Date.now();
    const handle = await producer.submit('sendMessage', { chat_id: 1, text: 'hello' });
    const afterSubmitMs = Date.now();
    await producer.close();
    connection.disconnect();
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
    await expectNativeFinishedState(handle.id, 'completed');
  },
);

async function deliveredRequests(
  client: SchedulerClient,
  jobId: string,
): Promise<TelegramRequest[]> {
  const telegram = new FakeTelegram();
  await openWorker(telegram).start();
  expect((await settledJob(client, jobId)).state).toBe('succeeded');
  return telegram.attempts.map((attempt) => attempt.request);
}

integrationTest.each([
  ['a non-object payload', { method: 'sendMessage', payload: [] }],
  ['an inbound method', { method: 'deleteWebhook', payload: {} }],
  ['a malformed method', { method: 'send message', payload: {} }],
])('stored job data with %s fails without sending a request', async (_case, corruptRequest) => {
  const client = openClient();
  const handle = await client.submit('sendMessage', { chat_id: 1, text: 'hello' });
  const jobKey = `${queuePrefix}:${botId}.ordinary:${handle.id}`;
  const corruptData = { request: corruptRequest, originalDueAtMs: 0 };
  await inspector.hset(jobKey, 'data', JSON.stringify(corruptData));

  const telegram = new FakeTelegram();
  await openWorker(telegram).start();
  await expect
    .poll(async () => inspector.hget(jobKey, 'failedReason'), { timeout: 5_000 })
    .toMatch(/Invalid stored job data.*no request was sent/);
  await expectNativeFinishedState(handle.id, 'failed');
  expect(telegram.attempts).toEqual([]);
  await expect(client.getJob(handle.id)).rejects.toThrow(/^Invalid stored job data/);
});

integrationTest('mutating a payload after submit does not change the stored job', async () => {
  const client = openClient();
  const payload = { chat_id: 1, text: 'submitted' };
  const pendingHandle = client.submit('sendMessage', payload);
  payload.text = 'mutated';
  const handle = await pendingHandle;

  expect(await deliveredRequests(client, handle.id)).toEqual([
    { method: 'sendMessage', payload: { chat_id: 1, text: 'submitted' } },
  ]);
});

integrationTest('an own __proto__ property is delivered as ordinary JSON', async () => {
  const client = openClient();
  const payloadJson = '{"chat_id":1,"text":"hello","__proto__":{"nested":true}}';
  const handle = await client.submit('sendMessage', JSON.parse(payloadJson));

  const [delivered] = await deliveredRequests(client, handle.id);
  expect(JSON.stringify(delivered?.payload)).toBe(payloadJson);
  expect(Object.getPrototypeOf(delivered?.payload)).toBe(Object.prototype);
});

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
  'Telegram rejections, transport errors, and rate limits stay visible without retries',
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
          return { kind: 'failed', error: { message: 'Network request failed' } };
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
      state: 'failed',
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
    for (const handle of [rejected, ambiguous, rateLimited, invalidDelay]) {
      await expectNativeFinishedState(handle.id, 'failed');
    }
  },
);

integrationTest.each(['failed', 'uncertain'])(
  'legacy completed %s outcomes are read as failed with their errors preserved',
  async (state) => {
    const client = openClient();
    const handle = await client.submit('sendMessage', { chat_id: 1, text: 'hello' });
    const telegram = new FakeTelegram();
    await openWorker(telegram).start();
    await settledJob(client, handle.id);

    const error = { message: 'Bad Gateway', telegramErrorCode: 502 };
    await inspector.hset(
      `${queuePrefix}:${botId}.ordinary:${handle.id}`,
      'returnvalue',
      JSON.stringify({ state, error }),
    );

    expect(await client.getJob(handle.id)).toMatchObject({ state: 'failed', error });
    await expectNativeFinishedState(handle.id, 'completed');
    expect(telegram.attempts).toHaveLength(1);
  },
);

integrationTest('a terminal Telegram failure ignores a larger stored retry budget', async () => {
  const client = openClient();
  const handle = await client.submit('sendMessage', { chat_id: 1, text: 'hello' });
  const jobKey = `${queuePrefix}:${botId}.ordinary:${handle.id}`;
  await inspector.hset(jobKey, 'opts', JSON.stringify({ attempts: 4 }));
  const error = { message: 'Forbidden: "chat" is unavailable\nNo access', telegramErrorCode: 403 };
  const telegram = new FakeTelegram(() => ({ kind: 'failed', error }));
  const worker = openWorker(telegram);
  await worker.start();

  expect(await settledJob(client, handle.id)).toMatchObject({ state: 'failed', error });
  await expectNativeFinishedState(handle.id, 'failed');
  await worker.close();
  expect(telegram.attempts).toHaveLength(1);
  expect(await inspector.hget(jobKey, 'atm')).toBe('1');
});

integrationTest(
  'a lost response after an accepted call fails once and releases capacity',
  async () => {
    let acceptedCalls = 0;
    const transport = createGrammyTransport(botId, () => '123456:test-token', {
      fetch: async () => {
        acceptedCalls++;
        if (acceptedCalls === 1) throw new Error('Connection dropped after acceptance');
        return new Response(JSON.stringify({ ok: true, result: true }), {
          headers: { 'content-type': 'application/json' },
        });
      },
    });
    await openWorker(transport, { ordinaryConcurrency: 1 }).start();
    const client = openClient();
    const lostResponse = await client.submit('sendChatAction', { chat_id: 1, action: 'typing' });
    const unrelated = await client.submit('sendChatAction', { chat_id: 2, action: 'typing' });

    expect(await settledJob(client, lostResponse.id)).toMatchObject({
      state: 'failed',
      // grammY wraps the dropped connection in an HttpError with its own message.
      error: { message: "Network request for 'sendChatAction' failed!" },
    });
    expect(
      await inspector.hget(`${queuePrefix}:${botId}.ordinary:${lostResponse.id}`, 'returnvalue'),
    ).toBeNull();
    await expectNativeFinishedState(lostResponse.id, 'failed');
    expect(await settledJob(client, unrelated.id)).toMatchObject({
      state: 'succeeded',
      result: true,
    });
    expect(acceptedCalls).toBe(2);
  },
);

integrationTest(
  'an interrupted processor fails once, reports its error, and releases capacity',
  async () => {
    const telegram = new FakeTelegram((request) => {
      if (request.method === 'sendMessage') {
        throw new Error('transport broke its contract with secret details');
      }
      return { kind: 'succeeded', result: true };
    });
    await openWorker(telegram, { ordinaryConcurrency: 1 }).start();
    const client = openClient();
    const handle = await client.submit('sendMessage', { chat_id: 1, text: 'hello' });
    const unrelated = await client.submit('sendChatAction', { chat_id: 2, action: 'typing' });

    const job = await settledJob(client, handle.id);
    expect(job.state).toBe('failed');
    // The stored reason is generic; the original error goes only to the worker's handler.
    const message = job.state === 'failed' ? job.error.message : '';
    expect(message).toContain('Unexpected processing error');
    expect(message).not.toContain('secret details');
    await expectNativeFinishedState(handle.id, 'failed');
    expect((await settledJob(client, unrelated.id)).state).toBe('succeeded');
    expect(telegram.attempts).toHaveLength(2);
    expect(backendErrors.splice(0).map((error) => error.message)).toEqual([
      'transport broke its contract with secret details',
    ]);
  },
);

integrationTest.each(['succeeded', 'failed'] as const)(
  'default retention preserves old %s jobs after further jobs finish',
  async (state) => {
    const telegram = new FakeTelegram(() =>
      state === 'succeeded'
        ? { kind: 'succeeded', result: true }
        : { kind: 'failed', error: { message: 'Bad Request', telegramErrorCode: 400 } },
    );
    await openWorker(telegram).start();
    const client = openClient();
    const first = await client.submit('sendChatAction', { chat_id: 1, action: 'typing' });
    const snapshot = await settledJob(client, first.id);
    expect(snapshot.state).toBe(state);
    const nativeState = state === 'succeeded' ? 'completed' : 'failed';
    await expectNativeFinishedState(first.id, nativeState);

    const queueKey = `${queuePrefix}:${botId}.ordinary`;
    const oldFinishedOnMs = Date.now() - 365 * 24 * 60 * 60 * 1000;
    await inspector.hset(`${queueKey}:${first.id}`, 'finishedOn', oldFinishedOnMs);
    await inspector.zadd(`${queueKey}:${nativeState}`, oldFinishedOnMs, first.id);
    const next = await client.submit('sendChatAction', { chat_id: 2, action: 'typing' });
    expect((await settledJob(client, next.id)).state).toBe(state);

    expect(await client.getJob(first.id)).toEqual(snapshot);
    expect(await inspector.ttl(`${queueKey}:${first.id}`)).toBe(-1);
    await expectNativeFinishedState(first.id, nativeState);
    expect(telegram.attempts).toHaveLength(2);
  },
);

integrationTest.each([
  ['invalid JSON', '{'],
  ['an unsupported version', JSON.stringify({ version: 2, error: { message: 'rejected' } })],
  ['an invalid error', JSON.stringify({ version: 1, error: { message: 42 } })],
])('reading a stored failure with %s rejects', async (_case, encodedFailure) => {
  const telegram = new FakeTelegram(() => ({
    kind: 'failed',
    error: { message: 'Forbidden', telegramErrorCode: 403 },
  }));
  await openWorker(telegram).start();
  const client = openClient();
  const handle = await client.submit('sendChatAction', { chat_id: 1, action: 'typing' });
  expect((await settledJob(client, handle.id)).state).toBe('failed');
  await inspector.hset(
    `${queuePrefix}:${botId}.ordinary:${handle.id}`,
    'failedReason',
    `tg-scheduler:failure:${encodedFailure}`,
  );

  await expect(client.getJob(handle.id)).rejects.toThrow(/^Invalid stored job failure/);
  expect(telegram.attempts).toHaveLength(1);
});

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

integrationTest.each([
  { configuration: 'an omitted policy', policy: undefined, expectedConcurrency: 3 },
  { configuration: 'an empty policy', policy: {}, expectedConcurrency: 3 },
  {
    configuration: 'an explicit concurrency of one',
    policy: { ordinaryConcurrency: 1 },
    expectedConcurrency: 1,
  },
  {
    configuration: 'an explicit concurrency of two',
    policy: { ordinaryConcurrency: 2 },
    expectedConcurrency: 2,
  },
])(
  '$configuration shares ordinary capacity of $expectedConcurrency across workers',
  async ({ policy, expectedConcurrency }) => {
    const release = deferred();
    const telegram = new FakeTelegram(async () => {
      await release.promise;
      return { kind: 'succeeded', result: true };
    });
    await Promise.all([openWorker(telegram, policy).start(), openWorker(telegram, policy).start()]);
    const client = openClient();
    const handles = await Promise.all(
      [1, 2, 3, 4, 5, 6].map((chat_id) =>
        client.submit('sendChatAction', { chat_id, action: 'typing' }),
      ),
    );

    try {
      await expect.poll(() => telegram.inFlight).toBe(expectedConcurrency);
      // Give another claim time to happen if the shared limit did not hold.
      await new Promise((resolve) => setTimeout(resolve, 300));
      expect(telegram.inFlight).toBe(expectedConcurrency);
    } finally {
      release.resolve();
    }
    for (const handle of handles) {
      expect((await settledJob(client, handle.id)).state).toBe('succeeded');
    }
    expect(telegram.maxInFlight).toBe(expectedConcurrency);
    expect(telegram.attempts).toHaveLength(6);
  },
);

integrationTest('getJob returns undefined for an unknown job', async () => {
  expect(await openClient().getJob('does-not-exist')).toBeUndefined();
});

integrationTest(
  'closing a client leaves its shared connection and other clients usable',
  async () => {
    const connection = openConnection({
      maxRetriesPerRequest: 2,
      connectTimeout: 1_357,
      enableOfflineQueue: false,
    });
    const originalOptions = { ...connection.options };
    const originalErrorListeners = connection.listenerCount('error');
    const first = openClient(connection);
    const second = openClient(connection);
    const handle = await first.submit('sendMessage', { chat_id: 1, text: 'hello' });
    await first.close();

    expect(await connection.ping()).toBe('PONG');
    expect(await second.getJob(handle.id)).toMatchObject({ state: 'queued' });
    expect(connection.options).toEqual(originalOptions);
    await second.close();
    expect(connection.listenerCount('error')).toBe(originalErrorListeners);
    expect(await connection.ping()).toBe('PONG');
  },
);

integrationTest.each([null, 0])(
  'a worker shares and preserves a caller connection with maxRetriesPerRequest: %s',
  async (maxRetriesPerRequest) => {
    const connection = openConnection({ maxRetriesPerRequest });
    const originalOptions = { ...connection.options };
    const originalErrorListeners = connection.listenerCount('error');
    const telegram = new FakeTelegram();
    const client = openClient(connection);
    const worker = openWorker(telegram, undefined, connection);
    await worker.start();
    const handle = await client.submit('sendMessage', { chat_id: 1, text: 'hello' });
    await settledJob(client, handle.id);
    await worker.close();

    expect(await connection.ping()).toBe('PONG');
    expect((await client.getJob(handle.id))?.state).toBe('succeeded');
    expect(connection.options).toEqual(originalOptions);
    await client.close();
    expect(connection.listenerCount('error')).toBe(originalErrorListeners);
  },
);

integrationTest(
  'the same worker can start and deliver work after the caller reconnects',
  async () => {
    const connection = openConnection();
    await connection.connect();
    connection.disconnect();
    await expect.poll(() => connection.status).toBe('end');
    const originalErrorListeners = connection.listenerCount('error');
    const telegram = new FakeTelegram();
    const worker = openWorker(telegram, undefined, connection);

    await expect(worker.start()).rejects.toThrow('Connection is closed.');
    for (const error of backendErrors.splice(0)) {
      expect(error.message).toBe('Connection is closed.');
    }
    expect(connection.listenerCount('error')).toBe(originalErrorListeners);
    expect(telegram.attempts).toEqual([]);

    await connection.connect();
    await worker.start();
    const client = openClient();
    const handle = await client.submit('sendMessage', { chat_id: 1, text: 'hello' });
    expect((await settledJob(client, handle.id)).state).toBe('succeeded');
    expect(telegram.attempts.map((attempt) => attempt.request)).toEqual([
      { method: 'sendMessage', payload: { chat_id: 1, text: 'hello' } },
    ]);
    await worker.close();
    expect(connection.listenerCount('error')).toBe(originalErrorListeners);
    expect(await connection.ping()).toBe('PONG');
  },
);

integrationTest('a failed start preserves the caller connection and can be retried', async () => {
  const connection = openConnection({ maxRetriesPerRequest: 1 });
  await connection.connect();
  const originalErrorListeners = connection.listenerCount('error');
  const telegram = new FakeTelegram();
  const worker = openWorker(telegram, undefined, connection);
  await expect(worker.start()).rejects.toThrow('maxRetriesPerRequest');
  expect(await connection.ping()).toBe('PONG');
  expect(connection.options.maxRetriesPerRequest).toBe(1);
  expect(connection.listenerCount('error')).toBe(originalErrorListeners);

  // The caller corrects the setting; the scheduler never changes the supplied options.
  connection.options.maxRetriesPerRequest = null;
  await worker.start();
  const client = openClient();
  const handle = await client.submit('sendMessage', { chat_id: 1, text: 'hello' });
  expect((await settledJob(client, handle.id)).state).toBe('succeeded');
  await worker.close();
  expect(await connection.ping()).toBe('PONG');
});

integrationTest(
  'shutdown releases BullMQ connections and retains the supplied connections',
  async () => {
    const workerConnection = openConnection();
    const clientConnection = openConnection();
    const telegram = new FakeTelegram();
    const worker = openWorker(telegram, undefined, workerConnection);
    await worker.start();
    const client = openClient(clientConnection);
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
    // Two caller-owned connections and BullMQ's duplicated blocking connection.
    expect(await ownedClientIds()).toHaveLength(3);
    await Promise.all([client.close(), worker.close()]);
    await expect.poll(ownedClientIds).toHaveLength(2);
    expect(await workerConnection.ping()).toBe('PONG');
    expect(await clientConnection.ping()).toBe('PONG');
    await expect(client.getJob(handle.id)).rejects.toThrow('SchedulerClient is closed');
    await expect(worker.start()).rejects.toThrow('SchedulerWorker is closed');
  },
);
