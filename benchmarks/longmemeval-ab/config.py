"""Shared configuration for the LongMemEval A/B benchmark."""

# ── Model ─────────────────────────────────────────────────────────────────────
MODEL_ID = "global.anthropic.claude-sonnet-4-6"
AWS_REGION = "us-east-1"
MAX_TOKENS = 512       # answers in LongMemEval are typically short phrases
TEMPERATURE = 0.0      # deterministic for reproducibility

# ── Dataset ───────────────────────────────────────────────────────────────────
# Use the cleaned variant (removes noisy history sessions).
# longmemeval_s: ~40 sessions per question (~115k tokens each)
# longmemeval_m: ~500 sessions per question (too large for baseline)
HF_DATASET = "xiaowu0162/longmemeval-cleaned"
HF_SPLIT = "longmemeval_s_cleaned"

# Total questions to run (dataset has 500). Balanced sampling across types.
DEFAULT_SAMPLES = 500  # full benchmark — all 500 questions

# Question types in the benchmark (abstention questions have _abs suffix in id)
QUESTION_TYPES = [
    "single-session-user",
    "single-session-assistant",
    "single-session-preference",
    "multi-session",
    "temporal-reasoning",
    "knowledge-update",
]

# ── Scoring ───────────────────────────────────────────────────────────────────
# LLM judge model — same model for cost consistency
JUDGE_MODEL_ID = "global.anthropic.claude-sonnet-4-6"
JUDGE_MAX_TOKENS = 64

# ── ContextWeave condition ─────────────────────────────────────────────────────
CONTEXTWEAVE_TOP_K = 3

# ── Output ────────────────────────────────────────────────────────────────────
RESULTS_DIR = "results"
CHART_FILENAME = "longmemeval_ab_results.png"
RAW_RESULTS_FILENAME = "raw_scores.json"
