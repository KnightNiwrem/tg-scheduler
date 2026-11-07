# Visible job states

- **Status:** provisional
- **Human-confirmed:** yes

## Decision

A job is `queued`, `in-flight`, `succeeded` or `failed`.

- `succeeded` carries the Telegram result for the job's method.
- `failed` carries the execution error. Telegram may have performed the call even though the
  attempt did not produce a confirmed success.

After submission has completed, execution errors are retrieved through `getJob`; they do not
reject the original `submit` call.

Once lane cooldowns are implemented, a definite 429 is not a final outcome: the job returns to
`queued`, as described in [429 requeue](rate-limit-429-requeue-preserves-rank.md). Until then, the
[interim 429 failure](rate-limit-interim-429-failure.md) settles it as `failed`.

## Context

Like a rejected grammY API call, a failed job records an error and leaves the application to decide
whether to resubmit. A separate state for an unknown external outcome is unnecessary; see the
[no-retransmission policy](uncertainty-no-automatic-retransmission.md) and
[outcome classification](transport-outcome-classification.md).
