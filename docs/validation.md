# First-slice validation

These are acceptance criteria for the planned [architecture](architecture.md), not a record of
passing tests. Queue/scheduler implementation, Compose setup, and integration checks are pending.
[Library research](library-research.md) records dependency findings that require selected-version
verification.

The fixed stack is **TypeScript, grammY, Bun as the primary runtime, and BullMQ using its supported
injectable connection interface with ioredis-compatible interoperability backed by Valkey**. Node.js
and Deno remain library compatibility targets. The provisional topology is a long-lived Bun worker
containing the grammY caller; actual ioredis is the provisional initial driver. Docker Compose with
the official `valkey/valkey` image is part of the first implementation slice.

## Repository checks

Install dependencies with `bun install --frozen-lockfile`, then run the existing checks:

```sh
bun run fmt:check
bun run lint
bun run check
bun run test
```

These commands use Biome, TypeScript, and Bun's test runner as configured in
[package.json](../package.json). They currently cover the starter only. Passing them does not
establish the queue/scheduler acceptance criteria below. Additional runtime tests must exercise the
shared library without depending on the Bun-specific test runner.

## Selected slice

The first slice covers durable immediate jobs, one-time delayed jobs and fixed-interval UTC
recurrence through one per-bot queue/scheduler authority. It includes explicit enqueue and
status/result retrieval, JSON-serializable payloads and existing Telegram `file_id` references, and
disabling future recurrence.

Ordinary concurrency defaults to 1 and is configurable, with optional urgent capacity 1 for
`answerCallbackQuery` and `answerPreCheckoutQuery`. Ordinary and urgent lane cooldowns are separate
and monotonic. Eligible ordinary FIFO uses original due time then submission sequence. Ambiguous
sends become visibly uncertain without automatic replay; unrelated work continues. Recurrence is
planned-time anchored and coalesces missed, not-yet-materialized occurrences to the latest one
without discarding accepted jobs.

Native engine functionality is suitable where it meets these semantics. Durable acceptance requires
validated Valkey persistence/recovery configuration and documented recovery limits.

## Runtime and local development checks

- A documented Docker Compose command starts the Bun worker and official `valkey/valkey` service on
  the local VM. Tested image/dependency versions are pinned, and secrets are supplied outside
  committed Compose files.
- Run a local Compose smoke test for submission, worker execution and visible results using fake
  Telegram responses; verify worker restart and Valkey persistence/restart behaviour within the
  documented durability limits.
- TypeScript checking passes through `bun run check`. Imports and package entry points work on Bun,
  Node.js and Deno. Actual BullMQ/client enqueue, claim, delayed activation and result retrieval run
  against Valkey on each runtime; a successful import alone is insufficient.
- When using ioredis, worker startup succeeds with a manually created client configured with
  `maxRetriesPerRequest: null`, including the duplicated connection used for blocking operations.
- Test the grammY transport through its outgoing API surface without adding inbound update
  processing or hidden automatic retries.
- Runtime-specific permissions, startup and shutdown requirements are documented separately from the
  portable core. Compatibility evidence identifies tested dependency/runtime versions and any failed
  or unrun checks; type compatibility alone does not establish runtime support.

## Core checks

- Accepted work survives producer exit and the documented worker/backend recovery conditions.
  Identify which component retains work, activates due jobs and recovers abandoned claims.
- Concurrent submissions do not lose accepted jobs or create more current reservations than
  configured capacity. The documented failover limitation still applies to already-sent physical
  HTTP requests.
- Producers for one bot share ordinary cooldown state; other bots remain independent.
- A later shorter 429 cannot shorten either lane's longer existing cooldown.
- Application timestamps use Unix epoch milliseconds and durations use milliseconds. A valid
  `retry_after` in seconds is converted exactly once before computing the lane cooldown expiry.
- A 429 with missing `parameters`, missing `retry_after`, or an invalid, nonpositive or
  unrepresentable value uses the thirty-second fallback. Both lanes retain the job, preserve any
  longer cooldown and retry through a durable wakeup, including after restart. A valid server delay
  longer than the fallback is honored in full.
- No new ordinary admission occurs during an ordinary pause; already admitted attempts remain
  accounted for.
- Urgent bypass is disabled by default, restricted to the allowlist when enabled, and bounded by its
  additional single slot. Total normally admitted capacity is C + U.
- An urgent 429 gates new urgent jobs and retries through the shared urgent-lane cooldown.
- Future work does not block ready work. Eligible ordinary jobs follow original due time then
  submission sequence; manual 429 requeue preserves rank. C > 1 does not claim completion-order
  guarantees.
- Accepted immediate, delayed and recurring work resumes without needing another submission,
  including recovery after an interruption immediately following claim.
- Duplicate wakes cannot create competing current claims for the same job. Retry/recovery attempts
  have new identities, and stale attempts cannot overwrite current state.
- An accepted-send/lost-response simulation records uncertainty, does not automatically retransmit,
  releases the current reservation and allows unrelated work to continue. Engine stalled-job
  recovery must not silently violate this policy.
- A definite 429 retries after the relevant pause; permanent API errors and eventual successes
  remain visible to callers.
- Recurrence stays anchored to planned times. Missed, not-yet-created occurrences coalesce to the
  latest one; occurrence creation is unique and advances atomically to the next future time.
- Coalescing does not discard accepted queued jobs. Disabling recurrence stops future creation
  without silently cancelling already materialized work.
- Supported payloads remain usable after the submitting process exits. Unsupported transient
  payloads are rejected at submission rather than accepted unreliably.

Use deterministic fake Telegram responses and a controllable clock where practical. Simulate 429
responses rather than deliberately provoking production limits. Live checks, when part of the task,
use a dedicated test bot/chat and narrowly scoped calls.

## Deferred, not blocking this slice

General priorities, calendar cron/timezones, richer missed-occurrence policies, generic job
cancellation, custom deadlines, bounded waiting, transparent awaiting transformers, caller-supplied
submission deduplication, new-file upload persistence, additional backends and hypothetical-scale
optimizations are deferred. Internal occurrence uniqueness and safe claims remain core checks, not
deferred conveniences.

## Acceptance outcome

The first slice is ready when enqueue → durable job/schedule → due-work activation → coordinated
grammY Telegram attempt → visible outcome works, the local Compose setup and runtime checks pass,
and no known material blocker remains. Compatibility claims require evidence from the relevant
runtime tests.

Source findings are not runtime tests. The chosen dependency version must satisfy the retry/requeue,
cooldown expiry, recurrence and stalled-job recovery criteria above.
