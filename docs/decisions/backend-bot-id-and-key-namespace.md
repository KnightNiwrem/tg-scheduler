# Bot identity and key namespace

- **Status:** provisional
- **Human-confirmed:** no

## Decision

- `botId` contains 1–64 ASCII letters, digits, `_` or `-`.
- The bot's ordinary queue is named `<botId>.ordinary` and its urgent queue `<botId>.urgent`, so
  every Valkey key a lane uses is `<queuePrefix>:<botId>.<lane>:<suffix>`.
- `queuePrefix` defaults to `tg-scheduler` and contains 1–100 non-whitespace characters. It is the
  shared key namespace, and the bot identity provides per-bot isolation within it.

## Context

BullMQ rejects `:` in queue names. Excluding `.` from bot IDs keeps per-lane queue names distinct.
Telegram's numeric bot IDs satisfy the rule. Encoding arbitrary IDs would lift the restriction at
the cost of less readable keys.
