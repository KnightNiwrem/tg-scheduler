import { z } from 'zod';
import { type BotQueues, openBotQueues, resolveBotBackendConfig } from './backend/bullmq.ts';
import { enqueueJob, readJobSnapshot } from './backend/stored-job.ts';
import { type ErrorHandler, reportErrorToConsole } from './error-handler.ts';
import type { JobHandle, JobSnapshot, SubmitOptions } from './jobs.ts';
import type { ScheduleHandle, ScheduleOptions } from './schedules.ts';
import type { SharedBotOptions } from './shared-bot-options.ts';
import { parseTelegramRequest, type TelegramMethod, type TelegramPayload } from './telegram.ts';
import { UnimplementedError } from './unimplemented-error.ts';

export interface SchedulerClientOptions extends SharedBotOptions {
  /** Receives backend connection errors that no operation awaits. Defaults to `console.error`. */
  onError?: ErrorHandler;
}

export interface SchedulerClient {
  /**
   * Durably accept immediate or delayed work. Resolves once Valkey has stored the job.
   *
   * @throws {TypeError} when the method, payload, or options cannot be stored for later replay.
   */
  submit<Method extends TelegramMethod>(
    method: Method,
    payload: TelegramPayload<Method>,
    options?: SubmitOptions,
  ): Promise<JobHandle<Method>>;
  getJob(jobId: string): Promise<JobSnapshot | undefined>;
  createSchedule<Method extends TelegramMethod>(
    method: Method,
    payload: TelegramPayload<Method>,
    options: ScheduleOptions,
  ): Promise<ScheduleHandle>;
  /** Stop future occurrence creation while preserving jobs already materialized. */
  disableSchedule(scheduleId: string): Promise<void>;
  /** Release the client's backend connection. Later operations reject. */
  close(): Promise<void>;
}

const submitOptionsSchema = z
  .strictObject({
    runAtMs: z.int().nonnegative().optional(),
    lane: z.enum(['ordinary', 'urgent']).optional(),
  })
  .optional();

/**
 * Construction validates options but performs no I/O; the backend connection opens on first use.
 * Schedules and the urgent lane are not implemented yet and reject with `UnimplementedError`.
 *
 * @throws {TypeError} when the bot identity or backend options are invalid.
 */
export function createSchedulerClient(options: SchedulerClientOptions): SchedulerClient {
  const config = resolveBotBackendConfig(options.botId, options.backend);
  const onError = options.onError ?? reportErrorToConsole;
  let queues: BotQueues | undefined;
  let closing: Promise<void> | undefined;

  function openedQueues(): BotQueues {
    if (closing !== undefined) throw new Error('SchedulerClient is closed');
    queues ??= openBotQueues(config, 'producer', onError);
    return queues;
  }

  return {
    async submit(method, payload, submitOptions) {
      const request = parseTelegramRequest(method, payload);
      const parsedOptions = submitOptionsSchema.safeParse(submitOptions);
      if (!parsedOptions.success) {
        throw new TypeError(`Invalid submit options: ${z.prettifyError(parsedOptions.error)}`);
      }
      if (parsedOptions.data?.lane === 'urgent') {
        throw new UnimplementedError('Urgent lane submission');
      }
      const id = await enqueueJob(
        openedQueues().ordinary,
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
      return readJobSnapshot(openedQueues().ordinary, config.botId, jobId);
    },
    async createSchedule(_method, _payload, _options) {
      throw new UnimplementedError('SchedulerClient.createSchedule');
    },
    async disableSchedule(_scheduleId) {
      throw new UnimplementedError('SchedulerClient.disableSchedule');
    },
    close() {
      closing ??= queues?.close() ?? Promise.resolve();
      return closing;
    },
  };
}
