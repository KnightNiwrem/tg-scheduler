# Supporting library research

The source findings below date to 2 November 2026; the native behavior experiments were run on
6 November 2026 against the pinned dependencies. The
[decisions](decisions/) record the selected choices, and [validation](validation.md) defines
acceptance criteria. The project pins BullMQ 6.7.1, ioredis 6.0.0, and Zod 4.6.7; current integration
coverage is described in the [testing guide](../README.md#testing). Default-branch source links can
change; the observations below apply to the tested versions.

## Runtime compatibility

The integration suite runs a BullMQ queue and worker on the backend's ioredis connections and checks
connection cleanup on Bun, Node.js, and Deno. The tests of a diagnostic bootstrap, removed after
[commit `2748c31`](https://github.com/KnightNiwrem/tg-scheduler/tree/2748c319dbad3c85fb8eb5fadc8343895a8796d4),
also verified enqueue, claim, delayed activation, result retrieval, and graceful shutdown on those
versions. A manual Compose check recorded in [PR #2](https://github.com/KnightNiwrem/tg-scheduler/pull/2)
confirmed that jobs acknowledged by `WAITAOF` survived a Valkey `SIGKILL` and container recreation;
it does not establish zero-loss durability for other writes under `appendfsync everysec`. Separate one-off experiments
verified native admission, ordering, cooldown, and stalled-recovery behavior on all three.
This project's full queue/scheduler acceptance tests remain pending; the experiments expose
integration gaps rather than establishing the scheduler's required policies.

## Selected-version native behavior

The experiments used BullMQ **6.7.1**, ioredis **6.0.0**, and the official
`valkey/valkey:9.0.7-alpine` image (Valkey **9.0.7**). Tested runtimes are Bun **1.4.4**, Node.js
**24.22.1**, and Deno **2.9.6** on Linux ARM64. The same experiments passed on each runtime.
They used isolated queue names, simulated 429 responses, and a separate accepted-effect ledger;
they made no Telegram calls.

At the archived revision, the complete suite passed **54 tests on each runtime**, including
15 native behavior cases, with no failures or skips when `VALKEY_TEST_URL` was set. TypeScript,
Biome lint, and formatting checks also passed.

| Requirement or primitive     | Observed native behavior                                                                                                                                                                                                            | Integration consequence                                                                                      |
| ---------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| Shared capacity              | `setGlobalConcurrency(1)` and `(2)` bound competing claims across workers and producers; completion frees a slot. Worker-local concurrency alone permits multiple workers to exceed a shared limit.                                 | Configure queue-wide capacity for each bot; process-local settings are insufficient.                         |
| Unique current claim         | Competing workers acquire a single job only once while its lock is valid.                                                                                                                                                           | Reuse native atomic claims and ownership tokens.                                                             |
| Shared cooldown              | With a configured limiter, `queue.rateLimit()` blocks other workers while admitted jobs can settle. Separate queue identities remain independent.                                                                                   | Native gating is reusable, but requires limiter configuration. Setting an expiry alone does not gate claims. |
| Monotonic cooldown           | A later shorter `rateLimit()` replaces a longer expiry.                                                                                                                                                                             | Extend the expiry atomically by maximum; the native setter alone violates this requirement.                  |
| Activation after replacement | A replacement worker processes queued work after the stored cooldown expires, with no new submission or application wakeup timer.                                                                                                   | Reuse the native activation machinery after establishing the correct durable gate.                           |
| Eligible ordinary ordering   | Ready jobs retain submission FIFO and future jobs do not block. An older-due delayed job is promoted behind a newer ready backlog.                                                                                                  | Native ready-list FIFO does not implement ordering by original due time across all eligible work.            |
| Concurrent 429 retries       | Returning two admitted jobs through `RateLimitError` retries the last-returned job first. Responses in admission order reverse their original rank; reverse responses happen to preserve it. The order survives worker replacement. | Preserve original rank explicitly across retries; native manual requeue is insufficient.                     |
| Ambiguous effect recovery    | Killing a worker after the simulated service accepted its effect causes default stalled recovery to repeat the effect with a new token.                                                                                             | Default replay violates the no-retransmission policy.                                                        |
| Disabled stalled replay      | `maxStalledCount: 0` skips another processor invocation and records `failed`. Both recovery configurations release capacity and allow unrelated work.                                                                               | Disable replay and expose the interrupted job as `failed`; Telegram may have acted.                          |
| Stale settlement             | An old token cannot complete or fail a job owned by a replacement, or overwrite its completed result.                                                                                                                               | Native fencing protects job settlement; it cannot revoke an already transmitted external request.            |

The exploratory checks are archived in [commit `60bf973`](https://github.com/KnightNiwrem/tg-scheduler/commit/60bf9735513a98f2226879c106bf5f17be3df099):
[admission](https://github.com/KnightNiwrem/tg-scheduler/blob/60bf9735513a98f2226879c106bf5f17be3df099/tests/bullmq-admission.integration.test.ts),
[ordering](https://github.com/KnightNiwrem/tg-scheduler/blob/60bf9735513a98f2226879c106bf5f17be3df099/tests/bullmq-ordering.integration.test.ts),
[recovery](https://github.com/KnightNiwrem/tg-scheduler/blob/60bf9735513a98f2226879c106bf5f17be3df099/tests/bullmq-recovery.integration.test.ts), and the
[crash fixture](https://github.com/KnightNiwrem/tg-scheduler/blob/60bf9735513a98f2226879c106bf5f17be3df099/tests/fixtures/accepted-effect-worker.ts).
They are absent from the current tree and CI suite. The recovery experiment killed a real child
worker with `SIGKILL` after recording an accepted effect and before settling its job.
Manual claims controlled competing admissions and response order; the cooldown replacement
experiment used the running worker loop to establish automatic reactivation.

To reproduce the experiments, use a checkout of that commit with the
[documented Valkey test setup](../README.md#testing) and run
`VALKEY_TEST_URL=redis://127.0.0.1:6379/0 bun run test:all`.
The recorded verification used isolated host port `16379`.

These findings support the [BullMQ and Valkey backend](decisions/backend-bullmq-valkey.md). They establish reusable claim,
capacity, activation, and settlement primitives, with additional coordination required for
monotonic cooldowns and original-rank admission/requeue. The disabled-replay setting supports the
[no-retransmission policy](decisions/uncertainty-no-automatic-retransmission.md); the library's full
crash-recovery acceptance tests remain pending. The experiments do not establish Valkey persistence
across restart, recurrence/coalescing, urgent-lane policy, Telegram error
classification or retry-delay validation, or the complete scheduler acceptance criteria.

## BullMQ integration findings

BullMQ's [connection documentation](https://docs.bullmq.io/guide/connections) describes raw ioredis
compatibility and `IRedisClient` adapters, including an adapter for Bun's built-in Redis client.
The [ioredis driver decision](decisions/backend-ioredis-driver.md) records the selected client, the
required worker connection settings and the conditions for replacing it.

The source review identified the following integration risks. The archived experiments above
verified cooldown replacement, ordinary retry ordering, stalled recovery, and shared limits in the
selected version. Recurrence/coalescing remains unverified:

- **Cooldown extension:** the inspected Redis-compatible backend replaces the rate-limit expiry
  rather than taking the later expiry. The library requires atomic maximum-expiry updates. [Backend
  source](https://github.com/taskforcesh/bullmq/blob/master/src/classes/redis-queue-backend.ts)
- **Retry ordering:** manual rate-limit requeue puts ordinary FIFO jobs back at the front;
  prioritized jobs have a separate reinsertion path. Ordinary failure/backoff retries differ. Check
  original-rank preservation under concurrent failures. [Manual
  requeue](https://github.com/taskforcesh/bullmq/blob/master/src/commands/moveJobFromActiveToWait-9.lua),
  [priority
  reinsertion](https://github.com/taskforcesh/bullmq/blob/master/src/commands/includes/pushBackJobWithPriority.lua)
- **Recurrence:** native scheduler behaviour must match planned-time anchoring, occurrence
  uniqueness and coalescing of missed unmaterialized work. [Job
  schedulers](https://docs.bullmq.io/guide/job-schedulers/)
- **Recovery:** automatic stalled-job replay can repeat an ambiguous Telegram effect. The
  [disabled-replay setting](decisions/recovery-stalled-replay-disabled.md) implements the
  [no-retransmission policy](decisions/uncertainty-no-automatic-retransmission.md).
- **Shared limits:** validate that all workers/producers for each bot share the selected capacity
  and cooldown state. [Global concurrency](https://docs.bullmq.io/guide/queues/global-concurrency),
  [rate limiting](https://docs.bullmq.io/guide/rate-limiting)

These risks are reflected in the [decisions](decisions/) and acceptance criteria.

## Cross-runtime test framework

[Vitest](https://vitest.dev/guide/features.html), the
[selected test runner](decisions/testing-vitest-cross-runtime.md), runs on Bun, Node.js, and Deno.
It provides TypeScript support, assertions, lifecycle hooks, asynchronous tests, mocking, fake
timers, snapshots, and watch mode. The same TypeScript test files run directly on each
runtime. The [testing guide](../README.md#testing) describes the repository commands and verified
CI runtime versions.

## Alternatives reviewed: background only

No complete match was found among the inspected Telegram-specific libraries; this is not proof that
none exists.

- **@gramio/broadcast:** closest Telegram-specific candidate. Uses jobify/BullMQ and queue-wide
  retry_after handling, but its processor discards returned action results, treats 403 as
  completion, uses GramIO-specific errors and a fixed queue name, and lacks the selected controlled
  urgent-lane and no-retransmission policies. Direct BullMQ reuse avoids adapting this wrapper.
  [Source](https://github.com/gramiojs/broadcast/blob/main/src/index.ts)
- **grammY transformer-throttler/Bottleneck:** useful throttling and bypass mechanisms, but Redis
  clustering shares limiter state rather than durable queued requests; pending jobs remain
  process-local. [Plugin](https://github.com/grammyjs/transformer-throttler/blob/master/src/mod.ts),
  [clustering
  limitations](https://github.com/SGrondin/bottleneck#important-considerations-when-clustering)
- **Yaebal:** throttle requests are held in memory; broadcast exposes a storage/claim interface but
  has only a built-in memory backend.
  [Throttle](https://github.com/neverlane/yaebal/blob/master/packages/throttle/src/index.ts),
  [broadcast](https://github.com/neverlane/yaebal/blob/master/packages/broadcast/README.md)
- **pg-boss / Graphile Worker:** durable database-backed primitives, but still need Telegram policy
  and are outside the selected BullMQ/Valkey implementation.
  [pg-boss](https://github.com/timgit/pg-boss), [Graphile
  Worker](https://worker.graphile.org/docs/sql-add-job)
- **grammy-message-queue:** local send/edit queues and independent 429 sleeps, not a unified durable
  scheduler. [Source](https://github.com/snipe-dev/grammy-message-queue/blob/master/src/index.ts)
