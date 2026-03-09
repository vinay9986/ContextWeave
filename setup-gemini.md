# Beads Context Hooks (Gemini CLI)

This setup uses a **low‑overhead, trace‑focused flow**:

> Replace `/path/to/hooks` with the absolute path to your cloned hooks repo.

- **`bd prime`** = workflow memory (how to use Beads)
- **Trace logging** = prompt → tool call/result → intermediate chunks → final (snippets only)

## Files in this repo

Hook scripts (self-contained, no external script dependencies):
- `hooks/1-context-start.js`
- `hooks/2-context-before-agent.js`
- `hooks/6-context-after-agent.js`
- `hooks/7-context-after-tool.js`
- `hooks/8-context-after-model.js`
- `hooks/3-context-precompress.js`
- `hooks/4-context-postcompress.js`
- `hooks/5-context-end.js`
- `hooks/trace-utils.js`
- `hooks/payload.js` (provider mapper)
- `hooks/output.js` (provider-specific output)
- `hooks/mappers/gemini.js`

## Hook behavior (Gemini)

### SessionStart
Injects:
- `bd prime --full`
- **All prompt → final summaries** (oldest → newest)
- **Open issues** (non-trace)
Output format:
- `hookSpecificOutput.additionalContext` (model sees it)
- `systemMessage` (user-visible confirmation)

### BeforeAgent
Behavior:
- Logs the **prompt** to Beads (parent node).
- If compaction just occurred, rehydrates `bd prime --full` + context pack + recent summary.
Output format:
- `hookSpecificOutput.additionalContext`

### AfterAgent
Behavior:
- Logs the **final answer** to Beads (child of current prompt).
Output format:
- Silent (empty JSON).

### AfterTool
Behavior:
- Logs **tool call** and **tool result** to Beads (children of current prompt).
Output format:
- Silent (empty JSON).

### AfterModel
Behavior:
- Logs **intermediate output chunks** (limited to 3 per prompt).
Output format:
- Silent (empty JSON).

### PreCompress
Injects:
- reminder to update Beads memory before compaction
- writes `.beads/.needs_rehydrate` so the next prompt rehydrates after compaction

### SessionEnd
Injects:
- (silent) outputs empty JSON (no user-visible message)

## settings.json (Gemini CLI)

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
            "command": "HOOK_PROVIDER=gemini node /path/to/hooks/1-context-start.js"
          }
        ]
      }
    ],
    "BeforeAgent": [
      {
        "matcher": "*",
        "hooks": [
          {
            "name": "beads-context-before-agent",
            "type": "command",
            "command": "HOOK_PROVIDER=gemini node /path/to/hooks/2-context-before-agent.js"
          }
        ]
      }
    ],
    "AfterAgent": [
      {
        "matcher": "*",
        "hooks": [
          {
            "name": "beads-context-after-agent",
            "type": "command",
            "command": "HOOK_PROVIDER=gemini node /path/to/hooks/6-context-after-agent.js"
          }
        ]
      }
    ],
    "AfterTool": [
      {
        "matcher": "*",
        "hooks": [
          {
            "name": "beads-context-after-tool",
            "type": "command",
            "command": "HOOK_PROVIDER=gemini node /path/to/hooks/7-context-after-tool.js"
          }
        ]
      }
    ],
    "AfterModel": [
      {
        "matcher": "*",
        "hooks": [
          {
            "name": "beads-context-after-model",
            "type": "command",
            "command": "HOOK_PROVIDER=gemini node /path/to/hooks/8-context-after-model.js"
          }
        ]
      }
    ],
    "PreCompress": [
      {
        "matcher": "*",
        "hooks": [
          {
            "name": "beads-context-precompress",
            "type": "command",
            "command": "HOOK_PROVIDER=gemini node /path/to/hooks/3-context-precompress.js"
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
            "command": "HOOK_PROVIDER=gemini node /path/to/hooks/5-context-end.js"
          }
        ]
      }
    ]
  }
}
```

## Notes

- Prompts stay **open** until a final response is logged. When a new prompt starts while the previous prompt has no final, the prior prompt is labeled `interrupted`, annotated with the last child snippet, and closed.
- If a **Request cancelled** event appears in the transcript between prompts, the prior prompt is marked `interrupted` even if it emitted partial output.
- Trace logging writes issues with labels: `trace`, `prompt`, `tool_call`, `tool_result`, `intermediate`, `final`.
- Tool outputs are **truncated snippets**; rerun tools to recover full output if needed.
- Beads v0.49.1 does **not** have `bd pin` or `bd decision`. Use:
  - Pinned memory: `bd update <id> --add-label pinned`
  - Decisions: `bd update <id> --add-label decision` (or create with that label)
