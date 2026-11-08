# Untrusted input is parsed once into library-owned values

- **Status:** provisional
- **Human-confirmed:** no

## Decision

A value from outside the library is validated once, where it enters. Caller-supplied data is
parsed into a new value the library owns, and code after that point uses the parsed value, never
the original. Validation of [native recurrence options](recurrence-native-schedules.md) is delegated
to BullMQ; the library does not add a Zod schema or cron parser before that handoff.
Caller-supplied functions,
[connections](backend-ioredis-driver.md) and [API instances](transport-caller-owned-api.md) are
checked as their contracts require and retained by reference. Data read back from Valkey has just
been parsed from JSON by BullMQ and is referenced by no other code, so it is checked in place without
another copy. Values that the library's own modules produce carry their invariants in their types and are not
revalidated when passed between modules.

Validation rejects input that would be lost, altered or misapplied, such as a payload that JSON
storage cannot replay or an invalid bot identity. It does not treat
the calling application, which runs in the same process, as hostile, so it does not defend against
values built to defeat it, such as proxies, getters or `toJSON` hooks; those behave as ordinary
reads.

Values from outside the library enter at these boundaries:

- client and worker options, at construction; connections are recognized with BullMQ's instance
  check, while connection settings and the supplied API instance's configuration remain the
  caller's responsibility;
- `submit`, `createSchedule`, `deleteSchedule` and `getJob` arguments, including the payload, which
  is copied as described in
  [durable JSON requests](api-durable-json-requests.md);
- fields read from Telegram responses, such as `retry_after`, whose parsing the
  [retry delay](rate-limit-retry-after-fallback.md) decision places;
- job data, native scheduling metadata and outcomes read back from Valkey, as recorded in
  [stored job data](backend-stored-job-data.md).

Invalid library-defined input is reported as a `TypeError` whose message omits credentials. Native
BullMQ schedule-creation errors propagate unchanged through `createSchedule`. The
[Zod decision](tooling-zod-validation.md) covers which parser handles which input.

## Context

A value that is checked but then passed on unchanged stays under the caller's control, and later
mutation can make the value the library uses differ from the one it checked. Copying a
caller-supplied value closes that gap with one copy. The caller writes the code that builds its own
values, so guarding against values built to defeat the parser adds code and tests without protecting
a real security boundary. Valkey is a boundary too: other processes, and possibly other library
versions, write the data read back from it.
