# Stored job data

- **Status:** provisional
- **Human-confirmed:** no

## Decision

BullMQ job data is `{ request, originalDueAtMs }`. The original due time is stored explicitly rather
than derived from BullMQ's timestamp and delay. A successful outcome is stored as
`{ state: 'succeeded', result }` in BullMQ's return value.

Terminal failures follow the [native outcome mapping](backend-native-job-outcomes.md). Their
`failedReason` is `tg-scheduler:failure:` followed by JSON `{ version: 1, error }`, preserving the
message and optional Telegram error code in the same native transition as the failure state.
The adapter throws BullMQ's `UnrecoverableError` for these failures. Unexpected processor errors
and native stalled failures retain their unstructured failure reasons and are reported as
interrupted processing. Unexpected processor error details follow
[unawaited error reporting](api-unawaited-error-reporting.md).

Readers also accept completed return values with `state: 'failed'` or `state: 'uncertain'`, exposing
both as `failed` with their recorded errors, without rewriting existing jobs.

Job data, completed outcomes and structured failure reasons are checked against their stored
shapes when read back. Malformed or unsupported structured failure reasons reject with a
`TypeError`. The method must pass the same outgoing-only method check as `submit`; the payload is
checked to be a JSON object but is not copied again, because BullMQ has already parsed it from
JSON. Data that fails the check settles the job as `failed` without sending a request, and
`getJob` rejects with a `TypeError`. Jobs use BullMQ's sequential IDs and `attempts: 1`.

## Context

Jobs are read by processes other than the one that wrote them, so reads cannot trust stored data.
Admission ordering needs the [original due time](ordering-eligible-fifo.md). An unsettled attempt
may already have reached Telegram, so BullMQ must never retry it on its own: `attempts: 1` prevents
failed-job retries, and `UnrecoverableError` also suppresses them regardless of a job's attempt
budget. [Stalled replay](recovery-stalled-replay-disabled.md) is disabled separately. Encoding the
error in the native failure reason avoids a separate write that could outlive a lost claim.
