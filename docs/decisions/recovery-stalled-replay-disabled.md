# Stalled jobs are reported as uncertain, not replayed

- **Status:** provisional
- **Human-confirmed:** no

## Decision

The BullMQ worker runs with `maxStalledCount: 0`, so BullMQ never runs an abandoned attempt again.
Any job that BullMQ records as failed is reported as `uncertain`. A worker that stops mid-attempt
leaves its job `in-flight` until a running worker's stalled check finds it after the 30-second lock
expires. Processing errors are reported to `onError` in full, and BullMQ stores only a generic
failure reason, so error details never reach job snapshots.

## Context

The coordinator settles every attempt it completes, so BullMQ fails a job only when processing was
interrupted by a lost lock or a processor error, either of which can follow a transmitted request.
Without attempt records, an interruption before sending cannot be told apart from one after it, so
both are conservatively reported as `uncertain`. This implements the
[uncertainty policy](uncertainty-no-automatic-retransmission.md) until durable attempt records
exist.
