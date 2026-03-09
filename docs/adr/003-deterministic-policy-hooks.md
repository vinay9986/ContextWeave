# ADR 003: Deterministic Policy Enforcement via Hooks

## Status
Accepted

## Context
LLMs are inherently non-deterministic, making them difficult to secure. System prompts ("Don't write secrets") are easily bypassed via prompt injection or simple forgetting.

## Decision
ContextWeave utilizes **Synchronous Hooks** to enforce deterministic policies *outside* the LLM's reasoning loop. Before an agent executes a tool (e.g., `write_file`), a hook script validates the payload against security policies (redacting secrets) and checks for architectural compliance.

## Consequences
- **Hard Security**: Policies are enforced by code, not just suggestions.
- **Redaction**: Sensitive data is blocked before it ever hits the model or the disk.

## Alternatives Considered
- **LLM-Based Moderation**: Rejected as it is subject to the same non-deterministic failures as the agent itself.
- **Post-hoc Auditing**: Rejected because it only detects breaches after they have occurred.
