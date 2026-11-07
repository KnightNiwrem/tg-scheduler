# Bot identity and key namespace

- **Status:** provisional
- **Human-confirmed:** no

## Decision

- `botId` contains 1–64 ASCII letters, digits, `_` or `-`.
- The bot's single dispatch queue uses the existing name `<botId>.ordinary`, so its Valkey keys are
  `<queuePrefix>:<botId>.ordinary:<suffix>`. Both priorities use this identity; priority is not part
  of the queue name.
- `queuePrefix` defaults to `tg-scheduler` and contains 1–100 non-whitespace characters. It is the
  shared key namespace, and the bot identity provides per-bot isolation within it.

## Context

BullMQ rejects `:` in queue names. Keeping the existing dispatch queue identity preserves access to
accepted jobs. Telegram's numeric bot IDs satisfy the identifier rule; the namespace separates bots
within the same store.
