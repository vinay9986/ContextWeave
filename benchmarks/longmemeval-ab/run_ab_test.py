"""
LongMemEval A/B Test — main entry point.

Runs both conditions (Baseline and ContextWeave) against LongMemEval and
produces results charts + raw JSON scores.

Uses AWS Bedrock — no separate Anthropic API key required.

Usage:
    python run_ab_test.py [options]

Options:
    --samples N         Total questions to test         [default: 100]
    --types TYPE,...    Comma-separated question types  [default: all]
    --condition         Run only "baseline" or "contextweave" [default: both]
    --plot-only         Load existing raw_scores.json and re-plot
    --region REGION     AWS region                      [default: us-east-1]
    --profile PROFILE   AWS SSO profile name            [default: default]

Example (quick dev run, 10 questions):
    python run_ab_test.py --samples 10 --condition contextweave
"""

from __future__ import annotations

import argparse
import json
import logging
import sys
import time
from datetime import datetime
from pathlib import Path

import boto3
from botocore.config import Config
from botocore.exceptions import ClientError
from tqdm import tqdm

import config
from baseline.runner import run_baseline
from contextweave.runner import run_contextweave
from data.loader import load_longmemeval
from eval.scorer import aggregate_scores, judge_response
from eval.visualize import load_and_plot, plot_results


# ── Logging ───────────────────────────────────────────────────────────────────

def _setup_logger() -> logging.Logger:
    log_path = Path(f"/tmp/longmemeval_benchmark_{datetime.now().strftime('%Y%m%d_%H%M%S')}.log")
    logging.basicConfig(
        level=logging.DEBUG,
        format="%(asctime)s  %(levelname)-7s  %(message)s",
        handlers=[logging.FileHandler(log_path)],
    )
    logger = logging.getLogger("longmemeval")
    print(f"Sample-level logs → {log_path}")
    return logger


# ── CLI ────────────────────────────────────────────────────────────────────────

def _parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(description="LongMemEval A/B benchmark runner")
    p.add_argument("--samples", type=int, default=config.DEFAULT_SAMPLES,
                   help="Total questions to test (balanced across types)")
    p.add_argument("--types", default=None,
                   help="Comma-separated question types to include")
    p.add_argument("--condition", choices=["baseline", "contextweave", "both"],
                   default="both")
    p.add_argument("--plot-only", action="store_true")
    p.add_argument("--region", default=config.AWS_REGION)
    p.add_argument("--profile", default=None)
    return p.parse_args()


# ── Helpers ────────────────────────────────────────────────────────────────────

def _save_results(results: dict, path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, "w") as f:
        json.dump(results, f, indent=2)
    print(f"Raw scores saved → {path}")


# ── Main benchmark loop ────────────────────────────────────────────────────────

def run_condition(
    condition: str,
    samples: list[dict],
    client: boto3.client,
    log: logging.Logger,
) -> dict:
    """
    Run all samples for one condition.

    Returns per-question-type aggregated results:
        {
          "single-session-user": {"accuracy": 0.8, "n_samples": 16, ...},
          ...
        }
    """
    # Group by question_type
    type_samples: dict[str, list[dict]] = {}
    for s in samples:
        qt = s["question_type"]
        type_samples.setdefault(qt, []).append(s)

    type_results: dict[str, dict] = {}

    for qt, qt_samples in type_samples.items():
        per_sample_scores = []
        per_sample_slim = []
        n_failed = 0

        for s_idx, sample in enumerate(tqdm(qt_samples, desc=f"{condition} [{qt}]", leave=False)):
            for attempt in range(3):
                try:
                    # ── Run model ─────────────────────────────────────────────
                    if condition == "baseline":
                        response, usage = run_baseline(sample, client)
                        tool_calls = 0
                    else:
                        response, tool_calls, usage = run_contextweave(sample, client)

                    # ── Judge ─────────────────────────────────────────────────
                    judgment = judge_response(
                        question=sample["question"],
                        expected=sample["answer"],
                        response=response,
                        is_abstention=sample["is_abstention"],
                        client=client,
                    )

                    score = {
                        "correct": judgment["correct"],
                        "tool_calls": tool_calls,
                    }
                    per_sample_scores.append(score)
                    per_sample_slim.append({
                        "idx": s_idx,
                        "question_id": sample["question_id"],
                        "correct": judgment["correct"],
                        "judge_raw": judgment["raw"],
                        "tool_calls": tool_calls,
                        "input_tokens": usage.get("inputTokens", 0),
                        "output_tokens": usage.get("outputTokens", 0),
                        "total_tokens": usage.get("totalTokens", 0),
                        "n_sessions": sample["n_sessions"],
                        "n_turns": sample["n_turns"],
                    })

                    log.info(
                        "[%s] %s idx=%d  qid=%s  correct=%s  tool_calls=%d"
                        "  input_tokens=%d  output_tokens=%d\n"
                        "  question: %s\n"
                        "  expected: %s\n"
                        "  response: %s\n"
                        "  judge:    %s",
                        condition, qt, s_idx, sample["question_id"],
                        judgment["correct"], tool_calls,
                        usage.get("inputTokens", 0), usage.get("outputTokens", 0),
                        sample["question"][:300],
                        sample["answer"][:300],
                        response[:300],
                        judgment["raw"],
                    )
                    break

                except ClientError as exc:
                    code = exc.response["Error"]["Code"]
                    if code == "ThrottlingException" and attempt < 2:
                        wait = 15 * (2 ** attempt)
                        print(f"\n  Throttled — retrying in {wait}s (attempt {attempt + 1}/3)")
                        time.sleep(wait)
                    else:
                        print(f"\n  Bedrock error ({code}): {exc} — skipping sample")
                        log.error("[%s] %s idx=%d  FAILED: %s", condition, qt, s_idx, exc)
                        n_failed += 1
                        per_sample_slim.append({
                            "idx": s_idx,
                            "question_id": sample["question_id"],
                            "correct": False,
                            "error": str(exc),
                        })
                        break

        type_results[qt] = aggregate_scores(per_sample_scores)
        type_results[qt]["n_failed"] = n_failed
        type_results[qt]["samples"] = per_sample_slim

        if per_sample_slim:
            valid = [s for s in per_sample_slim if "input_tokens" in s]
            if valid:
                n = len(valid)
                type_results[qt]["avg_input_tokens"] = round(
                    sum(s["input_tokens"] for s in valid) / n
                )
                type_results[qt]["avg_output_tokens"] = round(
                    sum(s["output_tokens"] for s in valid) / n
                )

        acc = type_results[qt]["accuracy"]
        failed_str = f", failures={n_failed}" if n_failed else ""
        print(f"  [{condition}] {qt}: accuracy={acc:.1%}"
              f" (n={type_results[qt]['n_samples']}{failed_str})")

    return type_results


# ── Entry point ────────────────────────────────────────────────────────────────

def main() -> None:
    args = _parse_args()

    results_dir = Path(config.RESULTS_DIR)
    raw_scores_path = results_dir / config.RAW_RESULTS_FILENAME
    chart_path = results_dir / config.CHART_FILENAME

    log = _setup_logger()

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
    client = session.client(
        "bedrock-runtime",
        region_name=args.region,
        config=Config(retries={"max_attempts": 5, "mode": "adaptive"}),
    )

    try:
        sts = session.client("sts")
        identity = sts.get_caller_identity()
        print(f"AWS identity: {identity['Arn']}")
    except Exception as e:
        print(f"Error: AWS credentials not configured ({e})")
        sys.exit(1)

    # ── Dataset ────────────────────────────────────────────────────────────────
    question_types = (
        [t.strip() for t in args.types.split(",")]
        if args.types
        else None
    )

    samples = load_longmemeval(
        total_samples=args.samples,
        question_types=question_types,
    )

    if not samples:
        print("No samples loaded.")
        sys.exit(1)

    print(f"\n{'='*60}")
    print(f"  LongMemEval A/B Benchmark")
    print(f"  Model:      {config.MODEL_ID}")
    print(f"  Condition:  {args.condition}")
    print(f"  Total:      {len(samples)} questions")
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
        raw_results[condition] = run_condition(condition, samples, client, log)
        _save_results(raw_results, raw_scores_path)

    # ── Chart ──────────────────────────────────────────────────────────────────
    if "baseline" in raw_results and "contextweave" in raw_results:
        plot_results(raw_results, str(chart_path))
        print(f"\nChart → {chart_path}")

    print("\nBenchmark complete.")


if __name__ == "__main__":
    main()
