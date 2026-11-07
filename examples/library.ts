import {
  type BotTokenResolver,
  createSchedulerClient,
  createSchedulerWorker,
  type SchedulerClientOptions,
  type SharedBotOptions,
} from 'tg-scheduler';

// Usage sketch: submission and retrieval, plus a worker that is configured but not started here.
// Schedule calls reject until recurrence is implemented, so they run after retrieval.
export async function submitAndInspect(options: SchedulerClientOptions) {
  const client = createSchedulerClient(options);
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
    const schedule = await client.createSchedule(
      'sendMessage',
      { chat_id: 123, text: 'Recurring' },
      { intervalMs: 3_600_000, anchorAtMs: Date.now() + 3_600_000 },
    );
    await client.disableSchedule(schedule.id);
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

export function configureWorker(options: SharedBotOptions, resolveBotToken: BotTokenResolver) {
  const worker = createSchedulerWorker({
    ...options,
    resolveBotToken,
    policy: { ordinaryConcurrency: 1, urgentBypassEnabled: false },
  });
  // A long-lived executable owns calling start(), handling signals, and awaiting close().
  return worker;
}
