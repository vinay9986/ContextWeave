"""
Condition B — ContextWeave runner for LongMemEval.

Replicates exactly what ContextWeave does in production:

  1. Ingest all conversation sessions into beads (truncated summaries).

  2. Inject the session-start context block — the truncated CONVERSATION
     HISTORY summary that 1-context-start.js builds, including the
     `search-beads "<query>"` instruction.

  3. Expose a Bash tool — the LLM calls `search-beads "<query>"` to retrieve
     the full content of the most relevant past exchange.

  4. Handle the tool-use loop until the model produces a final answer.

This faithfully mirrors real ContextWeave: bounded context, structured
retrieval advertised as a Bash command, LLM-driven decision-making.
"""

from __future__ import annotations

import re

import boto3

from config import CONTEXTWEAVE_TOP_K, MAX_TOKENS, MODEL_ID, TEMPERATURE
from contextweave.bead_store import BeadStore

# ── Tool definition ────────────────────────────────────────────────────────────

_BASH_TOOL = {
    "toolSpec": {
        "name": "Bash",
        "description": (
            "Execute a shell command. Use `search-beads \"<query>\"` to search "
            "the ContextWeave bead store when the CONVERSATION HISTORY summary "
            "does not contain enough detail to answer the question."
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

When answering the question below:
- First check if the CONVERSATION HISTORY summary above contains the answer.
- If the summary is insufficient or truncated, use the Bash tool to run
  `search-beads "<query>"` to retrieve the full content of the relevant exchange.
  Make your query as specific as possible — include all distinguishing details.
- Answer concisely. Give only the answer, no preamble.\
"""

_SEARCH_BEADS_RE = re.compile(
    r"""search-beads\s+(?:"([^"]+)"|'([^']+)'|(.+))""",
    re.IGNORECASE,
)

_MAX_TOOL_ROUNDS = 3


def _extract_search_query(command: str) -> str | None:
    m = _SEARCH_BEADS_RE.search(command)
    if not m:
        return None
    return (m.group(1) or m.group(2) or m.group(3) or "").strip()


def run_contextweave(
    sample: dict,
    client: boto3.client,
) -> tuple[str, int, dict]:
    """
    Run the ContextWeave condition on a single LongMemEval sample.

    Args:
        sample:  Normalised sample from data.loader.
        client:  boto3 bedrock-runtime client.

    Returns:
        Tuple of (model_response_text, tool_calls_made, usage_dict).
    """
    # ── 1. Ingest sessions into bead store ─────────────────────────────────────
    store = BeadStore()
    store.ingest(sample["sessions"])

    # ── 2. Build session-start context ────────────────────────────────────────
    session_context = store.build_session_context()
    system_prompt = _SYSTEM_TEMPLATE.format(session_context=session_context)

    # ── 3. Start with the question ────────────────────────────────────────────
    messages = [
        {"role": "user", "content": [{"text": sample["question"]}]}
    ]

    tool_calls_made = 0
    total_usage = {"inputTokens": 0, "outputTokens": 0, "totalTokens": 0}

    # ── 4. Agentic loop ───────────────────────────────────────────────────────
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
        for k in total_usage:
            total_usage[k] += response.get("usage", {}).get(k, 0)

        if not output_msg.get("content"):
            break

        messages.append(output_msg)

        if stop_reason == "end_turn":
            for block in output_msg.get("content", []):
                if "text" in block:
                    return block["text"], tool_calls_made, total_usage
            return "", tool_calls_made, total_usage

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
                        beads = store.search(query, top_k=CONTEXTWEAVE_TOP_K)
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

            if not tool_results:
                break

            messages.append({
                "role": "user",
                "content": [{"toolResult": r} for r in tool_results],
            })

    # Exceeded max rounds — return whatever text we have
    for msg in reversed(messages):
        if msg.get("role") == "assistant":
            for block in msg.get("content", []):
                if "text" in block:
                    return block["text"], tool_calls_made, total_usage

    return "", tool_calls_made, total_usage
