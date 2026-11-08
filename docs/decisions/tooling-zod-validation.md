# Zod parses structured options and stored data

- **Status:** provisional
- **Human-confirmed:** no

## Decision

Zod schemas parse structured input at the [trust boundaries](validation-trust-boundaries.md):
`botId`, `queuePrefix`, submit options, the worker policy, and job data and outcomes read back from
Valkey. A `z.custom` check uses BullMQ's instance predicate for the caller-owned connection, retaining
the resource by reference. Required function options are checked with `typeof`. Submitted payloads
use the hand-written
[durable JSON request](api-durable-json-requests.md) parser instead of Zod, and a payload read back
from Valkey is checked in place with `z.custom` rather than rebuilt by an object or record schema.

## Context

Zod covers fixed-shape input concisely and reports every problem in one message. The payload parser
names the first unsupported value by its path, such as `payload.photo` for an `InputFile`, which is
the error a caller needs. Zod object, record and JSON schemas rebuild objects and drop own
`__proto__` keys, which would alter a payload Telegram should receive as submitted.
