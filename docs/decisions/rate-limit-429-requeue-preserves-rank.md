# A 429 requeues the job with its original rank

- **Status:** provisional
- **Human-confirmed:** no

## Decision

A definite 429 returns the same job to `queued` with its original admission rank (original due time,
then submission sequence). The job becomes eligible again after its lane's cooldown, and the retry
is a new attempt with its own identity. There is no additional strict retry barrier: once the
cooldown ends, more than one eligible job may be admitted when C > 1.

## Context

A 429 means Telegram did not perform the call, so retrying is safe. The
[native behavior experiments](../library-research.md#selected-version-native-behavior) showed that
returning concurrent jobs through `RateLimitError` can reverse their original rank, so rank is
preserved explicitly. Until cooldowns are implemented, the
[interim 429 failure](rate-limit-interim-429-failure.md) decision applies.
