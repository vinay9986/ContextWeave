# ContextWeave Setup for Gemini CLI

This guide wires Gemini CLI hook events to the scripts in this repository.

> Replace `/absolute/path/to/ContextWeave` with the absolute path to this repo.

## Repo-Root Scripts Used by Gemini

- `1-context-start.js`
- `2-context-before-agent.js`
- `3-context-precompress.js`
- `5-context-end.js`
- `6-context-after-agent.js`
- `7-context-after-tool.js`
- `8-context-after-model.js`
- `payload.js`
- `output.js`
- `trace-utils.js`
- `mappers/gemini.js`

`4-context-postcompress.js` is present in the repo as an optional helper, but it is not required by the default Gemini hook config below.

## Hook Behavior

### SessionStart

Injects:

- `bd prime --full`
- all prompt/final summaries
- open non-trace issues

### BeforeAgent

- logs the new prompt
- injects the post-compaction rehydration pack when `.beads/.needs_rehydrate` exists
- otherwise injects a strict reminder to persist durable work into Beads

### AfterAgent

- logs the final answer

### AfterTool

- logs tool call and tool result snippets

### AfterModel

- logs up to three intermediate output chunks per prompt

### PreCompress

- reminds the agent to update Beads before compaction
- writes `.beads/.needs_rehydrate` so the next prompt rehydrates context

### SessionEnd

- returns an empty JSON object

## `settings.json` Example

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
            "command": "HOOK_PROVIDER=gemini node /absolute/path/to/ContextWeave/1-context-start.js"
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
            "command": "HOOK_PROVIDER=gemini node /absolute/path/to/ContextWeave/2-context-before-agent.js"
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
            "command": "HOOK_PROVIDER=gemini node /absolute/path/to/ContextWeave/6-context-after-agent.js"
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
            "command": "HOOK_PROVIDER=gemini node /absolute/path/to/ContextWeave/7-context-after-tool.js"
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
            "command": "HOOK_PROVIDER=gemini node /absolute/path/to/ContextWeave/8-context-after-model.js"
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
            "command": "HOOK_PROVIDER=gemini node /absolute/path/to/ContextWeave/3-context-precompress.js"
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
            "command": "HOOK_PROVIDER=gemini node /absolute/path/to/ContextWeave/5-context-end.js"
          }
        ]
      }
    ]
  }
}
```

## Enabling the `search-beads` tool

The `search-beads` command lets Gemini search conversation history using natural language.
It works via Gemini's native shell tool — no MCP required.

```bash
# From the ContextWeave repo directory:
npm link
```

That's it. Gemini can now call `search-beads "<query>"` via its shell tool whenever
the truncated session summary isn't enough to answer a question.

## Notes

- Prompts remain open until a final response is logged.
- If Gemini emits a cancellation and a new prompt arrives, the prior prompt can be marked `interrupted`.
- Tool outputs are truncated snippets, not a full replay log.
- Provider mapping lives in [mappers/gemini.js](mappers/gemini.js).
- `bd pin` and `bd decision` are not standard Beads commands. Use labels instead:
  - `bd update <id> --add-label pinned`
  - `bd update <id> --add-label decision`
