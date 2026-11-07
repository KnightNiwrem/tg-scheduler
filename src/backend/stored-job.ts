import type { Job, JobState, Queue } from 'bullmq';
import { z } from 'zod';
import type { JobOutcome, JobSnapshot, SettledJobOutcome } from '../jobs.ts';
import type { TelegramRequest } from '../telegram.ts';

/** Job data persisted in BullMQ. Jobs are read back by later processes, so reads revalidate it. */
export interface StoredJobData {
  request: TelegramRequest;
  /** Unix epoch milliseconds: the requested run time, or the submission time for immediate work. */
  originalDueAtMs: number;
}

/**
 * A stored job holds its Telegram request and, once the coordinator settles it, its outcome as the
 * BullMQ return value.
 */
export type BotJob = Job<StoredJobData, SettledJobOutcome>;
export type BotQueue = Queue<StoredJobData, SettledJobOutcome>;

/**
 * BullMQ parses job data from JSON, so a non-array object payload is already plain JSON that no
 * other code references. The payload is checked in place: a Zod object or record schema would
 * rebuild it and drop own `__proto__` keys.
 */
const storedPayloadSchema = z.custom<Record<string, unknown>>(
  (value) => typeof value === 'object' && value !== null && !Array.isArray(value),
  'Expected a JSON object',
);

const storedJobDataSchema = z.object({
  request: z.object({ method: z.string(), payload: storedPayloadSchema }),
  originalDueAtMs: z.int().nonnegative(),
});

const jobErrorSchema = z.object({
  message: z.string(),
  telegramErrorCode: z.int().optional(),
});

const settledJobOutcomeSchema = z.discriminatedUnion('state', [
  z.object({ state: z.literal('succeeded'), result: z.json() }),
  z.object({ state: z.literal('failed'), error: jobErrorSchema }),
  z.object({ state: z.literal('uncertain'), error: jobErrorSchema }),
]);

/** @throws {TypeError} when stored data does not describe a supported Telegram request. */
export function decodeStoredJobData(data: unknown): StoredJobData {
  const parsed = storedJobDataSchema.safeParse(data);
  if (!parsed.success) {
    throw new TypeError(`Invalid stored job data: ${z.prettifyError(parsed.error)}`);
  }
  const { request, originalDueAtMs } = parsed.data;
  // `submit` paired the method with its payload; TypeScript cannot correlate the two values.
  return { request: request as TelegramRequest, originalDueAtMs };
}

function decodeSettledJobOutcome(value: unknown): SettledJobOutcome {
  const parsed = settledJobOutcomeSchema.safeParse(value);
  if (!parsed.success) {
    throw new TypeError(`Invalid stored job outcome: ${z.prettifyError(parsed.error)}`);
  }
  // Results are stored exactly as Telegram returned them for the job's own method.
  return parsed.data as SettledJobOutcome;
}

/**
 * Persist accepted work. BullMQ's delayed set activates future work without producer involvement.
 *
 * @returns The durable job ID.
 */
export async function enqueueJob(
  queue: BotQueue,
  request: TelegramRequest,
  runAtMs: number | undefined,
  nowMs: number,
): Promise<string> {
  const originalDueAtMs = runAtMs ?? nowMs;
  const job = await queue.add(
    request.method,
    { request, originalDueAtMs },
    {
      timestamp: nowMs,
      delay: Math.max(0, originalDueAtMs - nowMs),
      // An unsettled attempt may already have reached Telegram, so BullMQ must never retry it.
      attempts: 1,
    },
  );
  if (job.id === undefined) throw new Error('BullMQ did not assign a job ID');
  return job.id;
}

/**
 * Read a job's current snapshot, or `undefined` when no such job exists.
 *
 * The state is read before the job, and finished states are final, so a finished state always has
 * its outcome. A job that finishes between the reads is reported in its earlier state.
 *
 * @throws {TypeError} when the stored job data or outcome is invalid.
 */
export async function readJobSnapshot(
  queue: BotQueue,
  botId: string,
  jobId: string,
): Promise<JobSnapshot | undefined> {
  const engineState = await queue.getJobState(jobId);
  if (engineState === 'unknown') return undefined;
  const job = await queue.getJob(jobId);
  if (job === undefined) return undefined;
  const { request, originalDueAtMs } = decodeStoredJobData(job.data);
  const snapshot = {
    id: jobId,
    method: request.method,
    botId,
    originalDueAtMs,
    lane: 'ordinary' as const,
    ...jobOutcome(engineState, job),
  };
  // The stored result belongs to the stored method; TypeScript cannot correlate the two values.
  return snapshot as JobSnapshot;
}

function jobOutcome(engineState: JobState, job: BotJob): JobOutcome {
  switch (engineState) {
    case 'waiting':
    case 'prioritized':
    case 'delayed':
    case 'waiting-children':
      return { state: 'queued' };
    case 'active':
      return { state: 'in-flight' };
    case 'completed':
      return decodeSettledJobOutcome(job.returnvalue);
    case 'failed':
      // The coordinator settles every attempt it completes, so BullMQ records a failure only when
      // processing was interrupted: a lost lock with stalled recovery disabled, or a processor
      // error. Either can follow a transmitted request.
      return {
        state: 'uncertain',
        error: {
          message: `Processing was interrupted after admission; the request may have reached Telegram (${job.failedReason})`,
        },
      };
  }
}
