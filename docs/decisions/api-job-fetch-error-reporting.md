# Worker job-fetch failures use an optional warning handler

- **Status:** provisional
- **Human-confirmed:** yes

## Decision

Worker options accept an optional `onJobFetchError(error)` callback for failures reported by the
worker's background next-job retrieval operation, such as a rejected backend call to obtain the
next job. When the caller omits it, the library reports the error through `console.warn`.

Separately emitted queue or connection error events follow
[internal diagnostics](api-internal-error-reporting.md), even when the same outage also causes a
retrieval failure. An event occurring while the worker is waiting for work is not, by timing alone,
a job-fetch failure; routing depends on which operation or event reports the error.

This callback reports a failed retrieval; invoking it does not itself change a job's outcome.
Telegram call failures follow the [job outcome mapping](backend-native-job-outcomes.md), and
failures of awaited public operations reject their promises.

## Context

The worker retrieves work after submission has returned a job ID. A later retrieval failure has no
awaiting submitter and may occur before any Telegram attempt. The caller needs a place to connect
logging or monitoring for this interruption to processing. Naming the hook after job fetching
makes its responsibility explicit instead of implying that it handles every kind of error.
