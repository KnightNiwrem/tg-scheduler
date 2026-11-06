# Bootstrap validation

Verified on 6 November 2026 on Linux ARM64. This covers local infrastructure and diagnostic jobs;
the full [scheduler acceptance criteria](validation.md) remain pending.

## Versions

| Component      | Tested version               |
| -------------- | ---------------------------- |
| Bun            | 1.4.4                        |
| Node.js        | 24.22.1                      |
| Deno           | 2.9.6                        |
| BullMQ         | 6.7.1                        |
| ioredis        | 6.0.0                        |
| Zod            | 4.6.7                        |
| Valkey image   | `valkey/valkey:9.0.7-alpine` |
| Bun image      | `oven/bun:1.4.4-alpine`      |
| Docker Engine  | 29.9.3                       |
| Docker Compose | 5.7.0                        |

Package versions are pinned in `package.json` and `bun.lock`. Image versions are pinned in
`compose.yaml` and `Dockerfile`.

## Passed checks

- `bun install --frozen-lockfile` with a writable Bun cache.
- `bun run fmt:check`, `bun run lint`, `bun run check`, and `git diff --check`.
- `VALKEY_TEST_URL=redis://127.0.0.1:16379/0 bun run test:all`: all 35 tests passed on each of Bun,
  Node.js, and Deno. Backend tests cover enqueue, claim, delayed activation, stored results, active
  work draining on close, replacement workers, and all three producer/worker/blocking client
  connections disappearing after cleanup. Subprocess tests verify SIGINT/SIGTERM shutdown and
  invalid configuration failure without exposing URL credentials.
- Compose configuration validation, image build with production dependencies, and startup of both
  services. The isolated validation project used host port `16379` because `6379` was occupied.
- `docker compose exec worker bun src/smoke.ts`: the separate producer submitted a diagnostic job
  and retrieved `{"status":"ok","message":"hello"}` from the running worker.
- A Bun worker connected to an unresponsive local test socket exited with code 1 after its startup
  deadline and completed connection cleanup. SIGTERM during an incomplete startup completed
  cleanup and exited with code 0. A refused backend connection also exited with code 1 and cleaned up.

The subprocess tests send signals through `process.kill(pid, signal)` to avoid Deno 2.9.6's
[child-process signal reporting issue](https://github.com/denoland/deno/issues/37001); they still
require a successful exit code and completed worker cleanup.

## Persistence and restart checks

The following sequence passed against the Compose stack:

1. Stop the worker, enqueue immediate and delayed diagnostic jobs through a separate producer,
   and close that producer.
2. Wait for local AOF fsync with `WAITAOF 1 0 5000`, then send SIGKILL to Valkey and recreate its
   container with the same named volume.
3. Confirm both job records remain, start the worker, and retrieve both successful results without
   submitting any additional jobs.
4. Gracefully restart Valkey and the worker, then run the smoke producer successfully again.

The fsync acknowledgement bounds the hard-crash check to persisted writes. The configured
`appendfsync everysec` can still lose roughly one second of recent writes on an abrupt crash;
the test does not establish zero-loss durability. See [Valkey persistence](https://valkey.io/topics/persistence/).
The local volume provides no replication or protection from disk/volume loss.

## Remaining validation

GitHub Actions has been configured to run the shared integration suite against Valkey on all
three runtimes; a hosted CI execution was not run from this environment. Container checks were
run locally on Linux ARM64, not on other host architectures.

Telegram transport, bot-wide coordination, eligible FIFO with original-rank 429 requeue,
monotonic cooldowns, urgent admission, recurrence/coalescing, and interrupted external-effect
uncertainty remain unimplemented and untested. Native stalled-job recovery is used only for
diagnostic jobs here; it must not be assumed to satisfy the Telegram uncertainty policy.
