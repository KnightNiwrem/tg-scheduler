# tg-scheduler

A planned durable queue and scheduler for outgoing Telegram Bot API calls, written in TypeScript
with grammY, BullMQ, and Valkey. Development uses Bun, with Node.js and Deno compatibility enforced
in CI.

The library currently supports the basic delivery path for immediate and one-time delayed jobs:

- `submit` parses a payload as durable JSON and stores the parsed copy in Valkey through BullMQ.
- A library worker claims due jobs within an ordinary concurrency shared by every worker for the
  bot, and makes one grammY call per job.
- `getJob` reports the job as `queued`, `in-flight`, `succeeded`, or `failed`, with the Telegram
  result or error.

New terminal outcomes use
[BullMQ's corresponding native states](docs/decisions/backend-native-job-outcomes.md).
Finished-job storage follows the [retention policy](docs/decisions/backend-finished-job-retention.md);
the scheduler API does not yet expose cleanup limits.

Network failures and Telegram server errors are reported as `failed` with their errors and are never
retransmitted automatically. A failed job does not prove that Telegram did not perform the call.
A worker that stops mid-attempt leaves its job `in-flight` until a running worker's stalled-job
check after BullMQ's 30-second lock expires. The job then shows as `queued` until a worker fetches
it and records it as `failed`, which can take longer when the queue is busy. A `queued` state
therefore does not prove that a request was never sent.

A Telegram 429 currently settles the job as `failed`; durable 429 retry with a bot cooldown is not
implemented yet, so the worker is not ready for production traffic. Recurring schedules and
urgent-priority requests reject with `UnimplementedError`. Priority selection and due-job activation
independent of dispatch capacity are also not implemented yet.

See the [library overview](docs/library-overview.md) for the component flow and source map, and the
[usage sketch](examples/library.ts) for the intended API.

## Planned capabilities

The rest of the first implementation will add fixed-interval recurring schedules with
[native scheduler recovery](docs/decisions/recurrence-planned-time-anchored.md) and status/result
retrieval like other jobs. Disabling recurrence will stop future occurrences while preserving jobs
already created.

Immediate, delayed and recurring work will support normal or urgent
[priority](docs/decisions/admission-job-priorities.md) through a
[single dispatch queue per bot](docs/decisions/backend-single-dispatch-queue.md). Due jobs will join
that queue while dispatch is busy, following [ready-entry ordering](docs/decisions/ordering-eligible-fifo.md).
Telegram 429 responses will return the affected job to the queue using
[native retry insertion](docs/decisions/rate-limit-native-429-requeue.md). The bot cooldown will pause
claims for both priorities until it expires.

Workers will accept a [caller-owned grammY API instance](docs/decisions/transport-caller-owned-api.md).
The current worker still accepts a token resolver and constructs its own `Api`.

Durable new-file sending is a candidate for v1; its storage and API design remain open. The
[current request contract](docs/decisions/api-durable-json-requests.md) covers the first slice.

Node.js and Deno remain library compatibility targets. The [technical decisions](docs/decisions/)
record the selected backend, runtimes and scheduling policies.
The [testing guide](#testing) describes current coverage and the commands to run it.
Inbound updates, polling, and webhook ingestion are outside scope.

## Getting started

Install [Bun](https://bun.sh/docs/installation) 1.4.4 and Docker with Compose, then run:

```sh
bun install --frozen-lockfile
cp .env.example .env
docker compose up -d --wait
```

Compose starts a local Valkey service used by the integration tests. `docker compose down` stops
Valkey and preserves the named data volume; `docker compose down -v` also deletes local queue data.

`VALKEY_PORT` sets the published host port and defaults to `6379`. If that port is occupied, set it
to another port in `.env` and use the same port in `VALKEY_TEST_URL`.

Local Valkey listens on host loopback without authentication, uses a named volume, enables AOF
with `appendfsync everysec`, and disables key eviction. The volume survives container recreation;
an abrupt crash can still lose roughly one second of writes, and volume deletion or disk loss
removes the data. See [Valkey persistence](https://valkey.io/topics/persistence/) for the persistence
tradeoffs. This configuration is for local testing.

Job durability depends on the store's persistence, replication, and recovery configuration.

Create and configure an ioredis instance in the application, then pass it as `backend.connection`
to each client or worker. Connections may be shared or separate. Callers own their settings and
lifetime; closing scheduler resources leaves the supplied connection open. Worker connections must
satisfy [BullMQ's connection requirements](https://docs.bullmq.io/guide/connections), including
`maxRetriesPerRequest: null`. See the [connection decision](docs/decisions/backend-ioredis-driver.md)
and [usage sketch](examples/library.ts).

For deployments beyond local testing, operators configure Valkey authentication and network
restrictions, and supply credentials through their ioredis connection configuration.
Prefer `rediss://` with a trusted server certificate, or an equivalent encrypted transport, to
protect credentials and job data in transit. See [Valkey security](https://valkey.io/topics/security/).
Backend access permits reading and modifying jobs in the accessible namespace.

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
The suite covers option and payload validation, caller-owned connection handling, and
grammY outcome classification against a fake Bot API. Set `VALKEY_TEST_URL` to also run the
client and worker against real Valkey with a fake Telegram transport: immediate and delayed
delivery, native success/failure states with preserved errors, default retention, shared concurrency
across workers, graceful worker shutdown, and BullMQ connection cleanup while supplied clients stay
usable. Each test uses a unique key prefix
and deletes its own data; use a local test instance. Without this variable, backend integration
tests are skipped. CI starts Valkey and
enables them for every runtime.

```sh
docker compose up -d --wait valkey
VALKEY_TEST_URL=redis://127.0.0.1:6379/0 bun run test:all
```

Adjust the port if `VALKEY_PORT` differs. The full scheduler acceptance criteria remain pending.

## Project documentation

- [Library overview](docs/library-overview.md): component flow, source map, and scaffolded public API.
- [Architecture](docs/architecture.md): components, job lifecycle, durable transitions, guarantee
  limits, and links to the decisions by area.
- [Decisions](docs/decisions/): one file per current technical decision, with its status and
  whether a maintainer has confirmed it.
- [Validation](docs/validation.md): first-slice acceptance criteria, runtime and recovery checks,
  and deferred capabilities.
- [Library research](docs/library-research.md): BullMQ integration caveats and the rationale for
  choosing the backend over the alternatives reviewed.
