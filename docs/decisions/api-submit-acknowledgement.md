# Submission resolves on the Valkey write acknowledgement

- **Status:** provisional
- **Human-confirmed:** no

## Decision

`submit` resolves once Valkey acknowledges the write, without waiting for an AOF fsync (`WAITAOF`).

## Context

Accepted work is subject to the configured `appendfsync everysec` loss window, about one second of
writes after an abrupt crash; see [local Valkey persistence](local-valkey-persistence.md). A manual
check recorded in [PR #2](https://github.com/KnightNiwrem/tg-scheduler/pull/2) showed that jobs
acknowledged through `WAITAOF` survived a Valkey `SIGKILL`; waiting for it would close the loss
window at the cost of an fsync wait on every submission.
