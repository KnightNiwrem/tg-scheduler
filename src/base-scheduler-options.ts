import type { Cluster, Redis } from 'ioredis';

/**
 * Options shared by every client and worker for one bot. Connections may be separate instances
 * targeting the same Valkey deployment; the bot identity and queue prefix must match across
 * participants.
 */
export interface BaseSchedulerOptions {
  /** Stable public bot identity. */
  botId: string;
  /** Caller-owned ioredis instance, passed to BullMQ. Closing the scheduler leaves it open. */
  connection: Redis | Cluster;
  /**
   * Shared key namespace for producers and workers; bot identity supplies per-bot isolation.
   * Defaults to `tg-scheduler`. Whitespace and braces are not allowed.
   */
  queuePrefix?: string;
}
