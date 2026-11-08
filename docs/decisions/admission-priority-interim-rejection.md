# Urgent requests reject until job priorities are implemented

- **Status:** provisional
- **Human-confirmed:** no

## Decision

Until [job priorities](admission-job-priorities.md) are implemented, `submit` and
`createSchedule` with `priority: 'urgent'` reject with `UnimplementedError` instead of silently
accepting urgent work as normal priority. Snapshots report `priority: 'normal'` for every stored
job.

## Context

A silent fallback would accept a preference the worker does not honor. This decision is removed
when job priorities are implemented.
