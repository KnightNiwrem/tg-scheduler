# Normal and urgent job priorities

- **Status:** provisional
- **Human-confirmed:** yes

## Decision

- Jobs have normal or urgent priority, with normal as the default. Any supported outgoing Bot API
  method may use either priority; there is no method allowlist or bypass enablement requirement.
- Priority is independent of timing. Immediate and one-time delayed jobs accept a priority, and
  recurring occurrences inherit the priority selected for their schedule.
- Eligible urgent jobs are selected before normal jobs. New ready jobs join the back of their
  selected priority according to [ready-entry ordering](ordering-eligible-fifo.md).
- Both priorities share the bot's [dispatch capacity](admission-bot-concurrency.md) and
  [cooldown](rate-limit-bot-cooldown.md). Urgent jobs add no capacity and cannot bypass a cooldown.
- Priority affects subsequent claims; it does not interrupt already-admitted attempts. A continuous
  urgent backlog can postpone normal jobs indefinitely.

All jobs use the bot's [single dispatch queue](backend-single-dispatch-queue.md).

## Context

Urgency is relative preference among queued jobs. It does not guarantee immediate delivery or a
deadline. Direct calls made outside the scheduler remain the application's responsibility.
