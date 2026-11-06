import { afterEach, expect, test, vi } from 'vitest';

afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  vi.doUnmock('../src/queue.ts');
  vi.resetModules();
});

test.each([
  ['SIGINT', false],
  ['SIGTERM', false],
  ['SIGINT', true],
  ['SIGTERM', true],
] as const)('%s closes safely when processing started is %s', async (signal, processingStarted) => {
  vi.useFakeTimers();
  const ready = Promise.withResolvers<void>();
  const activeJob = Promise.withResolvers<void>();
  const stopped = Promise.withResolvers<void>();
  const run = vi.fn(() => activeJob.promise);
  const close = vi.fn(async (force: boolean) => {
    if (!force) await activeJob.promise;
  });
  const createWorker = vi.fn(() => ({
    worker: { waitUntilReady: () => ready.promise, run },
    close,
  }));
  vi.doMock('../src/queue.ts', () => ({ createWorker }));
  vi.stubEnv('VALKEY_URL', 'redis://localhost:6379');
  const output = vi.spyOn(console, 'log').mockImplementation((message) => {
    if (message === 'Worker stopped') stopped.resolve();
  });
  const signalHandlers = new Map<string, unknown>();
  const removeListeners: Array<() => void> = [];
  const registerListener = process.on.bind(process);
  vi.spyOn(process, 'on').mockImplementation((event, listener) => {
    signalHandlers.set(event, listener);
    removeListeners.push(() => process.off(event, listener));
    return registerListener(event, listener);
  });

  try {
    const workerModule = import('../src/main.ts');
    await vi.waitFor(() => expect(createWorker).toHaveBeenCalledOnce());
    expect(createWorker).toHaveBeenCalledWith(
      expect.anything(),
      expect.any(Function),
      expect.any(Function),
      { autorun: false },
    );
    expect(run).not.toHaveBeenCalled();
    if (processingStarted) {
      ready.resolve();
      await vi.waitFor(() => expect(run).toHaveBeenCalledOnce());
    }
    const handler = signalHandlers.get(signal);
    if (typeof handler !== 'function') throw new Error(`Missing ${signal} handler`);
    handler();
    expect(close).toHaveBeenCalledWith(!processingStarted);
    if (processingStarted) {
      expect(output).not.toHaveBeenCalledWith('Worker stopped');
    }
    activeJob.resolve();
    await stopped.promise;
    ready.resolve();
    await workerModule;
    expect(output).toHaveBeenCalledWith('Worker stopped');
    if (!processingStarted) {
      expect(run).not.toHaveBeenCalled();
      expect(output).not.toHaveBeenCalledWith(expect.stringContaining('Worker ready:'));
    }
  } finally {
    try {
      activeJob.resolve();
      ready.resolve();
      const handler = signalHandlers.get(signal);
      if (typeof handler === 'function') {
        handler();
        await vi.waitFor(() => expect(output).toHaveBeenCalledWith('Worker stopped'), {
          timeout: 1_000,
        });
      }
    } finally {
      for (const removeListener of removeListeners) removeListener();
    }
  }
});
