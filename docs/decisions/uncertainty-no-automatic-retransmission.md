# Ambiguous attempts are never retransmitted automatically

- **Status:** provisional
- **Human-confirmed:** yes

## Decision

An attempt whose external outcome is ambiguous is not retransmitted automatically. The job is marked
`failed` with its error visible, its reservation is released and unrelated eligible work
continues. A caller may submit the call again explicitly, accepting the risk of a duplicate. Engine
crash and stalled-job recovery must preserve this policy.

Other terminal errors are also reported as `failed` without automatic retry. Definite 429 responses
follow the separate [cooldown and retry policy](rate-limit-429-requeue-preserves-rank.md). A
configurable automatic retry mode for ambiguous attempts is outside the first slice.

## Context

A failed job records an unsuccessful execution, like a rejected API call; it does not prove that
Telegram did not act. A timeout or server error can follow an external effect, and the library cannot
guarantee exactly-once external effects; see the
[guarantee limits](../architecture.md#guarantee-limits). The
[native behavior experiments](../library-research.md#selected-version-native-behavior) showed that
BullMQ's default stalled recovery repeats an effect that a simulated Telegram service had already
accepted. The public states are defined by [visible job states](api-visible-job-states.md), and
errors are recorded according to [outcome classification](transport-outcome-classification.md).
