# Valkey connection settings by role

- **Status:** provisional
- **Human-confirmed:** no

## Decision

Producers and workers create unconnected ioredis clients (`lazyConnect`) with a five-second connect
timeout and a connection name that appears in `CLIENT LIST`.

- **Producer connections** fail commands promptly when the connection is down:
  `maxRetriesPerRequest: 1` and no offline queue. There is no command timeout. ioredis's default
  TCP keepalive (after 30 seconds idle) lets the operating system eventually detect a dead peer, but
  a command sent to a Valkey server that stops responding while its TCP connection stays alive
  waits without bound.
- **Worker connections** keep reconnecting and queue commands offline: `maxRetriesPerRequest: null`
  and the offline queue enabled.

A Valkey URL must use `redis://` or `rediss://`, include a host, and may include a database number.
URLs with query strings or fragments are rejected, and validation messages omit the URL and its
credentials.

## Context

Producers serve callers that are awaiting `submit`, while BullMQ requires the worker settings for
blocking worker connections. ioredis applies URL query parameters as client options, so a query
such as `?maxRetriesPerRequest=0` could silently override the role settings. Connection names let
operators attribute connections.
