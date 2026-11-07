# Submission resolves on the Valkey write acknowledgement

- **Status:** provisional
- **Human-confirmed:** no

## Decision

`submit` resolves once Valkey acknowledges the write, without waiting for an AOF fsync (`WAITAOF`).

## Context

Accepted work is therefore subject to the backend's AOF fsync policy. With the
[local Valkey configuration](local-valkey-persistence.md) (`appendfsync everysec`), writes
acknowledged within about the last second can be lost if Valkey or its host fails before the next
fsync; operator-supplied configurations determine their own loss window. This loss window is an
accepted risk. Waiting for `WAITAOF` would close it at the cost of an fsync wait on every
submission.
