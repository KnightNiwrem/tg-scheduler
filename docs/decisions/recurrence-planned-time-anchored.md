# Fixed-interval recurrence with native BullMQ recovery

- **Status:** provisional
- **Human-confirmed:** no

## Decision

Fixed-interval schedules use BullMQ Job Schedulers, with absolute UTC planned times rather than
completion-time anchoring. Missed-occurrence recovery follows BullMQ's native behavior:

- Already-created overdue jobs remain queued and run when a worker has capacity.
- When a worker begins processing an occurrence, BullMQ creates the next scheduled occurrence.
- Missed times whose jobs were never created are skipped, including under capacity delays. The
  library adds no latest-missed occurrence, catch-up backlog, or custom recurrence recovery loop.
- Occurrence creation and schedule advancement use BullMQ's native scheduler coordination.
- Occurrences inherit the schedule's selected [job priority](admission-job-priorities.md). Once
  created, they enter the shared ready queue through [due-job activation](ordering-eligible-fifo.md).

Disabling a schedule uses BullMQ's native `Queue.removeJobScheduler` operation:

- Remove the scheduler so it cannot create subsequent occurrences.
- Delete its next occurrence if that job is still in BullMQ's delayed set, including an overdue
  occurrence that has not yet been activated. The job's state, rather than its due time, determines
  whether it is removed.
- Preserve ready, in-flight and finished occurrences. Ready jobs can still execute and in-flight
  attempts can settle; neither can recreate the removed scheduler or produce further occurrences.
- Races with activation and occurrence advancement follow BullMQ's atomic ordering. If activation
  moves the next occurrence out of the delayed set first, removal leaves that job intact.

A removed occurrence no longer exists, so `getJob` returns `undefined` for its ID. Removal does
not record a separate cancellation outcome.

Calendar cron expressions, time zones and alternative missed-occurrence policies are outside the
first slice. Interrupted Telegram attempts still follow the
[no-retransmission policy](uncertainty-no-automatic-retransmission.md).

## Context

Planned-time anchoring keeps the interval from drifting with delivery delays. Skipping uncreated
times avoids a burst of stale work, while recovery retains already-created overdue jobs. Native
removal treats the advance-created delayed occurrence as part of the schedule being disabled and
keeps removal coordinated with occurrence creation and activation. Reusing BullMQ's durable
scheduler, delayed-job and removal machinery avoids a second recovery or cancellation system.
Schedules advance as workers start occurrences, so capacity delays can reduce the actual execution
rate. The [native scheduler recovery probe](../library-research.md#native-scheduler-recovery-probe)
records the verified behavior and its limits.
