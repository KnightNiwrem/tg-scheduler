# Native BullMQ requeue ordering for definite 429 responses

- **Status:** provisional
- **Human-confirmed:** yes

## Decision

A definite Telegram 429 returns the same job to `queued` using BullMQ's native manual-rate-limit
requeue path (`Worker.RateLimitError()` / active-to-wait), retaining its priority. In the selected
version, this places the job at the front of its priority group. Urgent jobs still precede normal
jobs. Claims resume after the [bot cooldown](rate-limit-bot-cooldown.md), within shared capacity.

The library accepts native ordering among concurrently requeued jobs. It adds no original-rank
restoration, custom retry queue or strict retry barrier. Each subsequent claim has a new attempt
identity, and more than one eligible job may be admitted when C > 1.

This policy applies to definite 429 responses, not general failed-job retries. Terminal failures,
including ambiguous transport outcomes, follow the
[no-retransmission policy](uncertainty-no-automatic-retransmission.md). Until cooldowns are
implemented, the [interim 429 failure](rate-limit-interim-429-failure.md) applies.

## Context

A definite 429 is retryable because Telegram rejected the attempt. BullMQ already provides a
priority-aware return to waiting for that case; native tie ordering is sufficient for this queue.
The [integration findings](../library-research.md#bullmq-integration-findings) distinguish this path
from ordinary failure/backoff retries, which do not generally insert at the front.
