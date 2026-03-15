"""
ContextWeave Bead Store — general-purpose implementation for LongMemEval.

Unlike the MRCR version, this store handles real multi-session conversations
(not adversarial needle retrieval), so there is no MRCR-specific ordinal
extraction. Retrieval is purely semantic.

STORAGE (mirrors trace-utils.js logPrompt / logFinal):
  Each user→assistant exchange is stored as a bead:
    - prompt_snippet : user turn, truncated to LIMIT_PROMPT chars
    - final_snippet  : assistant response, truncated to LIMIT_FINAL chars
    - session_id     : which session this turn came from
    - session_index  : position of the session in the conversation history
    - turn_index     : position within the session

SESSION START INJECTION (mirrors 1-context-start.js + buildPromptFinalSummary):
  Builds a structured CONVERSATION HISTORY block with truncated snippets and
  a search instruction for the LLM.

RETRIEVAL:
  Semantic search using fastembed all-MiniLM-L6-v2 — same model as production.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass, field
from typing import List, Optional

import numpy as np
from fastembed import TextEmbedding

log = logging.getLogger("longmemeval.bead_store")

# ── Truncation limits (match trace-utils.js LIMITS) ───────────────────────────
LIMIT_PROMPT = 1200
LIMIT_FINAL = 1200


def _truncate(text: str, limit: int) -> str:
    text = " ".join(text.split())
    if len(text) <= limit:
        return text
    return text[: limit - 3] + "..."


# ── Bead data model ────────────────────────────────────────────────────────────

@dataclass
class Bead:
    bead_id: str
    session_id: str
    session_index: int    # which session (0-indexed, chronological)
    turn_index: int       # position of this user turn within the session
    prompt_full: str      # full user turn
    final_full: str       # full assistant response
    prompt_snippet: str   # truncated to LIMIT_PROMPT
    final_snippet: str    # truncated to LIMIT_FINAL


# ── Bead Store ─────────────────────────────────────────────────────────────────

class BeadStore:
    """
    In-memory bead store that replicates ContextWeave's storage and
    session-start injection behaviour for multi-session conversations.
    """

    def __init__(self):
        self._beads: List[Bead] = []
        self._embedder: Optional[TextEmbedding] = None
        self._full_embeddings: Optional[np.ndarray] = None

    def ingest(self, sessions: list[dict]) -> None:
        """
        Ingest all sessions into the bead store.

        Args:
            sessions: list of {session_id, session} dicts where
                      session = list of {role, content} turn dicts.
        """
        self._beads.clear()
        bead_num = 1

        for s_idx, session_entry in enumerate(sessions):
            session_id = session_entry.get("session_id", f"session-{s_idx}")
            turns = session_entry.get("session", [])

            t_idx = 0
            while t_idx < len(turns):
                turn = turns[t_idx]
                if turn.get("role") != "user":
                    t_idx += 1
                    continue

                user_content = turn.get("content", "").strip()

                # Find the next assistant turn
                final_content = ""
                j = t_idx + 1
                while j < len(turns) and turns[j].get("role") != "user":
                    if turns[j].get("role") == "assistant" and not final_content:
                        final_content = turns[j].get("content", "").strip()
                    j += 1

                if user_content and final_content:
                    bead = Bead(
                        bead_id=f"bead-{bead_num:04d}",
                        session_id=session_id,
                        session_index=s_idx,
                        turn_index=t_idx,
                        prompt_full=user_content,
                        final_full=final_content,
                        prompt_snippet=_truncate(user_content, LIMIT_PROMPT),
                        final_snippet=_truncate(final_content, LIMIT_FINAL),
                    )
                    self._beads.append(bead)
                    bead_num += 1

                t_idx = j

        self._build_index()
        log.debug("ingested %d beads from %d sessions", len(self._beads), len(sessions))

    def _build_index(self) -> None:
        if not self._beads:
            return
        self._embedder = TextEmbedding("sentence-transformers/all-MiniLM-L6-v2")
        full_texts = [b.prompt_full + " " + b.final_full for b in self._beads]
        self._full_embeddings = np.array(
            list(self._embedder.embed(full_texts)), dtype=np.float32
        )

    def build_session_context(self) -> str:
        """
        Build the context block injected at session start — mirrors
        buildPromptFinalSummary() in trace-utils.js.
        """
        lines = [
            "# HOW TO SEARCH CONVERSATION HISTORY",
            '- `search-beads "<query>"` — retrieve the most relevant past exchange (Bash tool)',
            "",
            "# CONVERSATION HISTORY (USER → ASSISTANT, FINAL ONLY)",
        ]

        for i, bead in enumerate(self._beads, 1):
            lines.append(f"{i}. [Session {bead.session_index + 1}] User: {bead.prompt_snippet}")
            lines.append(f"   Assistant: {bead.final_snippet}")

        return "\n".join(lines)

    def search(self, query: str, top_k: int = 3) -> List[Bead]:
        """Semantic search over all beads."""
        if not self._beads or self._embedder is None:
            return []

        q_emb = np.array(list(self._embedder.embed([query])), dtype=np.float32)
        scores = (self._full_embeddings @ q_emb.T).flatten()
        top_indices = np.argsort(scores)[::-1][:top_k]
        results = [self._beads[i] for i in top_indices if scores[i] > 0]

        for b in results:
            idx = self._beads.index(b)
            log.debug("search hit=%s score=%.4f prompt=%r",
                      b.bead_id, scores[idx], b.prompt_full[:100])
        return results

    def format_search_result(self, beads: List[Bead]) -> str:
        if not beads:
            return "No matching conversation history found."
        parts = []
        for bead in beads:
            parts.append(
                f"[{bead.bead_id} | Session {bead.session_index + 1}]\n"
                f"User: {bead.prompt_full}\n\n"
                f"Assistant: {bead.final_full}"
            )
        return "\n\n---\n\n".join(parts)

    @property
    def bead_count(self) -> int:
        return len(self._beads)
