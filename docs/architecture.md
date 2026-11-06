# Outbound queue and scheduler architecture

Status: selected design; queue/scheduler implementation and its acceptance tests are pending. The
repository currently contains a Bun starter. **Fixed** identifies a project requirement or necessary
correctness constraint. **Provisional** identifies a selected implementation approach that can be
revised with evidence.

The [project overview](../README.md) describes current capabilities. [Validation](validation.md)
defines acceptance criteria for this design; [library research](library-research.md) records
supporting dependency findings.

## 1. Scope and ownership

**Fixed:** outgoing Telegram Bot API calls only; the durable queue and scheduler are the core.
Immediate, delayed and recurring work share one logical coordination authority per bot, including
across serverless producer invocations. The Telegram-call executor is the thin effectful edge and
uses grammY.

**Fixed implementation stack:** TypeScript and grammY; Bun as the primary development and worker
runtime, with Node.js and Deno as library compatibility targets; BullMQ through its supported
injectable connection interface with ioredis-compatible interoperability, backed by Valkey; Docker
Compose for the first local test slice using the official `valkey/valkey` image. Biome provides
formatting and linting, and TypeScript provides type checking through the repository's Bun scripts.

| Component                        | Owns                                                                                                                 |
| -------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| Client                           | Submit jobs/schedules, retrieve status/results, disable future recurrence                                            |
| Core queue/scheduler             | Eligibility, ordering, occurrence creation, ordinary/urgent admission, cooldowns and retry/recovery decisions        |
| Durable backend                  | Jobs, schedules, bot state, atomic transitions, reservations and recovery records                                    |
| Wakeup/scheduling infrastructure | Activate due work, cooldown expiry, recurrence and recovery independently of producer lifetime                       |
| Telegram executor/transport      | Use grammY to perform an admitted API attempt and report the result; no hidden retry/sleep loop or independent queue |

**Provisional topology:** a long-lived Bun worker containing the grammY Telegram caller, with one
ordinary BullMQ queue and one optional urgent queue per bot. All producers for that bot use the same
queue identities; the urgent queue is governed by its own bounded capacity and cooldown, not an
unrestricted second sender. These are logical modules, not separate microservices. The first local
deployment is a Docker Compose stack with the worker and Valkey; the operator provides the required
worker execution and persistent backend. Durable storage alone does not activate due work. Durable
acceptance depends on validated Valkey persistence/recovery configuration and BullMQ/client
semantics. Exact dependency versions and configuration remain implementation choices.

The initial producer API connects through the configured BullMQ/client path, so its hosting runtime
must support that connection and reach Valkey. Serverless compatibility means producer lifetime
independence, not a claim that every hosting platform permits the necessary networking. An HTTP
gateway is not part of this slice.

Runtime-specific startup, permissions, environment access and shutdown handling belong at the edges.
The TypeScript library core must isolate Bun-only and Deno-only APIs. Dependency imports and package
entry points must work for the intended Bun, Node.js and Deno consumers. Runtime compatibility
requires real queue and worker operations on each runtime; npm imports and successful type checking
alone do not establish it. The current Bun tooling uses `package.json`, `bun.lock`, `biome.json` and
`tsconfig.json`; compatibility testing does not require a second formatting or dependency-management
workflow.

**Provisional driver:** actual ioredis connected to Valkey through BullMQ's supported connection
interface. BullMQ's [connection documentation](https://docs.bullmq.io/guide/connections) describes
raw ioredis compatibility and the `IRedisClient` adapter contract. A manually created ioredis client
passed to a BullMQ `Worker` must set `maxRetriesPerRequest: null`; the worker also needs a duplicated
connection for blocking operations. These requirements need validation in the selected version.

The ioredis package itself is provisional; the fixed requirement is BullMQ's supported injectable
client contract with ioredis-compatible interoperability backed by Valkey. A replacement client
remains within this design if it satisfies the full selected-version contract, including commands,
connection lifecycle/events, duplication, Lua/scripts and pipelines, and passes integration checks
on all target runtimes. A driver-specific compatibility failure is grounds to evaluate such a
replacement; it does not by itself invalidate the fixed backend or runtime targets. Valkey is the
server; its use does not itself require a Valkey-specific client.

Dependency support is recorded in the
[runtime compatibility research](library-research.md#runtime-compatibility). This project's
queue/scheduler acceptance tests across the target runtimes remain pending.

A durable queue does not inherently require a user-hosted always-running coordinator: a platform can
persist state and wake ephemeral code. The first implementation uses operated workers; a serverless
core and a universal adapter framework are outside its scope.

All controlled calls for a bot use the same authority. Direct API calls outside this library are
outside its concurrency/cooldown guarantees. Telegram webhook-reply shortcuts cannot supply the
observed result/errors required for this path.

## 2. Public API and payloads

**Provisional first API:** explicit operations for jobs and recurring schedules. Names and exact
types remain implementation choices:

- `submit(method, payload, options)` returns a durable job handle for immediate or one-time delayed
  work. Options cover earliest execution time and the supported urgent exception.
- `getJob(jobId)` retrieves job status and the eventual result/error. The result type corresponds
  to the Bot API method.
- `createSchedule(method, payload, scheduleOptions)` returns a durable schedule handle. Schedule
  options define the fixed interval and planned-time anchor.
- `disableSchedule(scheduleId)` prevents future occurrence creation while preserving already
  materialized jobs.

Payload and result constraints:

- Stored requests contain method names and JSON-serializable payloads, without callbacks or
  closures.
- Existing Telegram `file_id` references are supported. Unsupported uploads, process-local streams
  and temporary files are rejected at submission because they cannot be replayed reliably.
- Credentials are resolved separately from job payloads, and tokens are excluded from logs.
- One-time and fixed-interval recurring schedules are supported. Disabling a schedule stops future
  recurrence without cancelling already materialized jobs.
- Status/result retrieval exposes actual outcomes. A job ID is a durable handle, not a Telegram
  `Message`.

**Deferred:** general priorities, custom deadlines, generic job cancellation, bounded waiting, a
transparent awaiting grammY transformer, caller-supplied submission deduplication and new-file
upload persistence. Internal occurrence uniqueness and atomic claim protection are still required. A
future transparent transformer must await the real Telegram result to preserve the normal API
contract.

The transport uses grammY's outgoing API surface. Inbound polling and webhook processing are outside
scope. A hidden auto-retry layer would consume 429 responses before the queue coordinator can
observe them and is incompatible with this design.

Reference: [grammY transformers](https://grammy.dev/advanced/transformers).

## 3. Persistent model

**Provisional records:**

- **Job:** ID, bot identity, method/payload, original due time and sequence, retry-not-before time,
  ordinary/urgent classification, state, attempt identity/lease, result/error.
- **Bot state:** ordinary blocked-until timestamp, urgent blocked-until timestamp, current
  reservations, ordinary concurrency C and bypass configuration.
- **Schedule:** interval, planned-time anchor, next occurrence, enabled state and unique occurrence
  identity.

**Provisional time representation:** application timestamps are integer milliseconds since the Unix
epoch in UTC. This includes public execution times, persisted due times, retry eligibility, lane
cooldown expiries, lease expiries and recurrence anchors. Intervals and lease durations are in
milliseconds. `nowMs` uses the same timestamp units; native engine units are converted explicitly
at the boundary.

Initial states are queued, in-flight, succeeded, failed and uncertain. A definite 429 returns the
same job to queued with its original ordering rank. An uncertain outcome is visible and is not
automatically retransmitted. Concurrency above one requires multiple in-flight reservations rather
than one retained head pointer.

Equivalent native engine representations are acceptable; these are behavioural requirements, not a
prescribed schema or adapter API.

## 4. Admission and 429 handling

**Fixed capabilities:** configurable concurrency, ordinary 429 pause, and an opt-in time-sensitive
exception.

The urgent exception reflects the maintainer's empirical observation that Telegram commonly permits
callback and pre-checkout answers during ordinary flood waits. Traffic that ignores waits can worsen
flood limiting. This observation does not guarantee that an urgent request will succeed or that a
given concurrency will always be safe.

**Selected provisional policy:**

- Ordinary concurrency C defaults to 1 and is configurable.
- Urgent bypass is disabled by default. The initial allowlist is `answerCallbackQuery` and
  `answerPreCheckoutQuery`.
- When enabled, urgent capacity U is 1 in addition to ordinary capacity. Maximum normally admitted
  attempts is C + U, not one shared cap.
- Ordinary cooldown is bot-wide. Urgent cooldown covers the entire urgent lane independently.
- Each lane atomically updates `blockedUntilMs = max(blockedUntilMs, nowMs + retryDelayMs)`, never
  shortening an existing pause.

Ordinary processing:

1. Atomically check eligibility, ordering, applicable cooldown and available capacity; reserve work.
2. Make one transport attempt per reservation.
3. Persist success/error and release capacity.
4. On a definite 429, retain the job and its rank, extend the ordinary cooldown and arrange retry
   after that cooldown.
5. Admit no new ordinary work while paused. Already admitted attempts may still reach Telegram or
   complete.
6. Ensure another execution opportunity through the durable engine. A local worker timer must not be
   the only recovery path.

Urgent processing:

- Allowlisted urgent work may bypass the ordinary backlog/cooldown but still requires urgent
  capacity and an open urgent gate.
- An urgent 429 extends the urgent lane's cooldown. Both retrying and newly submitted urgent jobs
  respect that gate; fresh work cannot evade it.
- These lane boundaries are conservative application policy, not a claim about Telegram's actual
  rate-limit buckets.

Telegram's optional response `parameters.retry_after` is in seconds. For a positive integer value
whose conversion and resulting expiry are safely representable, `retryDelayMs = retry_after * 1000`.
**Provisional fallback:** if `parameters` or `retry_after` is absent, or the value is invalid,
nonpositive or unrepresentable, `retryDelayMs = 30_000`. The fallback applies to either lane and to
every such 429. It never causes an immediate retry, never shortens a longer existing cooldown, and
does not cap a valid server-specified delay. The chosen expiry is persisted with a durable wakeup
so recovery does not depend on another submission or a local timer.

The fallback is application policy, not a guarantee of Telegram acceptance after thirty seconds.
The design assumes no universal requests-per-second threshold. Urgent bypass cannot guarantee
timeliness:
[answerPreCheckoutQuery](https://core.telegram.org/bots/api#answerprecheckoutquery), for example,
has a ten-second response requirement. Permanent API failures remain visible rather than being
retried indefinitely.

Reference: [Telegram ResponseParameters](https://core.telegram.org/bots/api#responseparameters).

## 5. Ordering and scheduling

**Selected provisional ordering:** FIFO among eligible ordinary jobs by original due time, then
submission sequence. Immediate work uses enqueue time as due time. Future jobs never block ready
work. A 429 retry changes its next eligible time, not its original rank.

- FIFO describes admission, not completion or Telegram-side effect order when C > 1.
- Urgent bypass deliberately permits overtaking. General priorities are deferred.
- No additional strict retry barrier is selected. Once the shared cooldown ends, more than one
  eligible job can be admitted if C > 1.
- “Run at” means not before that time, not guaranteed delivery at that instant.
- For a send followed by an edit of the returned message ID, submit the edit after successful
  delivery. A general dependency/DAG engine is outside the first slice.

**Selected provisional recurrence:** fixed intervals with absolute UTC timestamps, anchored to
planned times rather than completion. After downtime, coalesce missed, not-yet-materialized
occurrences into one job for the latest missed time, then advance to the next future occurrence.
Uniquely create each occurrence and advance schedule state atomically.

Coalescing preserves already accepted queued jobs. Disabling recurrence prevents further occurrence
creation but leaves materialized jobs intact. Calendar cron/timezones and alternative
missed-occurrence policies are deferred. Native recurrence helpers are usable only where their
semantics match this policy.

## 6. Atomic transitions and recovery

The selected design requires these behaviours, supplied by native engine primitives where possible
rather than duplicated behind mandatory adapter method names:

1. **Submit and ensure activation:** persist accepted work and guarantee a future processing
   opportunity.
2. **Claim/reserve:** atomically check due time, ordering, lane cooldown and capacity; reserve with
   current attempt identity and lease.
3. **Settle/defer/fail:** verify current ownership, save the outcome, release capacity,
   monotonically extend cooldowns and ensure next activation.
4. **Recover abandoned attempts:** reclaim expired ownership under the uncertainty policy below;
   arrange recovery at claim time, not only after successful completion.
5. **Materialize occurrence:** create one unique occurrence and advance the schedule atomically.
6. **Disable recurrence:** prevent further occurrence creation without silently cancelling accepted
   jobs.

Duplicate wakeups must reread state and claim before sending; they must not create competing current
claims for one job. Intentional retries/recovery have new attempt identities. Stale workers cannot
overwrite current state, and an old wakeup must not erase a newer one. Activation relies on engine
due-time/cooldown/recovery mechanisms, without mandatory minute polling.

## 7. Failure policy and guarantee limits

**Selected provisional uncertainty policy:** do not automatically retransmit a send whose external
outcome is ambiguous. Mark it uncertain, expose that outcome, release its current reservation and
continue unrelated eligible work. The caller may explicitly submit again while accepting duplicate
risk. A configurable retry-uncertainty mode is deferred.

A definite 429 can retry after its cooldown; permanent API failures are reported as failed.
Distinguish rejection from ambiguous transmission: a timeout or server error is not automatically
proof that Telegram did not act. Engine crash/stalled-job recovery must preserve this policy and
cannot automatically replay ambiguous side effects.

**Correctness limit:** Telegram may accept a request before the worker crashes or loses the
response. This library cannot guarantee exactly-once external effects. Even future submission
deduplication would not solve that boundary. Ownership/fencing protects stored state but cannot
revoke an already sent HTTP request. After lease expiry/failover, physical in-flight requests may
exceed the cap on current reservations.

## 8. Example with C=2 and urgent capacity 1

Jobs A and B are admitted; job D waits. A returns a twenty-second 429, preserving A's rank and pausing
ordinary admission. B can still succeed or extend that cooldown. An allowlisted callback answer can
use the urgent slot if the urgent gate is open. Its own 429 pauses the urgent lane. After the
ordinary cooldown, A is selected before later ordinary work, but D may occupy the second slot and
finish first.

## 9. Backend compatibility and contract boundaries

**Fixed backend direction:** BullMQ through its supported injectable connection interface with
ioredis-compatible interoperability, backed by Valkey. **Provisional topology and driver:** operated
Bun workers and actual ioredis. Native durable jobs, delayed work, scheduling, reservations and
recovery are reusable where their actual semantics match this design. [Library
research](library-research.md) records source findings, including manual 429 requeue and
non-monotonic rate-limit expiry updates.

The implementation reuses durable machinery rather than building a general-purpose queue engine.

Ordering, monotonic cooldowns, recurrence/coalescing and uncertainty handling require validation in
the selected dependency version on Bun, Node.js and Deno. A dependency conflict remains unresolved
until its impact on these requirements is understood. Convex and Durable Objects are background
comparisons; additional backends are outside the first slice.

Configuration, payload schema, ordering and uncertainty semantics become migration boundaries once
the library has public consumers or production data. Internal draft interfaces carry no hypothetical
compatibility obligation, while established external contracts and existing data require
preservation or an explicit migration.
