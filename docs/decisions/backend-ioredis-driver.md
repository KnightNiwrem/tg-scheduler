# ioredis as the initial Valkey client

- **Status:** provisional
- **Human-confirmed:** no

## Decision

BullMQ connects to Valkey through actual ioredis clients. A manually created client passed to a
BullMQ worker sets `maxRetriesPerRequest: null`, and the worker uses a duplicated connection for
blocking commands.

A replacement client or `IRedisClient` adapter, such as one for Bun's built-in Redis client, may
replace ioredis when it satisfies BullMQ's full contract for the selected version (commands,
connection lifecycle and events, duplication, Lua scripts and pipelines) and passes the integration
checks on every target runtime. That replacement stays within the
[BullMQ and Valkey backend](backend-bullmq-valkey.md) decision.

## Context

BullMQ's [connection documentation](https://docs.bullmq.io/guide/connections) describes raw ioredis
compatibility and the `IRedisClient` adapter contract. A driver-specific compatibility failure is
grounds to evaluate a replacement client, not to revisit the backend or runtime targets.
