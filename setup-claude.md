# Beads Context Hooks (Claude Code)

This setup reuses the same hook scripts but **Claude’s event names and payloads differ**, so the hook bindings are different.

> Replace `/path/to/hooks` with the absolute path to your cloned hooks repo.

## Supported trace capture (Claude)
- **Prompt**: `UserPromptSubmit`
- **Tool call**: `PreToolUse`
- **Tool result**: `PostToolUse` and `PostToolUseFailure`
- **Final response**: `Stop`
- **Intermediate output**: not available via hooks (Claude does not emit chunk events)

## Hook bindings (Claude Code)

```json
{
  "hooks": {
    "SessionStart": [
      {
        "matcher": "startup",
        "hooks": [
          {
            "name": "beads-context-start",
            "type": "command",
            "command": "node /path/to/hooks/1-context-start.js"
          }
        ]
      }
    ],
    "UserPromptSubmit": [
      {
        "matcher": "*",
        "hooks": [
          {
            "name": "beads-context-before-agent",
            "type": "command",
            "command": "node /path/to/hooks/2-context-before-agent.js"
          }
        ]
      }
    ],
    "PreToolUse": [
      {
        "matcher": "*",
        "hooks": [
          {
            "name": "beads-context-after-tool",
            "type": "command",
            "command": "node /path/to/hooks/7-context-after-tool.js"
          }
        ]
      }
    ],
    "PostToolUse": [
      {
        "matcher": "*",
        "hooks": [
          {
            "name": "beads-context-after-tool",
            "type": "command",
            "command": "node /path/to/hooks/7-context-after-tool.js"
          }
        ]
      }
    ],
    "PostToolUseFailure": [
      {
        "matcher": "*",
        "hooks": [
          {
            "name": "beads-context-after-tool",
            "type": "command",
            "command": "node /path/to/hooks/7-context-after-tool.js"
          }
        ]
      }
    ],
    "PreCompact": [
      {
        "matcher": "*",
        "hooks": [
          {
            "name": "beads-context-precompress",
            "type": "command",
            "command": "node /path/to/hooks/3-context-precompress.js"
          }
        ]
      }
    ],
    "Stop": [
      {
        "matcher": "*",
        "hooks": [
          {
            "name": "beads-context-after-agent",
            "type": "command",
            "command": "node /path/to/hooks/6-context-after-agent.js"
          }
        ]
      }
    ],
    "SessionEnd": [
      {
        "matcher": "*",
        "hooks": [
          {
            "name": "beads-context-end",
            "type": "command",
            "command": "node /path/to/hooks/5-context-end.js"
          }
        ]
      }
    ]
  }
}
```

## Notes

- Prompt/Tool/Final are logged as **parent/child** issues under the prompt.
- If a prompt is interrupted (no final and a new prompt arrives), it’s labeled `interrupted` and closed.
- Tool outputs are **truncated snippets**; rerun tools to recover full output if needed.
- Provider mapping lives in `hooks/mappers/claude.js`.
- SessionStart injects `bd prime --full`, **all prompt → final summaries**, and **open issues** (non-trace).
- SessionStart and UserPromptSubmit default to **plain-text injection** for Claude (to avoid strict JSON validation errors and to ensure context is injected). If you want JSON output for UserPromptSubmit, set `CLAUDE_HOOK_MODE=json` on that hook command.
