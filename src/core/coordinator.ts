import { z } from 'zod';
import type { BotQueues } from '../backend/bullmq.ts';
import { type BotJob, decodeStoredJobData } from '../backend/stored-job.ts';
import { toError } from '../error-handler.ts';
import type { SettledJobOutcome } from '../jobs.ts';
import type { TelegramRequest } from '../telegram.ts';
import type { TelegramTransport } from '../transport/telegram-transport.ts';
import { UnimplementedError } from '../unimplemented-error.ts';

export interface BotPolicy {
  /** Shared ordinary capacity across workers; defaults to three. */
  ordinaryConcurrency?: number;
  /** Defaults to false. The urgent lane adds at most one reservation. */
  urgentBypassEnabled?: boolean;
}

const botPolicySchema = z
  .strictObject({
    ordinaryConcurrency: z.int().positive().default(3),
    urgentBypassEnabled: z.boolean().default(false),
  })
  .prefault({});

/** @throws {TypeError} when the policy has unknown or invalid settings. */
export function parseBotPolicy(policy: unknown): Required<BotPolicy> {
  const parsed = botPolicySchema.safeParse(policy);
  if (!parsed.success) {
    throw new TypeError(`Invalid policy: ${z.prettifyError(parsed.error)}`);
  }
  return parsed.data;
}

export interface CoordinatorDependencies {
  transport: TelegramTransport;
}

/**
 * Perform one attempt for a claimed job and return its outcome for the backend to persist.
 * Admission capacity is enforced by the backend before the job is claimed.
 */
export async function coordinateJob(
  job: BotJob,
  { transport }: CoordinatorDependencies,
): Promise<SettledJobOutcome> {
  let request: TelegramRequest;
  try {
    request = decodeStoredJobData(job.data).request;
  } catch (error) {
    return {
      state: 'failed',
      error: { message: `${toError(error).message}; no request was sent` },
    };
  }

  const outcome = await transport.attempt(request);
  switch (outcome.kind) {
    case 'succeeded':
      return { state: 'succeeded', result: outcome.result };
    case 'failed':
      return { state: 'failed', error: outcome.error };
    case 'rate-limited': {
      // Lane cooldowns are not implemented, and retrying without a pause would add to the flood
      // wait, so a definite 429 currently settles the job as failed. A valid server delay is kept
      // in the message so callers know when resubmitting is reasonable.
      const { retryAfterSeconds } = outcome;
      const retryHint =
        Number.isSafeInteger(retryAfterSeconds) && Number(retryAfterSeconds) > 0
          ? `; Telegram asked to retry after ${retryAfterSeconds} seconds`
          : '';
      return {
        state: 'failed',
        error: {
          message: `Telegram rate-limited the call (429); automatic 429 retry is not implemented${retryHint}`,
          telegramErrorCode: 429,
        },
      };
    }
  }
}

/** Fence stale attempts and record interrupted failures without retransmitting them. */
export async function recoverAbandonedAttempts(_queues: BotQueues, _nowMs: number): Promise<void> {
  throw new UnimplementedError('recoverAbandonedAttempts');
}
