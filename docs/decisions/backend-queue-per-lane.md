# One BullMQ queue per bot lane

- **Status:** provisional
- **Human-confirmed:** no

## Decision

Each bot has one ordinary BullMQ queue and, when urgent bypass is enabled, one urgent queue. Every
producer and worker for the bot uses the same queue identities. The urgent queue is governed by its
own bounded capacity and cooldown; it is not an unrestricted second sender.

## Context

BullMQ capacity limits and rate limits apply per queue, and separate queue identities remain
independent, so a queue per lane gives each lane its own capacity and cooldown gate. Queue names
follow the [bot identity and key namespace](backend-bot-id-and-key-namespace.md) decision.
