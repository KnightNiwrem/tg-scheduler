# grammY transport without hidden retries

- **Status:** invariant
- **Human-confirmed:** yes

## Decision

The Telegram transport invokes the
[caller-owned grammY API instance](transport-caller-owned-api.md). It makes exactly one attempt per
admitted reservation and reports the classified outcome, including Telegram's raw `retry_after`,
to the coordinator. Retries, sleeps and cooldowns belong to the coordinator. The supplied instance
must not add automatic retries, throttling, sleeps or an independent queue, or hide the call's
actual result or error. Transformers that preserve this contract are compatible.

## Context

A hidden auto-retry layer would consume 429 responses before the coordinator could observe them,
and would sleep or resend outside the scheduler's cooldown and uncertainty policies. Compatibility
depends on a transformer's behavior, not merely its presence; see
[grammY transformers](https://grammy.dev/advanced/transformers).
