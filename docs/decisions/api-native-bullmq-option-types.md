# Options passed to BullMQ unchanged use BullMQ's types

- **Status:** provisional
- **Human-confirmed:** no

## Decision

A public option whose values the library passes to BullMQ unchanged takes its field types from
BullMQ's exported declarations instead of redeclaring them. The library narrows which fields it
exposes and how they combine, but does not restate a field's value type. `ScheduleRecurrence`
selects the `every` or `pattern` field of BullMQ's `RepeatOptions`, one at a time.

Library-defined values that the library converts before handing them to BullMQ keep library
types: `runAtMs`, `priority`, `botId`, `queuePrefix` and the dispatch concurrency policy.
Library options are not mixed into an object that reaches BullMQ unchanged; a schedule's priority
is a separate argument for that reason.

Opt-in [finished-job retention](backend-finished-job-retention.md) limits are library options
rather than BullMQ's `KeepJobs`, because `KeepJobs.age` is in seconds while library durations are
in [milliseconds](time-unix-epoch-milliseconds.md). Succeeded and failed jobs each take
`{ maxAgeMs?, maxCount? }` with at least one field set: `maxAgeMs` is a positive integer and
`maxCount` a non-negative integer. The library converts them to `KeepJobs` with
`age = Math.ceil(maxAgeMs / 1000)` and `count = maxCount`, rounding up so that no job becomes
eligible for removal before `maxAgeMs` has elapsed.

The caller-owned connection is typed with ioredis's `Redis | Cluster`. BullMQ 6.7.1's
`ConnectionOptions` also admits option objects and other clients, which the
[connection decision](backend-ioredis-driver.md) excludes, and BullMQ exports no type for ioredis
instances alone.

## Context

Redeclared types can drift from the dependency's accepted values when BullMQ is upgraded, while
the value still reaches BullMQ unchanged. Deriving the type keeps compile-time checks aligned with
the [native validation](recurrence-native-schedules.md) that decides acceptance at runtime.

Passing a native type through is preferred only while its units match the library's. A
seconds-valued `age` among millisecond options would let `age: 86_400_000`, meant as one day,
silently keep jobs for about 2.7 years. `KeepJobs` is small and stable, so converting it carries
less risk than exposing that unit.
