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
