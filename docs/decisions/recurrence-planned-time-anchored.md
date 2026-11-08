# Fixed-interval recurrence with native BullMQ recovery

- **Status:** provisional
- **Human-confirmed:** no

## Decision

Fixed-interval schedules use BullMQ Job Schedulers, with absolute UTC planned times rather than
completion-time anchoring. Creation uses native `Queue.upsertJobScheduler`; occurrence generation,
recovery and deletion follow the native scheduler lifecycle without custom scheduling or removal
semantics. Missed-occurrence recovery follows BullMQ's native behavior:

- Already-created overdue jobs remain queued and run when a worker has capacity.
- When a worker begins processing an occurrence, BullMQ creates the next scheduled occurrence.
- Missed times whose jobs were never created are skipped, including under capacity delays. The
  library adds no latest-missed occurrence, catch-up backlog, or custom recurrence recovery loop.
- Occurrence creation and schedule advancement use BullMQ's native scheduler coordination.
- Occurrences inherit the schedule's selected [job priority](admission-job-priorities.md). Once
  created, they enter the shared ready queue through [due-job activation](ordering-eligible-fifo.md).

Schedule deletion through `deleteSchedule(scheduleId)` must use BullMQ's native
`Queue.removeJobScheduler` operation. `disableSchedule(scheduleId)` is a deprecated compatibility
alias for the same deletion operation:

- Delete the scheduler definition so it cannot create subsequent occurrences.
- Delete its next occurrence if that job is still in BullMQ's delayed set, including an overdue
  occurrence that has not yet been activated. The job's state, rather than its due time, determines
  whether it is removed.
- Preserve ready, in-flight and finished occurrences. Ready jobs can still execute and in-flight
  attempts can settle; neither can recreate the removed scheduler or produce further occurrences.
- Races with activation and occurrence advancement follow BullMQ's atomic ordering. If activation
  moves the next occurrence out of the delayed set first, removal leaves that job intact.

A removed occurrence no longer exists, so `getJob` returns `undefined` for its ID. Removal does
not record a separate cancellation outcome. Both delayed and ready occurrences report the public
`queued` state; that state alone does not determine whether an occurrence will be removed.

The first-slice client API must support listing retained jobs by schedule ID and retrieving an
individual listed job through `getJob`. Listing must use each job's native BullMQ scheduler
association and remain available after schedule deletion while the jobs are retained under the
[finished-job retention policy](backend-finished-job-retention.md). It must exclude skipped times
whose jobs were never created and jobs removed by deletion or cleanup. This requires a library
query over retained jobs; BullMQ does not provide a native per-schedule job-history listing
operation. No separate occurrence history is recorded.

Schedule-specific pause and resume, calendar cron expressions, time zones and alternative
missed-occurrence policies are outside the first slice. Deletion does not retain a resumable
schedule definition or add a deleted-schedule state. Interrupted Telegram attempts still follow the
[no-retransmission policy](uncertainty-no-automatic-retransmission.md).

## Context

Planned-time anchoring keeps the interval from drifting with delivery delays. Skipping uncreated
times avoids a burst of stale work, while recovery retains already-created overdue jobs. Native
removal treats the advance-created delayed occurrence as part of the schedule being deleted and
keeps removal coordinated with occurrence creation and activation. Reusing BullMQ's durable
scheduler, delayed-job and removal machinery avoids a second recovery or cancellation system.

Retained jobs carry their scheduler association independently of the scheduler definition, so
history lookup does not need to preserve a deleted definition. Native pause controls apply to a
whole queue or one worker, not an individual scheduler; they do not supply per-schedule pause and
resume within the bot's shared dispatch queue.

Schedules advance as workers start occurrences, so capacity delays can reduce the actual execution
rate. The [native scheduler recovery probe](../library-research.md#native-scheduler-recovery-probe)
records the verified behavior and its limits.
