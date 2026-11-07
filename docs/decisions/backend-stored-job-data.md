# Stored job data

- **Status:** provisional
- **Human-confirmed:** no

## Decision

BullMQ job data is `{ request, originalDueAtMs }`. The original due time is stored explicitly rather
than derived from BullMQ's timestamp and delay. A settled outcome is stored as the BullMQ return
value. Job data and outcomes are revalidated when read back. Jobs use BullMQ's sequential IDs and
`attempts: 1`.

## Context

Jobs are read by processes other than the one that wrote them, so reads cannot trust stored data.
Admission ordering needs the [original due time](ordering-eligible-fifo.md). An unsettled attempt
may already have reached Telegram, so BullMQ must never retry it on its own: `attempts: 1` prevents
failed-job retries, and [stalled replay](recovery-stalled-replay-disabled.md) is disabled
separately.
