"""
Condition B — ContextWeave runner (faithful simulation).

Replicates exactly what ContextWeave does in production:

  1. Ingest the MRCR conversation into beads (prompt + final, truncated to
     ContextWeave's 1200-char limits).

  2. Inject the session-start context block — the same truncated
     CONVERSATION HISTORY summary that 1-context-start.js builds, including
     the `search-beads "<query>"` instruction that points to the Bash tool.

  3. Expose a `Bash` tool — the LLM calls `search-beads "<query>"` exactly as
     it would in production (Claude Code or Gemini CLI via their native shell
     tool).  The benchmark intercepts the command and delegates to the Python
     BeadStore so no actual subprocess is needed during the test.

  4. Let the LLM answer the retrieval query. It decides whether the truncated
     summary is sufficient or whether it needs to invoke search-beads.

  5. Handle the tool-use loop: call search → inject result → re-query until
     the model produces a final text answer.

This faithfully mirrors real ContextWeave: bounded context, structured
retrieval advertised as a Bash command, LLM-driven decision-making.
"""

from __future__ import annotations

import re

import boto3

from config import MAX_TOKENS, MODEL_ID, TEMPERATURE
from contextweave.bead_store import BeadStore

# ── Tool definition — Bash (matches Claude Code / Gemini CLI native tool) ─────

_BASH_TOOL = {
    "toolSpec": {
        "name": "Bash",
        "description": (
            "Execute a shell command. Use `search-beads \"<query>\"` to search "
            "the ContextWeave bead store when the CONVERSATION HISTORY summary "
            "does not contain enough detail to answer the query."
        ),
        "inputSchema": {
            "json": {
                "type": "object",
                "properties": {
                    "command": {
                        "type": "string",
                        "description": "The shell command to execute.",
                    }
                },
                "required": ["command"],
            }
        },
    }
}

_TOOL_CONFIG = {"tools": [_BASH_TOOL]}

_SYSTEM_TEMPLATE = """\
You are an AI assistant with access to a structured memory system called ContextWeave.
Your conversation history has been stored as beads — structured, retrievable units.

{session_context}

When answering the query below:
- First check if the CONVERSATION HISTORY summary above contains the answer.
- If the summary is insufficient (e.g. the content is truncated), use the Bash
  tool to run `search-beads "<query>"` and retrieve the full content of the
  relevant exchange.
- Reproduce the answer EXACTLY as it appeared, including any required prefix string.
- Do not include any other text in your response beyond what is asked.\
"""

# Parses: search-beads "some query" or search-beads 'some query' or search-beads some query
_SEARCH_BEADS_RE = re.compile(
    r"""search-beads\s+(?:"([^"]+)"|'([^']+)'|(.+))""",
    re.IGNORECASE,
)

# Max tool-use rounds before giving up
_MAX_TOOL_ROUNDS = 3


def _extract_search_query(command: str) -> str | None:
    """Extract the query string from a `search-beads "<query>"` command."""
    m = _SEARCH_BEADS_RE.search(command)
    if not m:
        return None
    return (m.group(1) or m.group(2) or m.group(3) or "").strip()


def run_contextweave(
    sample: dict,
    client: boto3.client,
) -> tuple[str, int]:
    """
    Run the ContextWeave condition on a single MRCR sample.

    Args:
        sample:  Normalised MRCR sample from data.loader.
        client:  boto3 bedrock-runtime client.

    Returns:
        Tuple of (model_response_text, tool_calls_made).
    """
    # ── 1. Ingest history into bead store ─────────────────────────────────────
    store = BeadStore()
    store.ingest(sample["history"])

    # ── 2. Build session-start context (mirrors 1-context-start.js) ───────────
    session_context = store.build_session_context()
    system_prompt = _SYSTEM_TEMPLATE.format(session_context=session_context)

    # ── 3. Start with just the retrieval query ────────────────────────────────
    messages = [
        {"role": "user", "content": [{"text": sample["query"]}]}
    ]

    tool_calls_made = 0

    # ── 4. Agentic loop: answer or search ─────────────────────────────────────
    for _ in range(_MAX_TOOL_ROUNDS + 1):
        response = client.converse(
            modelId=MODEL_ID,
            system=[{"text": system_prompt}],
            messages=messages,
            toolConfig=_TOOL_CONFIG,
            inferenceConfig={
                "maxTokens": MAX_TOKENS,
                "temperature": TEMPERATURE,
            },
        )

        output_msg = response["output"]["message"]
        stop_reason = response.get("stopReason", "")

        # Append model's response to messages for context continuity
        messages.append(output_msg)

        # ── Final text answer ──────────────────────────────────────────────────
        if stop_reason == "end_turn":
            for block in output_msg.get("content", []):
                if "text" in block:
                    return block["text"], tool_calls_made
            return "", tool_calls_made

        # ── Tool use requested ─────────────────────────────────────────────────
        if stop_reason == "tool_use":
            tool_results = []

            for block in output_msg.get("content", []):
                if "toolUse" not in block:
                    continue

                tool_use = block["toolUse"]
                tool_name = tool_use.get("name", "")
                tool_input = tool_use.get("input", {})
                tool_use_id = tool_use.get("toolUseId", "")

                if tool_name == "Bash":
                    command = tool_input.get("command", "")
                    query = _extract_search_query(command)
                    if query is not None:
                        # Delegate to Python BeadStore (simulates bin/search-beads)
                        beads = store.search(query, top_k=1)
                        result_text = store.format_search_result(beads)
                        tool_calls_made += 1
                    else:
                        result_text = f"Command not supported in benchmark: {command}"
                else:
                    result_text = f"Unknown tool: {tool_name}"

                tool_results.append({
                    "toolUseId": tool_use_id,
                    "content": [{"text": result_text}],
                })

            # Inject tool results and continue the loop
            messages.append({
                "role": "user",
                "content": [{"toolResult": r} for r in tool_results],
            })

    # Exceeded max rounds — return whatever text we have
    for msg in reversed(messages):
        if msg.get("role") == "assistant":
            for block in msg.get("content", []):
                if "text" in block:
                    return block["text"], tool_calls_made

    return "", tool_calls_made
