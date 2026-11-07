# Telegram outcome classification

- **Status:** provisional
- **Human-confirmed:** no

## Decision

- A successful response is `succeeded`.
- A 429 is handled as a rate limit.
- Any other Telegram 4xx response is `failed`.
- Telegram 5xx responses, grammY `HttpError`s (network failures, timeouts and non-JSON responses)
  and unrecognized transport errors are `uncertain`.

## Context

A 4xx response means Telegram answered and did not perform the call. A server error does not prove
the call had no effect, and a request may reach Telegram before the connection fails or times out;
see the [uncertainty policy](uncertainty-no-automatic-retransmission.md).
