"""
MRCR v2 dataset loader.

Loads test cases from HuggingFace (openai/mrcr) and normalises them into
a consistent structure for both the baseline and ContextWeave runners.

Actual dataset schema (openai/mrcr, train split):
  prompt                  str  – JSON-encoded list of messages; last message IS the query
  answer                  str  – reference answer (starts with required hash)
  random_string_to_prepend str – alphanumeric hash the model must prepend
  n_needles               int  – needle variant (2 / 4 / 8)
  n_chars                 int  – character count of the full context
  desired_msg_index       int  – index of the target message in the conversation
  total_messages          int  – total messages in conversation

Each returned sample has:
  context_bin     str          – human-readable size label (e.g. "~32K tokens")
  n_chars         int          – raw character count
  num_needles     int          – needle variant
  messages        list[dict]   – full conversation history (all turns incl. query)
  history         list[dict]   – all turns EXCEPT the final query
  query           str          – the retrieval question (last message content)
  expected_answer str          – reference text to match against
  required_hash   str          – hash the model MUST prepend
"""

from __future__ import annotations

import json

from datasets import load_dataset

from config import CONTEXT_BINS


def _bin_label(n_chars: int) -> str | None:
    """Return the bin label for a given n_chars value, or None if out of range."""
    for label, lo, hi in CONTEXT_BINS:
        if lo <= n_chars < hi:
            return label
    return None


def _normalise_sample(raw: dict) -> dict | None:
    """Convert a raw HuggingFace row into the canonical benchmark format."""
    try:
        messages = json.loads(raw["prompt"])
    except (json.JSONDecodeError, KeyError):
        return None

    if not messages or not isinstance(messages, list):
        return None

    # The last message is always the query (role: user)
    query_msg = messages[-1]
    if query_msg.get("role") != "user":
        return None

    query = query_msg["content"]
    history = messages[:-1]          # everything before the final query
    expected = raw.get("answer", "")
    required_hash = raw.get("random_string_to_prepend", "")
    n_chars = int(raw.get("n_chars", 0))
    n_needles = int(raw.get("n_needles", 0))

    if not query or not expected:
        return None

    bin_label = _bin_label(n_chars)
    if bin_label is None:
        return None

    return {
        "context_bin":    bin_label,
        "n_chars":        n_chars,
        "num_needles":    n_needles,
        "messages":       messages,   # full conversation incl. query (for baseline)
        "history":        history,    # conversation WITHOUT query (for ContextWeave)
        "query":          query,
        "expected_answer": expected,
        "required_hash":  required_hash,
    }


def load_mrcr(
    needle_counts: list[int],
    samples_per_cell: int = 20,
    cache_dir: str | None = None,
) -> list[dict]:
    """
    Download and filter MRCR v2 samples.

    Args:
        needle_counts:     Needle variants to include (e.g. [2, 4, 8]).
        samples_per_cell:  Max samples per (bin_label × needle_count) cell.
        cache_dir:         Optional local cache path for HuggingFace datasets.

    Returns:
        List of normalised sample dicts.
    """
    print("Loading MRCR v2 from HuggingFace (openai/mrcr) …")
    ds = load_dataset("openai/mrcr", split="train", cache_dir=cache_dir)

    needle_set = set(needle_counts)
    cell_counts: dict[tuple, int] = {}
    samples: list[dict] = []

    for raw in ds:
        if int(raw.get("n_needles", 0)) not in needle_set:
            continue

        sample = _normalise_sample(raw)
        if sample is None:
            continue

        cell_key = (sample["context_bin"], sample["num_needles"])
        if cell_counts.get(cell_key, 0) >= samples_per_cell:
            continue

        cell_counts[cell_key] = cell_counts.get(cell_key, 0) + 1
        samples.append(sample)

    print(f"  Loaded {len(samples)} samples across {len(cell_counts)} cells.")
    for (label, nn), count in sorted(cell_counts.items()):
        print(f"    {label} | {nn}-needle: {count} samples")

    return samples
