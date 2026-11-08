# Stalled jobs fail without replay

- **Status:** provisional
- **Human-confirmed:** no

## Decision

The BullMQ worker runs with `maxStalledCount: 0`, so BullMQ never runs an abandoned attempt again.
A worker that stops mid-attempt leaves its job `in-flight` until a running worker's stalled check
finds it after the 30-second lock expires. BullMQ then marks the job for a deferred failure and
returns it to the wait list, where it is reported as `queued` even though the request may already
have reached Telegram, until a worker fetches it and records the failure; that fetch waits for free
capacity, so on a busy queue the job can stay `queued` for some time. Native stalled failures are
exposed as interrupted processing under the [stored failure format](backend-stored-job-data.md).
Unexpected processor errors follow
[internal diagnostics](api-internal-error-reporting.md).

## Context

An abandoned attempt can follow a transmitted request. Without attempt records, an interruption
before sending cannot be told apart from one after it, so both are reported as `failed` without
claiming Telegram did nothing. This implements the
[no-retransmission policy](uncertainty-no-automatic-retransmission.md).
