# Outbound queue and scheduler architecture

This document describes how the scheduler's components fit together. Each technical choice is
recorded once in the [decisions folder](decisions/) with its status and context; this document
links to those decisions instead of restating them. The [project overview](../README.md) describes
current capabilities, and the [library overview](library-overview.md) maps source modules to these
components and lists operations that still reject as unimplemented. [Validation](validation.md)
defines acceptance criteria, and [library research](library-research.md) records supporting
dependency findings.

## Scope and ownership

The scheduler queues [outgoing Bot API calls only](decisions/scope-outgoing-bot-api-calls.md).
Immediate, delayed and recurring work for a bot share
[one coordination authority](decisions/scope-one-coordination-authority-per-bot.md).

| Component                        | Owns                                                                                                                 |
| -------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| Client                           | Submit jobs/schedules, retrieve status/results, disable future recurrence                                            |
| Core queue/scheduler             | Eligibility, ordering, occurrence creation, ordinary/urgent admission, cooldowns and retry/recovery decisions        |
| Durable backend                  | Jobs, schedules, bot state, atomic transitions, reservations and recovery records                                    |
| Wakeup/scheduling infrastructure | Activate due work, cooldown expiry, recurrence and recovery independently of producer lifetime                       |
| Telegram executor/transport      | Use grammY to perform an admitted API attempt and report the result; no hidden retry/sleep loop or independent queue |

## Decisions by area

- **Scope:** [outgoing Bot API calls only](decisions/scope-outgoing-bot-api-calls.md),
  [one coordination authority per bot](decisions/scope-one-coordination-authority-per-bot.md).
- **Stack and tooling:** [TypeScript](decisions/language-typescript.md),
  [Bun with Node.js and Deno targets](decisions/runtime-bun-primary-node-deno-compatible.md),
  [Biome](decisions/tooling-biome.md),
  [Bun dependency management](decisions/tooling-bun-dependency-management.md),
  [Zod validation](decisions/tooling-zod-validation.md).
- **Testing:** [Vitest on every runtime](decisions/testing-vitest-cross-runtime.md),
  [opt-in Valkey integration tests](decisions/testing-valkey-integration-opt-in.md).
- **Deployment and local stack:** [operated Bun workers](decisions/deployment-operated-bun-worker.md),
  [Docker Compose with Valkey](decisions/local-docker-compose-valkey.md),
  [local Valkey persistence](decisions/local-valkey-persistence.md).
- **Backend:** [BullMQ backed by Valkey](decisions/backend-bullmq-valkey.md),
  [ioredis driver](decisions/backend-ioredis-driver.md),
  [connection roles](decisions/backend-valkey-connection-roles.md),
  [native primitives](decisions/backend-native-primitives.md),
  [logical state records](decisions/backend-logical-state-records.md),
  [queue per lane](decisions/backend-queue-per-lane.md),
  [bot identity and key namespace](decisions/backend-bot-id-and-key-namespace.md),
  [stored job data](decisions/backend-stored-job-data.md),
  [finished-job retention](decisions/backend-finished-job-retention.md).
- **Public API:** [job and schedule operations](decisions/api-explicit-job-and-schedule-operations.md),
  [direct producer connections](decisions/api-producer-direct-backend-connection.md),
  [construction without I/O](decisions/api-construction-without-io.md),
  [unawaited error reporting](decisions/api-unawaited-error-reporting.md),
  [submit options](decisions/api-submit-options.md),
  [submission acknowledgement](decisions/api-submit-acknowledgement.md),
  [durable JSON requests](decisions/api-durable-json-requests.md),
  [bot token handling](decisions/credentials-bot-token-handling.md),
  [visible job states](decisions/api-visible-job-states.md),
  [millisecond timestamps](decisions/time-unix-epoch-milliseconds.md).
- **Admission and 429 handling:**
  [required capabilities](decisions/admission-required-capabilities.md),
  [ordinary concurrency](decisions/admission-ordinary-concurrency.md),
  [concurrency set by worker start](decisions/admission-concurrency-set-by-worker-start.md),
  [urgent lane](decisions/admission-urgent-lane.md),
  [interim urgent rejection](decisions/admission-urgent-lane-interim-rejection.md),
  [lane cooldowns](decisions/rate-limit-lane-cooldowns.md),
  [429 requeue](decisions/rate-limit-429-requeue-preserves-rank.md),
  [retry delay](decisions/rate-limit-retry-after-fallback.md),
  [interim 429 failure](decisions/rate-limit-interim-429-failure.md).
- **Ordering and recurrence:** [FIFO by original due time](decisions/ordering-eligible-fifo.md),
  [planned-time recurrence](decisions/recurrence-planned-time-anchored.md).
- **Outcomes and recovery:**
  [no automatic retransmission](decisions/uncertainty-no-automatic-retransmission.md),
  [stalled-job reporting](decisions/recovery-stalled-replay-disabled.md),
  [outcome classification](decisions/transport-outcome-classification.md),
  [grammY transport](decisions/transport-grammy-outgoing-api.md),
  [request timeout](decisions/transport-request-timeout.md).

## Job lifecycle

This is the target lifecycle. Cooldowns, 429 requeue, ordering by original due time and recurrence
are not implemented yet; the [library overview](library-overview.md#current-state) describes the
current behavior.

1. A producer submits a validated request; the backend persists it and guarantees a future
   processing opportunity, after which the producer may exit.
2. A worker claims due work when its lane has capacity and no active cooldown, in admission order.
3. The transport makes one Telegram attempt and reports a classified outcome.
4. The coordinator settles the job as succeeded, failed or uncertain, or returns it to the queue
   after a 429, extending that lane's cooldown.
5. Recurring schedules materialize occurrences as ordinary jobs that follow the same path.

## Durable transitions

The design requires these behaviours, supplied by native engine primitives where possible rather
than behind mandatory adapter method names:

1. **Submit and ensure activation:** persist accepted work and guarantee a future processing
   opportunity.
2. **Claim/reserve:** atomically check due time, ordering, lane cooldown and capacity; reserve with
   current attempt identity and lease.
3. **Settle/defer/fail:** verify current ownership, save the outcome, release capacity,
   monotonically extend cooldowns and ensure next activation.
4. **Recover abandoned attempts:** reclaim expired ownership under the uncertainty policy; arrange
   recovery at claim time, not only after successful completion.
5. **Materialize occurrence:** create one unique occurrence and advance the schedule atomically.
6. **Disable recurrence:** prevent further occurrence creation without silently cancelling accepted
   jobs.

Duplicate wakeups must reread state and claim before sending; they must not create competing current
claims for one job. Intentional retries and recovery have new attempt identities. Stale workers
cannot overwrite current state, and an old wakeup must not erase a newer one.

## Guarantee limits

Telegram may accept a request before the worker crashes or loses the response, so this library
cannot guarantee exactly-once external effects. Submission deduplication would not solve that
boundary. Ownership and fencing protect stored state but cannot revoke an HTTP request that was
already sent. After lease expiry or failover, physical in-flight requests may exceed the cap on
current reservations.

## Example with C=2 and urgent capacity 1

Jobs A and B are admitted; job D waits. A returns a twenty-second 429, preserving A's rank and pausing
ordinary admission. B can still succeed or extend that cooldown. An allowlisted callback answer can
use the urgent slot if the urgent gate is open. Its own 429 pauses the urgent lane. After the
ordinary cooldown, A is selected before later ordinary work, but D may occupy the second slot and
finish first.

## Compatibility boundaries

Configuration, payload schema, ordering and uncertainty semantics become migration boundaries once
the library has public consumers or production data. Internal draft interfaces carry no hypothetical
compatibility obligation, while established external contracts and existing data require
preservation or an explicit migration.
