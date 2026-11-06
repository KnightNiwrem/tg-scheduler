import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { basename } from 'node:path';
import { expect, test } from 'vitest';

const integrationTest = test.runIf(Boolean(process.env.VALKEY_TEST_URL));
const runtimeArguments = basename(process.execPath).startsWith('deno')
  ? ['run', '-A', '--no-lock']
  : [];

integrationTest.each(['SIGINT', 'SIGTERM'] as const)(
  '%s closes the worker and exits successfully',
  async (signal) => {
    const child = spawn(process.execPath, [...runtimeArguments, 'src/main.ts'], {
      env: {
        ...process.env,
        VALKEY_URL: process.env.VALKEY_TEST_URL,
        QUEUE_NAME: `signal-test-${crypto.randomUUID()}`,
        WORKER_CONCURRENCY: '1',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let output = '';
    let errors = '';
    child.stdout.on('data', (data) => {
      output += data.toString();
    });
    child.stderr.on('data', (data) => {
      errors += data.toString();
    });
    const exited = once(child, 'exit');
    try {
      await expect.poll(() => output, { timeout: 5_000 }).toContain('Worker ready:');
      if (child.pid === undefined) throw new Error('Worker process did not start');
      // Deno's child.kill() misreports handled signals: https://github.com/denoland/deno/issues/37001
      process.kill(child.pid, signal);
      await expect(exited).resolves.toEqual([0, null]);
      expect(output).toContain('Worker stopped');
      expect(errors).toBe('');
    } finally {
      if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
      await exited;
    }
  },
);

test('invalid environment exits unsuccessfully before connecting and hides credentials', async () => {
  const child = spawn(process.execPath, [...runtimeArguments, 'src/main.ts'], {
    env: { ...process.env, VALKEY_URL: 'https://user:secret-password@localhost' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let errors = '';
  child.stderr.on('data', (data) => {
    errors += data.toString();
  });
  const [code, signal] = await once(child, 'exit');
  expect(code).toBe(1);
  expect(signal).toBeNull();
  expect(errors).toContain('Invalid environment');
  expect(errors).not.toContain('secret-password');
});
