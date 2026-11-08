# Bot token handling

- **Status:** provisional
- **Human-confirmed:** no

## Decision

The library never adds a bot token to job payloads or stored job data; a value the caller places in
a payload is stored as supplied. Credentials and credential rotation belong to the caller through
the [supplied grammY API instance](transport-caller-owned-api.md).

Stored error messages have the supplied instance's token redacted, and tokens are excluded from
library logs.

## Context

Stored jobs persist and are readable by any process with backend access. Errors from a
caller-configured API instance may contain credentials and must not expose them in stored outcomes
or library logs.
