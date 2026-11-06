# Supporting library research

The library source findings below date to 2 November 2026. The
[architecture](architecture.md) defines selected choices, and [validation](validation.md) defines
acceptance criteria. Queue dependencies have not yet been added to the Bun starter. Default-branch
source links can change, so the findings need verification against the pinned versions selected for
implementation.

## Runtime compatibility

The maintainer has confirmed that BullMQ and ioredis work on Deno. Bun dependency integration still
needs runtime checks. This project's queue/scheduler acceptance tests remain pending on all target
runtimes; those checks cover its scheduling and recovery semantics as well as the selected versions.

## BullMQ integration findings

BullMQ with Valkey is fixed; actual ioredis is the provisional initial driver. BullMQ's [connection
documentation](https://docs.bullmq.io/guide/connections) describes raw ioredis compatibility and
`IRedisClient` adapters, including an adapter for Bun's built-in Redis client. Ioredis is the initial
candidate to test on Bun; its queue/worker compatibility remains unverified. Other clients need the
full selected-version contract: commands, lifecycle/events, duplication, Lua scripts and pipelines.
Valkey is the server, independent of the JavaScript client choice. The
[architecture](architecture.md#1-scope-and-ownership) records the required ioredis worker connection
settings and the boundary for changing the provisional driver.

The source review identified these integration risks to verify in the selected version:

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
- **Recovery:** automatic stalled-job replay can repeat an ambiguous Telegram effect. The selected
  policy requires persisted, visible uncertainty without automatic retransmission.
- **Shared limits:** validate that all workers/producers for each bot share the selected capacity
  and cooldown state. [Global concurrency](https://docs.bullmq.io/guide/queues/global-concurrency),
  [rate limiting](https://docs.bullmq.io/guide/rate-limiting)

These risks are reflected in the architecture and acceptance criteria; the selected backend remains
BullMQ with Valkey.

## Cross-runtime test framework

[Poku](https://poku.io/docs) is the selected test runner for Bun, Node.js, and Deno. It provides
assertions, test grouping, lifecycle hooks, asynchronous tests, parallel execution, watch mode,
plugins, and service/process helpers. The same TypeScript test files run on each runtime; `tsx`
handles Node.js TypeScript execution. The [testing guide](../README.md#testing) describes the
repository commands and CI runtime versions.

## Alternatives reviewed: background only

No complete match was found among the inspected Telegram-specific libraries; this is not proof that
none exists.

- **@gramio/broadcast:** closest Telegram-specific candidate. Uses jobify/BullMQ and queue-wide
  retry_after handling, but its processor discards returned action results, treats 403 as
  completion, uses GramIO-specific errors and a fixed queue name, and lacks the selected controlled
  urgent/uncertainty policy. Direct BullMQ reuse avoids adapting this wrapper.
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
