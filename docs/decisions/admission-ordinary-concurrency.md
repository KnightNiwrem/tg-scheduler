# Ordinary concurrency

- **Status:** provisional
- **Human-confirmed:** no

## Decision

Ordinary concurrency C, set through the worker policy's `ordinaryConcurrency`, defaults to 1 and is
configurable. It limits current ordinary reservations for the whole bot, across all workers, using
BullMQ's queue-wide global concurrency rather than worker-local concurrency.

## Context

The [native behavior experiments](../library-research.md#selected-version-native-behavior) showed
that worker-local concurrency lets several workers exceed a shared limit. Telegram publishes no
universal requests-per-second threshold, so the default is conservative. How the limit is written
is the [worker start](admission-concurrency-set-by-worker-start.md) decision.
