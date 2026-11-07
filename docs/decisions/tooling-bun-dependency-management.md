# Bun manages dependencies with exact pins

- **Status:** provisional
- **Human-confirmed:** no

## Decision

Bun installs dependencies from `package.json` and the single `bun.lock`; CI installs with
`--frozen-lockfile`. Dependency, tool, container image and CI runtime versions are pinned exactly.
Node.js and Deno test runs use the packages that Bun installed, and Deno runs without its own
lockfile.

## Context

Compatibility evidence applies to the versions that were tested, so versions change only
deliberately. One dependency workflow keeps all three runtimes on the same packages.
