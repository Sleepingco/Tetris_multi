#!/usr/bin/env python3
"""Fit the frozen V4 placement ranker without evaluating or integrating it."""

from __future__ import annotations

import argparse
import hashlib
import json
import math
import os
import platform
import secrets
import sys
import warnings
from collections import Counter, defaultdict
from pathlib import Path
from typing import Any, Iterable

import numpy as np
import scipy
import sklearn
from sklearn.exceptions import ConvergenceWarning
from sklearn.linear_model import LogisticRegression
from sklearn.preprocessing import StandardScaler


EXPERIMENT_ID = "placement-v4-125g-final-trainer"
DATASET_RELATIVE_PATH = "data/datasets/human-behavior-v2-temporal-cumulative-125g-20260720"
DATASET_FILES = ("manifest.json", "train.jsonl", "validation.jsonl", "rejected.jsonl")
EXPECTED_CHECKSUMS = {
    "manifest.json": "07fa9b76e868ac10f3cf4893aa7200ba0808971979f7f796152f7b3bfb3bd6ef",
    "train.jsonl": "986b5a6214aad13f13a239e4fe4a7c81582383dea6b16b1be6f046f2dbadd436",
    "validation.jsonl": "c468e24bbc48d94af5860bd2e5c7b90f2366a9cb9a32dba3abe7cdcce7af67bb",
    "rejected.jsonl": "0a19fab244c167384fdd5584f7495987ba4833576664fb78c1feacdb14d120e0",
}
EXPECTED_COUNTS = {
    "gameCount": 125,
    "decisionCount": 5682,
    "candidateCount": 192129,
    "normalDecisionCount": 4500,
    "hardDecisionCount": 1182,
}
FEATURE_NAMES = (
    "candidateResult.linesCleared",
    "candidateResult.gameOver",
    "metricDelta.aggregateHeight",
    "metricDelta.maxHeight",
    "metricDelta.holes",
    "metricDelta.bumpiness",
    "metricDelta.columnHeights[0]",
    "metricDelta.columnHeights[1]",
    "metricDelta.columnHeights[2]",
    "metricDelta.columnHeights[3]",
    "metricDelta.columnHeights[4]",
    "metricDelta.columnHeights[5]",
    "metricDelta.columnHeights[6]",
    "metricDelta.columnHeights[7]",
    "metricDelta.columnHeights[8]",
    "metricDelta.columnHeights[9]",
)
FORBIDDEN_LEAKAGE_INPUTS = (
    "heuristicBaseline.score",
    "metadata.inputSequence",
    "metadata.isWinner",
    "selectedBySource",
    "winnerPlayerId",
)
L2 = 0.01
TOLERANCE = 1e-12
MAX_ITERATIONS = 10_000


class ContractError(ValueError):
    """Raised when immutable data or frozen training contracts are violated."""


def require(condition: bool, reason: str) -> None:
    if not condition:
        raise ContractError(reason)


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def json_bytes(payload: dict[str, Any]) -> bytes:
    return (json.dumps(
        payload,
        ensure_ascii=False,
        sort_keys=True,
        indent=2,
        allow_nan=False,
    ) + "\n").encode("utf-8")


def decision_key(row: dict[str, Any]) -> str:
    return f"{row['gameId']}:{row['playerId']}:{row['pieceIndex']}"


def placement_key(row: dict[str, Any]) -> str:
    placement = row["candidatePlacement"]
    return ":".join(map(str, (
        placement["pieceType"],
        placement["rotation"],
        placement["row"],
        placement["col"],
    )))


def equivalence_key(row: dict[str, Any]) -> str:
    placement = row["candidatePlacement"]
    cells = sorted((cell["row"], cell["col"]) for cell in placement["cells"])
    cell_text = ";".join(f"{row},{col}" for row, col in cells)
    return f"{placement['pieceType']}|{cell_text}"


def extract_features(row: dict[str, Any]) -> tuple[float, ...]:
    result = row.get("candidateResult")
    delta = row.get("metricDelta")
    columns = delta.get("columnHeights") if isinstance(delta, dict) else None
    require(isinstance(result, dict) and isinstance(delta, dict), "FEATURE_OBJECT_REQUIRED")
    require(isinstance(columns, list) and len(columns) == 10, "COLUMN_HEIGHT_DELTA_REQUIRED")
    values = (
        result.get("linesCleared"),
        int(result.get("gameOver")) if isinstance(result.get("gameOver"), bool) else None,
        delta.get("aggregateHeight"),
        delta.get("maxHeight"),
        delta.get("holes"),
        delta.get("bumpiness"),
        *columns,
    )
    require(
        len(values) == len(FEATURE_NAMES)
        and all(isinstance(value, (int, float)) and not isinstance(value, bool)
                and math.isfinite(value) for value in values),
        "FINITE_16_FEATURE_VECTOR_REQUIRED",
    )
    return tuple(float(value) for value in values)


def compact_candidate(row: dict[str, Any]) -> dict[str, Any]:
    require(row.get("datasetSchemaVersion") == 2, "DATASET_SCHEMA_VERSION_MISMATCH")
    require(row.get("source") == "human", "HUMAN_SOURCE_REQUIRED")
    require(type(row.get("selectedBySource")) is bool, "SELECTED_BY_SOURCE_BOOLEAN_REQUIRED")
    require(row.get("aiDifficulty") in ("normal", "hard"), "AI_DIFFICULTY_REQUIRED")
    placement = row.get("candidatePlacement")
    require(isinstance(placement, dict), "CANDIDATE_PLACEMENT_REQUIRED")
    require(isinstance(placement.get("pieceType"), str), "PIECE_TYPE_REQUIRED")
    require(isinstance(placement.get("cells"), list) and placement["cells"], "OCCUPIED_CELLS_REQUIRED")
    for cell in placement["cells"]:
        require(
            isinstance(cell, dict)
            and isinstance(cell.get("row"), int)
            and isinstance(cell.get("col"), int),
            "FINITE_OCCUPIED_CELL_REQUIRED",
        )
    result = row.get("candidateResult")
    require(
        isinstance(result, dict)
        and isinstance(result.get("linesCleared"), int)
        and isinstance(result.get("gameOver"), bool),
        "CANDIDATE_RESULT_REQUIRED",
    )
    for field in ("gameId", "playerId"):
        require(isinstance(row.get(field), str) and row[field], f"{field.upper()}_REQUIRED")
    require(isinstance(row.get("pieceIndex"), int), "PIECE_INDEX_REQUIRED")
    return {
        "gameId": row["gameId"],
        "decisionKey": decision_key(row),
        "placementKey": placement_key(row),
        "equivalenceKey": equivalence_key(row),
        "selected": row["selectedBySource"],
        "difficulty": row["aiDifficulty"],
        "features": extract_features(row),
        "linesCleared": result["linesCleared"],
        "gameOver": result["gameOver"],
    }


def current_checksums(dataset_dir: Path) -> dict[str, str]:
    for name in DATASET_FILES:
        require((dataset_dir / name).is_file(), f"DATASET_FILE_MISSING:{name}")
    return {name: sha256_file(dataset_dir / name) for name in DATASET_FILES}


def inspect_dataset(
    dataset_dir: Path,
    expected_checksums: dict[str, str] | None = EXPECTED_CHECKSUMS,
    expected_counts: dict[str, int] | None = EXPECTED_COUNTS,
) -> dict[str, Any]:
    checksums = current_checksums(dataset_dir)
    if expected_checksums is not None:
        require(checksums == expected_checksums, "DATASET_CHECKSUM_MISMATCH")
    with (dataset_dir / "manifest.json").open("r", encoding="utf-8") as handle:
        manifest = json.load(handle)
    require(manifest.get("datasetSchemaVersion") == 2, "MANIFEST_SCHEMA_VERSION_MISMATCH")
    require(manifest.get("selectionPolicy") == "all-completed", "SELECTION_POLICY_MISMATCH")
    require(manifest.get("sourceFilter") == "human", "SOURCE_FILTER_MISMATCH")
    require(manifest.get("jsonParseFailureCount") == 0, "JSON_PARSE_FAILURE_PRESENT")
    require(
        isinstance(manifest.get("inputSha256"), str)
        and len(manifest["inputSha256"]) == 64,
        "MANIFEST_INPUT_SHA256_REQUIRED",
    )

    game_ids: set[str] = set()
    selected_by_decision: Counter[str] = Counter()
    decision_difficulty: dict[str, str] = {}
    candidate_count = 0
    for name in ("train.jsonl", "validation.jsonl"):
        with (dataset_dir / name).open("r", encoding="utf-8") as handle:
            for line_number, line in enumerate(handle, 1):
                if not line.strip():
                    continue
                try:
                    compact = compact_candidate(json.loads(line))
                except (json.JSONDecodeError, TypeError, KeyError) as error:
                    raise ContractError(f"INVALID_DATASET_ROW:{name}:{line_number}") from error
                candidate_count += 1
                game_ids.add(compact["gameId"])
                key = compact["decisionKey"]
                if compact["selected"]:
                    selected_by_decision[key] += 1
                prior = decision_difficulty.setdefault(key, compact["difficulty"])
                require(prior == compact["difficulty"], f"DECISION_DIFFICULTY_MISMATCH:{key}")
    require(selected_by_decision, "NO_SELECTED_DECISIONS")
    require(
        set(selected_by_decision) == set(decision_difficulty)
        and all(count == 1 for count in selected_by_decision.values()),
        "EXACTLY_ONE_SELECTED_CANDIDATE_REQUIRED",
    )
    difficulty_counts = Counter(decision_difficulty.values())
    actual_counts = {
        "gameCount": len(game_ids),
        "decisionCount": len(decision_difficulty),
        "candidateCount": candidate_count,
        "normalDecisionCount": difficulty_counts["normal"],
        "hardDecisionCount": difficulty_counts["hard"],
    }
    manifest_counts = {
        "gameCount": manifest.get("trainGameCount", 0) + manifest.get("validationGameCount", 0),
        "decisionCount": manifest.get("acceptedPlacementLogCount"),
        "candidateCount": manifest.get("trainSampleCount", 0) + manifest.get("validationSampleCount", 0),
        "normalDecisionCount": manifest.get("acceptedPlacementLogCountByAiDifficulty", {}).get("normal"),
        "hardDecisionCount": manifest.get("acceptedPlacementLogCountByAiDifficulty", {}).get("hard"),
    }
    require(actual_counts == manifest_counts, "MANIFEST_DATA_COUNT_MISMATCH")
    if expected_counts is not None:
        require(actual_counts == expected_counts, "EXPECTED_COHORT_COUNT_MISMATCH")
    return {
        "checksums": checksums,
        "manifest": manifest,
        "gameIds": sorted(game_ids),
        "counts": actual_counts,
    }


def load_training_candidates(
    dataset_dir: Path,
    selected_game_ids: set[str],
) -> list[dict[str, Any]]:
    candidates: list[dict[str, Any]] = []
    for name in ("train.jsonl", "validation.jsonl"):
        with (dataset_dir / name).open("r", encoding="utf-8") as handle:
            for line_number, line in enumerate(handle, 1):
                if not line.strip():
                    continue
                try:
                    row = json.loads(line)
                    if row.get("gameId") in selected_game_ids:
                        candidates.append(compact_candidate(row))
                except (json.JSONDecodeError, TypeError, KeyError) as error:
                    raise ContractError(f"INVALID_DATASET_ROW:{name}:{line_number}") from error
    candidates.sort(key=lambda item: (item["decisionKey"], item["placementKey"]))
    require(candidates, "EMPTY_TRAINING_COHORT")
    return candidates


def group_candidates(candidates: Iterable[dict[str, Any]]) -> dict[str, list[dict[str, Any]]]:
    decisions: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for candidate in candidates:
        decisions[candidate["decisionKey"]].append(candidate)
    ordered: dict[str, list[dict[str, Any]]] = {}
    for key in sorted(decisions):
        rows = sorted(decisions[key], key=lambda item: item["placementKey"])
        require(len(rows) >= 2, f"DECISION_REQUIRES_TWO_CANDIDATES:{key}")
        require(len({row["placementKey"] for row in rows}) == len(rows), f"PLACEMENT_KEY_DUPLICATE:{key}")
        require(sum(row["selected"] for row in rows) == 1, f"SELECTED_COUNT_MISMATCH:{key}")
        require(len({row["gameId"] for row in rows}) == 1, f"GAME_ID_MISMATCH:{key}")
        require(len({row["difficulty"] for row in rows}) == 1, f"DIFFICULTY_MISMATCH:{key}")
        ordered[key] = rows
    return ordered


def assert_equivalence_contract(decisions: dict[str, list[dict[str, Any]]]) -> None:
    for decision, rows in decisions.items():
        classes: dict[str, list[dict[str, Any]]] = defaultdict(list)
        for row in rows:
            classes[row["equivalenceKey"]].append(row)
        selected_classes = {row["equivalenceKey"] for row in rows if row["selected"]}
        require(len(selected_classes) == 1, f"SELECTED_CLASS_COUNT_MISMATCH:{decision}")
        for class_key, members in classes.items():
            require(
                len({member["features"] for member in members}) == 1
                and len({member["linesCleared"] for member in members}) == 1
                and len({member["gameOver"] for member in members}) == 1,
                f"EQUIVALENCE_CLASS_CONTRACT_MISMATCH:{decision}:{class_key}",
            )


def create_v4_pairs(
    decisions: dict[str, list[dict[str, Any]]],
    scaled_features: dict[tuple[str, str], np.ndarray],
) -> tuple[list[dict[str, Any]], list[str]]:
    pairs: list[dict[str, Any]] = []
    pairless: list[str] = []
    for decision in sorted(decisions):
        rows = decisions[decision]
        selected = next(row for row in rows if row["selected"])
        selected_class = selected["equivalenceKey"]
        alternatives: dict[str, list[dict[str, Any]]] = defaultdict(list)
        for row in rows:
            if row["equivalenceKey"] != selected_class:
                alternatives[row["equivalenceKey"]].append(row)
        if not alternatives:
            pairless.append(decision)
            continue
        weight = 1.0 / len(alternatives)
        for class_key in sorted(alternatives):
            representative = min(alternatives[class_key], key=lambda item: item["placementKey"])
            difference = (
                scaled_features[(decision, selected["placementKey"])]
                - scaled_features[(decision, representative["placementKey"])]
            )
            require(np.isfinite(difference).all(), f"NON_FINITE_PAIR:{decision}")
            pairs.append({
                "decisionKey": decision,
                "classKey": class_key,
                "difference": difference,
                "weight": weight,
            })
    require(pairs, "NO_PHYSICAL_CLASS_PAIRS")
    return pairs, pairless


def symmetric_samples(
    pairs: list[dict[str, Any]],
) -> tuple[np.ndarray, np.ndarray, np.ndarray, dict[str, float]]:
    features: list[np.ndarray] = []
    labels: list[int] = []
    weights: list[float] = []
    decision_weights: dict[str, float] = defaultdict(float)
    for pair in pairs:
        half_weight = pair["weight"] / 2.0
        features.extend((pair["difference"], -pair["difference"]))
        labels.extend((1, 0))
        weights.extend((half_weight, half_weight))
        decision_weights[pair["decisionKey"]] += pair["weight"]
    matrix = np.asarray(features, dtype=np.float64)
    target = np.asarray(labels, dtype=np.int64)
    sample_weight = np.asarray(weights, dtype=np.float64)
    require(np.isfinite(matrix).all(), "NON_FINITE_TRANSFORMED_FEATURE")
    require(np.isfinite(sample_weight).all(), "NON_FINITE_SAMPLE_WEIGHT")
    require(all(abs(total - 1.0) <= 1e-12 for total in decision_weights.values()), "DECISION_WEIGHT_MISMATCH")
    return matrix, target, sample_weight, dict(decision_weights)


def fit_model(candidates: list[dict[str, Any]]) -> dict[str, Any]:
    decisions = group_candidates(candidates)
    assert_equivalence_contract(decisions)
    raw_features = np.asarray([row["features"] for row in candidates], dtype=np.float64)
    require(np.isfinite(raw_features).all(), "NON_FINITE_RAW_FEATURE")
    scaler = StandardScaler().fit(raw_features)
    transformed = scaler.transform(raw_features)
    require(np.isfinite(scaler.mean_).all() and np.isfinite(scaler.scale_).all(), "NON_FINITE_SCALER")
    require((scaler.scale_ > 0).all(), "NON_POSITIVE_SCALER_SCALE")
    scaled_features = {
        (row["decisionKey"], row["placementKey"]): transformed[index]
        for index, row in enumerate(candidates)
    }
    pairs, pairless = create_v4_pairs(decisions, scaled_features)
    matrix, target, sample_weight, decision_weights = symmetric_samples(pairs)
    decision_count = len(decisions)
    c_value = 1.0 / (decision_count * L2)
    estimator = LogisticRegression(
        solver="lbfgs",
        fit_intercept=False,
        class_weight=None,
        tol=TOLERANCE,
        max_iter=MAX_ITERATIONS,
        C=c_value,
    )
    with warnings.catch_warnings(record=True) as caught:
        warnings.simplefilter("always")
        estimator.fit(matrix, target, sample_weight=sample_weight)
    convergence_warnings = [str(item.message) for item in caught if issubclass(item.category, ConvergenceWarning)]
    unexpected_warnings = [str(item.message) for item in caught if not issubclass(item.category, ConvergenceWarning)]
    require(not convergence_warnings, "LOGISTIC_REGRESSION_DID_NOT_CONVERGE")
    require(not unexpected_warnings, "UNEXPECTED_TRAINING_WARNING")
    coefficients = estimator.coef_[0]
    require(np.isfinite(coefficients).all(), "NON_FINITE_COEFFICIENT")
    margins = matrix @ coefficients
    weighted_log_loss = float(np.average(np.logaddexp(0.0, -(2 * target - 1) * margins), weights=sample_weight))
    require(math.isfinite(weighted_log_loss), "NON_FINITE_TRAINING_DIAGNOSTIC")
    return {
        "scaler": scaler,
        "coefficients": coefficients,
        "decisionCount": decision_count,
        "pairCount": len(pairs),
        "pairlessDecisionKeys": pairless,
        "representedDecisionCount": len(decision_weights),
        "symmetricSampleCount": len(matrix),
        "sampleWeightTotal": float(sample_weight.sum()),
        "minimumDecisionWeight": min(decision_weights.values()),
        "maximumDecisionWeight": max(decision_weights.values()),
        "iterations": int(estimator.n_iter_[0]),
        "weightedTrainingLogLoss": weighted_log_loss,
        "c": c_value,
        "convergenceWarnings": convergence_warnings,
        "unexpectedWarnings": unexpected_warnings,
    }


def environment_contract() -> dict[str, str]:
    return {
        "architecture": platform.machine(),
        "numpy": np.__version__,
        "platform": platform.system(),
        "python": platform.python_version(),
        "scikitLearn": sklearn.__version__,
        "scipy": scipy.__version__,
    }


def build_artifacts(
    dataset_dir: Path,
    inspection: dict[str, Any],
    candidates: list[dict[str, Any]],
    fit: dict[str, Any],
    selected_game_ids: list[str],
) -> tuple[dict[str, Any], dict[str, Any]]:
    full_cohort = len(selected_game_ids) == inspection["counts"]["gameCount"]
    run_mode = "full" if full_cohort else "smoke"
    checksums_after = current_checksums(dataset_dir)
    require(checksums_after == inspection["checksums"], "SOURCE_DATASET_MUTATED")
    scaler = fit["scaler"]
    coefficients = fit["coefficients"]
    difficulty_counts = Counter(
        rows[0]["difficulty"] for rows in group_candidates(candidates).values()
    )
    game_id_sha = hashlib.sha256("\n".join(selected_game_ids).encode("utf-8")).hexdigest()
    model = {
        "canonicalArtifact": False,
        "coefficients": coefficients.tolist(),
        "dataset": {
            "acceptedCandidateCount": len(candidates),
            "acceptedDecisionCount": fit["decisionCount"],
            "acceptedGameCount": len(selected_game_ids),
            "checksums": inspection["checksums"],
            "manifestInputSha256": inspection["manifest"].get("inputSha256"),
            "relativePath": DATASET_RELATIVE_PATH,
        },
        "datasetSchemaVersion": 2,
        "environment": environment_contract(),
        "featureNames": list(FEATURE_NAMES),
        "featureSchemaVersion": 1,
        "fullCohortCovered": full_cohort,
        "modelSchemaVersion": 1,
        "modelType": "pairwise_linear_ranker",
        "productionIntegration": False,
        "representation": {
            "name": "V4",
            "pairWeight": "one over unique non-selected physical classes",
            "selectedClassAliasesExcluded": True,
            "unit": "occupied-cell physical class",
        },
        "runMode": run_mode,
        "scaler": {
            "mean": scaler.mean_.tolist(),
            "scale": scaler.scale_.tolist(),
        },
        "trainingConfig": {
            "c": fit["c"],
            "classWeight": None,
            "fitIntercept": False,
            "l2": L2,
            "maxIterations": MAX_ITERATIONS,
            "solver": "lbfgs",
            "tolerance": TOLERANCE,
        },
        "trainingDiagnostics": {
            "convergenceWarningCount": len(fit["convergenceWarnings"]),
            "iterationCount": fit["iterations"],
            "maximumDecisionWeight": fit["maximumDecisionWeight"],
            "minimumDecisionWeight": fit["minimumDecisionWeight"],
            "pairCount": fit["pairCount"],
            "pairlessDecisionCount": len(fit["pairlessDecisionKeys"]),
            "representedDecisionCount": fit["representedDecisionCount"],
            "sampleWeightTotal": fit["sampleWeightTotal"],
            "symmetricSampleCount": fit["symmetricSampleCount"],
            "unexpectedWarningCount": len(fit["unexpectedWarnings"]),
            "weightedTrainingLogLoss": fit["weightedTrainingLogLoss"],
            "weightedTrainingLogLossRole": "optimization diagnostic only; not held-out performance",
        },
        "weights": coefficients.tolist(),
    }
    model_sha = hashlib.sha256(json_bytes(model)).hexdigest()
    report = {
        "canonicalArtifact": False,
        "dataset": {
            "availableAcceptedGameCount": inspection["counts"]["gameCount"],
            "availableCandidateCount": inspection["counts"]["candidateCount"],
            "availableDecisionCount": inspection["counts"]["decisionCount"],
            "checksumsAfter": checksums_after,
            "checksumsBefore": inspection["checksums"],
            "relativePath": DATASET_RELATIVE_PATH,
            "selectionPolicy": "all-completed",
            "sourceFilter": "human",
        },
        "environment": environment_contract(),
        "estimator": {
            "c": fit["c"],
            "classWeight": None,
            "fitIntercept": False,
            "l2": L2,
            "maxIterations": MAX_ITERATIONS,
            "solver": "lbfgs",
            "tolerance": TOLERANCE,
        },
        "evaluationMetricsIncluded": False,
        "experimentId": EXPERIMENT_ID,
        "featureContract": {
            "featureNames": list(FEATURE_NAMES),
            "forbiddenLeakageInputs": list(FORBIDDEN_LEAKAGE_INPUTS),
            "scalerFitCandidateCount": len(candidates),
            "scalerFitScope": "all raw candidates in selected training cohort",
        },
        "fullCohortCovered": full_cohort,
        "heldOutEvidence": False,
        "modelArtifact": {
            "modelSha256": model_sha,
            "productionIntegration": False,
        },
        "productionIntegration": False,
        "representation": {
            "name": "V4",
            "pairCount": fit["pairCount"],
            "pairWeight": "one over unique non-selected physical classes",
            "pairlessDecisionCount": len(fit["pairlessDecisionKeys"]),
            "selectedClassAliasesExcluded": True,
            "unit": "occupied-cell physical class",
        },
        "runMode": run_mode,
        "status": "candidate_artifact_created" if full_cohort else "awaiting_user_full_run",
        "trainingCohort": {
            "candidateCount": len(candidates),
            "decisionCount": fit["decisionCount"],
            "gameCount": len(selected_game_ids),
            "gameIdSha256": game_id_sha,
            "hardDecisionCount": difficulty_counts["hard"],
            "normalDecisionCount": difficulty_counts["normal"],
            "representedDecisionCount": fit["representedDecisionCount"],
        },
        "trainingDiagnostics": {
            "coefficientFeatureOrder": list(FEATURE_NAMES),
            "coefficientL2Norm": float(np.linalg.norm(coefficients)),
            "coefficientMaxAbsolute": float(np.max(np.abs(coefficients))),
            "coefficients": coefficients.tolist(),
            "convergenceWarnings": fit["convergenceWarnings"],
            "iterations": fit["iterations"],
            "maximumDecisionWeight": fit["maximumDecisionWeight"],
            "minimumDecisionWeight": fit["minimumDecisionWeight"],
            "pairlessDecisionKeys": fit["pairlessDecisionKeys"],
            "sampleWeightTotal": fit["sampleWeightTotal"],
            "symmetricSampleCount": fit["symmetricSampleCount"],
            "unexpectedWarnings": fit["unexpectedWarnings"],
            "weightedTrainingLogLoss": fit["weightedTrainingLogLoss"],
            "weightedTrainingLogLossRole": "optimization diagnostic only; not held-out performance",
        },
    }
    return model, report


def lexical_path(path: Path) -> Path:
    return Path(os.path.abspath(os.fspath(path)))


def assert_safe_output_path(output_path: Path, protected_sources: Iterable[Path]) -> None:
    output_lexical = lexical_path(output_path)
    output_resolved = output_path.resolve(strict=False)
    require(not output_path.is_symlink(), "OUTPUT_SYMLINK_NOT_ALLOWED")
    for source in protected_sources:
        source_lexical = lexical_path(source)
        source_resolved = source.resolve(strict=True)
        same_file = False
        try:
            same_file = output_path.samefile(source)
        except FileNotFoundError:
            pass
        require(
            output_lexical != source_lexical
            and output_resolved != source_resolved
            and not same_file,
            "OUTPUT_PATH_CONFLICTS_WITH_SOURCE",
        )


def create_staging_file(output_path: Path, protected_sources: list[Path]) -> tuple[int, Path, os.stat_result]:
    for _ in range(32):
        staging_path = output_path.with_name(f".{output_path.name}.{secrets.token_hex(16)}.tmp")
        require(lexical_path(staging_path.parent) == lexical_path(output_path.parent), "STAGING_DIRECTORY_MISMATCH")
        assert_safe_output_path(staging_path, protected_sources)
        try:
            descriptor = os.open(staging_path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
            return descriptor, staging_path, os.fstat(descriptor)
        except FileExistsError:
            continue
    raise ContractError("STAGING_PATH_ALLOCATION_FAILED")


def remove_owned_file(path: Path | None, identity: os.stat_result | None) -> None:
    if path is None or identity is None:
        return
    try:
        current = path.lstat()
        if not path.is_symlink() and (current.st_dev, current.st_ino) == (identity.st_dev, identity.st_ino):
            path.unlink()
    except FileNotFoundError:
        pass


def stage_bytes(output_path: Path, content: bytes, protected_sources: list[Path]) -> tuple[Path, os.stat_result]:
    descriptor: int | None = None
    staging_path: Path | None = None
    identity: os.stat_result | None = None
    try:
        descriptor, staging_path, identity = create_staging_file(output_path, protected_sources)
        with os.fdopen(descriptor, "wb") as handle:
            descriptor = None
            handle.write(content)
            handle.flush()
            os.fsync(handle.fileno())
        current = staging_path.lstat()
        require(
            not staging_path.is_symlink()
            and (current.st_dev, current.st_ino) == (identity.st_dev, identity.st_ino),
            "STAGING_FILE_REPLACED",
        )
        return staging_path, identity
    except Exception:
        if descriptor is not None:
            os.close(descriptor)
        remove_owned_file(staging_path, identity)
        raise


def write_artifacts_atomic(
    model_path: Path,
    report_path: Path,
    model: dict[str, Any],
    report: dict[str, Any],
    protected_sources: list[Path],
) -> None:
    same_artifact = False
    try:
        same_artifact = model_path.samefile(report_path)
    except FileNotFoundError:
        pass
    require(
        lexical_path(model_path) != lexical_path(report_path)
        and model_path.resolve(strict=False) != report_path.resolve(strict=False)
        and not same_artifact,
        "ARTIFACT_PATHS_MUST_DIFFER",
    )
    model_content = json_bytes(model)
    require(report.get("modelArtifact", {}).get("modelSha256") == hashlib.sha256(model_content).hexdigest(), "MODEL_SHA_MISMATCH")
    report_content = json_bytes(report)
    model_path.parent.mkdir(parents=True, exist_ok=True)
    report_path.parent.mkdir(parents=True, exist_ok=True)
    assert_safe_output_path(model_path, protected_sources)
    assert_safe_output_path(report_path, protected_sources)
    original_model = model_path.read_bytes() if model_path.exists() else None
    original_report = report_path.read_bytes() if report_path.exists() else None
    model_stage = report_stage = None
    model_identity = report_identity = None
    model_replaced = report_replaced = False
    try:
        model_stage, model_identity = stage_bytes(model_path, model_content, protected_sources)
        report_stage, report_identity = stage_bytes(report_path, report_content, protected_sources)
        assert_safe_output_path(model_path, protected_sources)
        assert_safe_output_path(report_path, protected_sources)
        os.replace(model_stage, model_path)
        model_stage = None
        model_replaced = True
        os.replace(report_stage, report_path)
        report_stage = None
        report_replaced = True
    except Exception:
        for path, original, replaced, identity in (
            (report_path, original_report, report_replaced, report_identity),
            (model_path, original_model, model_replaced, model_identity),
        ):
            if not replaced:
                continue
            if original is None:
                try:
                    current = path.lstat()
                    if identity is not None and (current.st_dev, current.st_ino) == (identity.st_dev, identity.st_ino):
                        path.unlink()
                except FileNotFoundError:
                    pass
            else:
                restore_path, restore_identity = stage_bytes(path, original, protected_sources)
                try:
                    os.replace(restore_path, path)
                    restore_path = None
                finally:
                    remove_owned_file(restore_path, restore_identity)
        raise
    finally:
        remove_owned_file(model_stage, model_identity)
        remove_owned_file(report_stage, report_identity)


def train_and_write(
    dataset_dir: Path,
    output_dir: Path,
    max_games: int,
    expected_checksums: dict[str, str] | None = EXPECTED_CHECKSUMS,
    expected_counts: dict[str, int] | None = EXPECTED_COUNTS,
) -> tuple[dict[str, Any], dict[str, Any]]:
    require(max_games > 0, "MAX_GAMES_MUST_BE_POSITIVE")
    dataset_resolved = dataset_dir.resolve(strict=True)
    output_resolved = output_dir.resolve(strict=False)
    require(
        not output_dir.is_symlink()
        and output_resolved != dataset_resolved
        and dataset_resolved not in output_resolved.parents,
        "OUTPUT_DIRECTORY_CONFLICTS_WITH_DATASET",
    )
    inspection = inspect_dataset(dataset_dir, expected_checksums, expected_counts)
    selected_game_ids = inspection["gameIds"][:max_games]
    candidates = load_training_candidates(dataset_dir, set(selected_game_ids))
    fit = fit_model(candidates)
    model, report = build_artifacts(dataset_dir, inspection, candidates, fit, selected_game_ids)
    protected_sources = [dataset_dir / name for name in DATASET_FILES]
    write_artifacts_atomic(
        output_dir / "model.json",
        output_dir / "training-report.json",
        model,
        report,
        protected_sources,
    )
    require(current_checksums(dataset_dir) == inspection["checksums"], "SOURCE_DATASET_MUTATED")
    return model, report


def parse_args(args: list[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--dataset", type=Path, default=Path(DATASET_RELATIVE_PATH))
    parser.add_argument("--output-dir", type=Path, required=True)
    parser.add_argument("--max-games", type=int, default=2)
    return parser.parse_args(args)


def main(args: list[str] | None = None) -> int:
    options = parse_args(sys.argv[1:] if args is None else args)
    model, report = train_and_write(options.dataset, options.output_dir, options.max_games)
    print(json.dumps({
        "canonicalArtifact": model["canonicalArtifact"],
        "fullCohortCovered": report["fullCohortCovered"],
        "productionIntegration": report["productionIntegration"],
        "runMode": report["runMode"],
        "status": report["status"],
        "trainingCandidateCount": report["trainingCohort"]["candidateCount"],
        "trainingDecisionCount": report["trainingCohort"]["decisionCount"],
        "trainingGameCount": report["trainingCohort"]["gameCount"],
    }, ensure_ascii=False, sort_keys=True, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
