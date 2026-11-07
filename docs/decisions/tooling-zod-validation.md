# Zod validates options and stored data

- **Status:** provisional
- **Human-confirmed:** no

## Decision

Zod schemas validate `botId`, `queuePrefix`, Valkey URLs, submit options, the worker policy, and
job data and outcomes read back from Valkey. Function options such as `resolveBotToken` are checked
with `typeof` where they are required, and payloads use the
[durable JSON request](api-durable-json-requests.md) validator. Invalid input is reported as a `TypeError` whose message omits
credentials.

## Context

Options come from callers and stored data comes from other processes, so both are external input
validated at the library boundary.
