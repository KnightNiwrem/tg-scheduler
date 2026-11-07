import { Redis } from 'ioredis';
import { z } from 'zod';

// ioredis applies URL query parameters as client options, so a query string could silently
// override the role settings below (for example `?maxRetriesPerRequest=0` on a worker). It also
// reads the database number with `parseInt` and skips `SELECT` when the result is not a number,
// so a path such as `/foo` would silently use database 0.
const valkeyUrlSchema = z.url({ protocol: /^rediss?$/ }).pipe(
  z.string().refine((value) => {
    const url = new URL(value);
    return (
      url.hostname.length > 0 &&
      /^\/(?:\d+)?$/.test(url.pathname || '/') &&
      url.search === '' &&
      url.hash === ''
    );
  }, 'Expected a redis:// or rediss:// URL with a host and optional database number; no query or fragment'),
);

/** A Valkey URL that {@link parseValkeyUrl} accepted. */
export type ValkeyUrl = string & { readonly __brand: 'ValkeyUrl' };

/**
 * Producers fail commands promptly during outages. Workers keep reconnecting and queue commands
 * offline, as BullMQ requires for blocking worker connections.
 */
export type ValkeyConnectionRole = 'producer' | 'worker';

export interface ValkeyConnectionOptions {
  valkeyUrl: ValkeyUrl;
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
export function parseValkeyUrl(valkeyUrl: unknown): ValkeyUrl {
  const parsedUrl = valkeyUrlSchema.safeParse(valkeyUrl);
  if (!parsedUrl.success) {
    const problems = parsedUrl.error.issues.map((issue) => issue.message);
    throw new TypeError(`Invalid valkeyUrl: ${problems.join('; ')}`);
  }
  return parsedUrl.data as ValkeyUrl;
}

/**
 * Create an unconnected client for injection into a BullMQ queue or worker. The caller owns it and
 * must disconnect it after closing the BullMQ object; a worker closes its own duplicated blocking
 * connection.
 */
export function createValkeyConnection(options: ValkeyConnectionOptions): Redis {
  const isWorker = options.role === 'worker';
  const connection = new Redis(options.valkeyUrl, {
    lazyConnect: true,
    connectTimeout: 5_000,
    connectionName: options.connectionName,
    maxRetriesPerRequest: isWorker ? null : 1,
    enableOfflineQueue: isWorker,
  });
  connection.on('error', options.onError);
  return connection;
}
