import type { DeliveryLane } from './jobs.ts';

export interface ScheduleOptions {
  intervalMs: number;
  /** Planned-time anchor in Unix epoch milliseconds. */
  anchorAtMs: number;
  lane?: DeliveryLane;
}

export interface ScheduleHandle {
  id: string;
}
