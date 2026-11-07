import { Redis } from 'ioredis';
import { z } from 'zod';

// ioredis applies URL query parameters as client options, so a query string could silently
// override the role settings below (for example `?maxRetriesPerRequest=0` on a worker).
const valkeyUrlSchema = z.url({ protocol: /^rediss?$/ }).pipe(
  z.string().refine((value) => {
    const url = new URL(value);
    return (
      url.hostname.length > 0 &&
      url.port !== '0' &&
      /^\/(?:0|[1-9]\d*)?$/.test(url.pathname || '/') &&
      Number.isSafeInteger(Number(url.pathname.slice(1))) &&
      url.search === '' &&
      url.hash === ''
    );
  }, 'Expected a redis:// or rediss:// URL with a host and optional database number; no query or fragment'),
);

/**
 * Producers fail commands promptly during outages. Workers keep reconnecting and queue commands
 * offline, as BullMQ requires for blocking worker connections.
 */
export type ValkeyConnectionRole = 'producer' | 'worker';

export interface ValkeyConnectionOptions {
  valkeyUrl: string;
  role: ValkeyConnectionRole;
  /** Reported in `CLIENT LIST` so operators can attribute connections. */
  connectionName: string;
  onError: (error: Error) => void;
}

/**
 * Validate a Valkey URL without connecting.
 *
 * @throws {TypeError} when `valkeyUrl` is invalid. The message omits the URL and its credentials.
 */
export function parseValkeyUrl(valkeyUrl: unknown): string {
  const parsedUrl = valkeyUrlSchema.safeParse(valkeyUrl);
  if (!parsedUrl.success) {
    const problems = parsedUrl.error.issues.map((issue) => issue.message);
    throw new TypeError(`Invalid valkeyUrl: ${problems.join('; ')}`);
  }
  return parsedUrl.data;
}

/**
 * Create an unconnected client for injection into a BullMQ queue or worker. The caller owns it and
 * must disconnect it after closing the BullMQ object; a worker closes its own duplicated blocking
 * connection.
 *
 * @throws {TypeError} when `valkeyUrl` is invalid. The message omits the URL and its credentials.
 */
export function createValkeyConnection(options: ValkeyConnectionOptions): Redis {
  const valkeyUrl = parseValkeyUrl(options.valkeyUrl);
  const isWorker = options.role === 'worker';
  const connection = new Redis(valkeyUrl, {
    lazyConnect: true,
    connectTimeout: 5_000,
    connectionName: options.connectionName,
    maxRetriesPerRequest: isWorker ? null : 1,
    enableOfflineQueue: isWorker,
  });
  connection.on('error', options.onError);
  return connection;
}
