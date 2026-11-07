# Retry delay from retry_after with a 60-second fallback

- **Status:** provisional
- **Human-confirmed:** yes

## Decision

The transport reports Telegram's raw `parameters.retry_after`, in seconds, and the coordinator
validates and converts it once:

- For a positive integer for which `nowMs + retry_after * 1000` does not exceed
  `Number.MAX_SAFE_INTEGER`, `retryDelayMs = retry_after * 1000`.
- If `parameters` or `retry_after` is absent, or the value is invalid, nonpositive or
  unrepresentable, `retryDelayMs = 60_000`.

The fallback applies at either job priority and to every such 429. It never causes an immediate
retry, never shortens a longer existing cooldown and never caps a valid server-specified delay. An
integer too large to satisfy the bound, which would exceed 285,000 years, is treated as invalid.

## Context

[`ResponseParameters`](https://core.telegram.org/bots/api#responseparameters) makes `retry_after`
optional. Maintainer observations include Telegram returning repeated 429s during downtime or
maintenance, with a valid `retry_after` that remains unchanged across retries. Missing or invalid
delay metadata alone does not establish that Telegram is down.

The fallback backs off conservatively for anomalous rate-limit responses. Neither the fallback nor
a valid server-specified delay guarantees that the next attempt will succeed.
