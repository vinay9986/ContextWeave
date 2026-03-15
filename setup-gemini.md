# ContextWeave Setup for Gemini CLI

Run the installer from the repo root first (see [setup.md](setup.md)):

```bash
node install.js
```

The installer prints the exact JSON block to paste into `~/.gemini/settings.json`. Copy it in — no path editing required; the installer substitutes your actual home directory.

## Hook Bindings

The printed block wires these events:

```json
{
  "hooks": {
    "SessionStart": [
      {
        "matcher": "startup",
        "hooks": [
          {
            "name": "contextweave-start",
            "type": "command",
            "command": "HOOK_PROVIDER=gemini node ~/.contextweave/1-context-start.js"
          }
        ]
      }
    ],
    "BeforeAgent": [
      {
        "matcher": "*",
        "hooks": [
          {
            "name": "contextweave-before-agent",
            "type": "command",
            "command": "HOOK_PROVIDER=gemini node ~/.contextweave/2-context-before-agent.js"
          }
        ]
      }
    ],
    "AfterAgent": [
      {
        "matcher": "*",
        "hooks": [
          {
            "name": "contextweave-after-agent",
            "type": "command",
            "command": "HOOK_PROVIDER=gemini node ~/.contextweave/6-context-after-agent.js"
          }
        ]
      }
    ],
    "AfterTool": [
      {
        "matcher": "*",
        "hooks": [
          {
            "name": "contextweave-after-tool",
            "type": "command",
            "command": "HOOK_PROVIDER=gemini node ~/.contextweave/7-context-after-tool.js"
          }
        ]
      }
    ],
    "AfterModel": [
      {
        "matcher": "*",
        "hooks": [
          {
            "name": "contextweave-after-model",
            "type": "command",
            "command": "HOOK_PROVIDER=gemini node ~/.contextweave/8-context-after-model.js"
          }
        ]
      }
    ],
    "PreCompress": [
      {
        "matcher": "*",
        "hooks": [
          {
            "name": "contextweave-precompress",
            "type": "command",
            "command": "HOOK_PROVIDER=gemini node ~/.contextweave/3-context-precompress.js"
          }
        ]
      }
    ],
    "SessionEnd": [
      {
        "matcher": "*",
        "hooks": [
          {
            "name": "contextweave-end",
            "type": "command",
            "command": "HOOK_PROVIDER=gemini node ~/.contextweave/5-context-end.js"
          }
        ]
      }
    ]
  }
}
```

## Hook Behavior

### SessionStart
Injects `bd prime --full`, all prompt/final summaries, and open non-trace issues.

### BeforeAgent
- Logs the new prompt
- Injects the post-compaction rehydration pack when `.beads/.needs_rehydrate` exists
- Otherwise injects a strict reminder to persist durable work into Beads

### AfterAgent
Logs the final answer.

### AfterTool
Logs tool call and tool result snippets.

### AfterModel
Logs up to three intermediate output chunks per prompt.

### PreCompress
- Reminds the agent to update Beads before compaction
- Writes `.beads/.needs_rehydrate` so the next prompt rehydrates context

### SessionEnd
Returns an empty JSON object.

## The `search-beads` tool

`search-beads` is linked onto your PATH by the installer. Gemini can call it via its
native shell tool — no MCP required. It uses four-stage ONNX semantic retrieval
(`all-MiniLM-L6-v2`) to find the most relevant past exchange when the session
summary is not enough to answer a question.

## Notes

- Prompts remain open until a final response is logged.
- If Gemini emits a cancellation and a new prompt arrives, the prior prompt can be marked `interrupted`.
- Tool outputs are truncated snippets, not a full replay log.
- Provider mapping lives in `~/.contextweave/mappers/gemini.js`.
- `bd pin` and `bd decision` are not standard Beads commands. Use labels instead:
  - `bd update <id> --add-label pinned`
  - `bd update <id> --add-label decision`
