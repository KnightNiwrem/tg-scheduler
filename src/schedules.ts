/** Fixed-interval schedules materialize ordinary-lane jobs. */
export interface ScheduleOptions {
  intervalMs: number;
  /** Planned-time anchor in Unix epoch milliseconds. */
  anchorAtMs: number;
}

export interface ScheduleHandle {
  id: string;
}
