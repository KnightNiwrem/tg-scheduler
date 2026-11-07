# FIFO admission by original due time

- **Status:** provisional
- **Human-confirmed:** no

## Decision

Eligible ordinary jobs are admitted in order of original due time, then submission sequence.
Immediate work uses its enqueue time as its due time. Future jobs never block ready work, and a 429
retry changes a job's next eligible time but not its rank.

- FIFO describes admission, not completion or Telegram-side effect order when C > 1.
- "Run at" means not before that time, not delivery at that instant.
- Urgent bypass deliberately overtakes ordinary work. General priorities are outside the first
  slice.
- For a send followed by an edit of the returned message, the caller submits the edit after the
  send succeeds. A general dependency engine is outside the first slice.

## Context

The [native behavior experiments](../library-research.md#selected-version-native-behavior) showed
that BullMQ's ready list keeps submission order but promotes an older-due delayed job behind a newer
ready backlog, so ordering by original due time needs additional coordination.
