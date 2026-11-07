# Worker startup sets per-bot concurrency

- **Status:** provisional
- **Human-confirmed:** yes

## Decision

`worker.start()` calls BullMQ's `setGlobalConcurrency` on the bot's ordinary queue once the worker's
connection is ready and before it claims jobs. The latest successful write to that queue sets the
ordinary concurrency shared across all workers for the bot.

Workers with different settings overwrite each other's limit when they start. BullMQ does not reject
the mismatch or order writes by application version. A worker shutting down or failing after the
write does not restore the previous limit; a later worker startup writes its configured limit again.

## Context

Each bot has its [own ordinary queue](backend-queue-per-lane.md), so BullMQ's global concurrency
applies independently to each bot. Consistent settings across replicas keep the shared limit stable;
mixed settings during a rolling deployment or rollback follow the same latest-write behavior.
