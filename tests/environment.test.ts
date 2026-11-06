import { expect, test } from 'vitest';
import { readEnvironment } from '../src/environment.ts';

test('requires a Valkey address and supplies bootstrap defaults', () => {
  expect(readEnvironment({ VALKEY_URL: 'redis://localhost:6379' })).toEqual({
    VALKEY_URL: 'redis://localhost:6379',
    QUEUE_NAME: 'tg-scheduler-bootstrap',
    WORKER_CONCURRENCY: 1,
  });
  expect(() => readEnvironment({})).toThrow('VALKEY_URL');
});

test('parses configured values and ignores unrelated process variables', () => {
  expect(
    readEnvironment({
      VALKEY_URL: 'rediss://user:password@valkey.example:6380/2',
      QUEUE_NAME: 'local_test-2',
      WORKER_CONCURRENCY: '3',
      PATH: '/usr/bin',
    }),
  ).toEqual({
    VALKEY_URL: 'rediss://user:password@valkey.example:6380/2',
    QUEUE_NAME: 'local_test-2',
    WORKER_CONCURRENCY: 3,
  });
});

test.each([
  '',
  'valkey:6379',
  'https://valkey:6379',
  'redis:///0',
  'redis://valkey:0',
  'redis://valkey:65536',
  'redis://valkey/foo',
  'redis://valkey/-1',
  'redis://valkey/1.5',
  'redis://valkey/9007199254740992',
  'redis://valkey/0?maxRetriesPerRequest=0',
  'redis://valkey/0#fragment',
])('rejects invalid or unsupported Valkey URL %s', (VALKEY_URL) => {
  expect(() => readEnvironment({ VALKEY_URL })).toThrow('VALKEY_URL');
});

test.each(['', '0', '-1', '1.5', 'NaN', 'Infinity', ' 2 ', '1e2', '9007199254740992'])(
  'rejects invalid concurrency %s',
  (WORKER_CONCURRENCY) => {
    expect(() => readEnvironment({ VALKEY_URL: 'redis://localhost', WORKER_CONCURRENCY })).toThrow(
      'WORKER_CONCURRENCY',
    );
  },
);

test.each(['', 'bot:ordinary', 'two queues', '../queue'])(
  'rejects invalid queue name %s',
  (QUEUE_NAME) => {
    expect(() => readEnvironment({ VALKEY_URL: 'redis://localhost', QUEUE_NAME })).toThrow(
      'QUEUE_NAME',
    );
  },
);

test('configuration errors name the field without exposing URL credentials', () => {
  expect(() => readEnvironment({ VALKEY_URL: 'https://user:private-password@valkey' })).toThrow(
    'VALKEY_URL',
  );
  try {
    readEnvironment({ VALKEY_URL: 'https://user:private-password@valkey' });
  } catch (error) {
    expect(String(error)).not.toContain('private-password');
  }
});
