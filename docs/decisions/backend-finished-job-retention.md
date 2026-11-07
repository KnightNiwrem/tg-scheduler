# Indefinite retention with native lazy cleanup

- **Status:** provisional
- **Human-confirmed:** yes

## Decision

Succeeded and failed jobs are kept indefinitely by default.

Opt-in removal by age or count uses BullMQ's native lazy automatic removal. Age limits are
evaluated when another job finishes in the corresponding BullMQ terminal state; they do not
promise deletion at an exact expiry time or while the queue is idle. The library does not add an
eager expiry timer, periodic cleanup worker, or its own completion-time index.

## Context

Indefinite retention keeps results retrievable through `getJob` until explicitly removed, while
storage grows with retained jobs. BullMQ already records finish timestamps and per-queue terminal
indexes and supports [age and count limits](https://docs.bullmq.io/guide/queues/auto-removal-of-jobs).
Reusing those mechanisms avoids a second cleanup system. Removal makes `getJob` return `undefined`.
