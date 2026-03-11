# ADR 003: Deterministic Hook Control Points

## Status

Accepted

## Context

Provider hooks are the only reliable place to observe prompt boundaries, tool events, final responses, and compaction markers without asking the model to self-report them.

If those responsibilities are left inside the model loop, trace ordering and rehydration behavior become inconsistent.

## Decision

ContextWeave uses synchronous hook scripts as the control points for:

- prompt, tool, intermediate, and final trace logging
- session-start context injection
- compaction reminders
- post-compaction rehydration markers
- provider-specific output formatting

The model receives the results of that hook work, but it does not control the hook workflow itself.

## Consequences

- Trace ordering is deterministic and independent of model phrasing.
- Rehydration behavior is repeatable after compaction.
- Provider-specific differences can be handled in `payload.js` and `output.js` without duplicating trace logic.

## Alternatives Considered

- Model self-reporting: rejected because it is incomplete and non-deterministic.
- Post-hoc transcript scraping only: rejected because it misses the chance to inject context at the right lifecycle boundaries.
