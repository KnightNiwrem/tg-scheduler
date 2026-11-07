# Unawaited errors go to onError

- **Status:** provisional
- **Human-confirmed:** no

## Decision

Client and worker options accept `onError`, which receives errors that no operation awaits, such as
BullMQ connection failures and unexpected job processing errors. It defaults to `console.error`.
Processing errors reach `onError` in full, while the failure reason stored with the job is generic.
The caller handles errors emitted directly by its supplied connection, including before BullMQ
resources are initialized and after they close.

## Context

These errors have no awaiting caller, so they need an explicit reporting path. Stored job data is
visible to every producer, and the original error may carry details that do not belong there.
