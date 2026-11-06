import { readEnvironment } from './environment.ts';
import type { HealthcheckData, HealthcheckResult } from './healthcheck.ts';
import { createQueue } from './queue.ts';

async function main(): Promise<void> {
  const environment = readEnvironment(process.env);
  const producer = createQueue<HealthcheckData, HealthcheckResult>(environment, (error) => {
    console.error(error.message);
  });
  const timeout = setTimeout(() => {
    console.error('Smoke test exceeded 10 seconds; check that Valkey and the worker are running');
    process.exit(1);
  }, 10_000);

  try {
    await producer.queue.waitUntilReady();
    const job = await producer.queue.add('healthcheck', { message: 'hello' });
    if (!job.id) throw new Error('Valkey did not return a smoke job ID');
    const deadlineMs = Date.now() + 8_000;
    while (Date.now() < deadlineMs) {
      const storedJob = await producer.queue.getJob(job.id);
      if (!storedJob) throw new Error(`Smoke job ${job.id} is missing`);
      const state = await storedJob.getState();
      if (state === 'completed') {
        console.log(JSON.stringify({ jobId: job.id, result: storedJob.returnvalue }));
        return;
      }
      if (state === 'failed') {
        throw new Error(`Smoke job failed: ${storedJob.failedReason}`);
      }
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    throw new Error('Smoke job did not complete; check that the worker is running');
  } finally {
    await producer.close();
    clearTimeout(timeout);
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : 'Unknown smoke test error');
  process.exitCode = 1;
});
