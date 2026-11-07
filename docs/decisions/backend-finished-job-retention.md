# Finished jobs are retained indefinitely

- **Status:** provisional
- **Human-confirmed:** no

## Decision

Succeeded and failed jobs are kept indefinitely, which is BullMQ's default.

## Context

Results stay retrievable through `getJob`, but storage grows without bound until a retention policy
is chosen.
