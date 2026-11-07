# tg-scheduler

A planned durable queue and scheduler for outgoing Telegram Bot API calls, written in TypeScript
with grammY, BullMQ, and Valkey. Bun is the primary development and worker runtime.

The repository currently provides a typed library skeleton for the client, worker, coordinator,
backend, and grammY transport. Its operations explicitly reject with `UnimplementedError`. The
implemented part is the backend's Valkey connection factory, which validates the connection URL and
applies the producer and worker connection settings BullMQ needs. Telegram delivery, per-bot
coordination, recurrence, and a runnable worker are not implemented yet.

See the [library overview](docs/library-overview.md) for the component flow and source map, and the
[usage sketch](examples/library.ts) for the intended API.

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
ioredis as the provisional initial driver. Node.js and Deno remain library compatibility targets.
The [testing guide](#testing) describes current coverage and the commands to run it.
Inbound updates, polling, and webhook ingestion are outside scope.

## Getting started

Install [Bun](https://bun.sh/docs/installation) 1.4.4 and Docker with Compose, then run:

```sh
bun install --frozen-lockfile
cp .env.example .env
docker compose up -d --wait
```

Compose currently starts only a local Valkey service, used by the integration tests. A worker
service will be added once the scheduler worker can run. `docker compose down` stops Valkey and
preserves the named data volume; `docker compose down -v` also deletes local queue data.

`VALKEY_PORT` sets the published host port and defaults to `6379`. If that port is occupied, set it
to another port in `.env` and use the same port in `VALKEY_TEST_URL`.

Local Valkey listens on host loopback without authentication, uses a named volume, enables AOF
with `appendfsync everysec`, and disables key eviction. The volume survives container recreation;
an abrupt crash can still lose roughly one second of writes, and volume deletion or disk loss
removes the data. See [Valkey persistence](https://valkey.io/topics/persistence/) for the persistence
tradeoffs. This configuration is for local testing.

## Commands

- `bun run test` — run the shared tests on Bun
- `bun run test:bun` — run the shared tests on Bun explicitly
- `bun run test:node` — run the shared tests on Node.js
- `bun run test:deno` — run the shared tests on Deno
- `bun run test:all` — run the shared tests on all three runtimes
- `bun run lint` — lint files
- `bun run fmt` — format files
- `bun run fmt:check` — check formatting
- `bun run check` — type-check source files and tests with TypeScript

Tool versions and scripts are defined in [package.json](package.json), with dependencies locked in
[bun.lock](bun.lock).

## Testing

[Vitest](https://vitest.dev/guide/) runs the same TypeScript suite on Bun, Node.js, and Deno. Tests
import `expect` and `test` from `vitest`; mocking, fake timers, snapshots, and lifecycle hooks are
available without a separate assertion or mocking library. Bun remains the default for
`bun run test`.

`bun run test:all` requires all three runtimes to be installed. All dependencies come from `bun.lock`;
the Deno test command uses the installed local packages without creating a separate Deno lockfile.
The suite covers Valkey URL validation and the producer and worker connection settings. Set
`VALKEY_TEST_URL` to also run a BullMQ queue and worker on those connections against real Valkey and
verify that every client is released after cleanup. The test uses a unique queue name and deletes
its own queue data; use a local test instance. Without this variable, backend integration tests are
skipped. CI starts Valkey and enables them for every runtime.

```sh
docker compose up -d --wait valkey
VALKEY_TEST_URL=redis://127.0.0.1:6379/0 bun run test:all
```

Adjust the port if `VALKEY_PORT` differs. The full scheduler acceptance criteria remain pending.

## Project documentation

- [Library overview](docs/library-overview.md): component flow, source map, and scaffolded public API.
- [Architecture](docs/architecture.md): requirements, selected design, API boundaries, scheduling,
  concurrency, and failure semantics.
- [Validation](docs/validation.md): first-slice acceptance criteria, runtime and recovery checks,
  and deferred capabilities.
- [Library research](docs/library-research.md): BullMQ integration caveats and the rationale for
  choosing the backend over the alternatives reviewed.
