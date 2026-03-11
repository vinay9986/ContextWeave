# ADR 002: Rehydration Packs Instead of Full-History Dumping

## Status

Accepted

## Context

When an agent starts a session or returns from compaction, it needs enough context to resume work without being flooded by stale history.

A naive full-history dump would waste tokens and make it harder for the agent to distinguish active work from old traces.

## Decision

ContextWeave rehydrates with a compact, deterministic pack built from:

- `bd prime --full`
- prompt/final summaries from earlier traces
- open non-trace issues
- a focused memory pack built from pinned, decision, ready, and dependency-related issues

The pack is injected at session start and after compaction markers are detected.

## Consequences

- The model receives current workflow memory without replaying every historical message.
- Rehydration stays aligned with the actual Beads workspace instead of a free-form summary file.
- The hook layer can re-run the same rehydration logic after every compaction event.

## Alternatives Considered

- Full transcript injection: rejected because it is token-heavy and noisy.
- Manual summary maintenance: rejected because it depends on the model to keep summaries accurate.
- No rehydration: rejected because compaction would drop important project context between turns.
