# ContextWeave Setup

ContextWeave is a set of Node hook scripts that expect:

- `bd` on `PATH`
- a Beads workspace initialized in the project you want to augment
- a local clone of this repo, referenced by absolute path in the provider hook config

## Prerequisites

Initialize Beads in the target workspace if needed:

```bash
bd init --prefix CW
```

Make sure the provider can execute commands such as:

```bash
node /absolute/path/to/ContextWeave/1-context-start.js
```

## Choose a Provider Guide

- [setup-gemini.md](setup-gemini.md)
- [setup-claude.md](setup-claude.md)

## Shared Behavior

Both providers use the same underlying scripts:

- prompt logging
- tool call and tool result logging
- final response logging
- `bd prime --full` context injection at session start
- post-compaction rehydration via `.beads/.needs_rehydrate`

The only major runtime difference is that Gemini can log intermediate model chunks and Claude cannot in this setup.

Gemini commands in this repo explicitly set `HOOK_PROVIDER=gemini` so the output stays JSON-shaped. Claude can optionally use `CLAUDE_HOOK_MODE=json`, but the default path is plain-text-safe output for `UserPromptSubmit`.
