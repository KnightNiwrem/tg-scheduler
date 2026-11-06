import type { BullMqBackendOptions } from './backend/bullmq.ts';
import type { JobHandle, JobSnapshot, SubmitOptions } from './jobs.ts';
import type { ScheduleHandle, ScheduleOptions } from './schedules.ts';
import type { TelegramMethod, TelegramPayload } from './telegram.ts';
import { UnimplementedError } from './unimplemented-error.ts';

export interface SchedulerClientOptions {
  /** Stable public bot identity, shared by every producer and worker for this bot. */
  botId: string;
  backend: BullMqBackendOptions;
}

export interface SchedulerClient {
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
  close(): Promise<void>;
}

/** Construction performs no I/O. All operations currently reject with UnimplementedError. */
export function createSchedulerClient(_options: SchedulerClientOptions): SchedulerClient {
  return {
    async submit(_method, _payload, _options) {
      throw new UnimplementedError('SchedulerClient.submit');
    },
    async getJob(_jobId) {
      throw new UnimplementedError('SchedulerClient.getJob');
    },
    async createSchedule(_method, _payload, _options) {
      throw new UnimplementedError('SchedulerClient.createSchedule');
    },
    async disableSchedule(_scheduleId) {
      throw new UnimplementedError('SchedulerClient.disableSchedule');
    },
    async close() {
      throw new UnimplementedError('SchedulerClient.close');
    },
  };
}
