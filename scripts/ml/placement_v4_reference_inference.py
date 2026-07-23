#!/usr/bin/env python3
"""Reference the frozen V4 inference contract independently in Python.

This script does not train, evaluate held-out gameplay, or enable production
integration.  It verifies the model SHA/schema, recreates occupied-cell
physical classes, applies the game-over safety filter, and checks deterministic
fixture outcomes against the TypeScript scorer contract.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import math
import os
import sys
from collections import defaultdict
from pathlib import Path
from typing import Any

if __package__:
    from scripts.ml import train_placement_v4 as trainer
else:
    import train_placement_v4 as trainer


EXPECTED_MODEL_SHA256 = "ff64b0d3e4cd9eb6c6d7920f2cbe961f1d70e4c90ccc69a5d9ab8bcd410cb33d"
FEATURE_NAMES = trainer.FEATURE_NAMES
ContractError = trainer.ContractError
require = trainer.require


def reject_nonfinite_constant(value: str) -> None:
    raise ContractError(f"NON_FINITE_JSON_CONSTANT:{value}")


def load_json_object(path: Path) -> dict[str, Any]:
    try:
        payload = json.loads(
            path.read_text(encoding="utf-8"),
            parse_constant=reject_nonfinite_constant,
        )
    except (OSError, UnicodeError, json.JSONDecodeError) as error:
        raise ContractError(f"INVALID_JSON:{path.name}") from error
    require(isinstance(payload, dict), f"JSON_OBJECT_REQUIRED:{path.name}")
    return payload


def finite_vector(value: Any, name: str) -> tuple[float, ...]:
    require(isinstance(value, list) and len(value) == len(FEATURE_NAMES), f"{name}_LENGTH_MISMATCH")
    require(
        all(isinstance(item, (int, float)) and not isinstance(item, bool)
            and math.isfinite(item) for item in value),
        f"{name}_FINITE_NUMBERS_REQUIRED",
    )
    return tuple(float(item) for item in value)


def validate_model(model: dict[str, Any]) -> dict[str, Any]:
    """Validate the exact frozen feature, scaler, and experimental-artifact contract."""
    require(isinstance(model, dict), "MODEL_OBJECT_REQUIRED")
    require(type(model.get("modelSchemaVersion")) is int, "MODEL_SCHEMA_VERSION_REQUIRED")
    require(model["modelSchemaVersion"] == 1, "UNSUPPORTED_MODEL_SCHEMA_VERSION")
    require(type(model.get("datasetSchemaVersion")) is int, "DATASET_SCHEMA_VERSION_REQUIRED")
    require(model["datasetSchemaVersion"] == 2, "UNSUPPORTED_DATASET_SCHEMA_VERSION")
    require(type(model.get("featureSchemaVersion")) is int, "FEATURE_SCHEMA_VERSION_REQUIRED")
    require(model["featureSchemaVersion"] == 1, "UNSUPPORTED_FEATURE_SCHEMA_VERSION")
    require(model.get("modelType") == "pairwise_linear_ranker", "UNSUPPORTED_MODEL_TYPE")
    require(model.get("featureNames") == list(FEATURE_NAMES), "FEATURE_NAMES_MISMATCH")
    require(model.get("canonicalArtifact") is False, "CANONICAL_ARTIFACT_MUST_BE_FALSE")
    require(model.get("productionIntegration") is False, "PRODUCTION_INTEGRATION_MUST_BE_FALSE")

    representation = model.get("representation")
    require(isinstance(representation, dict), "REPRESENTATION_REQUIRED")
    require(representation.get("name") == "V4", "UNSUPPORTED_REPRESENTATION")
    require(
        representation.get("unit") == "occupied-cell physical class"
        and representation.get("selectedClassAliasesExcluded") is True,
        "V4_REPRESENTATION_CONTRACT_MISMATCH",
    )
    coefficients = finite_vector(model.get("coefficients"), "COEFFICIENT")
    weights = finite_vector(model.get("weights"), "WEIGHT")
    require(coefficients == weights, "COEFFICIENT_WEIGHT_MISMATCH")
    scaler = model.get("scaler")
    require(isinstance(scaler, dict), "SCALER_REQUIRED")
    mean = finite_vector(scaler.get("mean"), "SCALER_MEAN")
    scale = finite_vector(scaler.get("scale"), "SCALER_SCALE")
    require(all(value > 0 for value in scale), "SCALER_SCALE_MUST_BE_POSITIVE")
    return {"coefficients": coefficients, "mean": mean, "scale": scale}


def load_model(path: Path, expected_sha256: str = EXPECTED_MODEL_SHA256) -> tuple[dict[str, Any], dict[str, Any], str]:
    digest = trainer.sha256_file(path)
    require(digest == expected_sha256, "MODEL_SHA256_MISMATCH")
    model = load_json_object(path)
    return model, validate_model(model), digest


def validate_candidate(candidate: Any) -> dict[str, Any]:
    require(isinstance(candidate, dict), "CANDIDATE_OBJECT_REQUIRED")
    placement = candidate.get("candidatePlacement")
    require(isinstance(placement, dict), "CANDIDATE_PLACEMENT_REQUIRED")
    require(isinstance(placement.get("pieceType"), str) and placement["pieceType"], "PIECE_TYPE_REQUIRED")
    for name in ("rotation", "row", "col"):
        require(type(placement.get(name)) is int, f"PLACEMENT_{name.upper()}_INTEGER_REQUIRED")
    cells = placement.get("cells")
    require(isinstance(cells, list) and cells, "OCCUPIED_CELLS_REQUIRED")
    for cell in cells:
        require(
            isinstance(cell, dict)
            and type(cell.get("row")) is int
            and type(cell.get("col")) is int,
            "OCCUPIED_CELL_INTEGER_REQUIRED",
        )
    require(
        len({(cell["row"], cell["col"]) for cell in cells}) == len(cells),
        "DUPLICATE_OCCUPIED_CELL",
    )
    result = candidate.get("candidateResult")
    require(isinstance(result, dict), "CANDIDATE_RESULT_REQUIRED")
    require(type(result.get("linesCleared")) is int, "LINES_CLEARED_INTEGER_REQUIRED")
    require(type(result.get("gameOver")) is bool, "GAME_OVER_BOOLEAN_REQUIRED")
    try:
        features = trainer.extract_features(candidate)
        placement_key = trainer.placement_key(candidate)
        class_key = trainer.equivalence_key(candidate)
    except (KeyError, TypeError) as error:
        raise ContractError("INVALID_CANDIDATE_STRUCTURE") from error
    return {
        "classKey": class_key,
        "features": features,
        "gameOver": result["gameOver"],
        "linesCleared": result["linesCleared"],
        "placementKey": placement_key,
    }


def linear_score(features: tuple[float, ...], parameters: dict[str, Any]) -> float:
    score = sum(
        coefficient * ((raw - mean) / scale)
        for raw, mean, scale, coefficient in zip(
            features,
            parameters["mean"],
            parameters["scale"],
            parameters["coefficients"],
        )
    )
    require(math.isfinite(score), "NON_FINITE_LINEAR_SCORE")
    return score


def rank_candidates(candidates: Any, parameters: dict[str, Any]) -> dict[str, Any]:
    """Rank physical placement classes with the frozen 16-feature linear model.

    Rotation/pivot aliases of the same piece type that occupy identical cells
    share one class.  Game-over classes are excluded whenever a safe class
    exists, and score ties use the canonical class key so input order cannot
    change the selection.
    """
    require(isinstance(candidates, list) and candidates, "NON_EMPTY_CANDIDATE_LIST_REQUIRED")
    validated = [validate_candidate(candidate) for candidate in candidates]
    placement_keys = [candidate["placementKey"] for candidate in validated]
    require(len(placement_keys) == len(set(placement_keys)), "DUPLICATE_PLACEMENT_KEY")

    grouped: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for candidate in validated:
        grouped[candidate["classKey"]].append(candidate)
    classes: list[dict[str, Any]] = []
    for class_key in sorted(grouped):
        members = sorted(grouped[class_key], key=lambda item: item["placementKey"])
        require(len({member["features"] for member in members}) == 1, "CLASS_FEATURE_MISMATCH")
        require(len({member["linesCleared"] for member in members}) == 1, "CLASS_RESULT_MISMATCH")
        require(len({member["gameOver"] for member in members}) == 1, "CLASS_RESULT_MISMATCH")
        representative = members[0]
        classes.append({
            "aliasCount": len(members),
            "classKey": class_key,
            "gameOver": representative["gameOver"],
            "linearScore": linear_score(representative["features"], parameters),
            "representativeKey": representative["placementKey"],
        })

    safe_class_available = any(not physical_class["gameOver"] for physical_class in classes)
    eligible = [physical_class for physical_class in classes if not physical_class["gameOver"]] if safe_class_available else classes
    filtered_count = len(classes) - len(eligible)
    ranked = sorted(eligible, key=lambda item: (-item["linearScore"], item["classKey"]))
    ranks = {physical_class["classKey"]: index for index, physical_class in enumerate(ranked, 1)}
    class_results = []
    for physical_class in sorted(classes, key=lambda item: item["classKey"]):
        class_results.append({
            **physical_class,
            "excludedByGameOverSafety": physical_class["classKey"] not in ranks,
            "finalRank": ranks.get(physical_class["classKey"]),
        })
    selected = ranked[0]
    return {
        "candidateCount": len(validated),
        "classes": class_results,
        "filteredGameOverClassCount": filtered_count,
        "physicalClassCount": len(classes),
        "safeClassAvailable": safe_class_available,
        "selectedClassKey": selected["classKey"],
        "selectedRepresentativeKey": selected["representativeKey"],
        "unavoidableGameOver": not safe_class_available,
    }


def assert_expected_result(result: dict[str, Any], expected: Any, scenario_id: str) -> None:
    require(isinstance(expected, dict), f"EXPECTED_RESULT_REQUIRED:{scenario_id}")
    for name in (
        "selectedClassKey",
        "selectedRepresentativeKey",
        "safeClassAvailable",
        "filteredGameOverClassCount",
        "unavoidableGameOver",
    ):
        require(result[name] == expected.get(name), f"EXPECTED_{name.upper()}_MISMATCH:{scenario_id}")
    actual_ranks = {row["classKey"]: row["finalRank"] for row in result["classes"]}
    require(actual_ranks == expected.get("classRanks"), f"EXPECTED_CLASS_RANK_MISMATCH:{scenario_id}")
    if "selectedAliasCount" in expected:
        selected = next(row for row in result["classes"] if row["classKey"] == result["selectedClassKey"])
        require(selected["aliasCount"] == expected["selectedAliasCount"], f"EXPECTED_ALIAS_COUNT_MISMATCH:{scenario_id}")
    if "highestLinearScoreClassKey" in expected:
        highest = min(result["classes"], key=lambda row: (-row["linearScore"], row["classKey"]))
        require(highest["classKey"] == expected["highestLinearScoreClassKey"], f"EXPECTED_SCORE_ORDER_MISMATCH:{scenario_id}")


def build_report(
    model_path: Path,
    fixture_path: Path,
    expected_model_sha256: str = EXPECTED_MODEL_SHA256,
) -> dict[str, Any]:
    """Validate all fixture scenarios while proving model and fixture bytes stay unchanged."""
    model_before = trainer.sha256_file(model_path)
    fixture_before = trainer.sha256_file(fixture_path)
    fixture = load_json_object(fixture_path)
    require(fixture.get("modelSha256") == expected_model_sha256, "FIXTURE_MODEL_SHA256_MISMATCH")
    model, parameters, model_sha = load_model(model_path, expected_model_sha256)
    require(fixture.get("fixtureSchemaVersion") == 1, "UNSUPPORTED_FIXTURE_SCHEMA_VERSION")
    require(fixture.get("modelSha256") == model_sha, "FIXTURE_MODEL_SHA256_MISMATCH")
    scenarios = fixture.get("scenarios")
    require(isinstance(scenarios, list) and scenarios, "FIXTURE_SCENARIOS_REQUIRED")
    scenario_ids: set[str] = set()
    results = []
    for scenario in scenarios:
        require(isinstance(scenario, dict), "SCENARIO_OBJECT_REQUIRED")
        scenario_id = scenario.get("scenarioId")
        require(isinstance(scenario_id, str) and scenario_id, "SCENARIO_ID_REQUIRED")
        require(scenario_id not in scenario_ids, "DUPLICATE_SCENARIO_ID")
        scenario_ids.add(scenario_id)
        result = rank_candidates(scenario.get("candidates"), parameters)
        assert_expected_result(result, scenario.get("expected"), scenario_id)
        results.append({"scenarioId": scenario_id, **result})
    results.sort(key=lambda item: item["scenarioId"])
    require(trainer.sha256_file(model_path) == model_before, "MODEL_MUTATED")
    require(trainer.sha256_file(fixture_path) == fixture_before, "FIXTURE_MUTATED")
    return {
        "canonicalArtifact": model["canonicalArtifact"],
        "fixture": {"scenarioCount": len(results), "sha256": fixture_before},
        "gameOverSafetyStatus": "gameover_safety_contract_valid",
        "heldOutEvidence": False,
        "model": {
            "featureSchemaVersion": model["featureSchemaVersion"],
            "modelSchemaVersion": model["modelSchemaVersion"],
            "representation": "V4",
            "sha256": model_sha,
        },
        "productionIntegration": model["productionIntegration"],
        "scenarios": results,
        "status": "reference_inference_valid",
    }


def write_report_atomic(output_path: Path, report: dict[str, Any], protected_sources: list[Path]) -> None:
    """Publish complete JSON through a protected same-directory staging file."""
    content = trainer.json_bytes(report)
    trainer.assert_safe_output_path(output_path, protected_sources)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    staging_path = None
    identity = None
    try:
        staging_path, identity = trainer.stage_bytes(output_path, content, protected_sources)
        trainer.assert_safe_output_path(output_path, protected_sources)
        os.replace(staging_path, output_path)
        staging_path = None
    finally:
        trainer.remove_owned_file(staging_path, identity)


def parse_args(args: list[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--model", required=True, type=Path)
    parser.add_argument("--fixture", required=True, type=Path)
    parser.add_argument("--output", required=True, type=Path)
    return parser.parse_args(args)


def main(args: list[str] | None = None) -> int:
    options = parse_args(sys.argv[1:] if args is None else args)
    report = build_report(options.model, options.fixture)
    write_report_atomic(options.output, report, [options.model, options.fixture])
    print(json.dumps({
        "gameOverSafetyStatus": report["gameOverSafetyStatus"],
        "scenarioCount": len(report["scenarios"]),
        "status": report["status"],
    }, sort_keys=True, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
