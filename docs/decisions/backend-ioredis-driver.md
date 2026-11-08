# Caller-owned ioredis connections

- **Status:** provisional
- **Human-confirmed:** no

## Decision

Client and worker options accept a caller-created ioredis `Redis` or `Cluster` instance through the
`connection` option. The library passes that instance to BullMQ without changing its connection
settings. The caller controls authentication, TLS, retries, timeouts, reconnection, and connection
lifetime. Separate instances may be supplied to clients and workers, or a compatible instance may be
shared.

Closing a scheduler client or worker closes its BullMQ resources and removes their listeners, but
leaves the supplied connection open. BullMQ owns and closes the duplicated connection it creates
for blocking worker commands. The caller closes the supplied connection after its users finish.

Connections must satisfy BullMQ's connection contract. BullMQ recommends
`maxRetriesPerRequest: null` for workers; the pinned version also accepts `0`, which the library
passes through unchanged. Key prefixes are supplied through the scheduler's `queuePrefix` rather
than ioredis's `keyPrefix`. The library checks worker retry compatibility before allocating BullMQ
resources and reports invalid settings without changing them.

## Context

Connection and store configuration belong to the caller. Accepting the existing resource avoids
duplicating ioredis configuration or imposing a separate connection policy. BullMQ's
[connection documentation](https://docs.bullmq.io/guide/connections) defines compatible settings and
blocking-connection behavior. Its worker constructor can allocate resources before rejecting an
invalid retry setting, so checking that requirement first permits cleanup after a failed start.
