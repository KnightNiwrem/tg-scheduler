import { Worker } from 'bullmq';
import { Redis } from 'ioredis';

const [queueName, effectLedgerKey] = process.argv.slice(2);
const valkeyUrl = process.env.VALKEY_TEST_URL;
if (!queueName || !effectLedgerKey || !valkeyUrl) {
  throw new Error('Expected a queue name, effect ledger key, and VALKEY_TEST_URL');
}

const connection = new Redis(valkeyUrl, { maxRetriesPerRequest: null });
const worker = new Worker(
  queueName,
  async (_job, token) => {
    if (!token) throw new Error('Expected an attempt ownership token');
    // This separate ledger stands in for an external service that accepted the request.
    await connection.rpush(effectLedgerKey, token);
    process.stdout.write('Effect accepted\n');
    // The parent kills this process after acceptance and before BullMQ can settle the job.
    return new Promise<never>(() => {});
  },
  {
    connection,
    lockDuration: 300,
    skipLockRenewal: true,
    skipStalledCheck: true,
  },
);
worker.on('error', () => process.exit(1));
await worker.waitUntilReady();
