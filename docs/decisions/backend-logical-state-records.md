# Logical state records

- **Status:** provisional
- **Human-confirmed:** no

## Decision

The scheduler keeps the following logical state, using native BullMQ representations where they are
equivalent:

- **Job:** ID, bot identity, method and payload, requested due time, priority, ready-entry order,
  state, attempt identity and lease, and result or error. Native representations determine
  [retry ordering](rate-limit-native-429-requeue.md); there is no separate original-rank record.
- **Bot state:** shared blocked-until time, current reservations and dispatch concurrency.
- **Schedule:** interval, planned-time anchor, next occurrence, enabled state and unique occurrence
  identity, and the priority inherited by occurrences.

Concurrency above one uses multiple in-flight reservations rather than a single retained head
pointer.

## Context

These records describe the state that the admission, cooldown, ordering, recurrence and recovery
decisions need. They are behavioural requirements rather than a storage schema; the current stored
job format is the [stored job data](backend-stored-job-data.md) decision.
