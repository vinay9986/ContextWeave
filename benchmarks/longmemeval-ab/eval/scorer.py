"""
LongMemEval scoring — LLM judge.

Uses an LLM to judge whether the model's response correctly answers the
question given the expected answer. This matches the evaluation methodology
in the original LongMemEval paper (which uses GPT-4 as judge).

We use the same Claude Sonnet 4.6 model via Bedrock to keep costs consistent
and avoid introducing a separate API dependency.

Judge prompt design:
  - Provide the question, expected answer, and model response.
  - Ask for a binary YES/NO judgment with a brief reason.
  - Abstention questions are handled separately: correct iff model says
    it doesn't know / no information available.
"""

from __future__ import annotations

import boto3

from config import JUDGE_MAX_TOKENS, JUDGE_MODEL_ID

_JUDGE_SYSTEM = (
    "You are an answer correctness evaluator. "
    "Respond with exactly one line: 'YES' if the model answer is correct, "
    "'NO' if it is incorrect or missing key information. "
    "Do not add any other text."
)

_JUDGE_TEMPLATE = """\
Question: {question}

Expected answer: {expected}

Model answer: {response}

Is the model answer correct?"""

_ABSTENTION_JUDGE_TEMPLATE = """\
Question: {question}

The correct behavior is to say the information is not available / you don't know.

Model answer: {response}

Did the model correctly abstain (say it doesn't know or the info isn't available)?"""


def judge_response(
    question: str,
    expected: str,
    response: str,
    is_abstention: bool,
    client: boto3.client,
) -> dict:
    """
    Ask the LLM judge whether the response is correct.

    Returns:
        Dict with keys:
          correct  bool  – True if judge says YES
          raw      str   – raw judge output
    """
    if is_abstention:
        prompt = _ABSTENTION_JUDGE_TEMPLATE.format(
            question=question,
            response=response,
        )
    else:
        prompt = _JUDGE_TEMPLATE.format(
            question=question,
            expected=expected,
            response=response,
        )

    judge_response = client.converse(
        modelId=JUDGE_MODEL_ID,
        system=[{"text": _JUDGE_SYSTEM}],
        messages=[{"role": "user", "content": [{"text": prompt}]}],
        inferenceConfig={"maxTokens": JUDGE_MAX_TOKENS, "temperature": 0.0},
    )

    raw = judge_response["output"]["message"]["content"][0]["text"].strip()
    correct = raw.upper().startswith("YES")
    return {"correct": correct, "raw": raw}


def aggregate_scores(scores: list[dict]) -> dict:
    """
    Compute summary statistics over a list of per-sample score dicts.

    Returns dict with: accuracy, n_samples, n_correct, avg_tool_calls
    """
    if not scores:
        return {"accuracy": 0.0, "n_samples": 0, "n_correct": 0, "avg_tool_calls": 0.0}

    n = len(scores)
    n_correct = sum(1 for s in scores if s.get("correct", False))
    avg_tool_calls = sum(s.get("tool_calls", 0) for s in scores) / n

    return {
        "accuracy": n_correct / n,
        "n_samples": n,
        "n_correct": n_correct,
        "avg_tool_calls": round(avg_tool_calls, 2),
    }
