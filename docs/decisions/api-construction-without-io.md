# Construction performs no I/O

- **Status:** provisional
- **Human-confirmed:** no

## Decision

Importing the library performs no startup or environment access. Constructing a client or worker
validates its options and performs no I/O. A client opens its backend connection on first use, and
a worker connects in `start()`. Operations after `close()` reject.

## Context

Invalid configuration fails at construction, while code that creates a client at module scope or
in a serverless handler opens no connection until it uses the client.
