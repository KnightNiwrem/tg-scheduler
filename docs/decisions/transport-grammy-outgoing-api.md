# grammY transport without hidden retries

- **Status:** invariant
- **Human-confirmed:** no

## Decision

The Telegram transport uses grammY's outgoing API. It makes exactly one attempt per admitted
reservation and reports the classified outcome, including Telegram's raw `retry_after`, to the
coordinator. Retries, sleeps and cooldowns belong to the coordinator. The transport uses no
automatic retry layer, throttler, API transformer or independent queue.

## Context

A hidden auto-retry layer would consume 429 responses before the coordinator could observe them,
and would sleep or resend outside the scheduler's cooldown and uncertainty policies. See
[grammY transformers](https://grammy.dev/advanced/transformers).
