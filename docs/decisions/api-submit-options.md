# Strict submit options

- **Status:** provisional
- **Human-confirmed:** no

## Decision

`submit` rejects unknown option keys. `priority` is `normal`, the default, or `urgent`; see
[job priorities](admission-job-priorities.md). `runAtMs` must be a non-negative integer in
[Unix epoch milliseconds](time-unix-epoch-milliseconds.md); omitting it requests immediate work. A
`runAtMs` in the past requests immediate ready-queue entry. Its snapshot reports the native enqueue
time through `scheduledForMs`, following the [stored timing contract](backend-stored-job-data.md).
It does not reserve a position ahead of existing ready work.

## Context

Rejecting unknown keys keeps a misspelled option from silently changing how work is scheduled. The
ready-entry time determines new-job [FIFO position within a priority](ordering-eligible-fifo.md).
