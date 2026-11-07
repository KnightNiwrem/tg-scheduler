# Worker start sets the shared concurrency

- **Status:** provisional
- **Human-confirmed:** no

## Decision

`worker.start()` sets the bot's queue-wide ordinary concurrency once the worker's connection is
ready and before it claims jobs, so a worker that fails to start leaves the limit unchanged. Workers
started with different policies overwrite each other, and the last one started wins; every worker
for a bot must therefore use the same policy.

## Context

BullMQ stores global concurrency on the queue rather than per worker, so the limit has a single
current value for the bot.
