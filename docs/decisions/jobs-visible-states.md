# Visible job states

- **Status:** provisional
- **Human-confirmed:** no

## Decision

A job is `queued`, `in-flight`, `succeeded`, `failed` or `uncertain`.

- `succeeded` carries the Telegram result for the job's method.
- `failed` means Telegram definitely did not perform the call.
- `uncertain` means Telegram may have performed the call.

A definite 429 is not a final outcome: the job returns to `queued`, as described in
[429 requeue](rate-limit-429-requeue-preserves-rank.md). Job snapshots pair each method with its
result type.

## Context

Callers need the actual outcome, including ambiguity, to decide whether resubmitting is safe; see
the [uncertainty policy](uncertainty-no-automatic-retransmission.md) and
[outcome classification](telegram-outcome-classification.md).
