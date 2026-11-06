# Bun Template

This project is bootstrapped with a minimal Bun and TypeScript configuration, using Biome for linting
and formatting.

## Getting started

Install [Bun](https://bun.sh/docs/installation) 1.4.4, then install dependencies:

```sh
bun install --frozen-lockfile
```

## Commands

- `bun run start` — run `src/main.ts`
- `bun run dev` — run `src/main.ts` with file watching
- `bun run test` — run tests
- `bun run lint` — lint files with Biome
- `bun run fmt` — format files with Biome
- `bun run fmt:check` — check formatting
- `bun run check` — type-check source files and tests

Biome uses two-space indentation, single quotes, and a 100-column line width. GitHub Actions runs
formatting, lint, type, and test checks on pushes to `main` or `master` and on pull requests.
