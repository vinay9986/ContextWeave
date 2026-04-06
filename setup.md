# ContextWeave Setup

ContextWeave is a set of Node hook scripts for **Claude Code only**. It persists session traces to Beads and rehydrates context after compaction.

## Prerequisites

- `bd` (Beads CLI) on your PATH
- Node.js 18+
- Claude Code

## Step 1 — Install

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
5. Prints the exact hook config block to paste into `~/.claude/settings.json`

## Step 2 — Initialize Beads in Stealth Mode (per project)

Run this in each project you want to track:

```bash
cd /path/to/project
BEADS_DIR="$(pwd)/.beads" bd init --quiet --stealth
echo ".beads/" >> .gitignore
```

`BEADS_DIR` tells Beads where to put the database. In `--stealth` mode, git discovery is disabled, so you must set it explicitly. ContextWeave detects `.beads/` automatically and enables tracking for that project.

## Step 3 — Configure Hooks

See [setup-claude.md](setup-claude.md) for the full hook configuration and verification steps.

## Updating

Re-clone and re-run `node install.js`. The installer overwrites `~/.contextweave/` in place. The ONNX model cache is preserved.

## What Gets Installed

| Path | Contents |
|------|----------|
| `~/.contextweave/` | Hook scripts, mappers, support files, `node_modules/` |
| `~/.contextweave/bin/search-beads` | Semantic search CLI (linked to PATH via npm link) |
| `~/.cache/contextweave-onnx/` | ONNX embedding model cache (`all-MiniLM-L6-v2`) |
