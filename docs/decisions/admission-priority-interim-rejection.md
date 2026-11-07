# Urgent requests reject until job priorities are implemented

- **Status:** provisional
- **Human-confirmed:** no

## Decision

Until [job priorities](admission-job-priorities.md) are implemented, the current scaffold's `submit`
with `lane: 'urgent'` and `worker.start()` with `urgentBypassEnabled: true` reject with
`UnimplementedError` instead of silently accepting urgent work as normal priority.

## Context

A silent fallback would accept a preference the worker does not honor. The existing option names
are scaffolded API surface, not a requirement for a separate queue or cooldown bypass. This
decision is removed when job priorities are implemented.
