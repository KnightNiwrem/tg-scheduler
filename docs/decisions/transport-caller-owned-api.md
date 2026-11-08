# Caller-owned grammY API instances

- **Status:** provisional
- **Human-confirmed:** yes

## Decision

Workers accept a caller-created grammY `Api` instance and use it by reference for admitted calls.
The library does not construct, clone, reconfigure or install transformers on that instance.
The caller owns its credentials, credential rotation, request timeout, Bot API endpoint, network
configuration and lifetime. The scheduler imposes no separate request timeout.

An `Api` retains its construction-time token. Rotating that token requires a new `Api` instance
and replacement workers configured with it; callers drain and close workers that retain the old
instance. Reassigning a caller's variable does not rebind a running worker, and the library provides
no live API replacement operation.

Prefer a fresh `Api` instance dedicated to scheduler use, without transformers, over `bot.api` or
another instance shared with bot plugins. This is a recommendation, not a blanket prohibition on
transformers. A supplied instance must preserve the
[transport contract](transport-grammy-outgoing-api.md): one attempt per admission, observable
results and errors, and no hidden retries, throttling, sleeps or independent queue. In particular,
429 responses must reach the coordinator so it can pause the bot's other queued work.

Declare grammY as a peer dependency with a supported compatibility range, so the application
supplies the grammY installation used to create its API instances. Pin the development/test version
separately. Accepting an instance does not promise compatibility with arbitrary grammY versions.

## Context

Queueing, scheduling, admission and 429 coordination belong to the scheduler; configuring the
Telegram client belongs to the application. Borrowing the configured instance avoids duplicating
grammY options or creating a client from a separate library-owned grammY version.

A fresh instance makes the behavior of queued calls explicit. Existing bot instances may carry
[transformers](https://grammy.dev/advanced/transformers) that alter execution. For example,
[auto-retry](https://grammy.dev/plugins/auto-retry) consumes 429 responses, waits and retries, and
also retries network and server errors. Those behaviors conflict with coordinated cooldowns and
the [no-retransmission policy](uncertainty-no-automatic-retransmission.md). Other transformers can
preserve the transport contract.
