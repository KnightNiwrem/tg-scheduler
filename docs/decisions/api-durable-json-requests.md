# Durable JSON requests

- **Status:** provisional
- **Human-confirmed:** no

## Decision

A stored request is a Bot API method name and a payload that is a plain object of JSON values:
strings, booleans, finite numbers, `null`, arrays and plain objects. Object properties set to
`undefined` are omitted, like absent options. Existing Telegram `file_id` references are supported
as strings.

`submit` rejects, with a `TypeError` naming the path, `InputFile` uploads, other class instances,
dates, functions, bigints, symbols, non-finite numbers, undefined or missing array elements and
circular references.

Parsing builds a new payload from the caller's enumerable own string-keyed properties and array
elements, and `submit` stores that copy rather than the caller's object. Changing the caller's
object after `submit` returns has no effect on the stored job. An own `__proto__` key is copied as
data.

Method names must look like Bot API methods and exclude inbound methods. They are not checked
against the full method list, and per-method fields are left to Telegram.

New-file upload persistence is outside the first slice.

## Context

Another process sends the request after the submitter may have exited, so callbacks, closures,
process-local streams and temporary files cannot be replayed reliably and are rejected at submission
rather than accepted unreliably. Storing a copy follows the
[trust-boundary rule](validation-trust-boundaries.md), which also explains why proxies, getters and
`toJSON` hooks on the caller's value are read like ordinary values rather than rejected: BullMQ
serializes the copy, so they cannot change what is stored after parsing.

Checking names against the full method list would duplicate grammY's types at runtime; Telegram
rejects an unknown method with a definite 404, which is reported as `failed`.
