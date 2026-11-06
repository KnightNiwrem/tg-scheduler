import { expect, test } from 'vitest';
import { processHealthcheck } from '../src/healthcheck.ts';

test('bootstrap jobs return an observable result', async () => {
  await expect(
    processHealthcheck({ name: 'healthcheck', data: { message: 'hello' } }),
  ).resolves.toEqual({
    status: 'ok',
    message: 'hello',
  });
});

test('the bootstrap processor rejects unsupported jobs and malformed persisted data', async () => {
  await expect(processHealthcheck({ name: 'sendMessage', data: {} })).rejects.toThrow(
    'Unsupported bootstrap job',
  );
  await expect(
    processHealthcheck({ name: 'healthcheck', data: { message: 123 } }),
  ).rejects.toThrow();
});
