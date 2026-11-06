import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { basename } from 'node:path';
import { expect, onTestFinished, test } from 'vitest';

const integrationTest = test.runIf(Boolean(process.env.VALKEY_TEST_URL));
const runtimeArguments = basename(process.execPath).startsWith('deno')
  ? ['run', '-A', '--no-lock']
  : [];

function startWorkerProcess(variables: Record<string, string | undefined>) {
  const child = spawn(process.execPath, [...runtimeArguments, 'src/main.ts'], {
    env: { ...process.env, ...variables },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const closed = once(child, 'close');
  onTestFinished(async () => {
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
    await closed;
  });
  return { child, closed };
}

integrationTest.each(['SIGINT', 'SIGTERM'] as const)(
  '%s closes the worker and exits successfully',
  async (signal) => {
    const { child, closed } = startWorkerProcess({
      VALKEY_URL: process.env.VALKEY_TEST_URL,
      QUEUE_NAME: `signal-test-${crypto.randomUUID()}`,
      WORKER_CONCURRENCY: '1',
    });
    let output = '';
    let errors = '';
    child.stdout.on('data', (data) => {
      output += data.toString();
    });
    child.stderr.on('data', (data) => {
      errors += data.toString();
    });
    await expect.poll(() => output, { timeout: 5_000 }).toContain('Worker ready:');
    if (child.pid === undefined) throw new Error('Worker process did not start');
    // Deno's child.kill() misreports handled signals: https://github.com/denoland/deno/issues/37001
    process.kill(child.pid, signal);
    await expect(closed).resolves.toEqual([0, null]);
    expect(output).toContain('Worker stopped');
    expect(errors).toBe('');
  },
);

test('invalid environment exits unsuccessfully before connecting and hides credentials', async () => {
  const { child, closed } = startWorkerProcess({
    VALKEY_URL: 'https://user:secret-password@localhost',
  });
  let errors = '';
  child.stderr.on('data', (data) => {
    errors += data.toString();
  });
  const [code, signal] = await closed;
  expect(code).toBe(1);
  expect(signal).toBeNull();
  expect(errors).toContain('Invalid environment');
  expect(errors).not.toContain('secret-password');
});
