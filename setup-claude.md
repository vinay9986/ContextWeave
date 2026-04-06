# ContextWeave — Claude Code Setup

ContextWeave hooks into Claude Code's lifecycle to persist traces into Beads and rehydrate working context after compaction.

---

## Prerequisites

- **Beads CLI** installed and `bd` on your PATH
- **Node.js** (any modern version)

---

## Step 1 — Install ContextWeave

From this repo:

```bash
node install.js
```

This copies all hook scripts to `~/.contextweave/`, installs dependencies, and links `search-beads` onto your PATH.

---

## Step 2 — Initialize Beads in Stealth Mode (per project)

Stealth mode runs Beads locally without git integration — ideal for personal use on shared or open-source projects.

```bash
cd /path/to/your/project
BEADS_DIR="$(pwd)/.beads" bd init --quiet --stealth
echo ".beads/" >> .gitignore
```

`BEADS_DIR` tells Beads where to store the database (in `--stealth` mode git discovery is disabled, so you must specify the path explicitly). ContextWeave detects `.beads/` in the project root and enables tracing automatically.

> **Persistent access:** `bd` commands run in Claude Code hooks inherit Claude's shell environment. If you want to run `bd` commands in your own terminal too (e.g. `bd list`, `bd prime`), export `BEADS_DIR` in your shell profile for that project or use a tool like `direnv`:
> ```bash
> # .envrc (direnv)
> export BEADS_DIR="$(pwd)/.beads"
> ```

---

## Step 3 — Add Hooks to Claude Code

Merge the following into `~/.claude/settings.json` (under the top-level `"hooks"` key). Running `node install.js` prints the exact snippet with your real install path:

```json
{
  "hooks": {
    "SessionStart": [
      { "matcher": "", "hooks": [{ "type": "command", "command": "node ~/.contextweave/1-context-start.js" }] }
    ],
    "UserPromptSubmit": [
      { "matcher": "*", "hooks": [{ "type": "command", "command": "node ~/.contextweave/2-context-before-agent.js" }] }
    ],
    "PreToolUse": [
      { "matcher": "*", "hooks": [{ "type": "command", "async": true, "command": "node ~/.contextweave/7-context-after-tool.js" }] }
    ],
    "PostToolUse": [
      { "matcher": "*", "hooks": [{ "type": "command", "async": true, "command": "node ~/.contextweave/7-context-after-tool.js" }] }
    ],
    "PostToolUseFailure": [
      { "matcher": "*", "hooks": [{ "type": "command", "async": true, "command": "node ~/.contextweave/7-context-after-tool.js" }] }
    ],
    "PreCompact": [
      { "matcher": "*", "hooks": [{ "type": "command", "command": "node ~/.contextweave/3-context-precompress.js" }] }
    ],
    "Stop": [
      { "matcher": "*", "hooks": [{ "type": "command", "async": true, "command": "node ~/.contextweave/6-context-after-agent.js" }] }
    ],
    "SessionEnd": [
      { "matcher": "*", "hooks": [{ "type": "command", "async": true, "command": "node ~/.contextweave/5-context-end.js" }] }
    ]
  }
}
```

**Key design decisions:**
- `SessionStart` uses `matcher: ""` (empty) so it fires on ALL session starts: `startup`, `resume`, `clear`, and `compact`. This is critical — a `"startup"` matcher silently skips context injection after compaction restarts.
- Trace-only hooks (`PreToolUse`, `PostToolUse`, `Stop`, `SessionEnd`) are `async: true` so they don't add latency to every tool call.
- `PreCompact` output becomes `customInstructions` for the compaction LLM, guiding it to preserve Beads state in its summary.

---

## Step 4 — Verify with Doctor Script

Run the doctor from your project directory to verify everything is wired correctly:

```bash
cd /path/to/your/project
node ~/.contextweave/doctor.js
```

It checks:
- Prerequisites (Node.js, bd CLI)
- All scripts installed in `~/.contextweave/`
- `~/.claude/settings.json` hook config (correct matchers, async flags, script paths)
- Beads workspace initialized in the current directory
- Dry-runs all hook scripts with mock Claude payloads to verify exit 0

Then restart Claude Code in the project — on session start you should see a system reminder with your Beads context (`bd prime --full` output + open issues).

---

## Dolt Backend

Beads is powered by Dolt (a version-controlled SQL database).

### Embedded Mode (default)

No configuration needed. Dolt runs in-process with data stored at `.beads/embeddeddolt/`. Single-writer only, file-locked.

### Server Mode (multi-writer)

Connect to an external `dolt sql-server` for multi-writer support:

```bash
export BEADS_DOLT_SERVER_HOST=localhost
export BEADS_DOLT_SERVER_PORT=3307   # default
```

Start a Dolt server:
```bash
dolt sql-server --port 3307
```

---

## How It Works

| Hook | Event | Purpose |
|------|-------|---------|
| `1-context-start.js` | SessionStart | Injects `bd prime` output + open issues into session |
| `2-context-before-agent.js` | UserPromptSubmit | Rehydrates after compact, injects Beads reminder |
| `7-context-after-tool.js` | Pre/PostToolUse | Logs tool calls to Beads (async, non-blocking) |
| `3-context-precompress.js` | PreCompact | Writes `.needs_rehydrate` marker; guides compaction LLM |
| `6-context-after-agent.js` | Stop | Logs final response to Beads (async) |
| `5-context-end.js` | SessionEnd | No-op cleanup (async) |

### Compaction & Rehydration

When `/compact` runs:
1. `3-context-precompress.js` writes `.needs_rehydrate` in the session state dir
2. The compaction LLM receives instructions to preserve Beads issue IDs in its summary
3. On the next prompt after restart, `2-context-before-agent.js` detects `.needs_rehydrate`, injects a full context pack, and removes the marker

---

## search-beads

The `search-beads` binary (installed to PATH) performs semantic search over your Beads store using an ONNX embedding model (~90 MB, auto-downloaded on first install). Claude can invoke it directly:

```
search-beads "authentication refactor"
```
