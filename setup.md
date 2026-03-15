# ContextWeave Setup

ContextWeave is a set of Node hook scripts that expect:

- `bd` on `PATH`
- a Beads workspace initialized in the project you want to augment
- Node.js 18+

## Prerequisites

Initialize Beads in the target workspace if needed:

```bash
bd init --prefix CW
```

## Install

Clone the repo, run the installer, then delete the repo — you will not need it again.

```bash
git clone https://github.com/your-org/ContextWeave
cd ContextWeave
node install.js
```

The installer:
1. Copies all hook scripts to `~/.contextweave/`
2. Installs npm dependencies inside `~/.contextweave/`
3. Links `search-beads` onto your PATH via `npm link`
4. Downloads the `all-MiniLM-L6-v2` ONNX embedding model (~90 MB) to `~/.cache/contextweave-onnx`
5. Prints the exact hook config block to paste into your provider settings

After the installer finishes, paste the printed config into your provider settings file and delete the repo.

## Choose a Provider Guide

- [setup-claude.md](setup-claude.md) — Claude Code
- [setup-gemini.md](setup-gemini.md) — Gemini CLI

## Shared Behavior

Both providers use the same scripts from `~/.contextweave/`:

- prompt logging
- tool call and tool result logging
- final response logging
- `bd prime --full` context injection at session start
- post-compaction rehydration via `.beads/.needs_rehydrate`
- `search-beads` semantic retrieval via the native Bash/shell tool

The only major runtime difference is that Gemini can log intermediate model chunks and Claude cannot in this setup.

## Updating

To update ContextWeave, clone the repo again and re-run `node install.js`. The installer overwrites `~/.contextweave/` in place. The ONNX model cache is preserved.

## What gets installed

| Path | Contents |
| --- | --- |
| `~/.contextweave/` | Hook scripts, mappers, support files, `node_modules/` |
| `~/.contextweave/bin/search-beads` | Semantic search CLI (linked to PATH via npm link) |
| `~/.cache/contextweave-onnx/` | ONNX embedding model cache (`all-MiniLM-L6-v2`) |
