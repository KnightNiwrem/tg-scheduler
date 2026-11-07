# Reuse native BullMQ primitives and add coordination where they differ

- **Status:** provisional
- **Human-confirmed:** no

## Decision

The scheduler's [durable transitions](../architecture.md#durable-transitions) use native BullMQ and
Valkey primitives wherever their selected-version semantics match the scheduling decisions.
Additional coordination is added only where those semantics differ. There is no mandatory backend
adapter API or prescribed schema; equivalent native representations are acceptable. Activation
relies on the engine's delayed-job, cooldown and recovery mechanisms rather than polling, and a
worker-local timer is never the only path to recovery.

Reused natively: queue-wide capacity (`setGlobalConcurrency`), unique current claims with lock
tokens, cooldown gating through a configured limiter, activation after worker replacement and
fencing of stale settlements.

[Stalled recovery](recovery-stalled-replay-disabled.md) disables abandoned-attempt replay and
exposes interrupted processing as `failed` through job snapshots.

Requires additional coordination: [monotonic cooldown extension](rate-limit-lane-cooldowns.md),
[original-rank ordering](ordering-eligible-fifo.md), and
[429 requeue](rate-limit-429-requeue-preserves-rank.md).
Native recurrence helpers are usable only where they match the
[recurrence decision](recurrence-planned-time-anchored.md).

## Context

The [selected-version experiments](../library-research.md#selected-version-native-behavior) found
that native `rateLimit()` can shorten an existing pause, that delayed promotion and concurrent 429
requeue can lose original rank, and that default stalled recovery can repeat an ambiguous effect.
Native settings alone therefore do not implement the design.
