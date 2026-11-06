import { type Processor, Queue, Worker } from 'bullmq';
import { Redis } from 'ioredis';
import type { Environment } from './environment.ts';

type ErrorHandler = (error: Error) => void;

function createValkeyConnection(
  environment: Environment,
  role: 'producer' | 'worker',
  onError: ErrorHandler,
): Redis {
  const connection = new Redis(environment.VALKEY_URL, {
    lazyConnect: true,
    connectTimeout: 5_000,
    connectionName: `${environment.QUEUE_NAME}-${role}`,
    // Producers fail promptly during outages; workers must keep reconnecting.
    maxRetriesPerRequest: role === 'worker' ? null : 1,
    enableOfflineQueue: role === 'worker',
  });
  connection.on('error', onError);
  return connection;
}

export function createQueue<Data, Result>(environment: Environment, onError: ErrorHandler) {
  const connection = createValkeyConnection(environment, 'producer', onError);
  const queue = new Queue<Data, Result>(environment.QUEUE_NAME, { connection });
  queue.on('error', onError);
  let closing: Promise<void> | undefined;

  return {
    queue,
    close(): Promise<void> {
      closing ??= queue.close().finally(() => connection.disconnect());
      return closing;
    },
  };
}

export function createWorker<Data, Result>(
  environment: Environment,
  processor: Processor<Data, Result>,
  onError: ErrorHandler,
) {
  const connection = createValkeyConnection(environment, 'worker', onError);
  // BullMQ owns the extra blocking connection duplicated from this client.
  const worker = new Worker<Data, Result>(environment.QUEUE_NAME, processor, {
    connection,
    concurrency: environment.WORKER_CONCURRENCY,
  });
  worker.on('error', onError);
  let closing: Promise<void> | undefined;

  return {
    worker,
    close(force = false): Promise<void> {
      closing ??= worker.close(force).finally(() => connection.disconnect());
      return closing;
    },
  };
}
