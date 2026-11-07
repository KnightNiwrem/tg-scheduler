import type { Job, JobState, Queue } from 'bullmq';
import { z } from 'zod';
import { toError } from '../error-handler.ts';
import type { JobError, JobOutcome, JobSnapshot, SettledJobOutcome } from '../jobs.ts';
import { parseTelegramMethod, type TelegramRequest } from '../telegram.ts';

/** Job data persisted in BullMQ. Jobs are read back by later processes, so reads revalidate it. */
export interface StoredJobData {
  request: TelegramRequest;
  /** Unix epoch milliseconds: the requested run time, or the submission time for immediate work. */
  originalDueAtMs: number;
}

/**
 * Successful outcomes use BullMQ's return value. Terminal errors use its failure reason;
 * previously completed failure outcomes remain readable through the return value.
 */
export type BotJob = Job<StoredJobData, SettledJobOutcome>;
export type BotQueue = Queue<StoredJobData, SettledJobOutcome>;

/**
 * BullMQ parses job data from JSON, so a non-array object payload is already plain JSON that no
 * other code references. The payload is checked in place: a Zod object or record schema would
 * rebuild it and drop own `__proto__` keys. The method gets the same outgoing-only check as
 * `submit`, so stored data cannot send an inbound or malformed method.
 */
const storedPayloadSchema = z.custom<Record<string, unknown>>(
  (value) => typeof value === 'object' && value !== null && !Array.isArray(value),
  'Expected a JSON object',
);

const storedJobDataSchema = z.object({
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
  originalDueAtMs: z.int().nonnegative(),
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

const settledJobOutcomeSchema = z.discriminatedUnion('state', [
  z.object({ state: z.literal('succeeded'), result: z.json() }),
  z.object({ state: z.literal('failed'), error: jobErrorSchema }),
  // Older workers stored ambiguous errors separately; reads expose the current failure model.
  z.object({ state: z.literal('uncertain'), error: jobErrorSchema }),
]);

/** @throws {TypeError} when stored data does not describe a supported Telegram request. */
export function decodeStoredJobData(data: unknown): StoredJobData {
  const parsed = storedJobDataSchema.safeParse(data);
  if (!parsed.success) {
    throw new TypeError(`Invalid stored job data: ${z.prettifyError(parsed.error)}`);
  }
  const { request, originalDueAtMs } = parsed.data;
  // `submit` paired the method with its payload, which is left to Telegram to check.
  return { request: request as TelegramRequest, originalDueAtMs };
}

function decodeSettledJobOutcome(value: unknown): SettledJobOutcome {
  const parsed = settledJobOutcomeSchema.safeParse(value);
  if (!parsed.success) {
    throw new TypeError(`Invalid stored job outcome: ${z.prettifyError(parsed.error)}`);
  }
  if (parsed.data.state === 'uncertain') {
    return { state: 'failed', error: parsed.data.error };
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
      return { state: 'failed', error: decodeJobFailure(job.failedReason) };
  }
}
