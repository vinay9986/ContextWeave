# Changelog

## v2.0.0 — 2026-03-15

### Highlights

- **Semantic search** — `search-beads` now uses a local ONNX embedding model (`all-MiniLM-L6-v2`) for four-stage semantic retrieval. Keyword/TF-IDF search is removed.
- **Zero-friction install** — new `install.js` copies everything to `~/.contextweave/`, links `search-beads`, and downloads the ONNX model in one command. The repo can be deleted after setup.
- **LongMemEval benchmark** — replaced the MRCR v2 benchmark with LongMemEval (ICLR 2025), a multi-session long-term memory benchmark. ContextWeave achieves **68.2% accuracy vs 59.5% baseline** (+8.7pp) at **11% lower token cost** across 400 questions.

### New

- `install.js` — one-command installer that copies hook scripts to `~/.contextweave/`, installs dependencies, links `search-beads`, and downloads the ONNX model. Prints ready-to-paste hook configs for Claude Code and Gemini CLI. No absolute repo path required.
- `setup-onnx.js` — standalone ONNX model downloader. Called by the installer; can also be run manually to refresh the model cache.
- `benchmarks/longmemeval-ab/` — full A/B benchmark runner against [LongMemEval](https://arxiv.org/abs/2410.10813):
  - Baseline: full conversation context dumped into model
  - ContextWeave: bead retrieval with semantic search
  - Scored by LLM judge per question type
  - Results broken down by: single-session-user, single-session-assistant, single-session-preference, multi-session, temporal-reasoning, knowledge-update

### Changed

- **`bin/search-beads`** — rewritten from keyword+ordinal to four-stage ONNX semantic retrieval:
  1. Exact `(format, entity)` key match for ordinal queries
  2. Format-only ordinal match as a fallback
  3. Semantic group matching — embeds format+entity, finds most similar prompts, applies ordinal within the group
  4. Full cosine-similarity semantic search over all bead content
- **`setup-claude.md`** / **`setup-gemini.md`** — rewritten around `install.js`. No more absolute path editing; installer outputs ready-to-paste configs.
- **`setup.md`** — simplified to `git clone → node install.js → delete repo`.
- **`README.md`** — Quick Start is now 4 lines. Added benchmark results table. Added `search-beads` to Why ContextWeave.
- **`docs/architecture.md`** — added Semantic Retrieval section documenting the four-stage ONNX pipeline.
- **`docs/trace-model.md`** — added `bin/search-beads` and `setup-onnx.js` to script inventory.
- **`package.json`** — added `@huggingface/transformers` dependency for ONNX inference.

### Removed

- `benchmarks/mrcr-ab/` — MRCR v2 benchmark replaced by LongMemEval. MRCR tested adversarial needle-in-haystack retrieval, which is not aligned with ContextWeave's value proposition of persistent multi-session memory.
- Keyword/TF-IDF search in `search-beads` — replaced entirely by ONNX semantic search.

### Benchmark Results (LongMemEval, 400 questions)

| Condition | Accuracy | Avg Input Tokens |
|---|---|---|
| Baseline — full context | 59.5% | 115,660 |
| **ContextWeave — bead retrieval** | **68.2%** | **102,791** |

| Question Type | Baseline | ContextWeave | Delta |
|---|---|---|---|
| single-session-preference | 17% | **57%** | +40pp |
| single-session-user | 80% | **94%** | +14pp |
| temporal-reasoning | 20% | **34%** | +14pp |
| multi-session | 57% | **65%** | +8pp |
| single-session-assistant | 93% | 93% | — |
| knowledge-update | **78%** | 72% | −6pp |

---

## v1.0.0 — initial release

- Hook-based context persistence for Claude Code and Gemini CLI
- Beads-backed prompt/tool/final trace storage
- Session-start rehydration with `bd prime --full`
- Post-compaction rehydration via `.beads/.needs_rehydrate`
- `search-beads` with keyword + ordinal search
- MRCR v2 A/B benchmark
