# Stored job data

- **Status:** provisional
- **Human-confirmed:** no

## Decision

BullMQ job data is `{ request }`. Scheduling metadata stays in BullMQ's native job fields. For
immediate, one-time delayed and recurring jobs, snapshots expose the initial scheduled time as
`scheduledForMs = job.timestamp + (job.opts.delay ?? 0)`. This uses the original configured delay
in `opts`, not the live `job.delay` field that BullMQ resets when promoting delayed work.

Immediate submissions, including a past `runAtMs`, report the native enqueue time. Future jobs
report their planned execution time. Activation, execution, manual 429 requeue and settlement
do not change `scheduledForMs`; it does not determine ready-entry ordering or actual delivery time.
The request payload contains no duplicate scheduling timestamp, and recurring templates contain
only the shared request rather than an occurrence-specific time.

A successful outcome is stored as `{ state: 'succeeded', result }` in BullMQ's return value.

Terminal failures follow the [native outcome mapping](backend-native-job-outcomes.md). Their
`failedReason` is `tg-scheduler:failure:` followed by JSON `{ version: 1, error }`, preserving the
message and optional Telegram error code in the same native transition as the failure state.
The adapter throws BullMQ's `UnrecoverableError` for these failures. Unexpected processor errors
and native stalled failures retain their unstructured failure reasons and are reported as
interrupted processing. Unexpected processor error details follow
[internal diagnostics](api-internal-error-reporting.md).

Readers also accept completed return values with `state: 'failed'` or `state: 'uncertain'`, exposing
both as `failed` with their recorded errors, without rewriting existing jobs.

Stored requests and native timing metadata are checked together before dispatch and when creating
snapshots. The creation timestamp, configured delay and their sum must be non-negative safe
integers; an omitted configured delay means zero. Completed outcomes and structured failure
reasons are also checked when read back. Malformed or unsupported structured failure reasons
reject with a `TypeError`. The method must pass the same outgoing-only method check as `submit`.
The payload is checked to be a JSON object but is not copied again, because BullMQ has already
parsed it from JSON. Data that fails the check settles the job as `failed` without sending a
request, and `getJob` rejects with a `TypeError`.

BullMQ assigns job IDs, and the public API treats them as opaque strings. One-time jobs use native
default IDs; recurring occurrences use native Job Scheduler IDs. IDs do not encode a public
timestamp contract and are not parsed to derive scheduling times. Jobs use `attempts: 1`.

## Context

Jobs are read by processes other than the one that wrote them, so reads cannot trust stored data.
Native creation timestamps and original delay options provide one timing representation for
one-time jobs and scheduler-generated occurrences. Keeping those fields in the engine avoids a
copied recurring template reporting the same time for every occurrence. The
[native timing probe](../library-research.md#native-job-timing-metadata) records the selected-version
evidence. Scheduling times do not determine [ready-entry order](ordering-eligible-fifo.md).
An unsettled attempt may already have reached Telegram, so BullMQ must never retry it on its own:
`attempts: 1` prevents failed-job retries, and `UnrecoverableError` also suppresses them regardless
of a job's attempt budget. [Stalled replay](recovery-stalled-replay-disabled.md) is disabled
separately. Encoding the error in the native failure reason avoids a separate write that could
outlive a lost claim.
