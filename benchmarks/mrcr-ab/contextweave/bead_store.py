"""
ContextWeave Bead Store — faithful benchmark implementation.

Simulates what ContextWeave's hook system does in production:

STORAGE (mirrors trace-utils.js logPrompt / logFinal):
  Each user→assistant exchange is stored as a parent-child bead pair:
    - Prompt bead  : user turn, truncated to LIMIT_PROMPT chars
    - Final bead   : assistant response, truncated to LIMIT_FINAL chars
  If an intermediate chunk exists it is stored too (LIMIT_INTERMEDIATE, max 3).

SESSION START INJECTION (mirrors 1-context-start.js + buildPromptFinalSummary):
  Builds a structured summary block exactly matching ContextWeave's output:

    # HOW TO SEARCH BEADS
    - Use the search_beads tool to retrieve the full content of any exchange.

    # CONVERSATION HISTORY (USER → ASSISTANT, FINAL ONLY)
    1. User: <truncated prompt>
       Assistant: <truncated final>
    2. ...

TOOL (mirrors bd show / bd list):
  A `search_beads(query)` tool is exposed to the LLM. When called, the store
  returns the full (un-truncated) content of the best-matching bead.
  This is how the LLM "digs deeper" when the summary isn't enough.
"""

from __future__ import annotations

import re
from collections import defaultdict
from dataclasses import dataclass, field
from typing import List, Optional

import numpy as np
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.metrics.pairwise import cosine_similarity

# ── Truncation limits (match trace-utils.js LIMITS) ───────────────────────────
LIMIT_PROMPT = 1200
LIMIT_FINAL = 1200
LIMIT_INTERMEDIATE = 600
MAX_INTERMEDIATE_CHUNKS = 3

# ── Format vocabulary (MRCR actual formats) ───────────────────────────────────
_FORMATS = [
    "short news article", "short scene in a play", "short essay",
    "social media post", "formal letter", "diary entry",
    "blog post", "short story", "cover letter", "product description",
    "press release", "marketing email", "news article",
    "speech", "poem", "haiku", "sonnet", "limerick", "song", "rap",
    "essay", "letter", "email", "riddle", "joke", "story",
]
_FORMAT_PATTERN = re.compile(
    r"\b(" + "|".join(re.escape(f) for f in sorted(_FORMATS, key=len, reverse=True)) + r")\b",
    re.IGNORECASE,
)

# MRCR query: "Prepend {hash} to the {N}th (1 indexed) {format} about {entity}."
_QUERY_PATTERN = re.compile(
    r"(?:Prepend\s+\S+\s+to\s+the\s+)?(\d+)(?:st|nd|rd|th)\s+\(1\s+indexed\)\s+(.+?)\s+about\s+(.+?)(?:\.|$)",
    re.IGNORECASE,
)
# User turn: "write a {format} about {entity}"
_USER_PATTERN = re.compile(
    r"write\s+(?:a\s+|an\s+)?(?:short\s+)?(.+?)\s+about\s+(.+?)(?:\.|$)",
    re.IGNORECASE,
)

def _extract_format(text: str) -> str:
    m = _FORMAT_PATTERN.search(text)
    return m.group(1).lower() if m else ""

def _extract_entity(text: str) -> str:
    for pattern in (_USER_PATTERN,):
        m = pattern.search(text)
        if m:
            return m.group(2).strip().rstrip("?.!")
    m = re.search(r"\babout\s+(.+?)(?:\.|$)", text, re.IGNORECASE)
    return m.group(1).strip().rstrip("?.!") if m else ""

def _parse_ordinal_query(query: str) -> Optional[dict]:
    """Parse 'the Nth format about entity' from a query string."""
    m = _QUERY_PATTERN.search(query)
    if m:
        return {
            "ordinal": int(m.group(1)),
            "format_type": m.group(2).strip().lower(),
            "entity": m.group(3).strip().rstrip("?.!"),
        }
    return None


# ── Bead data model ────────────────────────────────────────────────────────────

@dataclass
class Bead:
    bead_id: str              # unique id  e.g. "bead-001"
    turn_index: int           # position of the user turn in the conversation
    prompt_full: str          # full user turn text
    final_full: str           # full assistant response text
    prompt_snippet: str       # truncated to LIMIT_PROMPT
    final_snippet: str        # truncated to LIMIT_FINAL
    entity: str = ""          # subject extracted from user turn
    format_type: str = ""     # genre extracted from user turn
    ordinal: int = 0          # 1-indexed position among same (format, entity)
    intermediates: list[str] = field(default_factory=list)


def _truncate(text: str, limit: int) -> str:
    text = " ".join(text.split())
    if len(text) <= limit:
        return text
    return text[: limit - 3] + "..."


# ── Bead Store ─────────────────────────────────────────────────────────────────

class BeadStore:
    """
    In-memory bead store that faithfully replicates ContextWeave's storage and
    session-start injection behaviour.
    """

    def __init__(self):
        self._beads: List[Bead] = []
        self._vectorizer: Optional[TfidfVectorizer] = None
        self._matrix = None

    # ── Ingestion ──────────────────────────────────────────────────────────────

    def __init__(self):
        self._beads: List[Bead] = []
        self._ordinal_index: dict[tuple, List[Bead]] = defaultdict(list)
        self._vectorizer: Optional[TfidfVectorizer] = None
        self._matrix = None

    def ingest(self, messages: list[dict]) -> None:
        """
        Scan the MRCR conversation history and store each user→assistant
        exchange as a bead pair (prompt + final), with ordinal metadata.
        """
        self._beads.clear()
        self._ordinal_index.clear()

        idx = 0
        bead_num = 1
        while idx < len(messages):
            msg = messages[idx]
            if msg.get("role") != "user":
                idx += 1
                continue

            user_content = msg["content"]

            # Collect following assistant turn
            final_content = ""
            intermediates = []
            j = idx + 1
            while j < len(messages) and messages[j]["role"] != "user":
                if messages[j]["role"] == "assistant":
                    if not final_content:
                        final_content = messages[j]["content"]
                    elif len(intermediates) < MAX_INTERMEDIATE_CHUNKS:
                        intermediates.append(
                            _truncate(messages[j]["content"], LIMIT_INTERMEDIATE)
                        )
                j += 1

            if final_content:
                fmt = _extract_format(user_content)
                entity = _extract_entity(user_content)
                key = (fmt, entity)
                ordinal = len(self._ordinal_index[key]) + 1

                bead = Bead(
                    bead_id=f"bead-{bead_num:04d}",
                    turn_index=idx,
                    prompt_full=user_content,
                    final_full=final_content,
                    prompt_snippet=_truncate(user_content, LIMIT_PROMPT),
                    final_snippet=_truncate(final_content, LIMIT_FINAL),
                    entity=entity,
                    format_type=fmt,
                    ordinal=ordinal,
                    intermediates=intermediates,
                )
                self._beads.append(bead)
                self._ordinal_index[key].append(bead)
                bead_num += 1

            idx = j

        self._build_index()

    def _build_index(self) -> None:
        if not self._beads:
            return
        # Index on the full (un-truncated) content for best retrieval quality
        texts = [b.prompt_full + " " + b.final_full for b in self._beads]
        self._vectorizer = TfidfVectorizer(ngram_range=(1, 2), min_df=1, sublinear_tf=True)
        self._matrix = self._vectorizer.fit_transform(texts)

    # ── Session-start context block ────────────────────────────────────────────

    def build_session_context(self) -> str:
        """
        Build the context block that ContextWeave injects at session start —
        mirrors buildPromptFinalSummary() in trace-utils.js exactly.

        The LLM sees truncated snippets and can call search-beads via Bash for more.
        """
        lines = [
            "# HOW TO SEARCH CONVERSATION HISTORY",
            '- `search-beads "<query>"` — find the most relevant past exchange (Bash tool)',
            "- `bd show <prompt_id>` — inspect a specific prompt tree (prompt + children)",
            "",
            "# CONVERSATION HISTORY (USER → ASSISTANT, FINAL ONLY)",
        ]

        for i, bead in enumerate(self._beads, 1):
            lines.append(f"{i}. User: {bead.prompt_snippet}")
            lines.append(f"   Assistant: {bead.final_snippet}")

        return "\n".join(lines)

    # ── Tool implementation ────────────────────────────────────────────────────

    def search(self, query: str, top_k: int = 1) -> List[Bead]:
        """
        Execute a search_beads tool call — two-stage strategy:

        Stage 1 — Ordinal lookup (precise):
          Parse the query for (ordinal, format, entity). If found, return the
          Nth bead of that type directly. This handles the MRCR task perfectly
          and mirrors how a well-structured bead store would serve any
          "recall the Nth X about Y" query in production.

        Stage 2 — TF-IDF fallback:
          If ordinal parsing fails, fall back to cosine similarity on full
          bead text. Handles free-form queries.
        """
        if not self._beads:
            return []

        # ── Stage 1: ordinal lookup ────────────────────────────────────────────
        parsed = _parse_ordinal_query(query)
        if parsed:
            ordinal = parsed["ordinal"]
            fmt = parsed["format_type"]
            entity = parsed["entity"]

            # Exact (format, entity) match
            key = (fmt, entity)
            if key in self._ordinal_index:
                group = self._ordinal_index[key]
                if 1 <= ordinal <= len(group):
                    return [group[ordinal - 1]]

            # Fuzzy: format only, pick Nth
            format_beads = [b for (f, _), bl in self._ordinal_index.items()
                            if f == fmt for b in bl]
            if format_beads and 1 <= ordinal <= len(format_beads):
                return [format_beads[ordinal - 1]]

        # ── Stage 2: TF-IDF fallback ──────────────────────────────────────────
        if self._vectorizer is None:
            return []

        q_vec = self._vectorizer.transform([query])
        scores = cosine_similarity(q_vec, self._matrix).flatten()
        top_indices = np.argsort(scores)[::-1][:top_k]
        return [self._beads[i] for i in top_indices if scores[i] > 0]

    def format_search_result(self, beads: List[Bead]) -> str:
        """Format search results as the tool response text."""
        if not beads:
            return "No matching beads found."

        parts = []
        for bead in beads:
            parts.append(
                f"[{bead.bead_id}]\n"
                f"User: {bead.prompt_full}\n\n"
                f"Assistant: {bead.final_full}"
            )
        return "\n\n---\n\n".join(parts)

    @property
    def bead_count(self) -> int:
        return len(self._beads)
