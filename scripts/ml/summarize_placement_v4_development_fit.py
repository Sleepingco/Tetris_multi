#!/usr/bin/env python3
"""Validate and summarize a V4 cumulative development-fit checkpoint.

This script audits an existing report against the frozen dataset and feature
contracts; it does not refit V4 or turn development-fit diagnostics into
held-out evidence or a production-integration decision.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import math
import os
import sys
import tempfile
from collections import Counter
from pathlib import Path
from typing import Any


EXPERIMENT_ID = "placement-v4-cumulative-75g-development-fit"
DATASET_RELATIVE_PATH = "data/datasets/human-behavior-v2-temporal-cumulative-75g-20260718"
DATASET_FILES = ("manifest.json", "train.jsonl", "validation.jsonl", "rejected.jsonl")
EXPECTED_COUNTS = {
    "manifestLifecycleGameCount": 76,
    "acceptedGameCount": 75,
    "decisionCount": 3_480,
    "candidateCount": 117_805,
}
EXPECTED_SHA256 = {
    "manifest.json": "dbf1dd5f30177abc3b44d7bdcc7e21aaf2f8a3d0015a96ba6bdfd9506c71487a",
    "train.jsonl": "0a71b121514016721d50bda5e01b298002fe8820e0a110f6b62945b4f1550120",
    "validation.jsonl": "65511767072d46484a5e4e15821bde2ee91957d02b1e16af35ec5e9da2c5274d",
    "rejected.jsonl": "84c93b3b1d8e4d82eb4dcf094bab28c35d8834dedf9566bfbe72b008b47b1085",
}
FEATURE_NAMES = (
    "candidateResult.linesCleared",
    "candidateResult.gameOver",
    "metricDelta.aggregateHeight",
    "metricDelta.maxHeight",
    "metricDelta.holes",
    "metricDelta.bumpiness",
    *(f"metricDelta.columnHeights[{index}]" for index in range(10)),
)
FLOAT_TOLERANCE = 1e-12


def reject_non_finite_constant(value: str) -> None:
    raise ValueError(f"NON_FINITE_JSON_CONSTANT:{value}")


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def load_json_object(path: Path) -> dict[str, Any]:
    value = json.loads(
        path.read_text(encoding="utf-8"),
        parse_constant=reject_non_finite_constant,
    )
    if not isinstance(value, dict):
        raise ValueError(f"JSON_OBJECT_REQUIRED:{path.name}")
    return value


def find_repository_root(start: Path) -> Path:
    for candidate in [start.resolve(), *start.resolve().parents]:
        if (candidate / "package.json").is_file() and (candidate / "python_tests").is_dir():
            return candidate
    raise ValueError("REPOSITORY_ROOT_NOT_FOUND")


def is_finite_number(value: Any) -> bool:
    return isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value)


def add_error(errors: list[str], error: str) -> None:
    if error not in errors:
        errors.append(error)


def is_sha256(value: Any) -> bool:
    return (
        isinstance(value, str)
        and len(value) == 64
        and all(character in "0123456789abcdef" for character in value)
    )


def scan_portability_contract(value: Any, errors: list[str], path: str = "report") -> None:
    if isinstance(value, dict):
        for key, child in value.items():
            if "timestamp" in str(key).lower():
                add_error(errors, f"TIMESTAMP_FIELD_FORBIDDEN:{path}.{key}")
            scan_portability_contract(child, errors, f"{path}.{key}")
        return
    if isinstance(value, list):
        for index, child in enumerate(value):
            scan_portability_contract(child, errors, f"{path}[{index}]")
        return
    if isinstance(value, str) and Path(value).is_absolute():
        add_error(errors, f"ABSOLUTE_PATH_FORBIDDEN:{path}")


def read_candidate_facts(path: Path, facts: dict[str, Any], errors: list[str]) -> int:
    row_count = 0
    with path.open("r", encoding="utf-8", errors="strict") as handle:
        for line_number, line in enumerate(handle, 1):
            if not line.strip():
                add_error(errors, f"EMPTY_JSONL_LINE:{path.name}:{line_number}")
                continue
            try:
                row = json.loads(line, parse_constant=reject_non_finite_constant)
            except (json.JSONDecodeError, ValueError) as error:
                add_error(errors, f"INVALID_JSONL:{path.name}:{line_number}:{error}")
                continue
            if not isinstance(row, dict):
                add_error(errors, f"JSON_OBJECT_LINE_REQUIRED:{path.name}:{line_number}")
                continue
            row_count += 1
            if row.get("datasetSchemaVersion") != 2:
                add_error(errors, "DATASET_SCHEMA_VERSION_MISMATCH")
            if row.get("source") != "human":
                add_error(errors, "NON_HUMAN_SOURCE_ROW")
            selected = row.get("selectedBySource")
            if not isinstance(selected, bool):
                add_error(errors, "BOOLEAN_SELECTED_REQUIRED")
                continue
            game_id = row.get("gameId")
            player_id = row.get("playerId")
            piece_index = row.get("pieceIndex")
            if not isinstance(game_id, str) or not game_id:
                add_error(errors, "GAME_ID_REQUIRED")
                continue
            if not isinstance(player_id, str) or not player_id:
                add_error(errors, "PLAYER_ID_REQUIRED")
                continue
            if not isinstance(piece_index, int) or isinstance(piece_index, bool):
                add_error(errors, "INTEGER_PIECE_INDEX_REQUIRED")
                continue
            decision_key = (game_id, player_id, piece_index)
            facts["gameIds"].add(game_id)
            facts["decisionCandidateCounts"][decision_key] += 1
            facts["decisionSelectedCounts"][decision_key] += int(selected)
    return row_count


def count_jsonl_objects(path: Path, errors: list[str]) -> int:
    count = 0
    with path.open("r", encoding="utf-8", errors="strict") as handle:
        for line_number, line in enumerate(handle, 1):
            if not line.strip():
                add_error(errors, f"EMPTY_JSONL_LINE:{path.name}:{line_number}")
                continue
            try:
                value = json.loads(line, parse_constant=reject_non_finite_constant)
            except (json.JSONDecodeError, ValueError) as error:
                add_error(errors, f"INVALID_JSONL:{path.name}:{line_number}:{error}")
                continue
            if not isinstance(value, dict):
                add_error(errors, f"JSON_OBJECT_LINE_REQUIRED:{path.name}:{line_number}")
                continue
            count += 1
    return count


def collect_dataset_facts(
    dataset_dir: Path,
    expected_counts: dict[str, int],
    expected_sha256: dict[str, str],
) -> tuple[dict[str, Any], list[str]]:
    errors: list[str] = []
    for name in DATASET_FILES:
        if not (dataset_dir / name).is_file():
            add_error(errors, f"DATASET_FILE_REQUIRED:{name}")
    if errors:
        return {}, errors

    actual_sha256 = {name: sha256_file(dataset_dir / name) for name in DATASET_FILES}
    if actual_sha256 != expected_sha256:
        add_error(errors, "SOURCE_DATASET_CHECKSUM_MISMATCH")
    manifest = load_json_object(dataset_dir / "manifest.json")
    working = {
        "gameIds": set(),
        "decisionCandidateCounts": Counter(),
        "decisionSelectedCounts": Counter(),
    }
    train_count = read_candidate_facts(dataset_dir / "train.jsonl", working, errors)
    validation_count = read_candidate_facts(dataset_dir / "validation.jsonl", working, errors)
    rejected_count = count_jsonl_objects(dataset_dir / "rejected.jsonl", errors)
    candidate_count = train_count + validation_count
    decision_count = len(working["decisionCandidateCounts"])
    game_ids = sorted(working["gameIds"])

    if any(count < 2 for count in working["decisionCandidateCounts"].values()):
        add_error(errors, "DECISION_REQUIRES_MULTIPLE_CANDIDATES")
    if any(count != 1 for count in working["decisionSelectedCounts"].values()):
        add_error(errors, "EXACTLY_ONE_SELECTED_REQUIRED")
    if len(game_ids) != expected_counts["acceptedGameCount"]:
        add_error(errors, "ACCEPTED_GAME_COUNT_MISMATCH")
    if decision_count != expected_counts["decisionCount"]:
        add_error(errors, "DECISION_COUNT_MISMATCH")
    if candidate_count != expected_counts["candidateCount"]:
        add_error(errors, "CANDIDATE_COUNT_MISMATCH")

    manifest_contract = {
        "datasetSchemaVersion": 2,
        "selectionPolicy": "all-completed",
        "sourceFilter": "human",
        "jsonParseFailureCount": 0,
        "totalGameCount": expected_counts["manifestLifecycleGameCount"],
        "trainSampleCount": train_count,
        "validationSampleCount": validation_count,
        "rejectedPlacementLogCount": rejected_count,
        "acceptedPlacementLogCount": decision_count,
    }
    for field, expected in manifest_contract.items():
        if manifest.get(field) != expected:
            add_error(errors, f"MANIFEST_FIELD_MISMATCH:{field}")
    if manifest.get("sampleCountBySource", {}).get("human") != candidate_count:
        add_error(errors, "MANIFEST_HUMAN_SAMPLE_COUNT_MISMATCH")

    game_id_sha256 = hashlib.sha256("\n".join(game_ids).encode("utf-8")).hexdigest()
    facts = {
        "checksums": actual_sha256,
        "manifestLifecycleGameCount": manifest.get("totalGameCount"),
        "acceptedGameCount": len(game_ids),
        "decisionCount": decision_count,
        "candidateCount": candidate_count,
        "trainCandidateCount": train_count,
        "validationCandidateCount": validation_count,
        "rejectedRowCount": rejected_count,
        "gameIdSha256": game_id_sha256,
    }
    return facts, errors


def validate_finite_vector(
    value: Any,
    expected_length: int,
    label: str,
    errors: list[str],
    require_positive: bool = False,
) -> list[float] | None:
    if not isinstance(value, list) or len(value) != expected_length:
        add_error(errors, f"VECTOR_LENGTH_MISMATCH:{label}")
        return None
    if not all(is_finite_number(item) for item in value):
        add_error(errors, f"FINITE_VECTOR_REQUIRED:{label}")
        return None
    result = [float(item) for item in value]
    if require_positive and any(item <= 0 for item in result):
        add_error(errors, f"POSITIVE_VECTOR_REQUIRED:{label}")
    return result


def validate_report(
    report: dict[str, Any],
    dataset_facts: dict[str, Any],
    dataset_errors: list[str],
    expected_counts: dict[str, int],
) -> list[str]:
    errors = list(dataset_errors)
    scan_portability_contract(report, errors)
    expected_fields = {
        "experimentId": EXPERIMENT_ID,
        "status": "development_checkpoint_created",
        "runMode": "full",
        "fullCohortCovered": True,
        "developmentOnly": True,
        "productionIntegration": False,
        "canonicalResultEligible": False,
        "policyDecisionEligible": False,
        "heldOutEvidence": False,
        "evaluationMetricsIncluded": False,
    }
    for field, expected in expected_fields.items():
        if report.get(field) != expected:
            add_error(errors, f"FIELD_MISMATCH:{field}:expected={expected!r}")
    if not dataset_facts:
        return errors

    dataset = report.get("dataset")
    if not isinstance(dataset, dict):
        add_error(errors, "REPORT_DATASET_OBJECT_REQUIRED")
    else:
        if dataset.get("relativePath") != DATASET_RELATIVE_PATH:
            add_error(errors, "REPORT_DATASET_PATH_MISMATCH")
        if dataset.get("checksumsBefore") != dataset_facts["checksums"]:
            add_error(errors, "REPORT_DATASET_CHECKSUM_BEFORE_MISMATCH")
        if dataset.get("checksumsAfter") != dataset_facts["checksums"]:
            add_error(errors, "REPORT_DATASET_CHECKSUM_AFTER_MISMATCH")
        count_fields = {
            "manifestLifecycleGameCount": "manifestLifecycleGameCount",
            "availableAcceptedGameCount": "acceptedGameCount",
            "availableDecisionCount": "decisionCount",
            "availableCandidateCount": "candidateCount",
        }
        for report_field, fact_field in count_fields.items():
            if dataset.get(report_field) != dataset_facts[fact_field]:
                add_error(errors, f"REPORT_DATASET_COUNT_MISMATCH:{report_field}")

    cohort = report.get("trainingCohort")
    if not isinstance(cohort, dict):
        add_error(errors, "TRAINING_COHORT_OBJECT_REQUIRED")
        cohort = {}
    cohort_contract = {
        "gameCount": dataset_facts["acceptedGameCount"],
        "decisionCount": dataset_facts["decisionCount"],
        "candidateCount": dataset_facts["candidateCount"],
        "gameIdSha256": dataset_facts["gameIdSha256"],
    }
    for field, expected in cohort_contract.items():
        if cohort.get(field) != expected:
            add_error(errors, f"TRAINING_COHORT_MISMATCH:{field}")

    representation = report.get("representation")
    if not isinstance(representation, dict):
        add_error(errors, "REPRESENTATION_OBJECT_REQUIRED")
        representation = {}
    representation_contract = {
        "name": "V4",
        "unit": "occupied-cell physical class",
        "pairWeight": "one over unique non-selected physical classes",
        "selectedClassAliasesExcluded": True,
    }
    for field, expected in representation_contract.items():
        if representation.get(field) != expected:
            add_error(errors, f"REPRESENTATION_MISMATCH:{field}")
    pair_count = representation.get("pairCount")
    pairless_count = representation.get("pairlessDecisionCount")
    represented_count = cohort.get("representedDecisionCount")
    if not isinstance(pair_count, int) or pair_count <= 0:
        add_error(errors, "POSITIVE_V4_PAIR_COUNT_REQUIRED")
    if not isinstance(pairless_count, int) or pairless_count < 0:
        add_error(errors, "NON_NEGATIVE_PAIRLESS_COUNT_REQUIRED")
    if not isinstance(represented_count, int) or represented_count <= 0:
        add_error(errors, "POSITIVE_REPRESENTED_DECISION_COUNT_REQUIRED")
    elif isinstance(pairless_count, int) and represented_count + pairless_count != expected_counts["decisionCount"]:
        add_error(errors, "REPRESENTED_PLUS_PAIRLESS_DECISION_MISMATCH")

    feature_contract = report.get("featureContract")
    if not isinstance(feature_contract, dict):
        add_error(errors, "FEATURE_CONTRACT_OBJECT_REQUIRED")
        feature_contract = {}
    if feature_contract.get("featureNames") != list(FEATURE_NAMES):
        add_error(errors, "FEATURE_ORDER_MISMATCH")
    if feature_contract.get("scalerFitScope") != "selected training cohort raw candidates only":
        add_error(errors, "SCALER_SCOPE_MISMATCH")
    if feature_contract.get("scalerFitCandidateCount") != expected_counts["candidateCount"]:
        add_error(errors, "SCALER_CANDIDATE_COUNT_MISMATCH")
    means = validate_finite_vector(feature_contract.get("mean"), 16, "scaler.mean", errors)
    scales = validate_finite_vector(feature_contract.get("scale"), 16, "scaler.scale", errors, require_positive=True)

    checkpoint = report.get("modelCheckpoint")
    if not isinstance(checkpoint, dict):
        add_error(errors, "MODEL_CHECKPOINT_OBJECT_REQUIRED")
        checkpoint = {}
    if checkpoint.get("coefficientFeatureOrder") != list(FEATURE_NAMES):
        add_error(errors, "COEFFICIENT_FEATURE_ORDER_MISMATCH")
    if checkpoint.get("intercept") is not False:
        add_error(errors, "MODEL_INTERCEPT_CONTRACT_MISMATCH")
    coefficients = validate_finite_vector(checkpoint.get("coefficients"), 16, "coefficients", errors)
    if coefficients is not None:
        expected_norm = math.sqrt(sum(value * value for value in coefficients))
        expected_max = max(abs(value) for value in coefficients)
        if not is_finite_number(checkpoint.get("coefficientL2Norm")) or not math.isclose(
            checkpoint["coefficientL2Norm"], expected_norm, rel_tol=0.0, abs_tol=FLOAT_TOLERANCE
        ):
            add_error(errors, "COEFFICIENT_L2_NORM_MISMATCH")
        if not is_finite_number(checkpoint.get("coefficientMaxAbsolute")) or not math.isclose(
            checkpoint["coefficientMaxAbsolute"], expected_max, rel_tol=0.0, abs_tol=FLOAT_TOLERANCE
        ):
            add_error(errors, "COEFFICIENT_MAX_ABSOLUTE_MISMATCH")

    estimator = report.get("estimator")
    if not isinstance(estimator, dict):
        add_error(errors, "ESTIMATOR_OBJECT_REQUIRED")
        estimator = {}
    estimator_contract = {
        "solver": "lbfgs",
        "fitIntercept": False,
        "classWeight": None,
        "tolerance": 1e-12,
        "maxIterations": 10_000,
        "l2": 0.01,
    }
    for field, expected in estimator_contract.items():
        if estimator.get(field) != expected:
            add_error(errors, f"ESTIMATOR_MISMATCH:{field}")
    expected_c = 1.0 / (expected_counts["decisionCount"] * estimator_contract["l2"])
    if not is_finite_number(estimator.get("c")) or not math.isclose(
        estimator["c"], expected_c, rel_tol=0.0, abs_tol=FLOAT_TOLERANCE
    ):
        add_error(errors, "ESTIMATOR_C_MISMATCH")

    diagnostics = report.get("trainingDiagnostics")
    if not isinstance(diagnostics, dict):
        add_error(errors, "TRAINING_DIAGNOSTICS_OBJECT_REQUIRED")
        diagnostics = {}
    if diagnostics.get("convergenceWarnings") != []:
        add_error(errors, "CONVERGENCE_WARNING_PRESENT")
    if diagnostics.get("unexpectedWarnings") != []:
        add_error(errors, "UNEXPECTED_WARNING_PRESENT")
    if isinstance(pair_count, int) and diagnostics.get("symmetricSampleCount") != pair_count * 2:
        add_error(errors, "SYMMETRIC_SAMPLE_COUNT_MISMATCH")
    if isinstance(represented_count, int):
        weight_total = diagnostics.get("sampleWeightTotal")
        if not is_finite_number(weight_total) or not math.isclose(
            weight_total, represented_count, rel_tol=0.0, abs_tol=FLOAT_TOLERANCE
        ):
            add_error(errors, "SAMPLE_WEIGHT_TOTAL_MISMATCH")
    for field in ("minimumDecisionWeight", "maximumDecisionWeight"):
        if not is_finite_number(diagnostics.get(field)) or not math.isclose(
            diagnostics[field], 1.0, rel_tol=0.0, abs_tol=FLOAT_TOLERANCE
        ):
            add_error(errors, f"DECISION_WEIGHT_MISMATCH:{field}")
    iterations = diagnostics.get("iterations")
    if not isinstance(iterations, int) or not 0 < iterations < estimator_contract["maxIterations"]:
        add_error(errors, "ITERATION_CONTRACT_MISMATCH")
    training_loss = diagnostics.get("weightedTrainingLogLoss")
    if not is_finite_number(training_loss) or not 0 <= training_loss:
        add_error(errors, "FINITE_NON_NEGATIVE_TRAINING_LOG_LOSS_REQUIRED")
    if diagnostics.get("weightedTrainingLogLossRole") != "optimization diagnostic only; not held-out performance":
        add_error(errors, "TRAINING_LOSS_ROLE_MISMATCH")

    if means is None or scales is None:
        add_error(errors, "SCALER_PARAMETERS_REQUIRED")
    return errors


def parameter_digest(report: dict[str, Any]) -> str:
    payload = {
        "featureNames": report["featureContract"]["featureNames"],
        "mean": report["featureContract"]["mean"],
        "scale": report["featureContract"]["scale"],
        "coefficients": report["modelCheckpoint"]["coefficients"],
        "estimator": report["estimator"],
        "representation": report["representation"],
    }
    encoded = json.dumps(payload, ensure_ascii=False, sort_keys=True, separators=(",", ":"), allow_nan=False)
    return hashlib.sha256(encoded.encode("utf-8")).hexdigest()


def summarize_report(
    report: dict[str, Any],
    source_report_sha256: str,
    dataset_facts: dict[str, Any],
    dataset_errors: list[str],
    expected_counts: dict[str, int] = EXPECTED_COUNTS,
) -> dict[str, Any]:
    errors = validate_report(report, dataset_facts, dataset_errors, expected_counts)
    if errors:
        return {
            "experimentId": report.get("experimentId"),
            "analysisStatus": "blocked",
            "sourceReportSha256": source_report_sha256,
            "validation": {"passed": False, "errors": errors},
        }

    features = [
        {
            "feature": feature,
            "scalerMean": report["featureContract"]["mean"][index],
            "scalerScale": report["featureContract"]["scale"][index],
            "coefficient": report["modelCheckpoint"]["coefficients"][index],
        }
        for index, feature in enumerate(FEATURE_NAMES)
    ]
    largest = sorted(features, key=lambda row: (-abs(row["coefficient"]), row["feature"]))[:5]
    return {
        "experimentId": EXPERIMENT_ID,
        "analysisStatus": "development_checkpoint_valid",
        "programGate": "continue_experimenting",
        "sourceReportSha256": source_report_sha256,
        "validation": {
            "passed": True,
            "errors": [],
            "sourceDatasetChecksumsVerified": True,
            "fullCohortCovered": True,
            "v4ContractVerified": True,
            "scalerAndCoefficientFinite": True,
            "decisionBalancedWeightVerified": True,
            "convergencePassed": True,
        },
        "checkpointBoundary": {
            "developmentOnly": True,
            "productionIntegration": False,
            "canonicalResultEligible": False,
            "policyDecisionEligible": False,
            "heldOutEvidence": False,
            "evaluationMetricsIncluded": False,
        },
        "dataset": dataset_facts,
        "trainingCohort": report["trainingCohort"],
        "representation": report["representation"],
        "estimator": report["estimator"],
        "trainingDiagnostics": report["trainingDiagnostics"],
        "modelParameters": {
            "parameterSha256": parameter_digest(report),
            "coefficientL2Norm": report["modelCheckpoint"]["coefficientL2Norm"],
            "coefficientMaxAbsolute": report["modelCheckpoint"]["coefficientMaxAbsolute"],
            "features": features,
            "largestAbsoluteCoefficients": largest,
        },
        "interpretation": {
            "observed": [
                "검증된 75게임 전체에 V4 development batch fit이 적용됐다.",
                "Scaler, coefficient, pair weight와 convergence 계약이 통과했다.",
            ],
            "canClaim": [
                "동일한 입력과 환경에서 development checkpoint를 재현할 수 있다.",
                "V4 occupied-cell class-balanced representation으로 학습이 수치적으로 수렴했다.",
            ],
            "cannotClaim": [
                "Held-out 일반화 성능이 개선됐다고 말할 수 없다.",
                "Gameplay 승률, production readiness 또는 PVE 승격 근거가 아니다.",
            ],
            "nextGate": "새 immutable temporal holdout cohort로 V4 development checkpoint를 평가한다.",
        },
    }


def format_number(value: Any) -> str:
    if isinstance(value, float):
        return f"{value:.12g}"
    return str(value)


def render_markdown(summary: dict[str, Any]) -> str:
    lines = [
        "# Placement V4 cumulative development-fit 요약",
        "",
        f"- 분석 상태: `{summary['analysisStatus']}`",
        f"- 원본 report SHA-256: `{summary['sourceReportSha256']}`",
        "",
        "## 검증",
        "",
        f"- 통과: `{str(summary['validation']['passed']).lower()}`",
    ]
    if not summary["validation"]["passed"]:
        lines.extend(f"- `{error}`" for error in summary["validation"]["errors"])
        return "\n".join(lines) + "\n"

    dataset = summary["dataset"]
    cohort = summary["trainingCohort"]
    representation = summary["representation"]
    diagnostics = summary["trainingDiagnostics"]
    boundary = summary["checkpointBoundary"]
    lines.extend([
        "- Dataset checksum: 네 파일 모두 실제 source와 일치",
        "- V4/scaler/coefficient/weight/convergence 계약: 통과",
        "",
        "## Checkpoint 경계",
        "",
        f"- developmentOnly: `{str(boundary['developmentOnly']).lower()}`",
        f"- productionIntegration: `{str(boundary['productionIntegration']).lower()}`",
        f"- canonicalResultEligible: `{str(boundary['canonicalResultEligible']).lower()}`",
        f"- heldOutEvidence: `{str(boundary['heldOutEvidence']).lower()}`",
        "",
        "## Dataset과 training cohort",
        "",
        f"- Manifest lifecycle game: {dataset['manifestLifecycleGameCount']}",
        f"- Accepted training game: {cohort['gameCount']}",
        f"- Decision: {cohort['decisionCount']}",
        f"- Candidate: {cohort['candidateCount']}",
        f"- Represented / pairless decision: {cohort['representedDecisionCount']} / {representation['pairlessDecisionCount']}",
        "",
        "## V4 학습 진단",
        "",
        f"- Physical-class pair: {representation['pairCount']}",
        f"- Symmetric sample: {diagnostics['symmetricSampleCount']}",
        f"- Sample-weight 합: {format_number(diagnostics['sampleWeightTotal'])}",
        f"- Decision weight min/max: {format_number(diagnostics['minimumDecisionWeight'])} / {format_number(diagnostics['maximumDecisionWeight'])}",
        f"- Iteration: {diagnostics['iterations']}",
        f"- Weighted training log loss: {format_number(diagnostics['weightedTrainingLogLoss'])} (optimization 진단 전용)",
        f"- Convergence/unexpected warning: {len(diagnostics['convergenceWarnings'])} / {len(diagnostics['unexpectedWarnings'])}",
        "",
        "## Scaler와 coefficient",
        "",
        f"- Parameter SHA-256: `{summary['modelParameters']['parameterSha256']}`",
        f"- Coefficient L2 norm: {format_number(summary['modelParameters']['coefficientL2Norm'])}",
        f"- Coefficient max absolute: {format_number(summary['modelParameters']['coefficientMaxAbsolute'])}",
        "",
        "| Feature | Scaler mean | Scaler scale | Coefficient |",
        "|---|---:|---:|---:|",
    ])
    for row in summary["modelParameters"]["features"]:
        lines.append(
            f"| `{row['feature']}` | {format_number(row['scalerMean'])} | "
            f"{format_number(row['scalerScale'])} | {format_number(row['coefficient'])} |"
        )
    interpretation = summary["interpretation"]
    lines.extend(["", "## 관측", ""])
    lines.extend(f"- {item}" for item in interpretation["observed"])
    lines.extend(["", "## 말할 수 있는 것", ""])
    lines.extend(f"- {item}" for item in interpretation["canClaim"])
    lines.extend(["", "## 아직 말할 수 없는 것", ""])
    lines.extend(f"- {item}" for item in interpretation["cannotClaim"])
    lines.extend(["", "## 다음 gate", "", interpretation["nextGate"]])
    return "\n".join(lines) + "\n"


def same_inode(left: Path, right: Path) -> bool:
    left_stat, right_stat = left.stat(), right.stat()
    return (left_stat.st_dev, left_stat.st_ino) == (right_stat.st_dev, right_stat.st_ino)


def assert_safe_output(output_path: Path, protected_files: list[Path], protected_dirs: list[Path]) -> None:
    lexical = Path(os.path.abspath(output_path))
    resolved = output_path.resolve(strict=False)
    if output_path.is_symlink():
        raise ValueError("OUTPUT_SYMLINK_FORBIDDEN")
    for directory in protected_dirs:
        if resolved == directory.resolve(strict=True) or resolved.is_relative_to(directory.resolve(strict=True)):
            raise ValueError("OUTPUT_INSIDE_SOURCE_DATASET")
    for protected in protected_files:
        if lexical == Path(os.path.abspath(protected)) or resolved == protected.resolve(strict=True):
            raise ValueError("OUTPUT_INPUT_COLLISION")
        if output_path.exists() and same_inode(output_path, protected):
            raise ValueError("UNSAFE_OUTPUT_ALIAS")


def atomic_write_text(
    output_path: Path,
    text: str,
    protected_files: list[Path],
    protected_dirs: list[Path],
) -> None:
    assert_safe_output(output_path, protected_files, protected_dirs)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    descriptor, staging_name = tempfile.mkstemp(
        prefix=f".{output_path.name}.", suffix=".tmp", dir=output_path.parent
    )
    staging_path = Path(staging_name)
    try:
        assert_safe_output(staging_path, protected_files, protected_dirs)
        with os.fdopen(descriptor, "w", encoding="utf-8", newline="\n") as handle:
            handle.write(text)
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(staging_path, output_path)
    finally:
        if staging_path.exists():
            staging_path.unlink()


def outputs_alias(left: Path, right: Path) -> bool:
    if left.resolve(strict=False) == right.resolve(strict=False):
        return True
    return left.exists() and right.exists() and same_inode(left, right)


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("report", type=Path, help="V4 cumulative development-fit full report JSON")
    parser.add_argument("--dataset-dir", type=Path, help="Override the project-relative immutable dataset directory")
    parser.add_argument("--output-json", type=Path)
    parser.add_argument("--output-md", type=Path)
    return parser.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv)
    root = find_repository_root(Path.cwd())
    report_path = args.report.resolve(strict=True)
    report = load_json_object(report_path)
    dataset_dir = (args.dataset_dir or root / DATASET_RELATIVE_PATH).resolve(strict=True)
    output_json = args.output_json or report_path.with_name("summary.json")
    output_md = args.output_md or report_path.with_name("summary.md")
    if outputs_alias(output_json, output_md):
        raise ValueError("OUTPUT_PATHS_MUST_DIFFER")

    dataset_facts, dataset_errors = collect_dataset_facts(
        dataset_dir,
        EXPECTED_COUNTS,
        EXPECTED_SHA256,
    )
    summary = summarize_report(
        report,
        sha256_file(report_path),
        dataset_facts,
        dataset_errors,
        EXPECTED_COUNTS,
    )
    json_text = json.dumps(summary, ensure_ascii=False, sort_keys=True, indent=2, allow_nan=False) + "\n"
    markdown_text = render_markdown(summary)
    protected_files = [report_path, *[dataset_dir / name for name in DATASET_FILES]]
    protected_dirs = [dataset_dir]
    assert_safe_output(output_json, protected_files, protected_dirs)
    assert_safe_output(output_md, protected_files, protected_dirs)
    atomic_write_text(output_json, json_text, protected_files, protected_dirs)
    atomic_write_text(output_md, markdown_text, protected_files, protected_dirs)
    print(json.dumps({
        "analysisStatus": summary["analysisStatus"],
        "outputJson": str(output_json),
        "outputMarkdown": str(output_md),
        "sourceReportSha256": summary["sourceReportSha256"],
    }, ensure_ascii=False, sort_keys=True))
    return 0 if summary["validation"]["passed"] else 2


if __name__ == "__main__":
    sys.exit(main())
