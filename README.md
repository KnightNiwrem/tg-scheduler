# tg-scheduler

A planned durable queue and scheduler for outgoing Telegram Bot API calls, written in TypeScript
with grammY, BullMQ, and Valkey. Bun is the primary development and worker runtime.

The library currently supports the basic delivery path for immediate and one-time delayed jobs:

- `submit` validates that a payload is durable JSON and stores it in Valkey through BullMQ.
- A library worker claims due jobs within an ordinary concurrency shared by every worker for the
  bot, and makes one grammY call per job.
- `getJob` reports the job as `queued`, `in-flight`, `succeeded`, `failed`, or `uncertain`, with
  the Telegram result or error.

Ambiguous attempts, such as network failures or Telegram server errors, are reported as `uncertain`
and never retransmitted automatically. A worker that stops mid-attempt leaves its job `in-flight`
until a running worker's stalled-job check, after BullMQ's 30-second lock expires, reports it as
`uncertain`.

A Telegram 429 currently settles the job as `failed`; durable 429 retry with lane cooldowns is not
implemented yet, so the worker is not ready for production traffic. Recurring schedules and the
urgent lane reject with `UnimplementedError`. Ordering by original due time and a runnable worker
executable are also not implemented yet.

See the [library overview](docs/library-overview.md) for the component flow and source map, and the
[usage sketch](examples/library.ts) for the intended API.

## Planned capabilities

The rest of the first implementation will add fixed-interval recurring schedules with status and
result retrieval like other jobs. Disabling recurrence will stop future occurrences while
preserving jobs already created.

Producers and workers for a bot will pause ordinary admission on Telegram 429 responses and retry
the affected job after the cooldown, keeping eligible jobs in original due-time order. An opt-in,
bounded urgent lane will support time-sensitive callback and pre-checkout answers. A worker
executable and Compose service will run the worker as a long-lived process.

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
The suite covers option and payload validation, the producer and worker connection settings, and
grammY outcome classification against a fake Bot API. Set `VALKEY_TEST_URL` to also run the
client and worker against real Valkey with a fake Telegram transport: immediate and delayed
delivery, visible outcomes, shared concurrency across workers, graceful worker shutdown, and
connection release. Each test uses a unique key prefix and deletes its own data; use a local test
instance. Without this variable, backend integration tests are skipped. CI starts Valkey and
enables them for every runtime.

```sh
docker compose up -d --wait valkey
VALKEY_TEST_URL=redis://127.0.0.1:6379/0 bun run test:all
```

Adjust the port if `VALKEY_PORT` differs. The full scheduler acceptance criteria remain pending.

## Project documentation

- [Library overview](docs/library-overview.md): component flow, source map, and scaffolded public API.
- [Architecture](docs/architecture.md): requirements, selected design, API boundaries, scheduling,
  concurrency, and failure semantics, including
  [implementation decisions pending review](docs/architecture.md#10-decisions-pending-review).
- [Validation](docs/validation.md): first-slice acceptance criteria, runtime and recovery checks,
  and deferred capabilities.
- [Library research](docs/library-research.md): BullMQ integration caveats and the rationale for
  choosing the backend over the alternatives reviewed.
