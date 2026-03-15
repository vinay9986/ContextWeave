"""
MRCR v2 A/B Test — main entry point.

Runs both conditions (Baseline and ContextWeave) against the official MRCR v2
benchmark and produces a results chart + raw JSON scores.

Uses AWS Bedrock — no separate Anthropic API key required. Credentials are
picked up from the standard AWS credential chain (SSO, env vars, ~/.aws/).

Usage:
    python run_ab_test.py [options]

Options:
    --samples N       Samples per (bin × needle_count) cell  [default: 20]
    --bins            Comma-separated context bins to test   [default: all]
    --needles         Comma-separated needle counts          [default: 2,4,8]
    --condition       Run only "baseline" or "contextweave"  [default: both]
    --plot-only       Load existing raw_scores.json and re-plot
    --region REGION   AWS region                             [default: us-east-1]
    --profile PROFILE AWS SSO profile name                   [default: default]

Example (quick dev run, 2 samples, two bins):
    python run_ab_test.py --samples 2 --bins 4096,32768 --needles 2
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import time
from pathlib import Path

import boto3
from botocore.exceptions import ClientError
from tqdm import tqdm

import config
from baseline.runner import run_baseline
from contextweave.runner import run_contextweave
from data.loader import load_mrcr
from eval.scorer import aggregate_scores, score_response
from eval.visualize import load_and_plot, plot_results


# ── CLI ────────────────────────────────────────────────────────────────────────

def _parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(description="MRCR v2 A/B benchmark runner")
    p.add_argument("--samples", type=int, default=config.DEFAULT_SAMPLES,
                   help="Samples per (bin × needle_count) cell")
    p.add_argument("--needles", default=None,
                   help="Comma-separated needle counts, e.g. 2,4,8")
    p.add_argument("--condition", choices=["baseline", "contextweave", "both"],
                   default="both")
    p.add_argument("--plot-only", action="store_true")
    p.add_argument("--region", default=config.AWS_REGION,
                   help="AWS region for Bedrock")
    p.add_argument("--profile", default=None,
                   help="AWS SSO profile name (optional)")
    return p.parse_args()


# ── Helpers ────────────────────────────────────────────────────────────────────

def _save_results(results: dict, path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, "w") as f:
        json.dump(results, f, indent=2)
    print(f"Raw scores saved → {path}")


def _cell_key(context_bin: str, num_needles: int) -> str:
    return f"{context_bin}_{num_needles}"


# ── Main benchmark loop ────────────────────────────────────────────────────────

def run_condition(
    condition: str,
    samples: list[dict],
    client: boto3.client,
) -> dict:
    """
    Run all samples for one condition and return per-cell aggregated scores.

    Returns:
        {
          "4096_2": {"accuracy": 0.95, "mean_ratio": 0.87, "n_samples": 20, ...},
          ...
        }
    """
    # Group samples by (context_length, num_needles)
    cells: dict[str, list[dict]] = {}
    for s in samples:
        key = _cell_key(s["context_bin"], s["num_needles"])
        cells.setdefault(key, []).append(s)

    cell_results: dict[str, dict] = {}

    for cell_key, cell_samples in cells.items():
        per_sample_scores = []

        for sample in tqdm(cell_samples, desc=f"{condition} [{cell_key}]", leave=False):
            try:
                if condition == "baseline":
                    response = run_baseline(sample, client)
                    tool_calls = 0
                else:
                    response, tool_calls = run_contextweave(sample, client)

                score = score_response(
                    response=response,
                    expected=sample["expected_answer"],
                    required_hash=sample["required_hash"],
                )
                score["tool_calls"] = tool_calls
                per_sample_scores.append(score)

            except ClientError as exc:
                code = exc.response["Error"]["Code"]
                print(f"\n  Bedrock error ({code}): {exc} — skipping sample")
                if code == "ThrottlingException":
                    time.sleep(10)
                continue

        cell_results[cell_key] = aggregate_scores(per_sample_scores)
        acc = cell_results[cell_key]["accuracy"]
        print(f"  [{condition}] {cell_key}: accuracy={acc:.1%} "
              f"(n={cell_results[cell_key]['n_samples']})")

    return cell_results


# ── Entry point ────────────────────────────────────────────────────────────────

def main() -> None:
    args = _parse_args()

    results_dir = Path(config.RESULTS_DIR)
    raw_scores_path = results_dir / config.RAW_RESULTS_FILENAME
    chart_path = results_dir / config.CHART_FILENAME

    # ── Plot-only mode ─────────────────────────────────────────────────────────
    if args.plot_only:
        if not raw_scores_path.exists():
            print(f"Error: {raw_scores_path} not found. Run the benchmark first.")
            sys.exit(1)
        load_and_plot(str(results_dir), str(chart_path))
        return

    # ── Bedrock client ─────────────────────────────────────────────────────────
    session = (
        boto3.Session(profile_name=args.profile)
        if args.profile
        else boto3.Session()
    )
    client = session.client("bedrock-runtime", region_name=args.region)

    # Quick auth check
    try:
        sts = session.client("sts")
        identity = sts.get_caller_identity()
        print(f"AWS identity: {identity['Arn']}")
    except Exception as e:
        print(f"Error: AWS credentials not configured ({e})")
        sys.exit(1)

    # ── Dataset ────────────────────────────────────────────────────────────────
    needle_counts = (
        [int(n) for n in args.needles.split(",")]
        if args.needles
        else config.NEEDLE_COUNTS
    )

    samples = load_mrcr(
        needle_counts=needle_counts,
        samples_per_cell=args.samples,
    )

    if not samples:
        print("No samples loaded — check your needle filter.")
        sys.exit(1)

    print(f"\n{'='*60}")
    print(f"  MRCR v2 A/B Benchmark")
    print(f"  Model:        {config.MODEL_ID}")
    print(f"  Condition:    {args.condition}")
    print(f"  Needles:      {needle_counts}")
    print(f"  Samples/cell: {args.samples}")
    print(f"  Total:        {len(samples)} samples")
    print(f"{'='*60}\n")

    # ── Load existing results if partial run ───────────────────────────────────
    raw_results: dict = {}
    if raw_scores_path.exists():
        with open(raw_scores_path) as f:
            raw_results = json.load(f)
        print(f"Resuming from existing {raw_scores_path}")

    # ── Run conditions ─────────────────────────────────────────────────────────
    conditions_to_run = (
        ["baseline", "contextweave"]
        if args.condition == "both"
        else [args.condition]
    )

    for condition in conditions_to_run:
        print(f"\n── Running condition: {condition} ──")
        raw_results[condition] = run_condition(condition, samples, client)
        # Save incrementally after each condition
        _save_results(raw_results, raw_scores_path)

    # ── Chart ──────────────────────────────────────────────────────────────────
    if "baseline" in raw_results and "contextweave" in raw_results:
        plot_results(raw_results, str(chart_path))
        print(f"\nChart → {chart_path}")

    print("\nBenchmark complete.")


if __name__ == "__main__":
    main()
