import { readEnvironment } from './environment.ts';
import { type HealthcheckData, type HealthcheckResult, processHealthcheck } from './healthcheck.ts';
import { createWorker } from './queue.ts';

function reportError(error: unknown): void {
  console.error(error instanceof Error ? error.message : 'Unknown worker error');
}

async function main(): Promise<void> {
  const environment = readEnvironment(process.env);
  const runtime = createWorker<HealthcheckData, HealthcheckResult>(
    environment,
    processHealthcheck,
    reportError,
  );
  let ready = false;
  let shuttingDown: Promise<void> | undefined;

  function shutdown(exitCode: number): Promise<void> {
    shuttingDown ??= (async () => {
      clearTimeout(startupTimer);
      console.log('Stopping worker');
      const shutdownTimer = setTimeout(() => {
        console.error('Worker shutdown exceeded 10 seconds');
        process.exit(1);
      }, 10_000);
      try {
        // An incomplete startup has no active jobs to drain.
        await runtime.close(!ready);
        process.exitCode = exitCode;
        console.log('Worker stopped');
      } catch (error) {
        reportError(error);
        process.exitCode = 1;
      } finally {
        clearTimeout(shutdownTimer);
        process.off('SIGINT', onSignal);
        process.off('SIGTERM', onSignal);
      }
    })();
    return shuttingDown;
  }

  function onSignal(): void {
    void shutdown(0);
  }

  process.on('SIGINT', onSignal);
  process.on('SIGTERM', onSignal);
  const startupTimer = setTimeout(() => {
    console.error('Worker startup exceeded 10 seconds; check Valkey connectivity');
    void shutdown(1);
  }, 10_000);

  try {
    await runtime.worker.waitUntilReady();
    clearTimeout(startupTimer);
    if (!shuttingDown) {
      ready = true;
      console.log(`Worker ready: ${environment.QUEUE_NAME}`);
    }
  } catch (error) {
    if (!shuttingDown) {
      reportError(error);
      await shutdown(1);
    }
  }
}

main().catch((error: unknown) => {
  reportError(error);
  process.exitCode = 1;
});
