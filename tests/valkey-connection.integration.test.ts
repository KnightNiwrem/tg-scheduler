import { Queue, Worker } from 'bullmq';
import { Redis } from 'ioredis';
import { expect, test } from 'vitest';
import { createValkeyConnection } from '../src/backend/valkey-connection.ts';

const valkeyTestUrl = process.env.VALKEY_TEST_URL;
const integrationTest = test.runIf(Boolean(valkeyTestUrl));

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
  'producer and worker connections run a BullMQ job and release every client',
  async () => {
    if (!valkeyTestUrl) throw new Error('VALKEY_TEST_URL is required');
    const queueName = `connection-test-${crypto.randomUUID()}`;
    const errors: Error[] = [];
    const onError = (error: Error) => errors.push(error);
    const inspector = new Redis(valkeyTestUrl, { maxRetriesPerRequest: 1 });
    inspector.on('error', onError);
    const producerConnection = createValkeyConnection({
      valkeyUrl: valkeyTestUrl,
      role: 'producer',
      connectionName: `${queueName}-producer`,
      onError,
    });
    const workerConnection = createValkeyConnection({
      valkeyUrl: valkeyTestUrl,
      role: 'worker',
      connectionName: `${queueName}-worker`,
      onError,
    });
    const queue = new Queue<{ value: string }, string>(queueName, {
      connection: producerConnection,
    });
    queue.on('error', onError);
    // BullMQ throws when an injected worker connection sets maxRetriesPerRequest.
    const worker = new Worker<{ value: string }, string>(queueName, async (job) => job.data.value, {
      connection: workerConnection,
    });
    worker.on('error', onError);
    let ownedIds: string[] = [];
    try {
      try {
        await Promise.all([queue.waitUntilReady(), worker.waitUntilReady()]);
        ownedIds = Array.from(
          await clientIds(
            inspector,
            new Set([
              `${queueName}-producer`,
              `${queueName}-worker`,
              worker.getBackend().clientName(),
            ]),
          ),
        );
        expect(ownedIds.length).toBe(3);

        const job = await queue.add('echo', { value: 'stored result' });
        await expect.poll(() => job.getState()).toBe('completed');
        expect((await queue.getJob(job.id ?? ''))?.returnvalue).toBe('stored result');
      } finally {
        // The worker closes its duplicated blocking connection; the owner disconnects the rest.
        await worker.close();
        workerConnection.disconnect();
        try {
          await queue.obliterate({ force: true });
        } finally {
          await queue.close();
          producerConnection.disconnect();
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
