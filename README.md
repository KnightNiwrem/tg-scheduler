# tg-scheduler

A planned durable queue and scheduler for outgoing Telegram Bot API calls, written in TypeScript
with grammY, BullMQ, and Valkey. Bun is the primary development and worker runtime; Biome handles
linting and formatting.

The repository currently contains the Bun starter, a sample entry point, and a placeholder test.
The queue, scheduler, Telegram transport, and Docker Compose setup are not implemented yet.

## Planned capabilities

The first implementation will provide explicit enqueue and status/result retrieval for immediate
jobs, one-time delayed jobs, and fixed-interval recurring schedules. Payloads will support
JSON-serializable requests and existing Telegram `file_id` references. Disabling recurrence will
stop future occurrences while preserving jobs already created.

All producers for a bot will share durable coordination, including configurable concurrency and
ordinary admission pauses on Telegram 429 responses. An opt-in, bounded urgent lane will support
time-sensitive callback and pre-checkout answers. Accepted work will survive producer exit, with
long-lived workers activating due work through BullMQ and Valkey.

The selected design uses BullMQ's supported injectable connection interface backed by Valkey, with
ioredis as the provisional initial driver. The first local deployment will use Docker Compose with
a Bun worker and the official `valkey/valkey` image. Node.js and Deno remain library compatibility
targets; [runtime compatibility research](docs/library-research.md#runtime-compatibility) records
dependency support. This project's scheduler implementation and integration tests remain pending.
Inbound updates, polling, and webhook ingestion are outside scope.

## Getting started

Install [Bun](https://bun.sh/docs/installation) 1.4.4, then install dependencies:

```sh
bun install --frozen-lockfile
```

## Commands

- `bun run start` — run the sample `src/main.ts` entry point
- `bun run dev` — run `src/main.ts` with file watching
- `bun run test` — run the shared tests on Bun
- `bun run test:bun` — run the shared tests on Bun explicitly
- `bun run test:node` — run the shared tests on Node.js
- `bun run test:deno` — run the shared tests on Deno
- `bun run test:all` — run the shared tests on all three runtimes
- `bun run lint` — lint files with Biome
- `bun run fmt` — format files with Biome
- `bun run fmt:check` — check formatting
- `bun run check` — type-check source files and tests with TypeScript

Biome uses two-space indentation, single quotes, and a 100-column line width. GitHub Actions runs
formatting, lint, type, and test checks on pushes to `main` or `master` and on pull requests.
Tool versions and scripts are defined in [package.json](package.json), with dependencies locked in
[bun.lock](bun.lock).

## Testing

[Vitest](https://vitest.dev/guide/) runs the same TypeScript suite on Bun, Node.js, and Deno. Tests
import `expect` and `test` from `vitest`; mocking, fake timers, snapshots, and lifecycle hooks are
available without a separate assertion or mocking library. Bun remains the default for
`bun run test`.

`bun run test:all` requires all three runtimes to be installed. CI uses Bun 1.4.4, Node.js 24.22.1,
and Deno 2.9.6 and runs each runtime in a separate job. All dependencies come from `bun.lock`;
the Deno test command uses the installed local packages without creating a separate Deno lockfile.
The current suite covers the starter only; scheduler integration tests remain pending.

## Project documentation

- [Architecture](docs/architecture.md): requirements, selected design, API boundaries, scheduling,
  concurrency, and failure semantics.
- [Validation](docs/validation.md): first-slice acceptance criteria, runtime and recovery checks,
  and deferred capabilities.
- [Library research](docs/library-research.md): BullMQ integration caveats and the rationale for
  choosing the backend over the alternatives reviewed.
