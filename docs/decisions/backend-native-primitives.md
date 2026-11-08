# Reuse native BullMQ primitives and add coordination where they differ

- **Status:** provisional
- **Human-confirmed:** no

## Decision

The scheduler's [durable transitions](../architecture.md#durable-transitions) use native BullMQ and
Valkey primitives wherever their selected-version semantics match the scheduling decisions.
Additional coordination is added only where those semantics differ. There is no mandatory backend
adapter API or prescribed schema; equivalent native representations are acceptable. Accepted work
and scheduling state remain durable, and a worker-local timer is never the only path to recovery.
Due-job activation must satisfy [ready-entry ordering](ordering-eligible-fifo.md) independently of
dispatch capacity; native worker fetching alone is insufficient.

Reused natively: queue-wide capacity (`setGlobalConcurrency`), unique current claims with lock
tokens, cooldown gating through a configured limiter, activation after worker replacement and
fencing of stale settlements. [Priority selection](admission-job-priorities.md) uses one dispatch
queue, and [429 requeue ordering](rate-limit-native-429-requeue.md) follows the native path.

[Stalled recovery](recovery-stalled-replay-disabled.md) disables abandoned-attempt replay and
exposes interrupted processing as `failed` through job snapshots.

Requires additional coordination: [monotonic cooldown extension](rate-limit-bot-cooldown.md) and
[due-job activation independent of dispatch capacity](ordering-eligible-fifo.md).
Recurrence and schedule removal use [native BullMQ Job Schedulers](recurrence-planned-time-anchored.md).

## Context

The [selected-version experiments](../library-research.md#selected-version-native-behavior) found
that native `rateLimit()` can shorten an existing pause and that default stalled recovery can
repeat an ambiguous effect. The [busy-worker probe](../library-research.md#busy-worker-delayed-promotion-probe)
also showed that native delayed promotion can wait for dispatch capacity. Native retry ordering is
accepted; the remaining integration work concerns activation, cooldown extension and safe recovery.
