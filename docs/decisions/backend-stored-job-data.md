# Stored job data

- **Status:** provisional
- **Human-confirmed:** no

## Decision

BullMQ job data is `{ request, originalDueAtMs }`. The original due time is stored explicitly rather
than derived from BullMQ's timestamp and delay. A settled outcome is stored as the BullMQ return
value. Job data and outcomes are checked against their stored shape when read back. The method must
pass the same outgoing-only method check as `submit`; the payload is checked to be a JSON object but
is not copied again, because BullMQ has already parsed it from JSON. Data that fails the check
settles the job as `failed` without sending a request, and `getJob` rejects with a `TypeError`. Jobs
use BullMQ's sequential IDs and `attempts: 1`.

New settled outcomes are `succeeded` or `failed`. Previously stored `uncertain` outcomes remain
readable as `failed`, preserving their recorded error.

## Context

Jobs are read by processes other than the one that wrote them, so reads cannot trust stored data.
Admission ordering needs the [original due time](ordering-eligible-fifo.md). An unsettled attempt
may already have reached Telegram, so BullMQ must never retry it on its own: `attempts: 1` prevents
failed-job retries, and [stalled replay](recovery-stalled-replay-disabled.md) is disabled
separately.
