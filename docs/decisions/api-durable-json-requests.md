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
value is an ordinary property. Validation reads property descriptors, so it runs no caller code.

Proxies are not supported payload values. JavaScript cannot reliably detect them, so validation does
not reject them; a proxy may be rejected or may serialize differently from what was validated.

Method names must look like Bot API methods and exclude inbound methods. They are not checked
against the full method list, and per-method fields are left to Telegram.

New-file upload persistence is outside the first slice.

## Context

Another process sends the request after the submitter may have exited, so callbacks, closures,
process-local streams and temporary files cannot be replayed reliably and are rejected at submission
rather than accepted unreliably. Getters and `toJSON` hooks run code when the payload is serialized,
so the stored payload could differ from the validated one. A proxy can answer every property read
differently, so no inspection of it guarantees what serialization will encode. Checking names against the full method
list would duplicate grammY's types at runtime; Telegram rejects an unknown method with a definite
404, which is reported as `failed`.
