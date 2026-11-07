# Untrusted input is parsed once into library-owned values

- **Status:** provisional
- **Human-confirmed:** no

## Decision

A value from outside the library is parsed where it enters, into a new value the library owns. Code
after that point uses the parsed value, never the original. Values that the library's own modules
produce carry their invariants in their types and are not revalidated when passed between modules.

Untrusted values enter at these boundaries:

- client and worker options, at construction;
- `submit` and `getJob` arguments, including the payload, which is copied as described in
  [durable JSON requests](api-durable-json-requests.md);
- the token resolver's return value, checked by the transport before each attempt;
- fields read from Telegram responses, such as `retry_after`, whose parsing the
  [retry delay](rate-limit-retry-after-fallback.md) decision places;
- job data and outcomes read back from Valkey, as recorded in
  [stored job data](backend-stored-job-data.md).

Invalid input is reported as a `TypeError` whose message omits credentials. The
[Zod decision](tooling-zod-validation.md) covers which parser handles which input.

## Context

A value that is checked but then passed on unchanged stays under the caller's control. Getters,
`toJSON` hooks, proxies and later mutation can all make the value the library uses differ from the
value it checked. Parsing into a new value closes all of these paths together instead of one
finding at a time. Valkey is a boundary too: other processes, and possibly other library versions,
write the data read back from it.
