# A 429 fails the job until cooldowns exist

- **Status:** provisional
- **Human-confirmed:** no

## Decision

Until [lane cooldowns](rate-limit-lane-cooldowns.md) are implemented, a definite 429 settles the
job as `failed` with `telegramErrorCode: 429` and is not retried. A valid positive integer
`retry_after` is included in the error message. This decision is removed when cooldowns replace it
with the [429 requeue](rate-limit-429-requeue-preserves-rank.md).

## Context

Retrying without a cooldown would add traffic during a flood wait. Including the server's delay
tells callers when resubmitting is reasonable. Until then the worker is not ready for production
traffic.
