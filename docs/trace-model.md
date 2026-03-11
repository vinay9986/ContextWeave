# ContextWeave Trace Model

## Trace Record Types

`trace-utils.js` writes a prompt tree into Beads. The main record types are:

| Label | Source | Parent |
| --- | --- | --- |
| `prompt` | `2-context-before-agent.js` | none |
| `tool_call` | `7-context-after-tool.js` | current prompt |
| `tool_result` | `7-context-after-tool.js` | current prompt |
| `intermediate` | `8-context-after-model.js` | current prompt |
| `final` | `6-context-after-agent.js` | current prompt |
| `interrupted` | added by `logPrompt()` when the previous prompt never completed | prompt itself |

All trace nodes also carry the `trace` label.

## Stored Notes Payload

Trace notes are JSON strings. Depending on the record type, they can include:

- `trace_kind`
- `prompt_seq`
- `step_seq`
- `chunk_index`
- `tool_name`
- `session_id`
- `timestamp`
- `snippet`
- `truncated`
- `error`
- interruption metadata for incomplete prompts

## Truncation Limits

The current hard-coded limits in [../trace-utils.js](../trace-utils.js) are:

| Field | Limit |
| --- | --- |
| prompt snippet | 1200 chars |
| final snippet | 1200 chars |
| tool snippet | 1000 chars |
| intermediate snippet | 600 chars |
| recent summary count | 5 prompts |
| intermediate chunks per prompt | 3 |

## Helper Files and Markers

| Path | Purpose |
| --- | --- |
| `.beads/.trace_state.json` | Sequence counters plus current prompt tracking. |
| `.beads/.needs_rehydrate` | Signals that the next prompt should inject a rehydration pack. |
| `.beads/.beads_bootstrap_done` | Suppresses the one-time bootstrap reminder after the first write. |

## Environment Variables

| Variable | Purpose |
| --- | --- |
| `HOOK_PROVIDER` | Forces provider detection. Required for the Gemini setup commands in this repo. |
| `CLAUDE_HOOK_MODE` | When set to `json`, Claude `UserPromptSubmit` output uses JSON instead of plain text. |

## Script Inventory

| File | Purpose |
| --- | --- |
| [../1-context-start.js](../1-context-start.js) | Session-start injection |
| [../2-context-before-agent.js](../2-context-before-agent.js) | Prompt logging, reminders, and post-compaction rehydration |
| [../3-context-precompress.js](../3-context-precompress.js) | Pre-compaction reminder and marker write |
| [../4-context-postcompress.js](../4-context-postcompress.js) | Optional post-compaction helper |
| [../5-context-end.js](../5-context-end.js) | Session-end no-op |
| [../6-context-after-agent.js](../6-context-after-agent.js) | Final-response logging |
| [../7-context-after-tool.js](../7-context-after-tool.js) | Tool-call and tool-result logging |
| [../8-context-after-model.js](../8-context-after-model.js) | Intermediate chunk logging |
| [../payload.js](../payload.js) | Provider detection and payload normalization |
| [../output.js](../output.js) | Provider-specific context-injection output |
| [../trace-utils.js](../trace-utils.js) | Shared Beads and trace logic |

## Inspecting a Prompt Tree

Use Beads directly:

```bash
bd show <prompt_id>
bd list --all --parent <prompt_id> --sort created --reverse --limit 0
```

Useful high-level views:

```bash
bd list --all --label trace --sort created --reverse --limit 20
bd list --status open --sort created --reverse --limit 20
```

## Provider Differences

- Gemini can log intermediate chunks through `AfterModel`.
- Claude does not expose an equivalent intermediate-output hook in this setup.
- Claude defaults to plain-text-safe injection for `UserPromptSubmit`; Gemini uses JSON hook output.
