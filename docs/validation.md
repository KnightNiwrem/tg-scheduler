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
fake Telegram transport. Those tests cover immediate and past-time delivery after producer exit,
delayed activation, native job IDs and scheduling times in snapshots (including scheduler-generated
occurrences), rejection of invalid native timing without transmission, visible errors without
retries, native terminal states, indefinite default retention,
accepted-effect/lost-response failures, stored-outcome compatibility, shared ordinary capacity
across workers, graceful shutdown, caller-connection reuse and option
preservation, startup failure cleanup, and release of BullMQ's blocking connection.
They also check that unexpected processing errors reach local diagnostics, and the transport
tests use caller-owned grammY API instances by reference. The dedicated job-fetch error handler,
credential rotation through replacement workers, stalled-worker recovery, Valkey restart, and the 429, priority, independent activation,
schedule job listing and full recurrence criteria are not yet covered.
[Archived dependency experiments](library-research.md#selected-version-native-behavior) document
native integration constraints separately from the active suite. Passing the current tests does
not establish the full queue/scheduler acceptance criteria below. The shared suite uses
[Vitest on Bun, Node.js, and Deno](../README.md#testing), so cross-runtime acceptance coverage exercises
the same library tests on each runtime.

The active backend integration suite uses standalone Valkey. A separate
[cluster namespace probe](library-research.md#cluster-namespace-compatibility) verifies the basic
delivery path and per-bot key placement through caller-owned ioredis `Cluster` connections.
Graceful shutdown of Deno Cluster workers remains unresolved: the probe intermittently stalls
while closing a worker after all jobs have settled.

## Selected slice

The first slice covers durable immediate jobs, one-time delayed jobs, native BullMQ interval
recurrence and UTC cron schedules for each bot, with native schedule creation/deletion, retained
job listing by schedule ID and status/result retrieval by job ID. Its normal and urgent priorities
share one dispatch queue.
Behavior follows the [decisions linked from the architecture](architecture.md#decisions-by-area).
Store-level persistence and recovery guarantees follow the operator's configuration. Local
acceptance validates the documented Compose configuration and its recovery limits.

## Runtime and local development checks

- A documented Docker Compose command starts the official `valkey/valkey` service on the local VM.
  Tested image/dependency versions are pinned, and secrets are supplied outside committed Compose
  files.
- Library acceptance checks against the local Valkey service cover submission, worker execution,
  visible results, worker restart, and Valkey persistence/restart behavior within the documented
  durability limits.
- TypeScript checking passes through `bun run check`. Imports and package entry points work on Bun,
  Node.js and Deno. Actual BullMQ/client enqueue, claim, delayed activation and result retrieval run
  against Valkey on each runtime; a successful import alone is insufficient.
- When using ioredis, worker startup succeeds with a manually created client configured with
  `maxRetriesPerRequest: null`, including the duplicated connection used for blocking operations.
  Closing clients and workers preserves supplied connections and their settings while removing
  the library's listeners and closing BullMQ-owned duplicates. Invalid worker retry settings fail
  without taking ownership of the caller's connection, and startup can be retried after correction.
- A failure reported by the background next-job retrieval operation reaches the optional
  [job-fetch handler](decisions/api-job-fetch-error-reporting.md), or `console.warn` when omitted.
  Reporting the retrieval error does not itself mark a job as failed. Telegram failures, rejected
  public operations and unrelated internal exceptions do not route through this dedicated handler.
  Separately emitted queue or connection error events use internal diagnostics, even when they
  occur during retrieval or share the outage that caused a retrieval operation to fail.
- Client operation failures reject their promises. Under
  [internal diagnostics](decisions/api-internal-error-reporting.md), unexpected processing exceptions
  log the original error locally and store a generic job failure without invoking a public handler.
  Client queue connection events between operations remain visible as local warnings.
- The grammY transport uses its outgoing API surface without inbound update processing or hidden
  automatic retries. A manually created, caller-configured
  [API instance](decisions/transport-caller-owned-api.md) is used by reference: configured request
  options take effect, calls preserve their results and errors, and the scheduler leaves the
  instance's configuration and transformers unchanged. Supported caller-produced 429 errors reach
  the coordinator with their raw `retry_after`; classification works without depending solely on
  constructor identity from a separate grammY copy. Package installation and public types use a
  compatible grammY peer dependency with a pinned development/test version.
- Under the [credential boundary](decisions/credentials-bot-token-handling.md), transport failures
  redact the known API token from stored messages and do not persist raw error objects or causes.
  A caller-sanitized custom error preserves its safe message and outcome fields without exposing
  the custom endpoint or network credentials removed by caller-owned code.
- Credential rotation follows the [API ownership contract](decisions/transport-caller-owned-api.md):
  replacing a caller's variable does not rebind an existing worker. After draining and closing the
  old worker, a replacement configured with a new `Api` uses the new credentials for subsequent
  queued jobs without rewriting their stored requests.
- Runtime-specific permissions, startup and shutdown requirements are documented separately from the
  portable core. Compatibility evidence identifies tested dependency/runtime versions and any failed
  or unrun checks; type compatibility alone does not establish runtime support.

## Core checks

- Accepted work survives producer exit and the documented worker/backend recovery conditions. The
  recovery guarantees identify the components responsible for retaining work, activating due jobs,
  and recovering abandoned claims.
- Concurrent submissions do not lose accepted jobs. New claims respect configured capacity across
  both priorities, including the [transition when capacity decreases](decisions/admission-bot-concurrency.md).
  The documented failover limitation still applies to already-sent physical HTTP requests.
- The [bot namespace](decisions/backend-bot-id-and-key-namespace.md) supports enqueue, claim,
  delayed activation and result retrieval on standalone Valkey and through a caller-owned ioredis
  `Cluster`. Each bot's queue keys share one cluster hash slot, and bots sharing a prefix retain
  independent jobs and concurrency limits. Invalid custom prefixes reject before backend I/O.
- All workers and both priorities for one bot share one concurrency limit and cooldown state;
  other bots remain independent. Urgent priority adds no capacity and cannot bypass the cooldown.
- A later shorter 429 at either priority cannot shorten the bot's longer existing cooldown.
- Application timestamps use Unix epoch milliseconds and durations use milliseconds. A valid
  `retry_after` in seconds is converted exactly once before computing the bot cooldown expiry.
- Job handles preserve native IDs as opaque strings. Snapshots derive `scheduledForMs` through the
  [native timing contract](decisions/backend-stored-job-data.md), including distinct planned times
  for scheduler-generated occurrences. Immediate and past-time submissions report native enqueue
  time. Activation, manual 429 requeue, settlement and restart preserve that scheduled time.
  Invalid stored timing fails before transmission and makes `getJob` reject with a `TypeError`.
- A 429 with missing `parameters`, missing `retry_after`, or an invalid, nonpositive or
  unrepresentable value uses the
  [60-second fallback](decisions/rate-limit-retry-after-fallback.md). Both priorities retain the job,
  preserve any longer cooldown and retry through a durable wakeup, including after restart. A valid
  server delay longer than the fallback is honored in full.
- No new dispatch occurs during a bot cooldown; already admitted attempts remain accounted for.
- Normal is the default priority. Any supported method can request urgent priority for immediate,
  delayed or recurring work, without an allowlist or bypass enablement flag. Occurrences inherit
  their schedule's priority.
- Eligible urgent jobs precede normal jobs. New ready jobs enter the back of their selected
  priority; future jobs do not block ready work, and already-admitted jobs are not interrupted.
- Jobs accepted by the current API without a priority remain normal jobs, preserving their identity,
  payload, native scheduled time and recorded outcomes. Priority implementation must account for those
  stored jobs before enabling urgent-first claims on the existing queue.
- Due-job activation progresses while all C dispatch slots are occupied and while a bot cooldown
  is active. Within one priority, an immediate job ready before a scheduled job's activation stays
  ahead, and an immediate job ready after activation stays behind. Verify the same order after
  freeing dispatch capacity or allowing the cooldown to expire.
- A past `runAtMs` or late activation does not retroactively move a job ahead of existing ready
  work. Pending activation recovers after interruption without another submission.
- Definite 429 requeue retains the job and its priority and follows
  [BullMQ's native front insertion within that priority](decisions/rate-limit-native-429-requeue.md).
  Concurrent retries need not preserve their original relative admission order. Urgent priority
  still precedes a normal retry, and C > 1 does not promise completion order.
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
- Schedule options expose the native `every` interval in milliseconds or UTC cron `pattern` form.
  BullMQ owns form selection, option validation and cron parsing; the library adds no Zod schema,
  option allowlist, anchor parameter or custom cron grammar. An undefined alternative follows
  native selection behavior. Supported recurrence values reach BullMQ unchanged. When native
  creation rejects invalid recurrence options or an unsupported pattern, `createSchedule` rejects
  with the original BullMQ error, without converting it to a `TypeError` or generic error. Changes
  to native expression support must not require a separate library grammar update.
- A new `{ every: 3_600_000 }` schedule has an immediately eligible first occurrence, then follows
  BullMQ's native interval cadence. At 12:25 UTC, a new `{ pattern: '0 * * * *' }` schedule first
  becomes due at 13:00, and `{ pattern: '26 * * * *' }` first becomes due at 12:26. Cron expressions
  with an optional seconds field also follow native interpretation. Claims can be late but do not
  change an occurrence's recorded planned time.
- Both recurrence forms follow their native planned times and
  [native scheduler recovery](decisions/recurrence-native-schedules.md): an already-created
  overdue job runs when capacity is available, and beginning it creates the next scheduled occurrence.
  Missed, uncreated occurrences are skipped without an additional catch-up job. Occurrence
  creation and advancement remain unique under competing workers for both forms.
- Recovery preserves accepted queued jobs.
- Schedule creation uses native BullMQ Job Schedulers. Deletion follows
  [native scheduler removal](decisions/recurrence-native-schedules.md): it removes the scheduler
  definition and the next occurrence if still delayed, including an overdue occurrence awaiting
  activation. `getJob` returns `undefined` for the removed job. Ready, in-flight and finished
  occurrences remain intact.
- Deleting a schedule while an occurrence is ready or in-flight does not prevent that occurrence
  from executing or settling, and its execution cannot recreate the scheduler. Races with due-job
  activation and occurrence advancement follow the native ordering: activation before removal
  preserves the ready job, while removal before activation deletes the delayed job.
- A new client can list retained jobs of either recurrence form by schedule ID after the creating
  client exits, including after deletion of the schedule definition. Listing follows each job's
  native scheduler
  association, excludes unrelated jobs, and provides job IDs usable with `getJob` to retrieve their
  current states and outcomes. Deleted delayed occurrences, jobs removed by retention cleanup and
  skipped times whose jobs were never created have no listing entry. Listing introduces no separate
  occurrence history or resumable schedule definition.
- Supported payloads remain usable after the submitting process exits. Unsupported transient
  payloads are rejected at submission rather than accepted unreliably.

## Deferred, not blocking this slice

Additional priority levels, per-schedule pause/resume, non-UTC time zones, richer missed-occurrence
policies, generic job cancellation, custom deadlines, bounded waiting, transparent awaiting
transformers, caller-supplied submission deduplication, new-file upload persistence, additional
backends and hypothetical-scale optimizations are deferred. Internal occurrence uniqueness and safe
claims remain core checks, not deferred conveniences.

## Acceptance outcome

The first slice is ready when enqueue → durable job/schedule → due-work activation → coordinated
grammY Telegram attempt → visible outcome works, the local Compose setup and runtime checks pass,
and no known material blocker remains. Compatibility claims require evidence from the relevant
runtime tests.

Archived dependency experiments established which native primitives can be reused and which require
additional coordination. The implemented scheduler must satisfy the retry/requeue, cooldown expiry,
recurrence, and stalled-job recovery criteria above; those acceptance checks remain pending.
