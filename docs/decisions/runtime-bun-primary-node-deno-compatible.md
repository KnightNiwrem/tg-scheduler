# Bun as primary runtime; Node.js and Deno as library targets

- **Status:** invariant
- **Human-confirmed:** no

## Decision

Bun is the primary development runtime and the reference runtime for library workers. Node.js and
Deno are library compatibility targets for both clients and workers: library imports and package
entry points must work on all three runtimes, and the library core must not depend on Bun-only or
Deno-only APIs.

Runtime-specific startup, permissions, environment access, process signals and exit handling belong
to the host application, outside the shared library.

Compatibility with a runtime is established only by real queue and worker operations against Valkey
on that runtime. Successful imports or type checking alone do not establish it.

## Context

Clients and workers may run in application processes on different supported runtimes, so the
library core must stay portable. The tested runtime versions are recorded in the
[library research](../library-research.md#selected-version-native-behavior).
