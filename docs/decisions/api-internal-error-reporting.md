# Internal failures use local diagnostics

- **Status:** provisional
- **Human-confirmed:** no

## Decision

Failures of awaited client and worker operations reject their promises. Worker job-fetch failures
use the [dedicated retrieval handler](api-job-fetch-error-reporting.md). There is no additional
public error-handler option for client queue error events or unexpected internal exceptions.

The library logs client queue connection error events through `console.warn` when they occur
outside an awaited operation. The caller handles errors emitted directly by its supplied ioredis
connection, including before BullMQ resources are initialized and after they close.

Unexpected internal processing exceptions are reported locally through `console.error`, preserving
the original error and its stack trace when available. The affected job's stored failure reason is
generic. Other unawaited queue or worker faults outside job fetching are also reported locally
through `console.error`. Expected Telegram outcomes follow the
[native outcome mapping](backend-native-job-outcomes.md).

## Context

A queue connection event can occur between public operations, when no promise is awaiting its
result. Such an event cannot reject an already completed submission. Local diagnostics keep these
events visible without requiring another public callback.

An unexpected internal processing exception indicates a library fault; a caller-provided callback
cannot repair it. The original error supports diagnosis, while the generic stored failure avoids
publishing internal details to every reader of job data.
