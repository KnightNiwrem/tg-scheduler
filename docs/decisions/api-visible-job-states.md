# Visible job states

- **Status:** provisional
- **Human-confirmed:** no

## Decision

A job is `queued`, `in-flight`, `succeeded`, `failed` or `uncertain`.

- `succeeded` carries the Telegram result for the job's method.
- `failed` means Telegram definitely did not perform the call.
- `uncertain` means Telegram may have performed the call.

Once lane cooldowns are implemented, a definite 429 is not a final outcome: the job returns to
`queued`, as described in [429 requeue](rate-limit-429-requeue-preserves-rank.md). Until then, the
[interim 429 failure](rate-limit-interim-429-failure.md) settles it as `failed`.

## Context

Callers need the actual outcome, including ambiguity, to decide whether resubmitting is safe; see
the [uncertainty policy](uncertainty-no-automatic-retransmission.md) and
[outcome classification](transport-outcome-classification.md).
