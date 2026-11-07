# Monotonic lane cooldowns

- **Status:** provisional
- **Human-confirmed:** no

## Decision

Each lane has a durable blocked-until time. The ordinary cooldown applies to all ordinary work for
the bot, and the urgent cooldown applies to the whole urgent lane independently.

- A 429 atomically updates its lane with
  `blockedUntilMs = max(blockedUntilMs, nowMs + retryDelayMs)`, so a cooldown is never shortened.
- No new work is admitted to a paused lane. Attempts admitted before the pause may still reach
  Telegram, complete or extend the cooldown.
- The chosen expiry is persisted together with a durable wakeup, so resuming work depends neither
  on another submission nor on a worker-local timer.

## Context

BullMQ's native `rateLimit()` replaces a longer expiry with a shorter one, according to the
[native behavior experiments](../library-research.md#selected-version-native-behavior), so the
maximum must be taken atomically by additional coordination. The retry delay comes from the
[retry delay](rate-limit-retry-after-fallback.md) decision. Until cooldowns are implemented, the
[interim 429 failure](rate-limit-interim-429-failure.md) decision applies.
