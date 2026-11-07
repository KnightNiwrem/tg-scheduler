# Monotonic per-bot cooldown

- **Status:** provisional
- **Human-confirmed:** no

## Decision

Each bot has one durable blocked-until time for its dispatch queue. The cooldown gates both normal
and urgent priority; priority does not bypass the pause. Other bots remain independent.

- A definite 429 at either priority atomically updates the bot's cooldown with
  `blockedUntilMs = max(blockedUntilMs, nowMs + retryDelayMs)`, so a cooldown is never shortened.
- No new work is dispatched for a paused bot. Attempts admitted before the pause may still reach
  Telegram, complete or extend the cooldown.
- The chosen expiry is persisted together with a durable wakeup, so resuming work depends neither
  on another submission nor on a worker-local timer.
- Delayed-job activation can continue during the cooldown according to
  [ready-entry ordering](ordering-eligible-fifo.md); becoming ready does not admit an API attempt.

## Context

BullMQ's native `rateLimit()` replaces a longer expiry with a shorter one, according to the
[native behavior experiments](../library-research.md#selected-version-native-behavior), so the
maximum must be taken atomically by additional coordination. The retry delay comes from the
[retry delay](rate-limit-retry-after-fallback.md) decision. Until cooldowns are implemented, the
[interim 429 failure](rate-limit-interim-429-failure.md) decision applies.
