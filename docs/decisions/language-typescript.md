# TypeScript with strict type checking

- **Status:** invariant
- **Human-confirmed:** no

## Decision

The library, tests and examples are written in TypeScript. `bun run check` type-checks them with
`tsc --noEmit` under the strict configuration in `tsconfig.json`.

## Context

TypeScript is part of the fixed implementation stack. Bot API method, payload and result types come
from grammY, so the public API can pair each method with its own payload and result types.
