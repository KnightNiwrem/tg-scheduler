# Strict submit options

- **Status:** provisional
- **Human-confirmed:** no

## Decision

`submit` rejects unknown option keys. `runAtMs` must be a non-negative integer in
[Unix epoch milliseconds](time-unix-epoch-milliseconds.md); omitting it requests immediate work. A
`runAtMs` in the past runs immediately and keeps the past value as its original due time.

## Context

Rejecting unknown keys keeps a misspelled option from silently changing how work is scheduled. The
stored due time determines the job's [admission rank](ordering-eligible-fifo.md).
