# Docker Compose with the official Valkey image for local development

- **Status:** invariant
- **Human-confirmed:** no

## Decision

Local development and the first-slice local stack use Docker Compose (`compose.yaml`) with the
official `valkey/valkey` image pinned to a tested tag. Secrets are supplied outside committed
Compose files. Once a worker executable exists, the Compose stack also runs the worker.

## Context

Docker Compose and the official image are part of the fixed implementation stack. The local
acceptance smoke test uses this stack to check worker restart and Valkey persistence.
