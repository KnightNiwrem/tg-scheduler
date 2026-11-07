# Logical state records

- **Status:** provisional
- **Human-confirmed:** no

## Decision

The scheduler keeps the following logical state, using native BullMQ representations where they are
equivalent:

- **Job:** ID, bot identity, method and payload, original due time and submission sequence,
  retry-not-before time, lane, state, attempt identity and lease, and result or error.
- **Bot state:** ordinary blocked-until time, urgent blocked-until time, current reservations,
  ordinary concurrency and urgent bypass configuration.
- **Schedule:** interval, planned-time anchor, next occurrence, enabled state and unique occurrence
  identity.

Concurrency above one uses multiple in-flight reservations rather than a single retained head
pointer.

## Context

These records describe the state that the admission, cooldown, ordering, recurrence and recovery
decisions need. They are behavioural requirements rather than a storage schema; the current stored
job format is the [stored job data](backend-stored-job-data.md) decision.
