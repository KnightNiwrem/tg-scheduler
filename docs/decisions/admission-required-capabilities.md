# Required admission capabilities

- **Status:** invariant
- **Human-confirmed:** no

## Decision

The scheduler provides configurable ordinary concurrency, a pause of ordinary admission after a
Telegram 429, and an opt-in exception that lets time-sensitive calls proceed during that pause.

## Context

The maintainer has observed that Telegram commonly permits callback and pre-checkout answers during
ordinary flood waits, while traffic that ignores waits can worsen flood limiting. This observation
does not guarantee that an urgent request will succeed or that a given concurrency is always safe.
The provisional policies are [ordinary concurrency](admission-ordinary-concurrency.md),
[lane cooldowns](rate-limit-lane-cooldowns.md) and the [urgent lane](admission-urgent-lane.md).
