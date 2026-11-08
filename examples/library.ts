import { Api } from 'grammy';
import {
  type BaseSchedulerOptions,
  SchedulerClient,
  type SchedulerClientOptions,
  SchedulerWorker,
} from 'tg-scheduler';

// The caller supplies the connection and closes it after all clients and workers finish.
// Usage sketch: submission and retrieval, plus a worker that is configured but not started here.
// Schedule calls reject until recurrence is implemented, so they run after retrieval.
export async function submitAndInspect(options: SchedulerClientOptions) {
  const client = new SchedulerClient(options);
  try {
    const immediate = await client.submit('sendMessage', { chat_id: 123, text: 'Hello' });
    await client.submit(
      'sendMessage',
      { chat_id: 123, text: 'Later' },
      { runAtMs: Date.now() + 60_000 },
    );
    const job = await client.getJob(immediate.id);
    if (job?.state === 'succeeded' && job.method === 'sendMessage') {
      // Narrowing the stored method gives the corresponding grammY result type.
      console.log(job.result.message_id);
    }
    const hourlySchedule = await client.createSchedule(
      'sendMessage',
      { chat_id: 123, text: 'Every hour at minute 26, UTC' },
      { pattern: '26 * * * *' },
      { priority: 'urgent' },
    );
    const intervalSchedule = await client.createSchedule(
      'sendMessage',
      { chat_id: 123, text: 'Immediately, then every hour' },
      { every: 3_600_000 },
    );
    await client.deleteSchedule(hourlySchedule.id);
    await client.deleteSchedule(intervalSchedule.id);
    // Retained occurrences stay listable after deletion; getJob reports each one's outcome.
    for (const occurrence of await client.listScheduleJobs(hourlySchedule.id)) {
      console.log(await client.getJob(occurrence.id));
    }
  } catch (operationError) {
    await client.close().catch((cleanupError: unknown) => {
      throw new AggregateError(
        [operationError, cleanupError],
        'Scheduler operation and client cleanup both failed',
        { cause: operationError },
      );
    });
    throw operationError;
  }
  await client.close();
}

export function configureWorker(options: BaseSchedulerOptions, botToken: string) {
  // A fresh instance dedicated to the scheduler, without auto-retry or other retrying transformers.
  const api = new Api(botToken);
  const worker = new SchedulerWorker({ ...options, api, policy: { dispatchConcurrency: 3 } });
  // The host application calls start(), handles signals, and awaits close().
  return worker;
}
