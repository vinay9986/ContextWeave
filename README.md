# ContextWeave

ContextWeave is a hook kit for **Claude Code** that persists prompt, tool, and final traces into Beads and rehydrates working context after compaction. It gives long-running coding agents a deterministic memory layer without running a separate service.

Search terms: Claude Code hooks, Beads memory, agent context persistence, AI coding assistant memory, prompt trace logging, compaction rehydration.

## Why ContextWeave

- Persist prompt trees into Beads through the `bd` CLI instead of asking the model to maintain its own memory files.
- Rehydrate the agent with `bd prime --full`, recent prompt/final summaries, and open work after session start or compaction.
- Fire trace hooks asynchronously so they never add latency to tool calls.
- Expose `search-beads` — a semantic retrieval tool backed by a local ONNX model (`all-MiniLM-L6-v2`) that lets the model search history via its native Bash tool without MCP.
- Stay operationally simple: plain Node scripts, Claude Code hook bindings, a `.beads` workspace, and a local model cache.

## Quick Start

```bash
# 1. Initialize Beads in stealth mode (per project — no git tracking)
cd /path/to/project
BEADS_DIR="$(pwd)/.beads" bd init --quiet --stealth
echo ".beads/" >> .gitignore

# 2. Clone and install ContextWeave, then delete the repo — not needed after setup
git clone https://github.com/your-org/ContextWeave
cd ContextWeave
node install.js
cd .. && rm -rf ContextWeave
```

The installer copies everything to `~/.contextweave/`, links `search-beads` onto your PATH, and prints the exact hook config block to paste into `~/.claude/settings.json`.

```bash
# 3. Verify everything is wired correctly
node ~/.contextweave/doctor.js
```

```bash
# 4. Inspect your first Beads trace after running a prompt
bd list --all --sort created --reverse --limit 5
```

See [setup.md](setup.md) for the full setup guide and [setup-claude.md](setup-claude.md) for hook configuration details.

## Architecture Snapshot

```
Claude Code
  │
  ├─ SessionStart   → 1-context-start.js    → inject bd prime + open issues
  ├─ UserPromptSubmit → 2-context-before-agent.js → rehydrate / inject reminder
  ├─ PreToolUse (async) → 7-context-after-tool.js → trace tool call
  ├─ PostToolUse (async) → 7-context-after-tool.js → trace tool result
  ├─ PreCompact     → 3-context-precompress.js → write rehydrate marker
  ├─ Stop (async)   → 6-context-after-agent.js → trace final response
  └─ SessionEnd (async) → 5-context-end.js   → cleanup
```

The hooks do two jobs: inject the right working context back into the model, and persist a structured prompt tree you can inspect later with Beads.

## Docs Map

- [Setup Overview](setup.md) — prerequisites, stealth mode, Dolt backend options.
- [Claude Code Setup](setup-claude.md) — hook config, stealth init, verification.
- [Architecture](docs/architecture.md) — hook flow, persistence model, compaction behavior.
- [Trace Model](docs/trace-model.md) — trace issue types, helper files, environment variables.
- [ADR 001](docs/adr/001-bead-hook-persistence-model.md) — why Beads + hooks is the persistence model.
- [ADR 002](docs/adr/002-ordered-sequence-loading.md) — why rehydration is summary- and dependency-aware.
- [ADR 003](docs/adr/003-deterministic-policy-hooks.md) — why deterministic hooks sit outside the model loop.

## Benchmark Results

Evaluated on [LongMemEval](https://arxiv.org/abs/2410.10813) (ICLR 2025) — 400 questions across six long-term memory abilities, using Claude Sonnet 4.6 via AWS Bedrock.

| Condition | Accuracy | Avg Input Tokens |
|---|---|---|
| Baseline — full conversation context | 59.5% | 115,660 |
| **ContextWeave — bead retrieval** | **68.2%** | **102,791** |

**+8.7 percentage points accuracy at 11% lower token cost.**

| Question Type | Baseline | ContextWeave | Delta |
|---|---|---|---|
| single-session-user | 80% | **94%** | +14pp |
| single-session-assistant | 93% | 93% | — |
| single-session-preference | 17% | **57%** | +40pp |
| multi-session | 57% | **65%** | +8pp |
| temporal-reasoning | 20% | **34%** | +14pp |
| knowledge-update | **78%** | 72% | −6pp |

The biggest gains are on preference recall (+40pp) and temporal reasoning (+14pp). The benchmark runner lives in [`benchmarks/longmemeval-ab/`](benchmarks/longmemeval-ab/).

## Implementation Notes

- Plain CommonJS scripts, no build step.
- `bd` must be on `PATH`.
- `SessionStart` matcher is `""` (empty) — fires on startup, resume, clear, and compact.
- Trace hooks (`PreToolUse`, `PostToolUse`, `Stop`, `SessionEnd`) run with `async: true` — non-blocking.
- `PreCompact` output becomes `customInstructions` for the compaction LLM, guiding it to preserve Beads state.
- Rehydration uses a `.needs_rehydrate` marker written by `3-context-precompress.js` and consumed by `2-context-before-agent.js`.
