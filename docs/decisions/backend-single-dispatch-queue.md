# One prioritized dispatch queue per bot

- **Status:** provisional
- **Human-confirmed:** yes

## Decision

Each bot has one BullMQ dispatch queue containing both [job priorities](admission-job-priorities.md).
Immediate submissions and activated delayed jobs or recurring occurrences feed this same ready
queue. All dispatch workers for the bot use the same queue identity, global concurrency and cooldown.

Scheduling storage and occurrence generation are internal parts of the library. They do not create
separate ordinary and urgent dispatch queues. [Due-job activation](ordering-eligible-fifo.md)
progresses independently of available dispatch capacity.

## Context

BullMQ's native priority selection and queue-wide limits coordinate one dispatch path. Separate bots
have separate queues and limits. The [namespace](backend-bot-id-and-key-namespace.md) identifies each
bot's queue. Native delayed promotion waits for worker fetching, so independent due-job activation
requires additional coordination; its implementation remains pending.
