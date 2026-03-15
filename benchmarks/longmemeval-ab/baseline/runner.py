"""
Condition A — Baseline runner.

Strategy: concatenate the entire conversation history (all sessions, all turns)
into the context and ask the model to answer the question. This is the "dump
everything in the context window" approach — exactly what a developer would do
without ContextWeave. At ~115k tokens per sample it exercises the model's full
long-context capability and incurs maximum token cost.

Uses AWS Bedrock Converse API.
"""

from __future__ import annotations

import boto3

from config import MAX_TOKENS, MODEL_ID, TEMPERATURE

_SYSTEM = (
    "You are a helpful assistant with access to a long conversation history. "
    "Answer the question based on the conversation history provided. "
    "Be concise — give only the answer, no preamble."
)


def run_baseline(sample: dict, client: boto3.client) -> tuple[str, dict]:
    """
    Run the baseline condition on a single LongMemEval sample.

    Args:
        sample:  Normalised sample from data.loader.
        client:  boto3 bedrock-runtime client.

    Returns:
        Tuple of (model_response_text, usage_dict).
        usage_dict keys: inputTokens, outputTokens, totalTokens.
    """
    # Build messages: full history + question as the final user turn
    messages = [
        {"role": m["role"], "content": [{"text": m["content"]}]}
        for m in sample["history_flat"]
    ]
    messages.append({
        "role": "user",
        "content": [{"text": sample["question"]}],
    })

    # Bedrock requires strictly alternating user/assistant roles.
    # Merge consecutive same-role messages that may remain after flattening.
    merged: list[dict] = []
    for msg in messages:
        if merged and merged[-1]["role"] == msg["role"]:
            merged[-1]["content"][0]["text"] += "\n" + msg["content"][0]["text"]
        else:
            merged.append(msg)

    # Must start with user role
    if merged and merged[0]["role"] != "user":
        merged = merged[1:]

    response = client.converse(
        modelId=MODEL_ID,
        system=[{"text": _SYSTEM}],
        messages=merged,
        inferenceConfig={
            "maxTokens": MAX_TOKENS,
            "temperature": TEMPERATURE,
        },
    )

    usage = response.get("usage", {"inputTokens": 0, "outputTokens": 0, "totalTokens": 0})
    text = response["output"]["message"]["content"][0]["text"]
    return text, usage
