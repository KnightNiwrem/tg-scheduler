import type { Job } from 'bullmq';
import type { BotQueues } from '../backend/bullmq.ts';
import type { TelegramRequest } from '../telegram.ts';
import type { TelegramAttemptOutcome, TelegramTransport } from '../transport/grammy.ts';
import { UnimplementedError } from '../unimplemented-error.ts';

export interface BotPolicy {
  /** Shared ordinary capacity across workers; defaults to one. */
  ordinaryConcurrency?: number;
  /** Defaults to false. The urgent lane adds at most one reservation. */
  urgentBypassEnabled?: boolean;
}

export interface CoordinatorDependencies {
  queues: BotQueues;
  transport: TelegramTransport;
  policy: BotPolicy;
}

/** Admit atomically, perform one attempt, and persist its outcome or durable 429 retry. */
export async function coordinateJob(
  _job: Job<TelegramRequest, TelegramAttemptOutcome>,
  _dependencies: CoordinatorDependencies,
): Promise<void> {
  throw new UnimplementedError('coordinateJob');
}

/** Atomically coalesce missed unmaterialized occurrences and advance their planned times. */
export async function materializeDueOccurrences(_queues: BotQueues, _nowMs: number): Promise<void> {
  throw new UnimplementedError('materializeDueOccurrences');
}

/** Fence stale attempts and expose ambiguous sends as uncertain without retransmitting them. */
export async function recoverAbandonedAttempts(_queues: BotQueues, _nowMs: number): Promise<void> {
  throw new UnimplementedError('recoverAbandonedAttempts');
}
