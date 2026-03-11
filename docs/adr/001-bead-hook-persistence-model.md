# ADR 001: The Beads Plus Hooks Persistence Model

## Status

Accepted

## Context

Long-running coding sessions need two things at the same time:

- durable project memory that survives compaction and restarts
- deterministic capture points for prompts, tool activity, and final responses

Relying on the model to maintain memory files is brittle, and building a separate service would add unnecessary operational weight for a hook-driven workflow.

## Decision

ContextWeave persists state through:

- Beads issues created through the `bd` CLI
- synchronous provider hooks that log trace nodes and inject context
- lightweight marker files in `.beads/`, including `.trace_state.json` and `.needs_rehydrate`

The Beads issue graph is the durable source of truth for prompt trees and project memory. The local marker files only track hook workflow state.

## Consequences

- Prompt, tool, intermediate, and final events can be reconstructed as a parent/child trace tree.
- Context injection stays deterministic because it runs in hook code, not inside the model's own output.
- The implementation remains light enough for repo-local installation with no extra service process.

## Alternatives Considered

- Model-maintained memory files: rejected because updates are easy to forget or corrupt.
- Standalone database service: rejected because the current workflow only needs Beads plus small local markers.
- Pure transcript replay: rejected because it does not provide structured prompt trees or compaction-aware rehydration.
