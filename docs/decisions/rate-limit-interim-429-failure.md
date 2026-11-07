# A 429 fails the job until cooldowns exist

- **Status:** provisional
- **Human-confirmed:** no

## Decision

Until the [bot cooldown](rate-limit-bot-cooldown.md) is implemented, a definite 429 settles the
job as `failed` with `telegramErrorCode: 429` and is not retried. A valid positive integer
`retry_after` is included in the error message. This decision is removed when cooldowns replace it
with the [429 requeue](rate-limit-native-429-requeue.md).

## Context

Retrying without a cooldown would add traffic during a flood wait. Including the server's delay
tells callers when resubmitting is reasonable. Until then the worker is not ready for production
traffic.
