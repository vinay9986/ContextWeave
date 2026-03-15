# ContextWeave Setup for Claude Code

This guide wires Claude Code hook events to the scripts in this repository.

> Replace `/absolute/path/to/ContextWeave` with the absolute path to this repo.

## What Claude Captures

- Prompt: `UserPromptSubmit`
- Tool call: `PreToolUse`
- Tool result: `PostToolUse` and `PostToolUseFailure`
- Final response: `Stop`
- Intermediate output: not available from Claude in this setup

## Hook Bindings

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
            "command": "node /absolute/path/to/ContextWeave/1-context-start.js"
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
            "command": "node /absolute/path/to/ContextWeave/2-context-before-agent.js"
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
            "command": "node /absolute/path/to/ContextWeave/7-context-after-tool.js"
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
            "command": "node /absolute/path/to/ContextWeave/7-context-after-tool.js"
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
            "command": "node /absolute/path/to/ContextWeave/7-context-after-tool.js"
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
            "command": "node /absolute/path/to/ContextWeave/3-context-precompress.js"
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
            "command": "node /absolute/path/to/ContextWeave/6-context-after-agent.js"
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
            "command": "node /absolute/path/to/ContextWeave/5-context-end.js"
          }
        ]
      }
    ]
  }
}
```

## Enabling the `search-beads` tool

The `search-beads` command lets Claude search conversation history using natural language.
It works via Claude's native Bash tool — no MCP required.

```bash
# From the ContextWeave repo directory:
npm link
```

That's it. Claude can now call `search-beads "<query>"` via its Bash tool whenever
the truncated session summary isn't enough to answer a question.

## Notes

- Prompt, tool, and final records are stored as parent/child Beads issues under the current prompt.
- If a new prompt starts before the previous one is finalized, the earlier prompt is labeled `interrupted`.
- Tool outputs are truncated snippets, not full payload archives.
- Provider mapping lives in [mappers/claude.js](mappers/claude.js).
- Session start injects `bd prime --full`, all prompt/final summaries, and open non-trace issues.
- `8-context-after-model.js` exists in the repo but has no Claude binding — Claude Code does not expose a streaming intermediate-chunk event. It is used by Gemini CLI (`AfterModel`) only.

## Optional JSON Output for `UserPromptSubmit`

Claude defaults to plain-text-safe output for `UserPromptSubmit`. If you need JSON output there, set `CLAUDE_HOOK_MODE=json` on that command:

```json
{
  "name": "contextweave-before-agent",
  "type": "command",
  "command": "CLAUDE_HOOK_MODE=json node /absolute/path/to/ContextWeave/2-context-before-agent.js"
}
```
