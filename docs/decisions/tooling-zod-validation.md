# Zod parses structured options and stored data

- **Status:** provisional
- **Human-confirmed:** no

## Decision

Zod schemas parse structured input at the [trust boundaries](validation-trust-boundaries.md):
`botId`, `queuePrefix`, Valkey URLs, submit options, the worker policy, and job data and outcomes
read back from Valkey. Function options such as `resolveBotToken` are checked with `typeof` where
they are required. Payloads use the hand-written
[durable JSON request](api-durable-json-requests.md) parser instead of Zod.

## Context

Zod covers fixed-shape input concisely and reports every problem in one message. Zod schemas read
property values, which runs getters. The payload parser instead reads property descriptors and
checks for `toJSON` hooks, which value-based schemas do not detect.
