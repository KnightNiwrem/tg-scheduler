/** Native BullMQ recurrence forms; schedule creation is not implemented yet. */
export type ScheduleOptions =
  | {
      /** Fixed interval in milliseconds, using BullMQ's native initial scheduling. */
      every: number;
      pattern?: never;
    }
  | {
      /** Native BullMQ cron expression, evaluated in UTC. */
      pattern: string;
      every?: never;
    };

export interface ScheduleHandle {
  id: string;
}
