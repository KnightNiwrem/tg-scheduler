# Required admission capabilities

- **Status:** invariant
- **Human-confirmed:** yes

## Decision

The scheduler provides configurable per-bot concurrency, a shared pause of queued dispatch after a
definite Telegram 429, and caller-selected normal or urgent priority for immediate, delayed and
recurring jobs.

## Context

Priority expresses which queued work should run next. Applications that need to send outside the
scheduler's capacity and cooldown controls can call Telegram directly; those calls are outside the
scheduler's guarantees. The policies are [bot concurrency](admission-bot-concurrency.md),
[bot cooldown](rate-limit-bot-cooldown.md) and [job priorities](admission-job-priorities.md).
