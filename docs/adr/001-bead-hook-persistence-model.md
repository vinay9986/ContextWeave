# ADR 001: The Bead-Hook Persistence Model

## Status
Accepted

## Context
Autonomous agents suffer from "context window exhaustion" and "LLM amnesia." As sessions grow, agents lose track of architectural decisions, dependencies, and project state. Traditional flat files (like TODO.md) are unstructured and token-heavy.

## Decision
I have implemented a dual architecture:
- **Beads**: A Git-native, append-only JSONL database for granular state tracking.
- **Hooks**: Deterministic lifecycle scripts that synchronously intercept agent events to inject memory or enforce policies.

## Consequences
- **Immutable State**: Every state change is a new "bead" in the log, providing full auditability and idempotency.
- **Git-Native**: Merging state between parallel agents is handled via standard Git workflows.
- **Fault Tolerance**: Append-only logs prevent file corruption during agent crashes.

## Alternatives Considered
- **Vector Database (RAG) Only**: Rejected because vector search lacks the strict temporal ordering and dependency awareness required for task management.
- **Relational Databases (SQLite/PostgreSQL)**: While used as a read-model cache, they are rejected as the primary source of truth to avoid external infrastructure dependencies and binary lock-in.
