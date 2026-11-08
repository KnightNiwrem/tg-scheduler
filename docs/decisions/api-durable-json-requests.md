# Durable JSON requests

- **Status:** provisional
- **Human-confirmed:** no

## Decision

A stored request is a Bot API method name and a payload that is a plain object of JSON values:
strings, booleans, finite numbers, `null`, arrays and plain objects. Existing Telegram `file_id`
references are supported as strings.

`submit` validates the payload with Zod's `z.json()` inside a string-keyed record and rejects, with
a `TypeError`, `InputFile` uploads, other class instances, dates, functions, bigints, symbols,
non-finite numbers, `undefined` values (object properties as well as array elements) and missing
array elements. The error describes the accepted values but does not name the offending path; Zod's validation
error is kept as its `cause`.

`submit` then copies the payload by encoding it with `JSON.stringify` and decoding the result, and
stores that copy rather than the caller's object. Encoding rejects what validation does not detect,
such as circular references, with a `TypeError` that keeps the encoding error as its `cause`.
Changing the caller's object after `submit` returns has no effect on the stored job.

Method names must look like Bot API methods and exclude inbound methods. They are not checked
against the full method list, and per-method fields are left to Telegram.

New-file upload persistence is outside the first slice.

## Context

Another process sends the request after the submitter may have exited, so callbacks, closures,
process-local streams and temporary files cannot be replayed reliably and are rejected at submission
rather than accepted unreliably. `JSON.stringify` alone would silently drop or alter several of
these values (non-finite numbers and `undefined` array elements become `null`, functions are
dropped, class instances lose their prototype and `Map` and `Set` contents, dates become strings),
so validation must come first.

A property set to `undefined` is rejected rather than omitted: an absent key is the only correct
stored form, and callers can leave the key out. Validation does not report the offending path
because `z.json()` reports union failures at the top level; a dedicated parser that named the path
was more code to maintain than the diagnostic was worth. Zod's parsed output is discarded because
the JSON encoding is needed anyway to reject circular references, and its result is exactly what
BullMQ stores.

Storing a copy follows the [trust-boundary rule](validation-trust-boundaries.md), which also
explains why proxies, getters and `toJSON` hooks on the caller's value are read like ordinary
values rather than rejected: BullMQ serializes the copy, so they cannot change what is stored after
parsing.

Checking names against the full method list would duplicate grammY's types at runtime; Telegram
rejects an unknown method with a definite 404, which is reported as `failed`.
