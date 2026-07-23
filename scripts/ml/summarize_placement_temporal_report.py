#!/usr/bin/env python3
"""Validate and compact a placement temporal holdout full report.

This post-processing step never trains a model.  It checks held-out aggregates,
per-game arithmetic, dataset checksums, and portable output fields before
writing a smaller summary for review.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import math
import os
import sys
import tempfile
from pathlib import Path
from typing import Any


EXPERIMENT_ID = "placement-temporal-holdout-v0-v4"
VARIANTS = ("V0", "V4")
DATASET_FILES = ("manifest.json", "train.jsonl", "validation.jsonl", "rejected.jsonl")
METRIC_FIELDS = (
    "decisionCount",
    "top1Count",
    "top3Count",
    "top1Accuracy",
    "top3Accuracy",
    "mrr",
    "meanSelectedRank",
    "tieAwareTop1Count",
    "topScoreTieDecisionCount",
)
FLOAT_TOLERANCE = 1e-12
GAME_DELTA_TOLERANCE = 1e-15


def reject_non_finite_constant(value: str) -> None:
    raise ValueError(f"NON_FINITE_JSON_CONSTANT:{value}")


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def load_report(path: Path) -> dict[str, Any]:
    value = json.loads(
        path.read_text(encoding="utf-8"),
        parse_constant=reject_non_finite_constant,
    )
    if not isinstance(value, dict):
        raise ValueError("REPORT_OBJECT_REQUIRED")
    return value


def nested(value: dict[str, Any], *path: str) -> Any:
    current: Any = value
    for key in path:
        if not isinstance(current, dict) or key not in current:
            raise KeyError(".".join(path))
        current = current[key]
    return current


def is_finite_number(value: Any) -> bool:
    return isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value)


def validate_metric(metric: Any, label: str, errors: list[str]) -> None:
    initial_error_count = len(errors)
    if not isinstance(metric, dict):
        errors.append(f"METRIC_OBJECT_REQUIRED:{label}")
        return
    for field in METRIC_FIELDS:
        if field not in metric or not is_finite_number(metric[field]):
            errors.append(f"FINITE_METRIC_REQUIRED:{label}.{field}")
    if len(errors) != initial_error_count:
        return
    decision_count = metric["decisionCount"]
    if not isinstance(decision_count, int) or decision_count <= 0:
        errors.append(f"POSITIVE_DECISION_COUNT_REQUIRED:{label}")
        return
    for field in ("top1Count", "top3Count", "tieAwareTop1Count", "topScoreTieDecisionCount"):
        if not isinstance(metric[field], int) or not 0 <= metric[field] <= decision_count:
            errors.append(f"METRIC_COUNT_RANGE:{label}.{field}")
    if metric["top1Count"] > metric["top3Count"]:
        errors.append(f"TOP_COUNT_ORDER:{label}")
    if not math.isclose(metric["top1Accuracy"], metric["top1Count"] / decision_count, abs_tol=FLOAT_TOLERANCE):
        errors.append(f"TOP1_ACCURACY_MISMATCH:{label}")
    if not math.isclose(metric["top3Accuracy"], metric["top3Count"] / decision_count, abs_tol=FLOAT_TOLERANCE):
        errors.append(f"TOP3_ACCURACY_MISMATCH:{label}")


def validate_dataset_checksums(report: dict[str, Any], errors: list[str]) -> None:
    before = report.get("datasetChecksums")
    after = report.get("datasetChecksumsAfter")
    if not isinstance(before, dict) or not isinstance(after, dict):
        errors.append("DATASET_CHECKSUM_OBJECTS_REQUIRED")
        return
    if before != after:
        errors.append("DATASET_CHECKSUM_MUTATION")
    for cohort in ("base", "cumulative"):
        checksums = before.get(cohort)
        if not isinstance(checksums, dict) or set(checksums) != set(DATASET_FILES):
            errors.append(f"DATASET_CHECKSUM_SET_MISMATCH:{cohort}")
            continue
        for name, checksum in checksums.items():
            if not isinstance(checksum, str) or len(checksum) != 64:
                errors.append(f"SHA256_REQUIRED:{cohort}.{name}")


def validate_aggregate(
    aggregate: dict[str, Any],
    per_game: list[dict[str, Any]],
    scope: str,
    label: str,
    errors: list[str],
) -> None:
    initial_error_count = len(errors)
    validate_metric(aggregate, label, errors)
    metrics = [row.get(scope) for row in per_game]
    if any(not isinstance(metric, dict) for metric in metrics):
        errors.append(f"PER_GAME_CHOICE_METRIC_REQUIRED:{label}")
        return
    for index, metric in enumerate(metrics):
        validate_metric(metric, f"{label}.perGame[{index}]", errors)
    if len(errors) != initial_error_count:
        return
    decision_count = sum(metric["decisionCount"] for metric in metrics)
    if aggregate["decisionCount"] != decision_count:
        errors.append(f"AGGREGATE_DECISION_COUNT_MISMATCH:{label}")
    for field in ("top1Count", "top3Count", "tieAwareTop1Count", "topScoreTieDecisionCount"):
        if aggregate[field] != sum(metric[field] for metric in metrics):
            errors.append(f"AGGREGATE_COUNT_MISMATCH:{label}.{field}")
    for field in ("mrr", "meanSelectedRank"):
        expected = sum(metric[field] * metric["decisionCount"] for metric in metrics) / decision_count
        if not math.isclose(aggregate[field], expected, rel_tol=0.0, abs_tol=FLOAT_TOLERANCE):
            errors.append(f"AGGREGATE_WEIGHTED_METRIC_MISMATCH:{label}.{field}")


def validate_report(report: dict[str, Any]) -> list[str]:
    errors: list[str] = []
    expected_values = {
        "experimentId": EXPERIMENT_ID,
        "runMode": "full",
        "fullCohortCovered": True,
        "policyDecisionEligible": True,
        "canonicalResultEligible": False,
        "productionIntegration": False,
        "status": "needs_policy_decision",
    }
    for field, expected in expected_values.items():
        if report.get(field) != expected:
            errors.append(f"FIELD_MISMATCH:{field}:expected={expected!r}")
    if report.get("sourceChecksumBefore") != report.get("sourceChecksumAfter"):
        errors.append("SOURCE_CHECKSUM_MUTATION")
    source_checksum = report.get("sourceChecksumBefore")
    if not isinstance(source_checksum, str) or len(source_checksum) != 64 or any(
        character not in "0123456789abcdef" for character in source_checksum
    ):
        errors.append("SOURCE_SHA256_REQUIRED")
    validate_dataset_checksums(report, errors)

    try:
        cohorts = nested(report, "cohorts")
        evaluated_ids = cohorts["evaluatedGameIds"]
        if cohorts["baseGameCount"] != 26:
            errors.append("BASE_GAME_COUNT_MISMATCH")
        if cohorts["newGameCount"] != cohorts["evaluatedNewGameCount"]:
            errors.append("FULL_NEW_COHORT_NOT_COVERED")
        if len(evaluated_ids) != cohorts["newGameCount"] or len(set(evaluated_ids)) != len(evaluated_ids):
            errors.append("EVALUATED_GAME_ID_COUNT_MISMATCH")
        if evaluated_ids != sorted(evaluated_ids):
            errors.append("EVALUATED_GAME_ID_ORDER_MISMATCH")
        if cohorts["cumulativeGameCount"] != cohorts["baseGameCount"] + cohorts["newGameCount"]:
            errors.append("COHORT_GAME_COUNT_MISMATCH")
    except (KeyError, TypeError) as error:
        errors.append(f"COHORT_CONTRACT_REQUIRED:{error}")
        return errors

    if nested(report, "diagnostics", "gameIdLeakageCount") != 0:
        errors.append("GAME_ID_LEAKAGE")
    for variant in VARIANTS:
        training = nested(report, "training", variant)
        if training.get("convergenceWarnings") != []:
            errors.append(f"CONVERGENCE_WARNING:{variant}")
        if training.get("unexpectedWarnings") != []:
            errors.append(f"UNEXPECTED_TRAINING_WARNING:{variant}")
        for field in ("pairCount", "symmetricSampleCount", "sampleWeightTotal", "iterations", "c"):
            if not is_finite_number(training.get(field)) or training[field] <= 0:
                errors.append(f"POSITIVE_TRAINING_VALUE_REQUIRED:{variant}.{field}")

        for evaluation_unit in ("physicalClass", "rawCandidate"):
            evaluation = nested(report, "evaluation", variant, evaluation_unit)
            per_game = evaluation.get("perGame")
            if not isinstance(per_game, list):
                errors.append(f"PER_GAME_LIST_REQUIRED:{variant}.{evaluation_unit}")
                continue
            game_ids = [row.get("gameId") for row in per_game if isinstance(row, dict)]
            if game_ids != cohorts["evaluatedGameIds"]:
                errors.append(f"PER_GAME_COHORT_MISMATCH:{variant}.{evaluation_unit}")
            for scope in ("all", "choiceRequired"):
                validate_aggregate(
                    evaluation.get(scope, {}),
                    per_game,
                    scope,
                    f"{variant}.{evaluation_unit}.{scope}",
                    errors,
                )
    try:
        v0_count = nested(report, "evaluation", "V0", "physicalClass", "choiceRequired", "decisionCount")
        v4_count = nested(report, "evaluation", "V4", "physicalClass", "choiceRequired", "decisionCount")
        if v0_count != v4_count:
            errors.append("VARIANT_DECISION_COUNT_MISMATCH")
    except KeyError as error:
        errors.append(f"PRIMARY_METRIC_REQUIRED:{error}")
    return errors


def compact_metric(metric: dict[str, Any]) -> dict[str, Any]:
    return {field: metric[field] for field in METRIC_FIELDS}


def metric_delta(v0: dict[str, Any], v4: dict[str, Any]) -> dict[str, Any]:
    return {field: v4[field] - v0[field] for field in METRIC_FIELDS if field != "decisionCount"}


def game_delta_rows(report: dict[str, Any]) -> list[dict[str, Any]]:
    v0_rows = nested(report, "evaluation", "V0", "physicalClass", "perGame")
    v4_rows = nested(report, "evaluation", "V4", "physicalClass", "perGame")
    v4_by_game = {row["gameId"]: row for row in v4_rows}
    rows = []
    for v0_row in v0_rows:
        game_id = v0_row["gameId"]
        v0_metric = v0_row["choiceRequired"]
        v4_metric = v4_by_game[game_id]["choiceRequired"]
        rows.append({
            "gameId": game_id,
            "decisionCount": v0_metric["decisionCount"],
            "v0Mrr": v0_metric["mrr"],
            "v4Mrr": v4_metric["mrr"],
            "mrrDelta": v4_metric["mrr"] - v0_metric["mrr"],
            "top1Delta": v4_metric["top1Count"] - v0_metric["top1Count"],
        })
    return rows


def summarize_report(report: dict[str, Any], source_sha256: str) -> dict[str, Any]:
    errors = validate_report(report)
    if errors:
        return {
            "experimentId": report.get("experimentId"),
            "analysisStatus": "blocked",
            "sourceReportSha256": source_sha256,
            "validation": {"passed": False, "errors": errors},
        }

    v0_primary = nested(report, "evaluation", "V0", "physicalClass", "choiceRequired")
    v4_primary = nested(report, "evaluation", "V4", "physicalClass", "choiceRequired")
    rows = game_delta_rows(report)
    better = sum(row["mrrDelta"] > GAME_DELTA_TOLERANCE for row in rows)
    worse = sum(row["mrrDelta"] < -GAME_DELTA_TOLERANCE for row in rows)
    equal = len(rows) - better - worse
    improvements = sorted(
        [row for row in rows if row["mrrDelta"] > GAME_DELTA_TOLERANCE],
        key=lambda row: (-row["mrrDelta"], row["gameId"]),
    )[:5]
    regressions = sorted(
        [row for row in rows if row["mrrDelta"] < -GAME_DELTA_TOLERANCE],
        key=lambda row: (row["mrrDelta"], row["gameId"]),
    )[:5]
    return {
        "experimentId": EXPERIMENT_ID,
        "analysisStatus": "needs_policy_decision",
        "sourceReportSha256": source_sha256,
        "validation": {
            "passed": True,
            "errors": [],
            "fullCohortCovered": True,
            "gameIdLeakageCount": 0,
            "convergencePassed": True,
            "sourceAndDatasetChecksumsUnchanged": True,
        },
        "cohorts": report["cohorts"],
        "primaryPhysicalClassChoiceRequired": {
            "V0": compact_metric(v0_primary),
            "V4": compact_metric(v4_primary),
            "deltaV4MinusV0": metric_delta(v0_primary, v4_primary),
        },
        "gameDistributionByMrr": {
            "v4Better": better,
            "equal": equal,
            "v4Worse": worse,
            "tolerance": GAME_DELTA_TOLERANCE,
        },
        "largestImprovements": improvements,
        "largestRegressions": regressions,
        "reportedWorstGames": {
            variant: nested(report, "evaluation", variant, "physicalClass", "worstGame")
            for variant in VARIANTS
        },
        "training": report["training"],
        "diagnostics": report["diagnostics"],
        "policy": {
            "automaticAdoptionAllowed": False,
            "reason": "No pre-registered V0/V4 adoption threshold exists.",
            "allowedDecision": "adopt_v0 | adopt_v4 | needs_more_data | blocked",
        },
    }


def format_number(value: Any) -> str:
    if isinstance(value, float):
        return f"{value:.10f}"
    return str(value)


def render_markdown(summary: dict[str, Any]) -> str:
    lines = [
        "# Placement temporal holdout compact summary",
        "",
        f"- Analysis status: `{summary['analysisStatus']}`",
        f"- Source report SHA-256: `{summary['sourceReportSha256']}`",
    ]
    validation = summary["validation"]
    lines.extend(["", "## Validation", "", f"- Passed: `{str(validation['passed']).lower()}`"])
    if not validation["passed"]:
        lines.extend(f"- `{error}`" for error in validation["errors"])
        return "\n".join(lines) + "\n"

    cohorts = summary["cohorts"]
    lines.extend([
        f"- Base/new/evaluated games: {cohorts['baseGameCount']} / {cohorts['newGameCount']} / {cohorts['evaluatedNewGameCount']}",
        "- Leakage: 0; convergence: passed; source/dataset checksum: unchanged",
        "",
        "## Primary: choice-required physical class",
        "",
        "| Metric | V0 | V4 | V4 - V0 |",
        "|---|---:|---:|---:|",
    ])
    primary = summary["primaryPhysicalClassChoiceRequired"]
    for field in ("decisionCount", "top1Count", "top3Count", "mrr", "meanSelectedRank"):
        delta = "-" if field == "decisionCount" else format_number(primary["deltaV4MinusV0"][field])
        lines.append(f"| {field} | {format_number(primary['V0'][field])} | {format_number(primary['V4'][field])} | {delta} |")
    distribution = summary["gameDistributionByMrr"]
    lines.extend([
        "",
        "## Per-game MRR distribution",
        "",
        f"- V4 better / equal / worse: {distribution['v4Better']} / {distribution['equal']} / {distribution['v4Worse']}",
        "",
        "## Largest regressions",
        "",
        "| Game | Decisions | V0 MRR | V4 MRR | Delta |",
        "|---|---:|---:|---:|---:|",
    ])
    for row in summary["largestRegressions"]:
        lines.append(f"| {row['gameId']} | {row['decisionCount']} | {row['v0Mrr']:.6f} | {row['v4Mrr']:.6f} | {row['mrrDelta']:.10f} |")
    lines.extend([
        "",
        "## Largest improvements",
        "",
        "| Game | Decisions | V0 MRR | V4 MRR | Delta |",
        "|---|---:|---:|---:|---:|",
    ])
    for row in summary["largestImprovements"]:
        lines.append(f"| {row['gameId']} | {row['decisionCount']} | {row['v0Mrr']:.6f} | {row['v4Mrr']:.6f} | {row['mrrDelta']:.10f} |")
    lines.extend([
        "",
        "## Script decision",
        "",
        "`needs_policy_decision`: the report is valid, but no pre-registered adoption threshold exists.",
    ])
    return "\n".join(lines) + "\n"


def same_inode(left: Path, right: Path) -> bool:
    left_stat, right_stat = left.stat(), right.stat()
    return (left_stat.st_dev, left_stat.st_ino) == (right_stat.st_dev, right_stat.st_ino)


def atomic_write_text(output_path: Path, text: str, protected_input: Path) -> None:
    output_path.parent.mkdir(parents=True, exist_ok=True)
    if output_path.resolve(strict=False) == protected_input.resolve(strict=True):
        raise ValueError("OUTPUT_INPUT_COLLISION")
    if os.path.lexists(output_path):
        if output_path.is_symlink() or same_inode(output_path, protected_input):
            raise ValueError("UNSAFE_OUTPUT_ALIAS")
    descriptor, staging_name = tempfile.mkstemp(
        prefix=f".{output_path.name}.", suffix=".tmp", dir=output_path.parent
    )
    staging_path = Path(staging_name)
    try:
        with os.fdopen(descriptor, "w", encoding="utf-8", newline="\n") as handle:
            handle.write(text)
            handle.flush()
            os.fsync(handle.fileno())
        if same_inode(staging_path, protected_input):
            raise ValueError("STAGING_INPUT_COLLISION")
        os.replace(staging_path, output_path)
    finally:
        if staging_path.exists():
            staging_path.unlink()


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("report", type=Path, help="Full temporal holdout report JSON")
    parser.add_argument("--output-json", type=Path)
    parser.add_argument("--output-md", type=Path)
    return parser.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv)
    report_path = args.report.resolve(strict=True)
    output_json = args.output_json or report_path.with_name("summary.json")
    output_md = args.output_md or report_path.with_name("summary.md")
    if output_json.resolve(strict=False) == output_md.resolve(strict=False):
        raise ValueError("OUTPUT_PATHS_MUST_DIFFER")
    report = load_report(report_path)
    summary = summarize_report(report, sha256_file(report_path))
    json_text = json.dumps(summary, ensure_ascii=False, sort_keys=True, indent=2, allow_nan=False) + "\n"
    atomic_write_text(output_json, json_text, report_path)
    atomic_write_text(output_md, render_markdown(summary), report_path)
    print(json.dumps({
        "analysisStatus": summary["analysisStatus"],
        "outputJson": str(output_json),
        "outputMarkdown": str(output_md),
        "sourceReportSha256": summary["sourceReportSha256"],
    }, ensure_ascii=False, sort_keys=True))
    return 0 if summary["validation"]["passed"] else 2


if __name__ == "__main__":
    sys.exit(main())
