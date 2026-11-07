/** Fixed-interval scheduling options; schedule creation is not implemented yet. */
export interface ScheduleOptions {
  intervalMs: number;
  /** Planned-time anchor in Unix epoch milliseconds. */
  anchorAtMs: number;
}

export interface ScheduleHandle {
  id: string;
}
