# Bot identity and key namespace

- **Status:** provisional
- **Human-confirmed:** no

## Decision

- `botId` contains 1–64 ASCII letters, digits, `_` or `-`.
- The bot's single dispatch queue is named `{<botId>}.ordinary`, so its Valkey keys are
  `<queuePrefix>:{<botId>}.ordinary:<suffix>`. Both priorities use this identity; priority is not part
  of the queue name.
- The bot ID inside braces is the queue's Valkey Cluster hash tag. All keys for one bot's queue
  share a hash slot; different bot IDs can map to different slots. The same key layout is used
  with standalone Valkey.
- `queuePrefix` defaults to `tg-scheduler` and contains 1–100 characters without whitespace or
  braces. It is the shared key namespace, and the bot identity provides per-bot isolation within it.

## Context

BullMQ's atomic queue operations touch multiple keys, which Valkey Cluster requires to share a
hash slot. A per-bot hash tag keeps those operations valid while allowing different bots' queues
to be distributed across shards. Standalone Valkey treats the braces as ordinary key characters.
Braces in a prefix could override the queue's tag or prevent it from taking effect, so prefixes
reject them. BullMQ rejects `:` in queue names, and Telegram's numeric bot IDs satisfy the
identifier rule.
