import { z } from 'zod';
import { type BotQueues, openBotQueues, resolveBotBackendConfig } from './backend/bullmq.ts';
import { enqueueJob, readJobSnapshot } from './backend/stored-job.ts';
import { warnUnawaitedQueueError } from './diagnostics.ts';
import type { JobHandle, JobSnapshot, SubmitOptions } from './jobs.ts';
import type { ScheduleHandle, ScheduleOptions, ScheduleRecurrence } from './schedules.ts';
import type { SharedBotOptions } from './shared-bot-options.ts';
import { parseTelegramRequest, type TelegramMethod, type TelegramPayload } from './telegram.ts';
import { UnimplementedError } from './unimplemented-error.ts';

export type SchedulerClientOptions = SharedBotOptions;

export interface SchedulerClient {
  /**
   * Queue immediate or delayed work. Resolves once BullMQ acknowledges submission.
   * Crash durability depends on the configured store.
   *
   * @throws {TypeError} when the method, payload, or options cannot be stored for later replay.
   */
  submit<Method extends TelegramMethod>(
    method: Method,
    payload: TelegramPayload<Method>,
    options?: SubmitOptions,
  ): Promise<JobHandle<Method>>;
  getJob(jobId: string): Promise<JobSnapshot | undefined>;
  /**
   * Create a native BullMQ Job Scheduler. The recurrence reaches BullMQ unchanged, with cron
   * patterns evaluated in UTC; a native validation error rejects unchanged.
   */
  createSchedule<Method extends TelegramMethod>(
    method: Method,
    payload: TelegramPayload<Method>,
    recurrence: ScheduleRecurrence,
    options?: ScheduleOptions,
  ): Promise<ScheduleHandle>;
  /**
   * Delete the schedule definition and its next occurrence if still delayed (not activated for
   * dispatch).
   * Delayed occurrences also report `queued`, including overdue ones awaiting activation.
   * Preserve `queued` jobs already activated for dispatch, plus `in-flight`, `succeeded` and
   * `failed` jobs.
   */
  deleteSchedule(scheduleId: string): Promise<void>;
  /**
   * List the schedule's retained jobs by their native scheduler association, including after the
   * schedule is deleted. Pass a listed ID to `getJob` for its current state and outcome.
   */
  listScheduleJobs(scheduleId: string): Promise<JobHandle[]>;
  /**
   * Close this client's queue resources, leaving the caller's connection open.
   * Later operations reject.
   */
  close(): Promise<void>;
}

const submitOptionsSchema = z
  .strictObject({
    runAtMs: z.int().nonnegative().optional(),
    priority: z.enum(['normal', 'urgent']).optional(),
  })
  .optional();

/**
 * Construction validates options but performs no I/O; BullMQ is initialized on first use.
 * The caller owns the supplied connection and controls its connection behavior. Queue connection
 * errors between operations are reported locally through `console.warn`.
 * Schedules and urgent priority are not implemented yet and reject with `UnimplementedError`.
 *
 * @throws {TypeError} when the bot identity or backend options are invalid.
 */
export function createSchedulerClient(options: SchedulerClientOptions): SchedulerClient {
  const config = resolveBotBackendConfig(options.botId, options.backend);
  let queues: BotQueues | undefined;
  let closing: Promise<void> | undefined;

  function openedQueues(): BotQueues {
    if (closing !== undefined) throw new Error('SchedulerClient is closed');
    queues ??= openBotQueues(config, warnUnawaitedQueueError);
    return queues;
  }

  return {
    async submit(method, payload, submitOptions) {
      const request = parseTelegramRequest(method, payload);
      const parsedOptions = submitOptionsSchema.safeParse(submitOptions);
      if (!parsedOptions.success) {
        throw new TypeError(`Invalid submit options: ${z.prettifyError(parsedOptions.error)}`);
      }
      if (parsedOptions.data?.priority === 'urgent') {
        throw new UnimplementedError('Urgent priority submission');
      }
      const id = await enqueueJob(
        openedQueues().dispatch,
        request,
        parsedOptions.data?.runAtMs,
        Date.now(),
      );
      return { id, method };
    },
    async getJob(jobId) {
      if (typeof jobId !== 'string' || jobId.length === 0) {
        throw new TypeError('Invalid jobId: expected a non-empty string');
      }
      return readJobSnapshot(openedQueues().dispatch, config.botId, jobId);
    },
    async createSchedule(_method, _payload, _recurrence, _options) {
      throw new UnimplementedError('SchedulerClient.createSchedule');
    },
    async deleteSchedule(_scheduleId) {
      throw new UnimplementedError('SchedulerClient.deleteSchedule');
    },
    async listScheduleJobs(_scheduleId) {
      throw new UnimplementedError('SchedulerClient.listScheduleJobs');
    },
    close() {
      closing ??= queues?.close() ?? Promise.resolve();
      return closing;
    },
  };
}
