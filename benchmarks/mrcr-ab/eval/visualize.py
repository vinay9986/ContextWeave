"""
Results visualisation — generates the accuracy-vs-context-length chart.

Produces a publication-ready plot placing ContextWeave on the same axis as the
GPT-5.4 / Gemini 3.1 / Opus 4.6 reference curves from the MRCR v2 paper,
demonstrating that context rot is an architectural problem ContextWeave solves.
"""

from __future__ import annotations

import json
from pathlib import Path

import matplotlib.pyplot as plt
import matplotlib.ticker as mticker
import numpy as np
import seaborn as sns

# Reference curves from published MRCR v2 results (Reddit post / Anthropic blog)
# Keys are nominal context lengths; values are reported accuracy (0–1).
REFERENCE_CURVES = {
    "GPT-5.4 (baseline)": {
        4_096:       0.95,
        8_192:       0.92,
        32_768:      0.85,
        131_072:     0.70,
        1_048_576:   0.366,
    },
    "Gemini 3.1 Pro (baseline)": {
        4_096:       0.93,
        8_192:       0.90,
        32_768:      0.80,
        131_072:     0.60,
        1_048_576:   0.259,
    },
    "Claude Opus 4.6 (baseline)": {
        4_096:       0.97,
        8_192:       0.95,
        32_768:      0.93,
        131_072:     0.88,
        1_048_576:   0.783,
    },
}

_PALETTE = {
    "GPT-5.4 (baseline)":              "#ef4444",   # red
    "Gemini 3.1 Pro (baseline)":        "#f97316",   # orange
    "Claude Opus 4.6 (baseline)":       "#8b5cf6",   # purple
    "Baseline — Claude Sonnet 4.6":     "#64748b",   # slate (our baseline)
    "ContextWeave — Claude Sonnet 4.6": "#22c55e",   # green (our result)
}

_LINESTYLES = {
    "GPT-5.4 (baseline)":              "--",
    "Gemini 3.1 Pro (baseline)":        "--",
    "Claude Opus 4.6 (baseline)":       "--",
    "Baseline — Claude Sonnet 4.6":     "-",
    "ContextWeave — Claude Sonnet 4.6": "-",
}

_MARKERS = {
    "GPT-5.4 (baseline)":              "s",
    "Gemini 3.1 Pro (baseline)":        "D",
    "Claude Opus 4.6 (baseline)":       "^",
    "Baseline — Claude Sonnet 4.6":     "o",
    "ContextWeave — Claude Sonnet 4.6": "*",
}


def _format_tokens(x: float, _) -> str:
    if x >= 1_000_000:
        return f"{x/1_000_000:.0f}M"
    if x >= 1_000:
        return f"{x/1_000:.0f}K"
    return str(int(x))


def plot_results(
    raw_results: dict,
    output_path: str,
    needle_count: int | None = None,
) -> None:
    """
    Generate and save the accuracy-vs-context-length chart.

    Args:
        raw_results:  Dict loaded from raw_scores.json.
        output_path:  File path for the saved PNG.
        needle_count: If set, filter to this needle variant only.
    """
    sns.set_theme(style="darkgrid", context="talk")
    fig, ax = plt.subplots(figsize=(12, 7))

    # ── Reference curves (dashed) ──────────────────────────────────────────────
    for label, curve in REFERENCE_CURVES.items():
        xs = sorted(curve.keys())
        ys = [curve[x] * 100 for x in xs]
        ax.plot(
            xs, ys,
            label=label,
            color=_PALETTE[label],
            linestyle=_LINESTYLES[label],
            marker=_MARKERS[label],
            markersize=7,
            linewidth=1.8,
            alpha=0.7,
        )

    # ── Our A/B results ────────────────────────────────────────────────────────
    # Bin label → approximate token midpoint for x-axis placement
    BIN_X = {
        "~4K tokens":   4_096,
        "~32K tokens":  32_768,
        "~128K tokens": 131_072,
        "~256K tokens": 262_144,
        "~1M tokens":   1_048_576,
    }

    for condition in ("baseline", "contextweave"):
        label = (
            "Baseline — Claude Sonnet 4.6"
            if condition == "baseline"
            else "ContextWeave — Claude Sonnet 4.6"
        )
        data = raw_results.get(condition, {})

        # Aggregate across needle counts (or filter to one)
        bin_scores: dict[str, list[float]] = {}
        for key, cell in data.items():
            # key format: "<bin_label>_<num_needles>"
            # bin_label may contain spaces so split from the right on last "_"
            last_underscore = key.rfind("_")
            bin_label = key[:last_underscore]
            nn = int(key[last_underscore + 1:])
            if needle_count is not None and nn != needle_count:
                continue
            bin_scores.setdefault(bin_label, []).append(cell["accuracy"])

        if not bin_scores:
            continue

        # Map bin labels to x positions
        xs = [BIN_X[b] for b in sorted(bin_scores.keys(), key=lambda b: BIN_X.get(b, 0))]
        ys = [np.mean(bin_scores[b]) * 100
              for b in sorted(bin_scores.keys(), key=lambda b: BIN_X.get(b, 0))]

        ax.plot(
            xs, ys,
            label=label,
            color=_PALETTE[label],
            linestyle=_LINESTYLES[label],
            marker=_MARKERS[label],
            markersize=9 if condition == "contextweave" else 7,
            linewidth=2.5 if condition == "contextweave" else 2.0,
        )

    # ── Axes & labels ──────────────────────────────────────────────────────────
    ax.set_xscale("log")
    ax.xaxis.set_major_formatter(mticker.FuncFormatter(_format_tokens))
    ax.set_xticks([4_096, 8_192, 32_768, 131_072, 1_048_576])
    ax.set_xlim(3_000, 2_000_000)

    ax.set_ylim(0, 105)
    ax.set_ylabel("Retrieval Accuracy (%)", fontsize=13)
    ax.set_xlabel("Context Length (tokens)", fontsize=13)

    needle_label = f" — {needle_count}-needle" if needle_count else ""
    ax.set_title(
        f"MRCR v2 Retrieval Accuracy vs Context Length{needle_label}\n"
        f"ContextWeave vs Frontier Model Baselines",
        fontsize=14,
        fontweight="bold",
        pad=16,
    )

    ax.legend(loc="lower left", fontsize=10, framealpha=0.9)
    ax.axhline(60, color="gray", linestyle=":", linewidth=1, alpha=0.5,
               label="_Correct threshold (0.6)")

    plt.tight_layout()
    plt.savefig(output_path, dpi=180, bbox_inches="tight")
    plt.close()
    print(f"Chart saved → {output_path}")


def load_and_plot(results_dir: str, output_path: str) -> None:
    """Convenience wrapper: load raw_scores.json and generate chart."""
    raw_path = Path(results_dir) / "raw_scores.json"
    with open(raw_path) as f:
        raw = json.load(f)
    plot_results(raw, output_path)
