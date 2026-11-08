import type { Job, JobState, Queue } from 'bullmq';
import { z } from 'zod';
import { toError } from '../diagnostics.ts';
import type { JobError, JobOutcome, JobSnapshot, SettledJobOutcome } from '../jobs.ts';
import { parseTelegramMethod, type TelegramRequest } from '../telegram.ts';

/** Job data persisted in BullMQ. Jobs are read back by later processes, so reads revalidate it. */
export interface StoredJobData {
  request: TelegramRequest;
}

/**
 * The outcome stored as BullMQ's return value. Terminal failures are stored in the native failure
 * reason instead, so a return value is always a success.
 */
export type StoredJobSuccess = Extract<SettledJobOutcome, { state: 'succeeded' }>;

export type BotJob = Job<StoredJobData, StoredJobSuccess>;
export type BotQueue = Queue<StoredJobData, StoredJobSuccess>;

/**
 * BullMQ parses job data from JSON, so a non-array object payload is already plain JSON that no
 * other code references, so only its top-level shape is checked, in place rather than rebuilt by a
 * Zod object or record schema. The method gets the same outgoing-only check as
 * `submit`, so stored data cannot send an inbound or malformed method.
 */
const storedPayloadSchema = z.custom<Record<string, unknown>>(
  (value) => typeof value === 'object' && value !== null && !Array.isArray(value),
  'Expected a JSON object',
);

const storedJobSchema = z
  .object({
    data: z.object({
      request: z.object({
        method: z.unknown().transform((method, context) => {
          try {
            return parseTelegramMethod(method);
          } catch (error) {
            context.addIssue({ code: 'custom', message: toError(error).message });
            return z.NEVER;
          }
        }),
        payload: storedPayloadSchema,
      }),
    }),
    timestamp: z.int().nonnegative(),
    opts: z.object({ delay: z.int().nonnegative().default(0) }),
  })
  .refine(({ timestamp, opts }) => Number.isSafeInteger(timestamp + opts.delay), {
    error: 'Scheduled time must be a safe integer number of milliseconds',
  });

const jobErrorSchema = z.object({
  message: z.string(),
  telegramErrorCode: z.int().optional(),
});

const storedFailurePrefix = 'tg-scheduler:failure:';
const storedFailureSchema = z.object({ version: z.literal(1), error: jobErrorSchema });

/** Encode error metadata in the reason BullMQ writes atomically when moving a job to failed. */
export function encodeJobFailure(error: JobError): string {
  return storedFailurePrefix + JSON.stringify({ version: 1, error });
}

function decodeJobFailure(reason: string): JobError {
  if (!reason.startsWith(storedFailurePrefix)) {
    // Native stalled failures and unexpected processor errors have no structured outcome.
    return {
      message: `Processing was interrupted after admission; the request may have reached Telegram (${reason})`,
    };
  }
  let value: unknown;
  try {
    value = JSON.parse(reason.slice(storedFailurePrefix.length));
  } catch {
    throw new TypeError('Invalid stored job failure: expected JSON');
  }
  const parsed = storedFailureSchema.safeParse(value);
  if (!parsed.success) {
    throw new TypeError(`Invalid stored job failure: ${z.prettifyError(parsed.error)}`);
  }
  return parsed.data.error;
}

const storedSuccessSchema = z.object({ state: z.literal('succeeded'), result: z.json() });

/**
 * Validate the stored request and native timing before dispatch or snapshot creation.
 * @throws {TypeError} when the stored request or scheduling metadata is invalid.
 */
export function decodeStoredJob(job: BotJob): {
  request: TelegramRequest;
  scheduledForMs: number;
} {
  const parsed = storedJobSchema.safeParse(job);
  if (!parsed.success) {
    throw new TypeError(`Invalid stored job: ${z.prettifyError(parsed.error)}`);
  }
  const { data, timestamp, opts } = parsed.data;
  // Telegram checks method-specific payload fields; stored reads enforce the outgoing JSON shape.
  return { request: data.request as TelegramRequest, scheduledForMs: timestamp + opts.delay };
}

function decodeStoredSuccess(value: unknown): StoredJobSuccess {
  const parsed = storedSuccessSchema.safeParse(value);
  if (!parsed.success) {
    throw new TypeError(`Invalid stored job outcome: ${z.prettifyError(parsed.error)}`);
  }
  // Results are stored exactly as Telegram returned them for the job's own method.
  return parsed.data as StoredJobSuccess;
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
  const job = await queue.add(
    request.method,
    { request },
    {
      timestamp: nowMs,
      delay: Math.max(0, (runAtMs ?? nowMs) - nowMs),
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
 * @throws {TypeError} when the stored request, native timing or outcome is invalid.
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
  const { request, scheduledForMs } = decodeStoredJob(job);
  const snapshot = {
    id: jobId,
    method: request.method,
    botId,
    scheduledForMs,
    // Priorities are not implemented; every stored job is normal priority.
    priority: 'normal' as const,
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
      return decodeStoredSuccess(job.returnvalue);
    case 'failed':
      return { state: 'failed', error: decodeJobFailure(job.failedReason) };
  }
}
