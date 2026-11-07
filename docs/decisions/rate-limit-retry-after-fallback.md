# Retry delay from retry_after with a 30-second fallback

- **Status:** provisional
- **Human-confirmed:** no

## Decision

The transport reports Telegram's raw `parameters.retry_after`, in seconds, and the coordinator
validates and converts it once:

- For a positive integer for which `nowMs + retry_after * 1000` does not exceed
  `Number.MAX_SAFE_INTEGER`, `retryDelayMs = retry_after * 1000`.
- If `parameters` or `retry_after` is absent, or the value is invalid, nonpositive or
  unrepresentable, `retryDelayMs = 30_000`.

The fallback applies to both lanes and to every such 429. It never causes an immediate retry, never
shortens a longer existing cooldown and never caps a valid server-specified delay. An integer too
large to satisfy the bound, which would exceed 285,000 years, is treated as invalid.

## Context

[`ResponseParameters`](https://core.telegram.org/bots/api#responseparameters) makes `retry_after`
optional. The fallback is application policy rather than a guarantee that Telegram accepts the call
after thirty seconds; Telegram publishes no universal requests-per-second threshold.
