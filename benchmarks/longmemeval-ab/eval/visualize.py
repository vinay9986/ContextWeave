"""
Results visualisation for the LongMemEval A/B benchmark.

Produces two charts:
  1. Accuracy by question type — grouped bar chart (Baseline vs ContextWeave)
  2. Average input tokens by question type — shows the cost efficiency story
"""

from __future__ import annotations

import json
from pathlib import Path

import matplotlib.pyplot as plt
import matplotlib.ticker as mticker
import numpy as np
import seaborn as sns

_COLORS = {
    "baseline":     "#64748b",   # slate
    "contextweave": "#22c55e",   # green
}

_LABELS = {
    "baseline":     "Baseline (full context)",
    "contextweave": "ContextWeave (bead retrieval)",
}

_QUESTION_TYPE_LABELS = {
    "single-session-user":       "Single-session\n(user info)",
    "single-session-assistant":  "Single-session\n(assistant info)",
    "single-session-preference": "Single-session\n(preference)",
    "multi-session":             "Multi-session",
    "temporal-reasoning":        "Temporal\nreasoning",
    "knowledge-update":          "Knowledge\nupdate",
}


def plot_results(raw_results: dict, output_path: str) -> None:
    """
    Generate and save the results chart.

    Args:
        raw_results:  Dict loaded from raw_scores.json.
        output_path:  File path for the saved PNG.
    """
    sns.set_theme(style="darkgrid", context="talk")
    fig, (ax1, ax2) = plt.subplots(1, 2, figsize=(16, 7))

    # Collect all question types that appear in either condition
    all_types: set[str] = set()
    for condition_data in raw_results.values():
        all_types.update(condition_data.keys())
    qtypes = sorted(all_types)
    x = np.arange(len(qtypes))
    width = 0.35

    # ── Chart 1: Accuracy ─────────────────────────────────────────────────────
    for i, condition in enumerate(("baseline", "contextweave")):
        data = raw_results.get(condition, {})
        accuracies = [data.get(qt, {}).get("accuracy", 0) * 100 for qt in qtypes]
        offset = (i - 0.5) * width
        bars = ax1.bar(x + offset, accuracies, width,
                       label=_LABELS[condition],
                       color=_COLORS[condition],
                       alpha=0.85)
        for bar, val in zip(bars, accuracies):
            if val > 0:
                ax1.text(bar.get_x() + bar.get_width() / 2, bar.get_height() + 1,
                         f"{val:.0f}%", ha="center", va="bottom", fontsize=8)

    tick_labels = [_QUESTION_TYPE_LABELS.get(qt, qt) for qt in qtypes]
    ax1.set_xticks(x)
    ax1.set_xticklabels(tick_labels, fontsize=9)
    ax1.set_ylim(0, 115)
    ax1.set_ylabel("Accuracy (%)", fontsize=12)
    ax1.set_title("Answer Accuracy by Question Type", fontsize=13, fontweight="bold")
    ax1.legend(fontsize=10)

    # ── Chart 2: Token cost ───────────────────────────────────────────────────
    for i, condition in enumerate(("baseline", "contextweave")):
        data = raw_results.get(condition, {})
        tokens = [data.get(qt, {}).get("avg_input_tokens", 0) / 1000 for qt in qtypes]
        offset = (i - 0.5) * width
        bars = ax2.bar(x + offset, tokens, width,
                       label=_LABELS[condition],
                       color=_COLORS[condition],
                       alpha=0.85)
        for bar, val in zip(bars, tokens):
            if val > 0:
                ax2.text(bar.get_x() + bar.get_width() / 2, bar.get_height() + 0.5,
                         f"{val:.0f}K", ha="center", va="bottom", fontsize=8)

    ax2.set_xticks(x)
    ax2.set_xticklabels(tick_labels, fontsize=9)
    ax2.set_ylabel("Avg Input Tokens (K)", fontsize=12)
    ax2.set_title("Token Cost per Question", fontsize=13, fontweight="bold")
    ax2.legend(fontsize=10)
    ax2.yaxis.set_major_formatter(mticker.FuncFormatter(lambda v, _: f"{v:.0f}K"))

    # ── Overall stats annotation ───────────────────────────────────────────────
    for condition in ("baseline", "contextweave"):
        data = raw_results.get(condition, {})
        if data:
            all_samples = [c for c in data.values() if isinstance(c, dict)]
            total_n = sum(c.get("n_samples", 0) for c in all_samples)
            total_correct = sum(c.get("n_correct", 0) for c in all_samples)
            overall_acc = total_correct / total_n if total_n else 0
            avg_tokens = (
                sum(c.get("avg_input_tokens", 0) * c.get("n_samples", 0) for c in all_samples)
                / total_n if total_n else 0
            )
            label = _LABELS[condition]
            print(f"  {label}: accuracy={overall_acc:.1%}, avg_input_tokens={avg_tokens:.0f}")

    plt.suptitle(
        "LongMemEval A/B: ContextWeave vs Baseline (Full Context)\n"
        "Claude Sonnet 4.6 via AWS Bedrock",
        fontsize=14, fontweight="bold", y=1.02,
    )
    plt.tight_layout()
    plt.savefig(output_path, dpi=180, bbox_inches="tight")
    plt.close()
    print(f"Chart saved → {output_path}")


def load_and_plot(results_dir: str, output_path: str) -> None:
    raw_path = Path(results_dir) / "raw_scores.json"
    with open(raw_path) as f:
        raw = json.load(f)
    plot_results(raw, output_path)
