# Telegram outcome classification

- **Status:** provisional
- **Human-confirmed:** no

## Decision

- A successful response is `succeeded`.
- A 429 is reported as rate-limited, with Telegram's raw `retry_after`, and settled by the
  rate-limit decisions; currently the [interim 429 failure](rate-limit-interim-429-failure.md)
  applies.
- Every other error is `failed`, with its message and Telegram error code when available. This
  includes Telegram 4xx and 5xx responses, grammY `HttpError`s (network failures, timeouts and
  non-JSON responses), and unrecognized transport errors.

## Context

Failure describes the execution outcome, not whether Telegram performed the call. A server error
can follow an external effect, and a request may reach Telegram before the connection fails or
times out. Recording these errors as failures follows the
[visible job states](api-visible-job-states.md) without changing the
[no-retransmission policy](uncertainty-no-automatic-retransmission.md).
