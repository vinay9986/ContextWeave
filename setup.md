# Beads Context Hooks

Choose your provider-specific setup:

- `setup-gemini.md` — Gemini CLI events and settings
- `setup-claude.md` — Claude Code events and settings

Both providers use the same hook scripts and Beads trace model. Provider payloads are normalized in `payload.js` and `mappers/`.
- Prompts stay **open** until a final response is logged. When a new prompt starts while the previous prompt has no final, the prior prompt is labeled `interrupted`, annotated with the last child snippet, and closed.

Gemini CLI should set `HOOK_PROVIDER=gemini` in each hook command to ensure JSON output (otherwise hooks may fall back to Claude-safe plain text).
