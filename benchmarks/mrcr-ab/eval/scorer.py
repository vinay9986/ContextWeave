"""
MRCR v2 scoring — faithful to the official benchmark methodology.

Two-stage evaluation (matching the openai/mrcr spec):
  1. Hash check  — if the required hash is absent from the response, score = 0.0
  2. Content match — SequenceMatcher ratio between response and expected answer.
     Ratio ≥ CORRECT_THRESHOLD counts as a correct retrieval.

Reference: https://huggingface.co/datasets/openai/mrcr
"""

from __future__ import annotations

from difflib import SequenceMatcher

from config import CORRECT_THRESHOLD


def _normalise(text: str) -> str:
    """Strip leading/trailing whitespace; collapse internal whitespace."""
    return " ".join(text.split())


def score_response(
    response: str,
    expected: str,
    required_hash: str,
) -> dict:
    """
    Score a single model response against the MRCR v2 reference answer.

    Args:
        response:      Raw text returned by the model.
        expected:      Reference answer from the dataset.
        required_hash: Alphanumeric hash the model MUST prepend.

    Returns:
        Dict with keys:
          ratio     float  – SequenceMatcher similarity (0.0–1.0)
          correct   bool   – ratio >= CORRECT_THRESHOLD AND hash present
          has_hash  bool   – required hash found in response
    """
    r = _normalise(response)
    e = _normalise(expected)

    # ── 1. Hash gate ───────────────────────────────────────────────────────────
    has_hash = bool(required_hash) and required_hash in r

    if required_hash and not has_hash:
        return {"ratio": 0.0, "correct": False, "has_hash": False}

    # ── 2. Content similarity ──────────────────────────────────────────────────
    ratio = SequenceMatcher(None, r, e).ratio()
    correct = ratio >= CORRECT_THRESHOLD

    return {"ratio": ratio, "correct": correct, "has_hash": has_hash}


def aggregate_scores(scores: list[dict]) -> dict:
    """
    Compute summary statistics over a list of per-sample score dicts.

    Returns:
        Dict with keys: accuracy, mean_ratio, n_samples, n_correct
    """
    if not scores:
        return {"accuracy": 0.0, "mean_ratio": 0.0, "n_samples": 0, "n_correct": 0}

    n = len(scores)
    n_correct = sum(1 for s in scores if s["correct"])
    mean_ratio = sum(s["ratio"] for s in scores) / n
    avg_tool_calls = sum(s.get("tool_calls", 0) for s in scores) / n

    return {
        "accuracy": n_correct / n,
        "mean_ratio": mean_ratio,
        "n_samples": n,
        "n_correct": n_correct,
        "avg_tool_calls": round(avg_tool_calls, 2),
    }
