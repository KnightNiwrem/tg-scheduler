# One coordination authority per bot

- **Status:** invariant
- **Human-confirmed:** no

## Decision

Immediate, delayed and recurring work for a bot share one logical coordination authority, including
work submitted from separate serverless producer invocations. Every controlled call for the bot
passes through that authority, and every producer and worker for the bot uses the same backend
namespace and bot identity. Different bots coordinate independently.

## Context

Concurrency limits and 429 cooldowns protect a bot only when every call it makes is counted against
them. Direct Bot API calls made outside this library are outside its concurrency and cooldown
guarantees.
