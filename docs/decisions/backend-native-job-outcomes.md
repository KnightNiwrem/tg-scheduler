# Align terminal outcomes with BullMQ states

- **Status:** provisional
- **Human-confirmed:** yes

## Decision

New successful Telegram jobs enter BullMQ's `completed` set. Terminal Telegram rejections,
transport errors and unexpected processor errors enter BullMQ's `failed` set. Terminal failures
preserve the error exposed by `getJob` and do not trigger automatic retransmission.

Definite 429 responses follow the [cooldown and retry policy](rate-limit-429-requeue-preserves-rank.md);
until it is implemented, the [interim failure](rate-limit-interim-429-failure.md) uses the failed set.

## Context

BullMQ classifies a normal processor return as completion and an error as failure. Returning a
failure object normally would make native job lists, events, counts and retention disagree with
the public outcome. Aligning them permits native terminal-state tools to reflect Telegram results.
Failure state and retry policy are separate; the
[no-retransmission policy](uncertainty-no-automatic-retransmission.md) still applies.
