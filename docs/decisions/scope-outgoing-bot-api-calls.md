# Schedule outgoing Bot API calls only

- **Status:** invariant
- **Human-confirmed:** no

## Decision

tg-scheduler queues and schedules outgoing Telegram Bot API calls. Inbound update processing,
including polling, webhook ingestion and webhook management, is outside the project. The `logOut`
and `close` lifecycle methods remain part of the outgoing method surface.

Telegram webhook-reply shortcuts are not used for controlled calls.

## Context

The durable queue and scheduler are the core of the project, and the Telegram call is a thin
effectful edge. A webhook reply returns no observed result or error, so the scheduler could not
record the outcome of the call.
