# Urgent requests reject until the urgent lane exists

- **Status:** provisional
- **Human-confirmed:** no

## Decision

Until the [urgent lane](admission-urgent-lane.md) is implemented, `submit` with `lane: 'urgent'` and
`worker.start()` with `urgentBypassEnabled: true` reject with `UnimplementedError` instead of
falling back to the ordinary lane.

## Context

A silent fallback would queue time-sensitive answers behind the ordinary backlog and cooldown
without telling the caller. This decision is removed when the urgent lane is implemented.
