# Biome for formatting and linting

- **Status:** invariant
- **Human-confirmed:** no

## Decision

Biome formats and lints the repository using `biome.json`: two-space indentation, 100-column lines,
single quotes and the recommended lint rules. `bun run fmt:check` and `bun run lint` run in CI, and
lint warnings fail the check. Testing on Node.js and Deno does not add a second formatter or linter.

## Context

Biome is part of the fixed implementation stack. A single toolchain keeps formatting and linting
identical regardless of the runtime under test.
