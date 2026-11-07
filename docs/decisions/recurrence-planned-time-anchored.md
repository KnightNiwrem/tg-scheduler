# Fixed-interval recurrence anchored to planned times

- **Status:** provisional
- **Human-confirmed:** no

## Decision

Schedules recur at a fixed interval in absolute UTC timestamps, anchored to planned times rather
than completion times.

- After downtime, missed occurrences that were never materialized coalesce into one job for the
  latest missed time, and the schedule advances to the next future occurrence.
- Each occurrence is created uniquely, atomically with advancing the schedule.
- Coalescing preserves already accepted jobs.
- Disabling a schedule stops future occurrences and leaves materialized jobs intact.
- Occurrences use the ordinary lane.

Calendar cron expressions, time zones and alternative missed-occurrence policies are outside the
first slice. Native BullMQ job schedulers are usable only where their semantics match this decision.

## Context

Planned-time anchoring keeps the interval from drifting with delivery delays, and coalescing keeps
downtime from producing a burst of stale occurrences. BullMQ's native scheduler semantics for this
policy have not yet been verified; see the
[BullMQ integration findings](../library-research.md#bullmq-integration-findings).
