# Application time in Unix epoch milliseconds

- **Status:** provisional
- **Human-confirmed:** no

## Decision

Application timestamps are integer milliseconds since the Unix epoch, in UTC. This covers public
execution times, persisted due times, retry eligibility, lane cooldown expiries, lease expiries and
recurrence anchors. Intervals and lease durations are in milliseconds, and `nowMs` uses the same
units. Names carry the unit, such as `runAtMs` and `intervalMs`. Native engine or Telegram units
are converted explicitly at the boundary.

## Context

One unit across the API, storage and scheduling arithmetic avoids conversion errors. Telegram's
`retry_after` is in seconds; see [retry delay](rate-limit-retry-after-fallback.md).
