# grammY's default request timeout

- **Status:** provisional
- **Human-confirmed:** no

## Decision

The transport keeps grammY's default 500-second request timeout.

## Context

A hung request can hold a capacity slot for up to 500 seconds. A shorter timeout would free the slot
sooner but would not make the outcome definite: a timed-out request is reported as `uncertain`.
