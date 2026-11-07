# Ordinary concurrency

- **Status:** provisional
- **Human-confirmed:** yes

## Decision

Ordinary concurrency C, set through the worker policy's `ordinaryConcurrency`, defaults to 3 and is
configurable. It gates new ordinary reservations for the whole bot, across all workers, using
BullMQ's queue-wide global concurrency rather than worker-local concurrency. A worker may claim a
job only when the number of active ordinary jobs is below C.

Lowering C does not interrupt jobs already active. The active count may temporarily exceed the new
limit while those jobs settle; further claims wait until the active count falls below C.

## Context

The [native behavior experiments](../library-research.md#selected-version-native-behavior) showed
that worker-local concurrency lets several workers exceed a shared limit.

Three concurrent attempts overlap network waits while keeping parallelism bounded.
[grammY's broadcasting guidance](https://grammy.dev/advanced/flood#how-to-broadcast-messages)
suggests about three parallel calls as an example of small concurrency. Concurrency governs
simultaneous reservations rather than requests per second; throughput depends on request duration.
[Telegram's published guidance](https://core.telegram.org/bots/faq#my-bot-is-hitting-limits-how-do-i-avoid-this)
describes about 30 messages per second for free bulk notifications and permits short bursts above
the per-chat one-message-per-second guidance. These are workload-specific limits, not a universal
safe rate for every method. Applications tune concurrency for their workloads and respect
[lane cooldowns](rate-limit-lane-cooldowns.md) after 429 responses.

How the limit is written is the [worker start](admission-concurrency-set-by-worker-start.md) decision.
