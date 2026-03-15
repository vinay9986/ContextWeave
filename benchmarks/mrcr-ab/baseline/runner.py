"""
Condition A — Baseline runner.

Strategy: concatenate the entire MRCR conversation into a single prompt and
ask Claude to answer the retrieval query. This is the naive "dump everything
in and hope the model finds it" approach that suffers from context rot at scale.

Uses AWS Bedrock Converse API — no separate Anthropic API key required.
"""

from __future__ import annotations

import boto3

from config import MAX_TOKENS, MODEL_ID, TEMPERATURE


def _to_bedrock_messages(messages: list[dict], query: str) -> list[dict]:
    """
    Convert MRCR messages + query to the Bedrock Converse API format.

    Bedrock content blocks use: [{"text": "..."}]
    """
    history = [
        {"role": m["role"], "content": [{"text": m["content"]}]}
        for m in messages
    ]
    history.append({"role": "user", "content": [{"text": query}]})
    return history


def run_baseline(sample: dict, client: boto3.client) -> str:
    """
    Run the baseline condition on a single MRCR sample.

    Args:
        sample:  Normalised MRCR sample from data.loader.
        client:  boto3 bedrock-runtime client.

    Returns:
        The model's raw text response.
    """
    messages = _to_bedrock_messages(sample["messages"], sample["query"])

    response = client.converse(
        modelId=MODEL_ID,
        messages=messages,
        inferenceConfig={
            "maxTokens": MAX_TOKENS,
            "temperature": TEMPERATURE,
        },
    )

    return response["output"]["message"]["content"][0]["text"]
