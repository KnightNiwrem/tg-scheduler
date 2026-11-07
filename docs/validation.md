# First-slice validation

These are acceptance criteria for the planned [architecture](architecture.md), not a record of
passing tests. The current suite covers the basic delivery path for immediate and delayed jobs;
the remaining queue/scheduler policies and full acceptance checks are pending.
[Library research](library-research.md#selected-version-native-behavior) records verified native
behavior, integration gaps, and policies still awaiting validation.

The checks verify the [technical decisions](decisions/); when a decision changes, the affected
checks change with it.

The [runtime compatibility research](library-research.md#runtime-compatibility) records dependency
support. The checks below cover this project's library and scheduling behavior, including the
dependency versions selected for it.

## Validation coverage

The [repository checks](../README.md#commands) cover option and durable-payload validation,
caller-owned connection handling, and grammY outcome classification against a fake Bot API.
With `VALKEY_TEST_URL` set, as in CI, they also run the client and worker against Valkey with a
fake Telegram transport. Those tests cover immediate delivery after producer exit, delayed activation,
visible errors without retries, native terminal states, indefinite default retention,
accepted-effect/lost-response failures, stored-outcome compatibility, shared ordinary capacity
across workers, graceful shutdown, caller-connection reuse and option
preservation, startup failure cleanup, and release of BullMQ's blocking connection.
Stalled-worker recovery, Valkey restart, and the 429, ordering, urgent-lane, and recurrence criteria
are not yet covered.
[Archived dependency experiments](library-research.md#selected-version-native-behavior) document
native integration constraints separately from the active suite. Passing the current tests does
not establish the full queue/scheduler acceptance criteria below. The shared suite uses
[Vitest on Bun, Node.js, and Deno](../README.md#testing), so cross-runtime acceptance coverage exercises
the same library tests on each runtime.

## Selected slice

The first slice covers durable immediate jobs, one-time delayed jobs and fixed-interval UTC
recurrence for each bot, with status/result retrieval and disabling of future recurrence. Its
behavior is defined by the [decisions linked from the architecture](architecture.md#decisions-by-area).
Store-level persistence and recovery guarantees follow the operator's configuration. Local
acceptance validates the documented Compose configuration and its recovery limits.

## Runtime and local development checks

- A documented Docker Compose command starts the Bun worker and official `valkey/valkey` service on
  the local VM. Tested image/dependency versions are pinned, and secrets are supplied outside
  committed Compose files.
- The local Compose smoke test covers submission, worker execution, visible results, worker restart,
  and Valkey persistence/restart behavior within the documented durability limits.
- TypeScript checking passes through `bun run check`. Imports and package entry points work on Bun,
  Node.js and Deno. Actual BullMQ/client enqueue, claim, delayed activation and result retrieval run
  against Valkey on each runtime; a successful import alone is insufficient.
- When using ioredis, worker startup succeeds with a manually created client configured with
  `maxRetriesPerRequest: null`, including the duplicated connection used for blocking operations.
  Closing clients and workers preserves supplied connections and their settings while removing
  the library's listeners and closing BullMQ-owned duplicates. Invalid worker retry settings fail
  without taking ownership of the caller's connection, and startup can be retried after correction.
- The grammY transport uses its outgoing API surface without inbound update processing or hidden
  automatic retries.
- Runtime-specific permissions, startup and shutdown requirements are documented separately from the
  portable core. Compatibility evidence identifies tested dependency/runtime versions and any failed
  or unrun checks; type compatibility alone does not establish runtime support.

## Core checks

- Accepted work survives producer exit and the documented worker/backend recovery conditions. The
  recovery guarantees identify the components responsible for retaining work, activating due jobs,
  and recovering abandoned claims.
- Concurrent submissions do not lose accepted jobs or create more current reservations than
  configured capacity. The documented failover limitation still applies to already-sent physical
  HTTP requests.
- Producers for one bot share ordinary cooldown state; other bots remain independent.
- A later shorter 429 cannot shorten either lane's longer existing cooldown.
- Application timestamps use Unix epoch milliseconds and durations use milliseconds. A valid
  `retry_after` in seconds is converted exactly once before computing the lane cooldown expiry.
- A 429 with missing `parameters`, missing `retry_after`, or an invalid, nonpositive or
  unrepresentable value uses the
  [60-second fallback](decisions/rate-limit-retry-after-fallback.md). Both lanes retain the job,
  preserve any longer cooldown and retry through a durable wakeup, including after restart. A valid
  server delay longer than the fallback is honored in full.
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
- An accepted-send/lost-response simulation records `failed` with its error, does not automatically
  retransmit, releases the current reservation and allows unrelated work to continue. Engine
  stalled-job recovery must not silently violate this policy.
- A definite 429 retries after the relevant pause; permanent API errors and eventual successes
  remain visible to callers.
- New terminal successes enter BullMQ's completed set and terminal failures enter its failed set,
  with structured Telegram errors preserved through `getJob` and no automatic retransmission.
  Completed failure outcomes from existing storage remain readable. Default retention keeps both
  terminal states without automatic removal. Configured age/count cleanup follows the
  [native lazy policy](decisions/backend-finished-job-retention.md).
- Recurrence stays anchored to planned times. Missed, not-yet-created occurrences coalesce to the
  latest one; occurrence creation is unique and advances atomically to the next future time.
- Coalescing does not discard accepted queued jobs. Disabling recurrence stops future creation
  without silently cancelling already materialized work.
- Supported payloads remain usable after the submitting process exits. Unsupported transient
  payloads are rejected at submission rather than accepted unreliably.

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

Archived dependency experiments established which native primitives can be reused and which require
additional coordination. The implemented scheduler must satisfy the retry/requeue, cooldown expiry,
recurrence, and stalled-job recovery criteria above; those acceptance checks remain pending.
