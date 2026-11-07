# Operated long-lived Bun workers

- **Status:** provisional
- **Human-confirmed:** no

## Decision

Due work runs in long-lived Bun worker processes that contain the grammY Telegram caller. The
operator provides worker execution and persistent Valkey. The first local deployment is a Docker
Compose stack with the worker and Valkey.

Client, coordinator, backend and transport are logical modules of one library, not separate
services. A serverless core and a universal adapter framework are outside the first slice.

## Context

Durable storage alone does not activate due work: something must run the claim loop independently
of producer lifetime. A durable queue does not inherently require a user-hosted coordinator, because
a platform can persist state and wake ephemeral code, but operated workers are the simplest
topology for the selected [BullMQ and Valkey backend](backend-bullmq-valkey.md).
