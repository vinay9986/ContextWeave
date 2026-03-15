"""
LongMemEval dataset loader.

Loads test cases from HuggingFace (xiaowu0162/longmemeval-cleaned) and
normalises them into a consistent structure for both runners.

Dataset schema:
  question_id       str  – unique identifier
  question_type     str  – one of: single-session-user, single-session-assistant,
                           single-session-preference, multi-session,
                           temporal-reasoning, knowledge-update
                           (question_id ending in _abs = abstention variant)
  question          str  – the question to answer
  answer            str  – expected answer
  question_date     str  – ISO date when question is posed (after all sessions)
  haystack          list – list of {session_id, session} dicts
                           each session = list of {role, content} turn dicts

Each returned sample:
  question_id       str         – original question id
  question_type     str         – question category
  is_abstention     bool        – True if this is an abstention question
  question          str         – question text
  answer            str         – expected answer
  question_date     str         – date of the question
  history_flat      list[dict]  – all turns from all sessions, chronologically
                                  (role: user/assistant, content: str)
                                  used by the baseline runner
  sessions          list[dict]  – original sessions list
                                  (for ContextWeave ingestion)
  n_sessions        int         – total number of history sessions
  n_turns           int         – total number of user→assistant turn pairs
"""

from __future__ import annotations

import collections
import json
import sys

from datasets import load_dataset

from config import DEFAULT_SAMPLES, HF_DATASET, HF_SPLIT, QUESTION_TYPES


def _parse_turn(raw_turn) -> dict | None:
    """Parse a turn from the dataset.

    The cleaned dataset stores turns as JSON-encoded strings:
      '{"role":"user","content":"..."}'
    """
    if isinstance(raw_turn, dict):
        return raw_turn
    if isinstance(raw_turn, str):
        try:
            return json.loads(raw_turn)
        except json.JSONDecodeError:
            return None
    return None


def _normalise_sample(raw: dict) -> dict | None:
    """Convert a raw HuggingFace row into the canonical benchmark format.

    Actual schema (xiaowu0162/longmemeval-cleaned, longmemeval_s_cleaned split):
      question_id          str
      question_type        str
      question             str
      question_date        str
      answer               str
      answer_session_ids   list[str]
      haystack_dates       list[str]
      haystack_session_ids list[str]  – session IDs, parallel to haystack_sessions
      haystack_sessions    list[list] – each inner list = turns as JSON strings
    """
    question_id = raw.get("question_id", "")
    question_type = raw.get("question_type", "")
    question = raw.get("question", "").strip()
    answer = raw.get("answer", "").strip()
    question_date = raw.get("question_date", "")

    if not question or not answer or not question_id:
        return None

    question_type = question_type.replace("_", "-").lower()
    is_abstention = question_id.endswith("_abs")

    haystack_sessions = raw.get("haystack_sessions", [])
    haystack_session_ids = raw.get("haystack_session_ids", [])

    if not haystack_sessions:
        return None

    # Build normalised sessions list (for ContextWeave ingestion)
    sessions: list[dict] = []
    for s_idx, raw_session in enumerate(haystack_sessions):
        sid = (
            haystack_session_ids[s_idx]
            if s_idx < len(haystack_session_ids)
            else f"session-{s_idx}"
        )
        turns = []
        for raw_turn in raw_session:
            turn = _parse_turn(raw_turn)
            if turn and turn.get("role") in ("user", "assistant"):
                turns.append({"role": turn["role"], "content": turn.get("content", "").strip()})
        if turns:
            sessions.append({"session_id": sid, "session": turns})

    if not sessions:
        return None

    # Flatten all sessions into a single chronological message list (for baseline).
    # Bedrock Converse requires strictly alternating user/assistant roles.
    history_flat: list[dict] = []
    for sess in sessions:
        for turn in sess["session"]:
            role = turn["role"]
            content = turn["content"]
            if not content:
                continue
            # Merge consecutive same-role messages
            if history_flat and history_flat[-1]["role"] == role:
                history_flat[-1]["content"] += "\n" + content
            else:
                history_flat.append({"role": role, "content": content})

    if not history_flat:
        return None

    n_turns = sum(1 for t in history_flat if t["role"] == "user")

    return {
        "question_id":    question_id,
        "question_type":  question_type,
        "is_abstention":  is_abstention,
        "question":       question,
        "answer":         answer,
        "question_date":  question_date,
        "history_flat":   history_flat,
        "sessions":       sessions,
        "n_sessions":     len(sessions),
        "n_turns":        n_turns,
    }


def load_longmemeval(
    total_samples: int = DEFAULT_SAMPLES,
    question_types: list[str] | None = None,
    cache_dir: str | None = None,
) -> list[dict]:
    """
    Download and sample LongMemEval questions.

    Args:
        total_samples:   Max total questions to return. Balanced across types.
        question_types:  Which types to include (default: all QUESTION_TYPES).
        cache_dir:       Optional local cache path for HuggingFace datasets.

    Returns:
        List of normalised sample dicts.
    """
    qtypes = set(question_types or QUESTION_TYPES)
    print(f"Loading LongMemEval from HuggingFace ({HF_DATASET}) …")

    # Use streaming=True so only the requested split is fetched — avoids
    # downloading/preparing the giant longmemeval_m_cleaned file entirely.
    ds = load_dataset(HF_DATASET, split=HF_SPLIT, streaming=True, cache_dir=cache_dir)

    per_type_limit = max(1, total_samples // len(qtypes))
    type_counts: dict[str, int] = collections.defaultdict(int)
    samples: list[dict] = []

    for raw in ds:
        sample = _normalise_sample(raw)
        if sample is None:
            continue

        qt = sample["question_type"]
        if qt not in qtypes:
            continue

        if type_counts[qt] >= per_type_limit:
            continue

        type_counts[qt] += 1
        samples.append(sample)

        if len(samples) >= total_samples:
            break

    if not samples:
        print("ERROR: No samples loaded. Check dataset name and split.", file=sys.stderr)
        return []

    print(f"  Loaded {len(samples)} questions.")
    for qt, count in sorted(type_counts.items()):
        print(f"    {qt}: {count}")

    return samples
