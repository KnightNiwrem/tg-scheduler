# Explicit job and schedule operations

- **Status:** provisional
- **Human-confirmed:** no

## Decision

The client exposes explicit operations:

- `submit(method, payload, options?)` durably accepts immediate or one-time delayed work and returns
  a job handle. [Options](api-submit-options.md) set the earliest execution time (`runAtMs`) and the
  delivery lane; urgent submission [currently rejects](admission-urgent-lane-interim-rejection.md).
- `getJob(jobId)` returns the job's current snapshot, including the Telegram result or error, or
  `undefined` when the job does not exist. The result type corresponds to the job's method.
- `createSchedule(method, payload, options)` returns a handle for a
  [fixed-interval schedule](recurrence-planned-time-anchored.md) defined by an interval and a
  planned-time anchor.
- `disableSchedule(scheduleId)` stops future occurrences while preserving jobs already created.
- `close()` releases the client's backend resources.

A job ID is a durable handle, not a Telegram `Message`.

General priorities, custom deadlines, generic job cancellation, bounded waiting, a transparent
awaiting grammY transformer and caller-supplied submission deduplication are outside the first
slice. A future transparent transformer must await the real Telegram result to preserve grammY's
normal API contract.

## Context

Producers may exit immediately after submission, so the API returns durable handles instead of
waiting for Telegram. Internal occurrence uniqueness and atomic claims are still required without
caller-supplied deduplication.
