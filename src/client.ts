import { z } from 'zod';
import {
  type BotQueueConfig,
  type BotQueues,
  openBotQueues,
  resolveBotQueueConfig,
} from './queue/bullmq.ts';
import { enqueueJob, readJobSnapshot } from './queue/stored-job.ts';
import { warnUnawaitedQueueError } from './diagnostics.ts';
import type { JobHandle, JobSnapshot, SubmitOptions } from './jobs.ts';
import type { ScheduleHandle, ScheduleOptions, ScheduleRecurrence } from './schedules.ts';
import type { BaseSchedulerOptions } from './base-scheduler-options.ts';
import { parseTelegramRequest, type TelegramMethod, type TelegramPayload } from './telegram.ts';
import { UnimplementedError } from './unimplemented-error.ts';

export type SchedulerClientOptions = BaseSchedulerOptions;

const submitOptionsSchema = z
  .strictObject({
    runAtMs: z.int().nonnegative().optional(),
    priority: z.enum(['normal', 'urgent']).optional(),
  })
  .optional();

/**
 * Submits and inspects one bot's jobs. Construction validates options but performs no I/O; BullMQ
 * is initialized on first use.
 * The caller owns the supplied connection and controls its connection behavior. Queue connection
 * errors between operations are reported locally through `console.warn`.
 * Schedules and urgent priority are not implemented yet and reject with `UnimplementedError`.
 *
 * @throws {TypeError} when the bot identity, connection, or queue prefix is invalid.
 */
export class SchedulerClient {
  readonly #config: BotQueueConfig;
  #queues: BotQueues | undefined;
  #closing: Promise<void> | undefined;

  constructor(options: SchedulerClientOptions) {
    this.#config = resolveBotQueueConfig(options);
  }

  /**
   * Queue immediate or delayed work. Resolves once BullMQ acknowledges submission.
   * Crash durability depends on the configured store.
   *
   * @throws {TypeError} when the method, payload, or options cannot be stored for later replay.
   */
  async submit<Method extends TelegramMethod>(
    method: Method,
    payload: TelegramPayload<Method>,
    options?: SubmitOptions,
  ): Promise<JobHandle<Method>> {
    const request = parseTelegramRequest(method, payload);
    const parsedOptions = submitOptionsSchema.safeParse(options);
    if (!parsedOptions.success) {
      throw new TypeError(`Invalid submit options: ${z.prettifyError(parsedOptions.error)}`);
    }
    if (parsedOptions.data?.priority === 'urgent') {
      throw new UnimplementedError('Urgent priority submission');
    }
    const id = await enqueueJob(
      this.#openedQueues().dispatch,
      request,
      parsedOptions.data?.runAtMs,
      Date.now(),
    );
    return { id, method };
  }

  async getJob(jobId: string): Promise<JobSnapshot | undefined> {
    if (typeof jobId !== 'string' || jobId.length === 0) {
      throw new TypeError('Invalid jobId: expected a non-empty string');
    }
    return readJobSnapshot(this.#openedQueues().dispatch, this.#config.botId, jobId);
  }

  /**
   * Create a native BullMQ Job Scheduler. The recurrence reaches BullMQ unchanged, with cron
   * patterns evaluated in UTC; a native validation error rejects unchanged.
   */
  async createSchedule<Method extends TelegramMethod>(
    _method: Method,
    _payload: TelegramPayload<Method>,
    _recurrence: ScheduleRecurrence,
    _options?: ScheduleOptions,
  ): Promise<ScheduleHandle> {
    throw new UnimplementedError('SchedulerClient.createSchedule');
  }

  /**
   * Delete the schedule definition and its next occurrence if still delayed (not activated for
   * dispatch).
   * Delayed occurrences also report `queued`, including overdue ones awaiting activation.
   * Preserve `queued` jobs already activated for dispatch, plus `in-flight`, `succeeded` and
   * `failed` jobs.
   */
  async deleteSchedule(_scheduleId: string): Promise<void> {
    throw new UnimplementedError('SchedulerClient.deleteSchedule');
  }

  /**
   * List the schedule's retained jobs by their native scheduler association, including after the
   * schedule is deleted. Pass a listed ID to `getJob` for its current state and outcome.
   */
  async listScheduleJobs(_scheduleId: string): Promise<JobHandle[]> {
    throw new UnimplementedError('SchedulerClient.listScheduleJobs');
  }

  /**
   * Close this client's queue resources, leaving the caller's connection open.
   * Later operations reject.
   */
  close(): Promise<void> {
    this.#closing ??= this.#queues?.close() ?? Promise.resolve();
    return this.#closing;
  }

  #openedQueues(): BotQueues {
    if (this.#closing !== undefined) throw new Error('SchedulerClient is closed');
    this.#queues ??= openBotQueues(this.#config, warnUnawaitedQueueError);
    return this.#queues;
  }
}
