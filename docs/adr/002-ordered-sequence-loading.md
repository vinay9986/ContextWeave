# ADR 002: Ordered Sequence Loading vs. Naive Context Dumping

## Status
Accepted

## Context
When an agent starts a new session or recovers from a crash, it needs to be "rehydrated" with project context. Simply dumping the entire project history into the prompt is token-inefficient and risks confusing the LLM with stale or contradictory information.

## Decision
ContextWeave implements **Ordered Sequence Loading**. The system performs a topological sort of the beads (tasks and decisions) and injects them in a structured, hierarchical sequence. Only unblocked, relevant tasks are presented as "Active," while historical context is provided as a compressed summary.

## Consequences
- **Token Efficiency**: Drastically reduces the "prompt tax" on every turn.
- **Focus**: The agent is forced to focus on the current unblocked task, eliminating hallucinated sequencing.

## Alternatives Considered
- **Naive Full-History Injection**: Rejected due to context window limits and cost.
- **Manual Summary Maintenance**: Rejected as it depends on the agent accurately updating its own summary, which frequently fails under stress.
