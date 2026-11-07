# Fixed-interval recurrence with native BullMQ recovery

- **Status:** provisional
- **Human-confirmed:** yes

## Decision

Fixed-interval schedules use BullMQ Job Schedulers, with absolute UTC planned times rather than
completion-time anchoring. Missed-occurrence recovery follows BullMQ's native behavior:

- Already-created overdue jobs remain queued and run when a worker has capacity.
- When a worker begins processing an occurrence, BullMQ creates the next scheduled occurrence.
- Missed times whose jobs were never created are skipped, including under capacity delays. The
  library adds no latest-missed occurrence, catch-up backlog, or custom recurrence recovery loop.
- Occurrence creation and schedule advancement use BullMQ's native scheduler coordination.
- Disabling a schedule stops future occurrences and leaves materialized jobs intact.
- Occurrences use the ordinary lane.

Calendar cron expressions, time zones and alternative missed-occurrence policies are outside the
first slice. Interrupted Telegram attempts still follow the
[no-retransmission policy](uncertainty-no-automatic-retransmission.md).

## Context

Planned-time anchoring keeps the interval from drifting with delivery delays. Skipping uncreated
times avoids a burst of stale work, while retaining queued jobs preserves accepted work. Reusing
BullMQ's durable scheduler and delayed-job machinery avoids a second recovery system. Schedules
advance as workers start occurrences, so capacity delays can reduce the actual execution rate. The
[native scheduler recovery probe](../library-research.md#native-scheduler-recovery-probe)
records the verified behavior and its limits.
