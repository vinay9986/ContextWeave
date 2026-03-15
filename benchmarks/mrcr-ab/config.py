"""Shared configuration for the MRCR v2 A/B benchmark."""

# ── Model ─────────────────────────────────────────────────────────────────────
# Same model for both conditions — the only variable is context strategy.
# Using Bedrock cross-region inference profile (no separate API key required).
MODEL_ID = "global.anthropic.claude-sonnet-4-6"
AWS_REGION = "us-east-1"
MAX_TOKENS = 1024          # max tokens for model answer
TEMPERATURE = 0.0          # deterministic for reproducibility

# ── Dataset ───────────────────────────────────────────────────────────────────
HF_DATASET = "openai/mrcr"

# MRCR v2 uses n_chars (character count) not token count.
# Approximate conversion: 1 token ≈ 4 chars.
# Bins below map roughly to: 4K, 32K, 128K, 256K, 1M tokens.
#
# The dataset ranges from ~15K to ~5M chars.
# Format: (label, min_chars_inclusive, max_chars_exclusive)
CONTEXT_BINS = [
    ("~4K tokens",   0,          80_000),
    ("~32K tokens",  80_000,     400_000),
    ("~128K tokens", 400_000,    800_000),
    ("~256K tokens", 800_000,    1_600_000),
    ("~1M tokens",   1_600_000,  999_999_999),
]

# Needle variants available: 2, 4, 8
NEEDLE_COUNTS = [2, 4, 8]

# Samples per (bin × needle_count) cell.
# MRCR v2 provides 100 per cell; reduce for cost control during development.
DEFAULT_SAMPLES = 20

# ── ContextWeave condition ─────────────────────────────────────────────────────
# Number of top beads to inject into the prompt.
CONTEXTWEAVE_TOP_K = 3

# Retrieval strategy: "tfidf" (fast, no extra deps) or "embedding" (better quality)
RETRIEVAL_STRATEGY = "tfidf"

# ── Scoring ───────────────────────────────────────────────────────────────────
# SequenceMatcher ratio above this threshold counts as a correct retrieval.
CORRECT_THRESHOLD = 0.6

# ── Output ────────────────────────────────────────────────────────────────────
RESULTS_DIR = "results"
CHART_FILENAME = "mrcr_ab_results.png"
RAW_RESULTS_FILENAME = "raw_scores.json"
