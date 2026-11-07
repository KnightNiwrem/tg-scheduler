# Zod validates options and stored data

- **Status:** provisional
- **Human-confirmed:** no

## Decision

Zod schemas validate client and worker options, the worker policy, Valkey URLs, and job data and
outcomes read back from Valkey. Invalid input is reported as a `TypeError` whose message omits
credentials.

## Context

Options come from callers and stored data comes from other processes, so both are external input
validated at the library boundary.
