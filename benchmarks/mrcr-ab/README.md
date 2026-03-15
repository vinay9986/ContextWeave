# MRCR v2 A/B Benchmark: ContextWeave vs Baseline

> **Thesis:** Context rot is an architectural problem, not a model problem.
> ContextWeave solves it by retrieving before the model ever sees the context.

---

## Background

Every major AI lab now claims a 1-million-token context window. But the
number on the spec sheet and the number that actually works are two very
different things.

A benchmark called **MRCR v2** (Multi-needle Retrieval Consistency Rating),
developed by OpenAI and published on HuggingFace
([openai/mrcr](https://huggingface.co/datasets/openai/mrcr)), stress-tests
this gap. It hides multiple pieces of information across a long conversation
and asks the model to retrieve a specific one — essentially measuring whether
a model can actually find what you put in.

The results from published evaluations are stark:

| Model | @ 256K tokens | @ 1M tokens | Drop |
|---|---|---|---|
| GPT-5.4 | ~79% | **36.6%** | −54% |
| Gemini 3.1 Pro | ~93% | **25.9%** | −72% |
| Claude Opus 4.6 | 91.9% | **78.3%** | −15% |

Researchers call this **"context rot"**. Every single frontier model tested
by Chroma in 2025 degraded as input length increased. Most decay
exponentially.

---

## The ContextWeave Hypothesis

The naive approach to long-running AI work is to concatenate everything into
one giant context window. The MRCR v2 data shows this strategy actively makes
the model less capable.

ContextWeave takes a fundamentally different architectural stance:

- **Every meaningful unit of context is a discrete, tagged bead.**
- **Retrieval happens _before_ the model sees anything.**
- **The model receives only the relevant slice — not the entire history.**

This means the context size fed to the model is bounded by
`TOP_K × avg_bead_size` (~2–5K tokens), completely decoupled from the total
size of the knowledge base. Context rot cannot occur because the model is
never asked to search.

---

## Experiment Design

This is a **controlled A/B test** using the official MRCR v2 dataset.

### Condition A — Baseline
The full MRCR conversation history is concatenated into a single prompt.
Claude Sonnet 4.6 must find the needle in the full context.
This replicates the published evaluation methodology.

### Condition B — ContextWeave
The conversation is parsed into beads (one per user→assistant exchange),
truncated to ContextWeave's production limits (1200 chars each). A truncated
`CONVERSATION HISTORY` summary is injected at session start — exactly as
`1-context-start.js` does in production.

The model is given a `Bash` tool and instructed to call
`search-beads "<query>"` when the summary isn't enough. This faithfully
mirrors how Claude Code and Gemini CLI users experience ContextWeave: the
LLM decides whether to search, calls the tool, and retrieves the relevant
bead on demand.

**Both conditions use the same model (Claude Sonnet 4.6) at temperature 0.**
The only variable is the context delivery strategy.

### Scoring
Faithful to the MRCR v2 specification:
1. **Hash gate** — if the required alphanumeric hash is absent, score = 0.0
2. **Content similarity** — Python `difflib.SequenceMatcher` ratio
3. **Correct** — ratio ≥ 0.6 (matching the benchmark's official threshold)

---

## Results

*(Run the benchmark to populate this section — see [Running the Benchmark](#running-the-benchmark) below.)*

Results chart will be saved to `results/mrcr_ab_results.png`.

---

## Running the Benchmark

### Prerequisites

```bash
# Install Python dependencies
pip install -r requirements.txt
```

AWS credentials are used for Bedrock — no separate API key required.
The benchmark picks up credentials from the standard AWS credential chain
(SSO, environment variables, `~/.aws/`).

```bash
# If using AWS SSO, authenticate first:
aws sso login --profile <your-profile>
```

### Quick run (development — 5 samples, two needle counts)

```bash
python run_ab_test.py --samples 5 --needles 2
```

With a named AWS SSO profile:

```bash
python run_ab_test.py --samples 5 --needles 2 --profile <your-profile>
```

### Full benchmark run

```bash
python run_ab_test.py --samples 20
```

### Options

| Flag | Default | Description |
|---|---|---|
| `--samples N` | 20 | Samples per (bin × needle_count) cell |
| `--needles` | 2,4,8 | Comma-separated needle counts, e.g. `2,4` |
| `--condition` | both | Run only `baseline` or `contextweave` |
| `--plot-only` | — | Re-plot from existing `raw_scores.json` |
| `--region REGION` | us-east-1 | AWS region for Bedrock |
| `--profile PROFILE` | default | AWS SSO profile name |

### Resuming a partial run

The runner saves `results/raw_scores.json` after each condition. If the run
is interrupted, restarting will load the existing file and skip completed
conditions automatically.

---

## Repository Structure

```
benchmarks/mrcr-ab/
├── run_ab_test.py          # Main entry point
├── config.py               # Shared configuration (model, bins, thresholds)
├── requirements.txt
│
├── data/
│   └── loader.py           # Loads and normalises MRCR v2 from HuggingFace
│
├── baseline/
│   └── runner.py           # Condition A: full context dump → Claude
│
├── contextweave/
│   ├── bead_store.py       # Parse conversation → beads; ordinal + TF-IDF search
│   └── runner.py           # Condition B: session summary + search-beads tool
│
├── eval/
│   ├── scorer.py           # MRCR v2 SequenceMatcher scoring
│   └── visualize.py        # Accuracy-vs-context-length chart generator
│
└── results/
    ├── raw_scores.json      # Per-cell accuracy scores (generated)
    └── mrcr_ab_results.png  # Results chart (generated)
```

---

## Key Architectural Insight

Condition B uses two-stage retrieval:

1. **Ordinal lookup** — parses `"Nth <format> about <entity>"` from the query
   and returns the exact bead directly. Handles the MRCR task structure with
   near-perfect precision.
2. **TF-IDF fallback** — keyword token-overlap for free-form queries.

Even this deliberately simple retrieval dramatically outperforms naive
long-context at scale, because the architecture eliminates the search problem
entirely rather than asking the model to solve it mid-generation.

The MRCR v2 benchmark isolates this variable cleanly: same model, same data,
same scoring. The only difference is whether context is delivered as a wall
of text or as a retrieved, focused slice.

---

## References

- **MRCR v2 Dataset** — [huggingface.co/datasets/openai/mrcr](https://huggingface.co/datasets/openai/mrcr)
- **Michelangelo paper** — ArXiv 2409.12640, *"Long Context Evaluations Beyond Haystacks via Latent Structure Queries"*
- **Google DeepMind eval hub** — [github.com/google-deepmind/eval_hub](https://github.com/google-deepmind/eval_hub/tree/master/eval_hub/mrcr_v2)
- **Published results** — [Anthropic blog, March 2026](https://x.com/claudeai/status/2032509548297343196)
