# ContextWeave Setup for Claude Code

Run the installer from the repo root first (see [setup.md](setup.md)):

```bash
node install.js
```

The installer prints the exact JSON block to paste into `~/.claude/settings.json`. Copy it in — no path editing required; the installer substitutes your actual home directory.

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
            "command": "node ~/.contextweave/1-context-start.js"
          }
        ]
      }
    ],
    "UserPromptSubmit": [
      {
        "matcher": "*",
        "hooks": [
          {
            "name": "contextweave-before-agent",
            "type": "command",
            "command": "node ~/.contextweave/2-context-before-agent.js"
          }
        ]
      }
    ],
    "PreToolUse": [
      {
        "matcher": "*",
        "hooks": [
          {
            "name": "contextweave-tool",
            "type": "command",
            "command": "node ~/.contextweave/7-context-after-tool.js"
          }
        ]
      }
    ],
    "PostToolUse": [
      {
        "matcher": "*",
        "hooks": [
          {
            "name": "contextweave-tool",
            "type": "command",
            "command": "node ~/.contextweave/7-context-after-tool.js"
          }
        ]
      }
    ],
    "PostToolUseFailure": [
      {
        "matcher": "*",
        "hooks": [
          {
            "name": "contextweave-tool",
            "type": "command",
            "command": "node ~/.contextweave/7-context-after-tool.js"
          }
        ]
      }
    ],
    "PreCompact": [
      {
        "matcher": "*",
        "hooks": [
          {
            "name": "contextweave-precompress",
            "type": "command",
            "command": "node ~/.contextweave/3-context-precompress.js"
          }
        ]
      }
    ],
    "Stop": [
      {
        "matcher": "*",
        "hooks": [
          {
            "name": "contextweave-after-agent",
            "type": "command",
            "command": "node ~/.contextweave/6-context-after-agent.js"
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
            "command": "node ~/.contextweave/5-context-end.js"
          }
        ]
      }
    ]
  }
}
```

## What Claude Captures

- Prompt: `UserPromptSubmit`
- Tool call: `PreToolUse`
- Tool result: `PostToolUse` and `PostToolUseFailure`
- Final response: `Stop`
- Intermediate output: not available from Claude in this setup

## The `search-beads` tool

`search-beads` is linked onto your PATH by the installer. Claude can call it via its
native Bash tool — no MCP required. It uses four-stage ONNX semantic retrieval
(`all-MiniLM-L6-v2`) to find the most relevant past exchange when the session
summary is not enough to answer a question.

## Optional JSON Output for `UserPromptSubmit`

Claude defaults to plain-text-safe output for `UserPromptSubmit`. If you need JSON
output there, set `CLAUDE_HOOK_MODE=json` on that command:

```json
{
  "name": "contextweave-before-agent",
  "type": "command",
  "command": "CLAUDE_HOOK_MODE=json node ~/.contextweave/2-context-before-agent.js"
}
```

## Notes

- Prompt, tool, and final records are stored as parent/child Beads issues under the current prompt.
- If a new prompt starts before the previous one is finalized, the earlier prompt is labeled `interrupted`.
- Tool outputs are truncated snippets, not full payload archives.
- Provider mapping lives in `~/.contextweave/mappers/claude.js`.
- Session start injects `bd prime --full`, all prompt/final summaries, and open non-trace issues.
- `8-context-after-model.js` is present but has no Claude binding — Claude Code does not expose a streaming intermediate-chunk event. It is used by Gemini CLI (`AfterModel`) only.
