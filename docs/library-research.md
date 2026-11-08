# Supporting library research

The source review dates to 2 November 2026. Native behavior experiments and library-level probes
record their execution dates, tested versions and coverage limits in their own sections.
The [decisions](decisions/) record the selected choices, and [validation](validation.md) defines
acceptance criteria. The project pins BullMQ 6.7.1, ioredis 6.0.0, and Zod 4.6.7; current integration
coverage is described in the [testing guide](../README.md#testing). Default-branch source links can
change; the observations below apply to the tested versions.

## Runtime compatibility

The integration suite runs the scheduler on caller-provided ioredis connections and checks reuse,
settings preservation, and BullMQ resource cleanup on Bun, Node.js, and Deno. The tests of a
diagnostic bootstrap, removed after
[commit `2748c31`](https://github.com/KnightNiwrem/tg-scheduler/tree/2748c319dbad3c85fb8eb5fadc8343895a8796d4),
also verified enqueue, claim, delayed activation, result retrieval, and graceful shutdown on those
versions. A manual Compose check recorded in [PR #2](https://github.com/KnightNiwrem/tg-scheduler/pull/2)
confirmed that jobs acknowledged by `WAITAOF` survived a Valkey `SIGKILL` and container recreation;
it does not establish zero-loss durability for other writes under `appendfsync everysec`. Separate one-off experiments
verified native admission, ordering, cooldown, and stalled-recovery behavior on all three.
This project's full queue/scheduler acceptance tests remain pending; the experiments expose
integration gaps rather than establishing the scheduler's required policies.

## Cluster namespace compatibility

On 8 November 2026, a library-level probe passed delivery and key-placement checks on Bun
**1.4.4**, Node.js **24.22.1**, and Deno **2.9.6**, using BullMQ **6.7.1**, ioredis **6.0.0**, and
three Valkey **9.0.7** primary nodes.
It exercised `submit`, worker claims, delayed activation and `getJob` through caller-owned
ioredis `Cluster` connections and a fake Telegram transport. Two bots shared a queue prefix;
one bot completed work while the other bot's single dispatch slot remained occupied. Immediate
and delayed jobs completed with their results retrievable, and delayed work did not run early.

All observed keys for each bot's queue shared one cluster hash slot, while the two tested bot IDs
occupied different slots. The [namespace decision](decisions/backend-bot-id-and-key-namespace.md)
defines the key layout and prefix restrictions. No Telegram calls were made.

Shutdown completed on Bun and Node.js. On Deno, `worker.close()` sometimes remained pending when
the probe's 20-second deadline elapsed, after all jobs had settled. The same observation reproduced
with the backend at [revision `a34dc6f`](https://github.com/KnightNiwrem/tg-scheduler/blob/a34dc6f322295c7193a0176a759869eba24a9277/src/backend/bullmq.ts)
and caller-provided per-bot hash tags. Reliable Deno Cluster resource cleanup therefore remains
unverified. The temporary cluster was removed after testing. These checks do not establish
cluster failover, resharding or replica durability; the active integration suite continues to use
standalone Valkey.

## Native job timing metadata

On 8 November 2026, an isolated native probe on Bun **1.4.4**, BullMQ **6.7.1**, ioredis **6.0.0**
and Valkey **9.0.7** verified `job.timestamp + (job.opts.delay ?? 0)` for one-time delayed jobs and
native Job Scheduler occurrences. The timestamp plus configured delay matched the planned time
before activation, after promotion, after manual rate-limit requeue and after completion. The
next generated occurrence had its own timestamp and configured delay, yielding its distinct
planned time even though it shared the same template payload.

Promotion reset the live `job.delay` field to zero while preserving `job.opts.delay`. A past
requested time converted to zero delay yielded native enqueue time. These observations support
the [stored timing contract](decisions/backend-stored-job-data.md). The probe made no Telegram
calls and removed its isolated queue. It characterized native fields rather than implementing
the library's recurrence or 429 coordinator; their full acceptance checks remain pending.

## Selected-version native behavior

On 6 November 2026, the experiments used BullMQ **6.7.1**, ioredis **6.0.0**, and the official
`valkey/valkey:9.0.7-alpine` image (Valkey **9.0.7**). Tested runtimes are Bun **1.4.4**, Node.js
**24.22.1**, and Deno **2.9.6** on Linux ARM64. The same experiments passed on each runtime.
They used isolated queue names, simulated 429 responses, and a separate accepted-effect ledger;
they made no Telegram calls.

At the archived revision, the complete suite passed **54 tests on each runtime**, including
15 native behavior cases, with no failures or skips when `VALKEY_TEST_URL` was set. TypeScript,
Biome lint, and formatting checks also passed.

| Requirement or primitive     | Observed native behavior                                                                                                                                                                                                                                    | Integration consequence                                                                                      |
| ---------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| Shared capacity              | `setGlobalConcurrency(1)` and `(2)` bound competing claims across workers and producers; completion frees a slot. Worker-local concurrency alone permits multiple workers to exceed a shared limit.                                                         | Configure queue-wide capacity for each bot; process-local settings are insufficient.                         |
| Unique current claim         | Competing workers acquire a single job only once while its lock is valid.                                                                                                                                                                                   | Reuse native atomic claims and ownership tokens.                                                             |
| Shared cooldown              | With a configured limiter, `queue.rateLimit()` blocks other workers while admitted jobs can settle. Separate queue identities remain independent.                                                                                                           | Native gating is reusable, but requires limiter configuration. Setting an expiry alone does not gate claims. |
| Monotonic cooldown           | A later shorter `rateLimit()` replaces a longer expiry.                                                                                                                                                                                                     | Extend the expiry atomically by maximum; the native setter alone violates this requirement.                  |
| Activation after replacement | A replacement worker processes queued work after the stored cooldown expires, with no new submission or application wakeup timer.                                                                                                                           | Reuse the native activation machinery after establishing the correct durable gate.                           |
| Ready-entry ordering         | Ready jobs retain submission FIFO and future jobs do not block. An older-due delayed job is promoted behind a newer ready backlog.                                                                                                                          | Keep native ready-entry insertion; activate due work independently of dispatch capacity.                     |
| Concurrent 429 retries       | For unprioritized jobs, returning two admitted jobs through `RateLimitError` retries the last-returned job first. Responses in admission order reverse their original rank; reverse responses happen to preserve it. The order survives worker replacement. | Accept native retry ordering; no original-rank restoration is required.                                      |
| Ambiguous effect recovery    | Killing a worker after the simulated service accepted its effect causes default stalled recovery to repeat the effect with a new token.                                                                                                                     | Default replay violates the no-retransmission policy.                                                        |
| Disabled stalled replay      | With `maxStalledCount: 0`, stalled jobs return to the wait list with a deferred failure. A later fetch records `failed` without invoking the processor. Both recovery configurations release capacity and allow unrelated work.                             | Snapshots show `queued` until that fetch, which waits for capacity; Telegram may have acted.                 |
| Stale settlement             | An old token cannot complete or fail a job owned by a replacement, or overwrite its completed result.                                                                                                                                                       | Native fencing protects job settlement; it cannot revoke an already transmitted external request.            |

The concurrent-retry experiment used unprioritized jobs. For positive-priority jobs, the pinned
source gives concurrent returns at the same priority equal scores, leaving ties to lexicographical
job ID order; see [retry integration findings](#bullmq-integration-findings). This is a separate
source finding, not an outcome of the unprioritized experiment.

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
capacity, activation, and settlement primitives. The selected design accepts native retry ordering;
additional coordination is required for monotonic cooldowns and activation independent of dispatch
capacity. The disabled-replay setting supports the
[no-retransmission policy](decisions/uncertainty-no-automatic-retransmission.md); the library's full
crash-recovery acceptance tests remain pending. The archived experiments do not establish Valkey
persistence across restart, full recurrence integration, job-priority policy, Telegram error
classification or retry-delay validation, or the complete scheduler acceptance criteria.

## Busy-worker delayed-promotion probe

On 7 November 2026, a separate probe ran the library's client and worker together on Bun **1.4.4**,
using BullMQ **6.7.1**, ioredis **6.0.0**, and the local Valkey **9.0.7** backend. A fake transport
held all three default dispatch slots open. Through `submit`, the probe added a delayed job A,
waited past its due time, then added immediate job B at the same priority while the worker remained
running. A was still `delayed` and B was `waiting`; after releasing the transport, B dispatched
before A. The probe passed and removed its isolated queue afterward. It made no Telegram calls
and was not run on Node.js or Deno.

This demonstrates delayed promotion waiting for dispatch capacity within one running library,
without independently stopped components. The pinned worker fetches while its local concurrency
has room; the claim and next-job scripts perform due-job promotion. A producer can still accept
submissions while every dispatch slot is occupied. The selected
[ready-entry policy](decisions/ordering-eligible-fifo.md) therefore needs independent activation;
the probe does not establish that the library implements it.

## Native scheduler recovery probe

On 7 November 2026, an isolated probe of BullMQ **6.7.1** and ioredis **6.0.0** against Valkey
**9.0.7** passed on Bun **1.4.4**, Node.js **24.22.1**, and Deno **2.9.6**. It registered a
one-second interval schedule with a future start date and a one-second UTC cron schedule, left
both without workers for 3.4 seconds, then claimed each through `Worker.getNextJob`.

Both strategies retained exactly the first queued occurrence while no workers ran. Claiming that
overdue job created one next occurrence in the future; intervening uncreated times were skipped.
The interval schedule preserved its phase. Native scheduling did not create an additional job
representing the latest missed time. This matches the documented
[production of the next job when the previous one begins processing](https://docs.bullmq.io/guide/job-schedulers/).

BullMQ provides both [fixed-interval and cron strategies](https://docs.bullmq.io/guide/job-schedulers/repeat-strategies).
Its existing delayed-job machinery supplies the wakeup; an operating-system cron service is not
required. The [recurrence decision](decisions/recurrence-planned-time-anchored.md) selects this
native recovery behavior.

This probe used temporary queues outside the active suite and removed its data afterward. It did
not implement the scheduler API, simulate a process crash or backend restart, or establish atomic
occurrence uniqueness, disable behavior, or interaction with the shared cooldown, job priorities
and independent due-job activation. Those library integration checks remain pending.

## BullMQ integration findings

BullMQ's [connection documentation](https://docs.bullmq.io/guide/connections) describes raw ioredis
compatibility and `IRedisClient` adapters, including an adapter for Bun's built-in Redis client.
The [connection ownership decision](decisions/backend-ioredis-driver.md) records the public
caller-owned connection contract and the required worker settings.

The source review identified the following integration risks. The archived experiments above
verified cooldown replacement, ordinary retry ordering, stalled recovery, and shared limits in the
selected version. The recovery probe above narrows the recurrence gap; full library integration
remains unverified:

- **Cooldown extension:** the inspected Redis-compatible backend replaces the rate-limit expiry
  rather than taking the later expiry. The library requires atomic maximum-expiry updates. [Backend
  source](https://github.com/taskforcesh/bullmq/blob/master/src/classes/redis-queue-backend.ts)
- **Retry ordering:** manual rate-limit requeue puts unprioritized FIFO jobs back at the front;
  prioritized jobs are reinserted ahead of other waiting jobs in the same priority group. In the
  pinned source, `pushBackJobWithPriority` resets the priority counter component to zero; concurrent
  returns at one priority share a score, leaving ties to
  [lexicographical job ID order](https://valkey.io/commands/zrange/#common-behavior-and-options)
  rather than original rank.
  The library accepts this [native 429 ordering](decisions/rate-limit-native-429-requeue.md).
  BullMQ's [manual rate-limit documentation](https://docs.bullmq.io/guide/rate-limiting#manual-rate-limit)
  uses `RateLimitError` to return the job to waiting. Ordinary
  [failure/backoff retries](https://docs.bullmq.io/guide/retrying-failing-jobs#custom-back-off-strategies)
  use a different path and do not generally insert at the front. [Manual
  requeue](https://github.com/taskforcesh/bullmq/blob/master/src/commands/moveJobFromActiveToWait-9.lua),
  [priority
  reinsertion](https://github.com/taskforcesh/bullmq/blob/master/src/commands/includes/pushBackJobWithPriority.lua)
- **Priority assignment:** BullMQ processes jobs with omitted priority or priority zero before
  jobs with positive priority values. With a positive-priority encoding, urgent needs a lower value
  than normal, and normal needs an explicit positive value as well. Leaving the application default
  omitted would give normal jobs precedence over positive-priority urgent jobs. Current enqueues
  omit priority, so implementation must also account for existing jobs rather than silently mixing
  incompatible defaults.
  [Priorities](https://docs.bullmq.io/guide/jobs/prioritized)
- **Due-job activation:** delayed promotion normally runs when a worker fetches work. The
  busy-worker probe above shows why this is insufficient for independent activation. In the pinned
  backend, `Queue.promoteJobs()` uses an unbounded timestamp and promotes all delayed jobs, including
  future ones; it is not a due-only scheduling loop. An activation mechanism still needs to be
  selected and validated against the project's ordering and recovery criteria.
- **Recurrence:** the library still needs to integrate native Job Schedulers and verify planned-time
  anchoring, occurrence uniqueness, disable behavior, and interaction with the shared cooldown,
  priorities and independent activation. In the pinned backend, `removeJobScheduler` deletes the
  next occurrence only if it remains in the delayed set. The
  [removal contract](decisions/recurrence-planned-time-anchored.md) adopts that boundary; integration
  checks must distinguish delayed from ready occurrences and cover activation and advancement races.
  [Job
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
[selected test runner](../README.md#testing), runs on Bun, Node.js, and Deno.
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
  priority and no-retransmission policies. Direct BullMQ reuse avoids adapting this wrapper.
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
