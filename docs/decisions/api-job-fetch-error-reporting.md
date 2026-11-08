# Worker job-fetch failures use an optional warning handler

- **Status:** provisional
- **Human-confirmed:** yes

## Decision

Worker options accept an optional `onJobFetchError(error)` callback for background failures while
trying to obtain the next job from the queue backend, such as Valkey being unreachable. When the
caller omits it, the library reports the error through `console.warn`.

This callback reports a failed retrieval; invoking it does not itself change a job's outcome.
Telegram call failures follow the [job outcome mapping](backend-native-job-outcomes.md), and
failures of awaited public operations reject their promises. Diagnostics for other background
failures follow the separate [internal diagnostics](api-internal-error-reporting.md) decision.

## Context

The worker retrieves work after submission has returned a job ID. A later retrieval failure has no
awaiting submitter and may occur before any Telegram attempt. The caller needs a place to connect
logging or monitoring for this interruption to processing. Naming the hook after job fetching
makes its responsibility explicit instead of implying that it handles every kind of error.
