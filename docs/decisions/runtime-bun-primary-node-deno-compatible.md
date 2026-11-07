# Bun as primary runtime; Node.js and Deno as library targets

- **Status:** invariant
- **Human-confirmed:** no

## Decision

Bun is the primary development and worker runtime. Node.js and Deno are library compatibility
targets: library imports and package entry points must work on all three runtimes, and the library
core must not depend on Bun-only or Deno-only APIs.

Runtime-specific startup, permissions, environment access, process signals and exit handling belong
in executables at the edges, not in the library.

Compatibility with a runtime is established only by real queue and worker operations against Valkey
on that runtime. Successful imports or type checking alone do not establish it.

## Context

Producers may run in hosting environments other than the worker's, so the library must stay
portable while the operated worker uses Bun. The tested runtime versions are recorded in the
[library research](../library-research.md#selected-version-native-behavior).
