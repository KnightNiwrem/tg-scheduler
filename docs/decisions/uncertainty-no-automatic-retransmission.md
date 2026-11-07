# Ambiguous attempts are never retransmitted automatically

- **Status:** provisional
- **Human-confirmed:** no

## Decision

An attempt whose external outcome is ambiguous is not retransmitted automatically. The job is marked
`uncertain` with its error visible, its reservation is released and unrelated eligible work
continues. A caller may submit the call again explicitly, accepting the risk of a duplicate. Engine
crash and stalled-job recovery must preserve this policy.

Permanent API failures are reported as `failed` and are not retried. A configurable
retry-uncertainty mode is outside the first slice.

## Context

A timeout or server error does not prove that Telegram did not act, and the library cannot
guarantee exactly-once external effects; see the
[guarantee limits](../architecture.md#guarantee-limits). The
[native behavior experiments](../library-research.md#selected-version-native-behavior) showed that
BullMQ's default stalled recovery repeats an effect that a simulated Telegram service had already
accepted. Which errors are
ambiguous is the [outcome classification](transport-outcome-classification.md) decision.
