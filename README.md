# tg-scheduler

A planned durable queue and scheduler for outgoing Telegram Bot API calls, written in TypeScript
with grammY, BullMQ, and Valkey. Bun is the primary development and worker runtime.

The repository currently provides local Valkey and Bun worker infrastructure, Zod environment
validation, BullMQ queue/worker initialization, graceful shutdown, and a diagnostic job with a stored
result. Telegram delivery, per-bot coordination, and recurrence are not implemented yet.

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
docker compose up -d --build --wait
docker compose exec worker bun src/smoke.ts
```

The smoke command submits a `healthcheck` job, waits for the running worker, and prints its job ID
and stored result: `{"status":"ok","message":"hello"}`. It makes no Telegram calls and needs no bot
token. Completed and failed diagnostic jobs remain in Valkey for inspection.

Use `docker compose logs -f worker` to view worker startup/shutdown. `docker compose down` stops the
stack and preserves the named data volume. `docker compose down -v` also deletes local queue data.

For development with the worker on the host, start only Valkey, then use two terminals:

```sh
docker compose up -d valkey
bun run start
# In another terminal:
bun run smoke
```

If the Compose worker is already running, stop it with `docker compose stop worker` before starting
a host worker. Bun loads `.env` automatically. Watch mode is available through `bun run dev`.

## Configuration

The worker and smoke producer validate these variables with Zod before opening connections:

| Variable             | Default                  | Meaning                                                              |
| -------------------- | ------------------------ | -------------------------------------------------------------------- |
| `VALKEY_URL`         | Required                 | `redis://` or `rediss://` URL, optional credentials and database     |
| `QUEUE_NAME`         | `tg-scheduler-bootstrap` | Letters, digits, underscores, or hyphens; starts with a letter/digit |
| `WORKER_CONCURRENCY` | `1`                      | Positive integer; applies to this worker process                     |

Compose supplies `redis://valkey:6379/0` to its worker. Host commands use the URL from `.env`, which
defaults to `redis://127.0.0.1:6379/0` in the example. URL query parameters and fragments are rejected.
Configuration errors identify fields without printing input values or URL credentials. `.env` is
ignored by Git and excluded from the Docker image.

`VALKEY_PORT` is a Compose-only setting for the published host port, defaulting to `6379`. If that
port is occupied, set it to another port in `.env` and update the port in `VALKEY_URL` for host-run
commands. The worker's internal Compose address stays on port `6379`.

Local Valkey listens on host loopback without authentication, uses a named volume, enables AOF
with `appendfsync everysec`, and disables key eviction. The volume survives container recreation;
an abrupt crash can still lose roughly one second of writes, and volume deletion or disk loss
removes the data. See [Valkey persistence](https://valkey.io/topics/persistence/) for the persistence
tradeoffs. This configuration is for local testing.

The worker begins processing only after both Valkey connections are ready. SIGINT and SIGTERM stop
the worker from claiming new work, let active jobs finish, close BullMQ's
blocking connection, and disconnect the owned ioredis client. Startup and shutdown each have a
ten-second deadline; exceeding either exits unsuccessfully. Compose allows thirty seconds before
forcing termination. Worker connections use `maxRetriesPerRequest: null`; producer commands fail
promptly during outages. Runtime environment access and signal handling live in the entry points.

## Commands

- `bun run start` — start the diagnostic worker
- `bun run smoke` — submit a diagnostic job and retrieve its result from a running worker
- `bun run dev` — run `src/main.ts` with file watching
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
The suite covers environment validation and bootstrap payload validation. Set `VALKEY_TEST_URL` to
enable real enqueue, delayed activation, result retrieval, worker replacement, connection cleanup,
and SIGINT/SIGTERM integration tests. Tests use unique queue names and delete their own queue data;
use a local test instance. Without this variable, backend integration tests are skipped. CI starts
Valkey and enables them for every runtime.

```sh
docker compose up -d valkey
VALKEY_TEST_URL=redis://127.0.0.1:6379/0 bun run test:all
```

Adjust the port if `VALKEY_PORT` differs. The integration suite verifies the bootstrap primitives;
the full scheduler acceptance criteria remain pending.

## Project documentation

- [Architecture](docs/architecture.md): requirements, selected design, API boundaries, scheduling,
  concurrency, and failure semantics.
- [Validation](docs/validation.md): first-slice acceptance criteria, runtime and recovery checks,
  and deferred capabilities.
- [Library research](docs/library-research.md): BullMQ integration caveats and the rationale for
  choosing the backend over the alternatives reviewed.
