import type { RepeatOptions } from 'bullmq';
import type { JobPriority } from './jobs.ts';

/**
 * One native BullMQ recurrence form, passed to the Job Scheduler unchanged; cron patterns are
 * evaluated in UTC. Field types come from BullMQ, which also validates the values.
 */
export type ScheduleRecurrence =
  | (Required<Pick<RepeatOptions, 'every'>> & { pattern?: never })
  | (Required<Pick<RepeatOptions, 'pattern'>> & { every?: never });

export interface ScheduleOptions {
  /** Inherited by every occurrence. Defaults to normal. */
  priority?: JobPriority;
}

export interface ScheduleHandle {
  id: string;
}
