# Native BullMQ interval and UTC cron schedules

- **Status:** provisional
- **Human-confirmed:** no

## Decision

Schedules use BullMQ Job Schedulers. `createSchedule(method, payload, recurrence, options?)`
accepts exactly one native recurrence form as `recurrence`, typed with BullMQ's `RepeatOptions`
fields under the [native option type](api-native-bullmq-option-types.md) decision. The schedule's
[job priority](admission-job-priorities.md) is a library option in the separate `options` argument,
so the recurrence object carries only native fields:

- `{ every: number }` specifies the native interval in milliseconds. A new schedule's
  first occurrence is immediately eligible under BullMQ's defaults; later planned times follow
  its native interval cadence rather than completion times. The library adds no clock alignment.
- `{ pattern: string }` specifies a native BullMQ cron expression, including its optional seconds
  field. Cron evaluation uses `tz: 'UTC'`, and the first occurrence is the next matching UTC time.
  Created at 12:25 UTC, `0 * * * *` first becomes due at 13:00, while `26 * * * *` becomes due at
  12:26. Parsing and calendar calculations use BullMQ's native cron strategy.

BullMQ validates recurrence options, selects the configured form and parses cron expressions. The
library does not validate those options with Zod, duplicate the supported cron grammar, or reject
options with a library-maintained allowlist. The `every` and `pattern` values must reach BullMQ
unchanged, with UTC evaluation configured for cron. An error from native schedule creation must reject
`createSchedule` unchanged, without conversion to a library `TypeError` or generic wrapper.

The public forms keep the native `every` and `pattern` names. Form selection treats an alternative
field set to `undefined` as absent under native behavior. There is no separate anchor timestamp,
alignment algorithm or custom repeat strategy. Creation uses native `Queue.upsertJobScheduler`;
occurrence generation, recovery and deletion follow the native scheduler lifecycle without custom
scheduling or removal semantics. A planned occurrence time is an eligibility time, not a delivery
deadline. Missed-occurrence recovery follows BullMQ's native behavior for both forms:

- Already-created overdue jobs remain queued and run when a worker has capacity.
- When a worker begins processing an occurrence, BullMQ creates the next scheduled occurrence.
- Missed times whose jobs were never created are skipped, including under capacity delays. The
  library adds no latest-missed occurrence, catch-up backlog, or custom recurrence recovery loop.
- Occurrence creation and schedule advancement use BullMQ's native scheduler coordination.
- Occurrences inherit the schedule's selected [job priority](admission-job-priorities.md). Once
  created, they enter the shared ready queue through [due-job activation](ordering-eligible-fifo.md).

Schedule deletion through `deleteSchedule(scheduleId)` must use BullMQ's native
`Queue.removeJobScheduler` operation:

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

The first-slice client API lists retained jobs by schedule ID through
`listScheduleJobs(scheduleId)`, which returns job handles; `getJob` retrieves each listed job.
Listing must use each job's native BullMQ scheduler association and remain available after
schedule deletion while the jobs are retained under the
[finished-job retention policy](backend-finished-job-retention.md). It must exclude skipped times
whose jobs were never created and jobs removed by deletion or cleanup. This requires a library
query over retained jobs; BullMQ does not provide a native per-schedule job-history listing
operation. No separate occurrence history is recorded.

Schedule-specific pause and resume, non-UTC time zones and alternative missed-occurrence policies
are outside the first slice. Deletion does not retain a resumable schedule definition or add a
deleted-schedule state. Interrupted Telegram attempts still follow the
[no-retransmission policy](uncertainty-no-automatic-retransmission.md).

## Context

Native intervals and UTC cron patterns express recurrence by duration and by calendar time without
a custom anchor contract. Delegating validation avoids imposing a second interpretation of native
options or limiting expressions that a later selected BullMQ version supports. Skipping uncreated
times avoids a burst of stale work, while recovery retains already-created overdue jobs. Native
removal treats the advance-created delayed occurrence
as part of the schedule being deleted and keeps removal coordinated with occurrence creation and
activation. Reusing BullMQ's durable scheduler, delayed-job and removal machinery avoids a second
recovery or cancellation system.

Retained jobs carry their scheduler association independently of the scheduler definition, so
history lookup does not need to preserve a deleted definition. Native pause controls apply to a
whole queue or one worker, not an individual scheduler; they do not supply per-schedule pause and
resume within the bot's shared dispatch queue.

Schedules advance as workers start occurrences, so capacity delays can reduce the actual execution
rate. The [native scheduler recovery probe](../library-research.md#native-scheduler-recovery-probe)
records the verified behavior and its limits. The
[native recurrence form findings](../library-research.md#native-recurrence-forms) distinguish initial
interval eligibility from cron's next matching time.
