# Urgent lane

- **Status:** provisional
- **Human-confirmed:** no

## Decision

- Urgent bypass is disabled by default and enabled through the worker policy's
  `urgentBypassEnabled`.
- Only `answerCallbackQuery` and `answerPreCheckoutQuery` may use the urgent lane.
- When enabled, urgent capacity U is 1 in addition to ordinary capacity, so up to C + U attempts
  are normally admitted at once.
- Urgent work may bypass the ordinary backlog and cooldown but is admitted only while an urgent
  slot is free and the urgent lane is not in cooldown.
- An urgent 429 extends the urgent lane's own cooldown, which gates both retrying and newly
  submitted urgent jobs.
- Urgent work is requested through explicit `submit` calls; schedule occurrences use the ordinary
  lane.

Urgent bypass deliberately permits urgent jobs to overtake ordinary work.

## Context

This implements the [required time-sensitive exception](admission-required-capabilities.md). The
lane boundaries are conservative application policy, not a claim about Telegram's actual
rate-limit buckets. Urgency cannot guarantee timeliness:
[answerPreCheckoutQuery](https://core.telegram.org/bots/api#answerprecheckoutquery), for example,
must be answered within ten seconds.
