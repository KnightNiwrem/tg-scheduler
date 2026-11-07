# Bot token handling

- **Status:** provisional
- **Human-confirmed:** no

## Decision

Bot tokens never appear in job payloads or stored job data. The worker resolves the token through
its `resolveBotToken` option before every attempt, so token rotation takes effect, and reuses the
grammY `Api` instance while the token is unchanged.

A resolver that throws or returns anything other than a non-empty string fails the job before
sending, with a generic message; the resolver's own error is not stored. Stored error messages have
the current token redacted, and tokens are excluded from logs.

## Context

Stored jobs persist and are readable by any process with backend access. A resolver is
caller-defined, and its error may describe credentials.
