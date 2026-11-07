# Vitest runs one suite on every runtime

- **Status:** provisional
- **Human-confirmed:** no

## Decision

Vitest runs the same TypeScript test files on Bun, Node.js and Deno. Tests import their APIs from
`vitest`, with no separate assertion or mocking library. `bun run test` runs the suite on Bun, and
`test:node`, `test:deno` and `test:all` run it on the other runtimes or on all three.

## Context

Running identical tests on each runtime makes the cross-runtime results comparable. Vitest runs
TypeScript directly on all three runtimes and provides assertions, lifecycle hooks, mocking, fake
timers and snapshots.
