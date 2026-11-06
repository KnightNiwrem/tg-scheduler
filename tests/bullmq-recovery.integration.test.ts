import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { basename } from 'node:path';
import { Queue, Worker } from 'bullmq';
import { Redis } from 'ioredis';
import { expect, test } from 'vitest';
import { readEnvironment } from '../src/environment.ts';

const integrationTest = test.runIf(Boolean(process.env.VALKEY_TEST_URL));
const runtimeArguments = basename(process.execPath).startsWith('deno')
  ? ['run', '-A', '--no-lock']
  : [];

function recoveryBackend() {
  const environment = readEnvironment({
    VALKEY_URL: process.env.VALKEY_TEST_URL,
    QUEUE_NAME: `recovery-test-${crypto.randomUUID()}`,
  });
  const errors: Error[] = [];
  const connection = new Redis(environment.VALKEY_URL, { maxRetriesPerRequest: null });
  connection.on('error', (error) => errors.push(error));
  const queue = new Queue(environment.QUEUE_NAME, { connection });
  queue.on('error', (error) => errors.push(error));
  return { connection, environment, errors, queue };
}

integrationTest.each([
  {
    stallLimit: 'default',
    maxStalledCount: undefined,
    expectedEffects: 2,
    expectedState: 'completed',
  },
  { stallLimit: 'zero', maxStalledCount: 0, expectedEffects: 1, expectedState: 'failed' },
])(
  'native $stallLimit stall limit produces $expectedEffects accepted effects and a $expectedState outcome after a crash',
  async ({ maxStalledCount, expectedEffects, expectedState }) => {
    const { connection, environment, errors, queue } = recoveryBackend();
    const effectLedgerKey = `${queue.toKey('')}:accepted-effects`;
    const child = spawn(
      process.execPath,
      [
        ...runtimeArguments,
        'tests/fixtures/accepted-effect-worker.ts',
        environment.QUEUE_NAME,
        effectLedgerKey,
      ],
      { env: process.env, stdio: ['ignore', 'pipe', 'pipe'] },
    );
    const closed = once(child, 'close');
    let childErrors = '';
    child.stderr.on('data', (data) => {
      childErrors += data.toString();
    });
    let replacement: Worker | undefined;
    try {
      await queue.waitUntilReady();
      const ambiguous = await queue.add('send', {});
      await expect.poll(() => connection.llen(effectLedgerKey), { timeout: 5_000 }).toBe(1);
      expect(await ambiguous.getState()).toBe('active');
      const firstAttempt = await queue.getJob(ambiguous.id ?? '');
      expect(firstAttempt?.attemptsStarted).toBe(1);
      expect(firstAttempt?.returnvalue).toBeNull();

      if (child.pid === undefined) throw new Error('Worker process did not start');
      process.kill(child.pid, 'SIGKILL');
      await closed;
      const unrelated = await queue.add('unrelated', {});

      replacement = new Worker(
        environment.QUEUE_NAME,
        async (job, token) => {
          if (!token) throw new Error('Expected an attempt ownership token');
          if (job.name === 'send') await connection.rpush(effectLedgerKey, token);
          return { processedBy: 'replacement', name: job.name };
        },
        {
          connection,
          lockDuration: 3_000,
          stalledInterval: 100,
          ...(maxStalledCount === undefined ? {} : { maxStalledCount }),
        },
      );
      replacement.on('error', (error) => errors.push(error));
      await replacement.waitUntilReady();
      await expect.poll(() => ambiguous.getState(), { timeout: 6_000 }).toBe(expectedState);
      await expect.poll(() => unrelated.getState(), { timeout: 6_000 }).toBe('completed');

      const settled = await queue.getJob(ambiguous.id ?? '');
      expect(settled?.attemptsStarted).toBe(2);
      expect(settled?.stalledCounter).toBe(1);
      const acceptedAttempts = await connection.lrange(effectLedgerKey, 0, -1);
      expect(acceptedAttempts).toHaveLength(expectedEffects);
      expect(new Set(acceptedAttempts).size).toBe(expectedEffects);
      if (expectedState === 'completed') {
        expect(settled?.returnvalue).toEqual({ processedBy: 'replacement', name: 'send' });
      } else {
        expect(settled?.failedReason).toBe('job stalled more than allowable limit');
        expect(settled?.returnvalue).toBeNull();
      }
      expect((await queue.getJob(unrelated.id ?? ''))?.returnvalue).toEqual({
        processedBy: 'replacement',
        name: 'unrelated',
      });
      expect(childErrors).toBe('');
      expect(errors).toEqual([]);
    } finally {
      if (child.exitCode === null && child.signalCode === null && child.pid !== undefined) {
        process.kill(child.pid, 'SIGKILL');
      }
      await closed;
      await replacement?.close();
      try {
        await queue.obliterate({ force: true });
        await connection.del(effectLedgerKey);
      } finally {
        await queue.close();
        connection.disconnect();
      }
    }
  },
  12_000,
);

integrationTest(
  'native ownership tokens fence stale success and failure settlement after recovery',
  async () => {
    const { connection, environment, errors, queue } = recoveryBackend();
    const staleToken = `stale-${crypto.randomUUID()}`;
    const staleWorker = new Worker<unknown, string>(environment.QUEUE_NAME, undefined, {
      connection,
      autorun: false,
      skipLockRenewal: true,
      skipStalledCheck: true,
      lockDuration: 300,
    });
    staleWorker.on('error', (error) => errors.push(error));
    const admitted = Promise.withResolvers<string>();
    const finish = Promise.withResolvers<string>();
    let replacement: Worker | undefined;
    try {
      await Promise.all([queue.waitUntilReady(), staleWorker.waitUntilReady()]);
      const submitted = await queue.add('send', {});
      const staleJob = await staleWorker.getNextJob(staleToken, { block: false });
      if (!staleJob) throw new Error('Expected the first worker to claim the submitted job');
      expect(staleJob.id).toBe(submitted.id);
      expect(staleJob.attemptsStarted).toBe(1);

      replacement = new Worker(
        environment.QUEUE_NAME,
        async (_job, token) => {
          if (!token) throw new Error('Expected a replacement ownership token');
          admitted.resolve(token);
          return finish.promise;
        },
        { connection, lockDuration: 3_000, stalledInterval: 100 },
      );
      replacement.on('error', (error) => errors.push(error));
      await expect
        .poll(async () => (await queue.getJob(submitted.id ?? ''))?.attemptsStarted, {
          timeout: 6_000,
        })
        .toBe(2);
      const replacementToken = await admitted.promise;
      expect(replacementToken).not.toBe(staleToken);

      await expect(staleJob.moveToCompleted('stale-success', staleToken, false)).rejects.toThrow(
        'Lock mismatch',
      );
      await expect(
        staleJob.moveToFailed(new Error('stale-failure'), staleToken, false),
      ).rejects.toThrow('Lock mismatch');
      expect(await submitted.getState()).toBe('active');
      expect((await queue.getJob(submitted.id ?? ''))?.returnvalue).toBeNull();
      finish.resolve('current-success');
      await expect.poll(() => submitted.getState()).toBe('completed');
      await expect(
        staleJob.moveToCompleted('late-stale-success', staleToken, false),
      ).rejects.toThrow('Missing lock');
      expect((await queue.getJob(submitted.id ?? ''))?.returnvalue).toBe('current-success');
      expect(errors).toEqual([]);
    } finally {
      finish.resolve('current-success');
      await replacement?.close();
      await staleWorker.close();
      try {
        await queue.obliterate({ force: true });
      } finally {
        await queue.close();
        connection.disconnect();
      }
    }
  },
);
