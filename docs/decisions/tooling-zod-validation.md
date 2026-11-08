# Parse structured options and stored data with Zod

- **Status:** provisional
- **Human-confirmed:** no

## Decision

Use Zod schemas for library-defined structured input at the
[trust boundaries](validation-trust-boundaries.md): `botId`, `queuePrefix`, submit options, the
worker policy, and job data, native timing metadata and outcomes read back from Valkey. A `z.custom`
check uses BullMQ's instance predicate for the caller-owned connection, retaining the resource by
reference. Required function options are checked with `typeof`. Submitted payloads use the
hand-written [durable JSON request](api-durable-json-requests.md) parser instead of Zod, and a payload
read back from Valkey is checked in place with `z.custom` rather than rebuilt by an object or record
schema.

Native recurrence options follow [BullMQ's validation and error contract](recurrence-native-schedules.md)
without a Zod schema for their values or cron syntax.

## Context

Zod covers fixed-shape input concisely and reports every problem in one message. The payload parser
names the first unsupported value by its path, such as `payload.photo` for an `InputFile`, which is
the error a caller needs. Zod object, record and JSON schemas rebuild objects and drop own
`__proto__` keys, which would alter a payload Telegram should receive as submitted.
BullMQ owns recurrence validation, so supported expressions and native error behavior can evolve
with the selected dependency without a second validator restricting them.
