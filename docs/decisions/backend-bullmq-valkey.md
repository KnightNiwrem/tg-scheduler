# BullMQ backed by Valkey

- **Status:** invariant
- **Human-confirmed:** no

## Decision

BullMQ, backed by a Valkey server, stores and coordinates durable jobs, delayed activation,
scheduling state, reservations and recovery. BullMQ receives its connections through its supported
injectable connection interface with ioredis-compatible interoperability. The implementation reuses
this machinery instead of building a general-purpose queue engine. Additional backends are outside
the first slice.

## Context

None of the Telegram-specific libraries or durable queues reviewed in the [library
research](../library-research.md#alternatives-reviewed-background-only) matched the required
scheduling semantics; Convex and Durable Objects were background comparisons only. Selected-version
experiments show which native primitives can be reused and which need additional coordination; see
[native primitives](backend-native-primitives.md). Valkey is the server, and using it does not
require a Valkey-specific client; see the [ioredis driver](backend-ioredis-driver.md).
