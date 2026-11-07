# Durable JSON requests

- **Status:** provisional
- **Human-confirmed:** no

## Decision

A stored request is a Bot API method name and a payload that is a plain object of JSON values:
strings, booleans, finite numbers, `null`, arrays and plain objects. Object properties set to
`undefined` are omitted, like absent options. Existing Telegram `file_id` references are supported
as strings.

`submit` rejects, with a `TypeError` naming the path, `InputFile` uploads, other class instances,
dates, functions, bigints, symbols, non-finite numbers, undefined or missing array elements,
getter or setter properties, arrays or objects with a callable or accessor `toJSON` (including a
non-enumerable or inherited one) and circular references. A `toJSON` field holding a plain JSON
value is an ordinary property.

Parsing builds a new payload from the property descriptors it reads, and `submit` stores that copy
rather than the caller's object. The stored payload is therefore exactly the validated one, and
changing the caller's object after `submit` returns has no effect on it. For a payload without
proxies, parsing runs no caller code. A proxy's traps run while parsing reads it, so a proxy can
cause a rejection or throw its own error, but it cannot make the stored payload differ from the
parsed copy.

Method names must look like Bot API methods and exclude inbound methods. They are not checked
against the full method list, and per-method fields are left to Telegram.

New-file upload persistence is outside the first slice.

## Context

Another process sends the request after the submitter may have exited, so callbacks, closures,
process-local streams and temporary files cannot be replayed reliably and are rejected at submission
rather than accepted unreliably. Getters and `toJSON` hooks would encode differently from the
contents that parsing reads, so they are rejected rather than copied silently.

Storing a copy follows the [trust-boundary rule](validation-trust-boundaries.md). A proxy can answer
every read differently, so inspecting the caller's object guarantees nothing about a later
serialization of it. `util.types.isProxy` from `node:util` could reject proxies on Bun, Node.js and
Deno, but it is not ECMAScript, and rejecting proxies would still leave the stored value dependent
on BullMQ serializing the job before the caller could mutate it. Copying covers both cases and needs
no runtime-specific API.

Checking names against the full method list would duplicate grammY's types at runtime; Telegram
rejects an unknown method with a definite 404, which is reported as `failed`.
