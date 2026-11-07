# Backend integration tests run when VALKEY_TEST_URL is set

- **Status:** provisional
- **Human-confirmed:** no

## Decision

Tests that need Valkey run only when `VALKEY_TEST_URL` is set and are skipped otherwise. Each test
uses a unique key prefix and deletes its own data. CI starts the pinned Valkey image as a service
and sets the variable for every runtime, so integration tests always run in CI. Tests replace
Telegram with a fake transport or a fake Bot API and make no real Telegram calls.

## Context

Unit tests stay runnable without services. Integration tests write keys, so they belong on a local
test instance rather than a shared one.
