import { expect, test } from 'vitest';
import {
  createValkeyConnection,
  parseValkeyUrl,
  type ValkeyConnectionOptions,
} from '../src/backend/valkey-connection.ts';

// Nothing listens on port 1, so commands to this address cannot succeed.
const unreachableValkeyUrl = parseValkeyUrl('redis://127.0.0.1:1');

function connectionOptions(
  overrides: Partial<ValkeyConnectionOptions> = {},
): ValkeyConnectionOptions {
  return {
    valkeyUrl: parseValkeyUrl('redis://localhost:6379'),
    role: 'producer',
    connectionName: 'test-connection',
    onError: () => {},
    ...overrides,
  };
}

function rejectionOf(valkeyUrl: string): unknown {
  try {
    parseValkeyUrl(valkeyUrl);
  } catch (error) {
    return error;
  }
  throw new Error('Expected the Valkey URL to be rejected');
}

test.each([
  'redis://localhost',
  'redis://localhost:6379/0',
  'rediss://user:password@valkey.example:6380/2',
])('accepts Valkey URL %s without connecting', (valkeyUrl) => {
  for (const role of ['producer', 'worker'] as const) {
    const connection = createValkeyConnection(
      connectionOptions({ valkeyUrl: parseValkeyUrl(valkeyUrl), role }),
    );
    try {
      expect(connection.status).toBe('wait');
    } finally {
      connection.disconnect();
    }
  }
});

test.each([
  '',
  'valkey:6379',
  'https://valkey:6379',
  'redis:///0',
  'redis://valkey:65536',
  'redis://valkey/foo',
  'redis://valkey/-1',
  'redis://valkey/1.5',
  'redis://valkey/0?maxRetriesPerRequest=0',
  'redis://valkey/0#fragment',
])('rejects invalid or unsupported Valkey URL %s', (valkeyUrl) => {
  const error = rejectionOf(valkeyUrl);
  expect(error).toBeInstanceOf(TypeError);
  expect(String(error)).toMatch(/^TypeError: Invalid valkeyUrl: /);
});

test.each([
  'https://user:private-password@valkey',
  'redis://user:private-password@valkey/0?tls=true',
])('rejection of %s does not expose URL credentials', (valkeyUrl) => {
  expect(String(rejectionOf(valkeyUrl))).not.toContain('private-password');
});

test.each([
  ['producer', 1],
  ['worker', null],
] as const)('%s connections use maxRetriesPerRequest %s', (role, maxRetriesPerRequest) => {
  const connection = createValkeyConnection(connectionOptions({ role }));
  try {
    // The architecture requires null for workers; a producer retries once, then fails.
    expect(connection.options.maxRetriesPerRequest).toBe(maxRetriesPerRequest);
  } finally {
    connection.disconnect();
  }
});

test('producer commands fail promptly instead of waiting for a connection', async () => {
  const connection = createValkeyConnection(
    connectionOptions({ valkeyUrl: unreachableValkeyUrl, role: 'producer' }),
  );
  try {
    await expect(connection.ping()).rejects.toThrow('enableOfflineQueue');
  } finally {
    connection.disconnect();
  }
});

test('worker commands wait for a connection and report connection errors', async () => {
  const errors: Error[] = [];
  const connection = createValkeyConnection(
    connectionOptions({
      valkeyUrl: unreachableValkeyUrl,
      role: 'worker',
      onError: (error) => errors.push(error),
    }),
  );
  // Not awaited after disconnect: ioredis leaves offline commands pending when a reconnecting
  // client is disconnected.
  const ping = connection.ping().then(
    () => 'answered',
    () => 'rejected',
  );
  try {
    await expect.poll(() => errors.length).toBeGreaterThan(0);
    const pending = Symbol('pending');
    expect(await Promise.race([ping, Promise.resolve(pending)])).toBe(pending);
  } finally {
    connection.disconnect();
  }
});
