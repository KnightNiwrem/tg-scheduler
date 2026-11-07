# Producers connect directly to Valkey

- **Status:** provisional
- **Human-confirmed:** no

## Decision

Producers submit work by connecting to Valkey through the BullMQ client path. There is no HTTP
gateway in the first slice. Serverless compatibility means producer lifetime independence: accepted
work does not depend on the producer staying alive.

## Context

The producer's hosting runtime must support the connection and reach Valkey. Not every serverless
platform permits that networking, so serverless compatibility makes no claim about every hosting
platform.

Valkey access is the trust boundary: any client that can reach the namespace can read and modify
every stored job in it. The library does not require Valkey authentication and accepts URLs without
credentials, so operators must configure Valkey authentication and network restrictions, and supply
credentials in the Valkey URL of each trusted producer and worker. Bot tokens stay
out of stored jobs; see [bot token handling](credentials-bot-token-handling.md). The
[local Valkey service](local-valkey-persistence.md) has no authentication and is reachable only from
host loopback.
