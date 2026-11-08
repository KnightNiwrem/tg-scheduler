# Bot token handling

- **Status:** provisional
- **Human-confirmed:** no

## Decision

The library never adds a bot token to job payloads or stored job data; a value the caller places in
a payload is stored as supplied. Credentials and credential rotation belong to the caller through
the [supplied grammY API instance](transport-caller-owned-api.md).

The transport redacts the supplied instance's token before including an error message in a stored
outcome or a library transport log. It does not persist the raw error object or its cause.

The caller must ensure that errors leaving its configured API instance contain no other
credentials. Custom endpoint, network and transformer code must sanitize credential-bearing
messages before they reach the scheduler, preserving the outcome fields needed by the
[transport contract](transport-grammy-outgoing-api.md). Logs produced by caller-owned code remain
the caller's responsibility.

## Context

Stored jobs persist and are readable by any process with backend access. The library knows the
supplied API token, but cannot identify arbitrary credentials embedded in custom error text. Token
redaction is therefore a safeguard for that known secret, not general sanitization of a
caller-configured API instance's errors.
