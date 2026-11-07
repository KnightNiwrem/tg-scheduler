# Local Valkey persistence and exposure

- **Status:** provisional
- **Human-confirmed:** no

## Decision

The local Valkey service enables AOF with `appendfsync everysec`, uses
`maxmemory-policy noeviction` and stores its data in a named volume. It publishes its port only on
host loopback (`VALKEY_PORT`, default `6379`) and requires no authentication.

## Context

Eviction would silently delete queued jobs. `appendfsync everysec` can lose about one second of
acknowledged writes in an abrupt crash; see
[submission acknowledgement](api-submit-acknowledgement.md). Loopback access without
authentication is only suitable for local testing, and operators supply the production Valkey
configuration.
