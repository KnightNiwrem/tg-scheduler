---

name: queue-backend-integration
description: Implement or validate tg-scheduler's BullMQ/Valkey integration and durable worker behavior. Use for backend/client changes or queue/scheduler integration; documentation-only and unrelated tooling edits do not need this workflow.
---

# Queue backend integration

Read the [architecture](../../../docs/architecture.md),
[acceptance criteria](../../../docs/validation.md), and
[library research](../../../docs/library-research.md) before queue/backend integration work. They
contain the selected behavior and dependency caveats; recover missing references before relying
on an incomplete design.

## Establish the dependency boundary

BullMQ, Valkey, and BullMQ's supported injectable client contract with ioredis-compatible
interoperability are fixed. Actual ioredis is the provisional initial driver. A driver-specific
failure can justify a supported replacement client/adapter that preserves the fixed contract
and runtime targets. Validate the replacement and update the design. A driver
change alone does not require approval; report a conflict with a fixed backend requirement or
runtime target before changing that requirement.

## Verify the integration

- Exercise the project's enqueue, claim, delayed activation, and result retrieval against Valkey on
  Bun, then on the Node.js and Deno library compatibility targets. Record the dependency/runtime
  versions tested. Imports, type checking, source research, and starter tests are insufficient.
- For the local Compose slice, use the official `valkey/valkey` image and validate persistence and
  restart behavior. Isolate runtime-specific startup, configuration, permissions, and shutdown at
  the edges of the shared library.
- Check client lifecycle and worker startup, including blocking connection duplication and the
  selected driver's required retry settings. The architecture records ioredis worker requirements.
- Verify native engine semantics before relying on them for eligible FIFO, original-rank 429
  requeue, monotonic lane cooldowns, planned-time recurrence, and missed-occurrence coalescing.
  Reuse native machinery where it satisfies the selected behavior.
- Exercise interrupted and stalled workers against the uncertainty policy. Native recovery must
  not silently retransmit an ambiguous Telegram effect or allow stale attempts to overwrite state.
- Use deterministic fake Telegram responses and a controllable clock where practical. Cover valid
  retry delays, the documented missing/invalid-delay fallback, both lanes, and durable reactivation
  after restart. Simulate 429s instead of deliberately provoking production flood limits.

Use the acceptance criteria for detailed cases relevant to the requested change. Distinguish
verified behavior from pending runtime or recovery checks when reporting the result.
