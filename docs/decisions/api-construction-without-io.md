# Construction performs no I/O

- **Status:** provisional
- **Human-confirmed:** no

## Decision

Importing the library performs no startup or environment access. Constructing a client or worker
validates its options and performs no I/O. A client initializes its BullMQ queue on first use, and
a worker initializes its BullMQ resources in `start()`. The
[caller-owned connection](backend-ioredis-driver.md) may already be connected or may connect when
BullMQ first uses it, according to the caller's settings. Operations after `close()` reject.

## Context

Invalid scheduler options fail at construction. The application chooses when to create and connect
its ioredis instance; constructing a scheduler client at module scope or in a serverless handler
does not itself initialize BullMQ or perform network I/O.
