# Priority then ready-entry FIFO

- **Status:** provisional
- **Human-confirmed:** yes

## Decision

The bot's [single dispatch queue](backend-single-dispatch-queue.md) selects eligible urgent jobs
before normal jobs. New jobs enter the back of their selected priority when they become ready:

- Immediate submissions enter on acceptance.
- Already-created delayed jobs and recurring occurrences enter when activated at their due time.
  Activation continues while dispatch capacity is full or the bot is in cooldown; it does not wait
  for an in-flight Telegram attempt to finish.
- Scheduling a future job does not reserve an earlier position in the ready queue. Its activation
  leaves existing ready jobs of the same priority ahead of it.
- If activation is late, the job joins when actually activated; its original due time does not
  retroactively move it ahead of ready jobs. A past `runAtMs` requests immediate entry in the same way.
- Future jobs do not block ready work. Recurring occurrence production and missed occurrences still
  follow [native scheduler recovery](recurrence-native-schedules.md).

[Native 429 requeue](rate-limit-native-429-requeue.md) determines retry insertion and concurrent retry
ordering; the library does not reconstruct a job's original admission rank.

- FIFO describes new ready-job entry and admission within a priority, not completion or
  Telegram-side effect order when [bot concurrency](admission-bot-concurrency.md) C > 1.
- "Run at" means not before that time, not delivery at that instant.
- For a send followed by an edit of the returned message, the caller submits the edit after the
  send succeeds. A general dependency engine is outside the first slice.

## Context

Ready-entry FIFO gives immediate and activated scheduled work one admission order without sorting
by historical due times. The [busy-worker probe](../library-research.md#busy-worker-delayed-promotion-probe)
showed that native worker promotion can wait while every dispatch slot is occupied, allowing later
immediate submissions to enter first. Independent activation is needed to maintain ready-entry
progress while dispatch is busy. Activation timing and priority support remain unimplemented.
