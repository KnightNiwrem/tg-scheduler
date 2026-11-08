# Develop with Bun and enforce Node.js and Deno compatibility

- **Status:** invariant
- **Human-confirmed:** no

## Decision

The library is developed using Bun. Compatibility with Node.js and Deno is enforced: library
imports, package entry points and runtime behavior must work on all three runtimes. The library
core must not depend on Bun-only or Deno-only APIs.

Runtime-specific startup, permissions, environment access, process signals and exit handling belong
to the host application, outside the shared library.

Compatibility with a runtime is established by integration tests covering submission, execution and
result retrieval against Valkey on that runtime. Successful imports or type checking alone do not
establish it.

## Context

One development toolchain keeps repository workflows consistent, while applications can use the
library on any supported runtime. The tested runtime versions are recorded in the
[library research](../library-research.md#selected-version-native-behavior).
