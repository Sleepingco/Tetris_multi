"""Single-fold JavaScript/Python pairwise ranker parity utilities."""

from __future__ import annotations

import argparse
import copy
import importlib.metadata
import json
import math
import os
import platform
import secrets
import sys
import warnings
from pathlib import Path
from typing import Any, Callable

import numpy as np
import sklearn
from sklearn.exceptions import ConvergenceWarning
from sklearn.linear_model import LogisticRegression


PARITY_BUNDLE_SCHEMA_VERSION = 2
SUPPORTED_DATASET_SCHEMA_VERSION = 2
SUPPORTED_FEATURE_SCHEMA_VERSION = 1
SUPPORTED_MODEL_SCHEMA_VERSION = 1
SUPPORTED_MODEL_TYPE = "pairwise_linear_ranker"
FEATURE_COUNT = 16

# 같은 canonical 순회와 float64 연산에서 libm 차이만 허용한다.
PARITY_ABSOLUTE_TOLERANCE = 1e-12
SKLEARN_SOLVER = "lbfgs"
SKLEARN_TOLERANCE = 1e-12
SKLEARN_MAX_ITERATIONS = 10_000
RANK_METRIC_NAMES = [
    "decisionCount",
    "top1Accuracy",
    "tieAwareTop1Accuracy",
    "topScoreTieDecisionCount",
    "top3Accuracy",
    "mrr",
    "meanSelectedRank",
]


class ContractError(ValueError):
    """Raised when a parity bundle violates the language-neutral contract."""


def _require(condition: bool, reason: str) -> None:
    if not condition:
        raise ContractError(reason)


def _is_finite_number(value: Any) -> bool:
    return isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value)


def _validate_finite_tree(value: Any, path: str = "bundle") -> None:
    if isinstance(value, float):
        _require(math.isfinite(value), f"NON_FINITE_VALUE:{path}")
    elif isinstance(value, list):
        for index, item in enumerate(value):
            _validate_finite_tree(item, f"{path}[{index}]")
    elif isinstance(value, dict):
        for key, item in value.items():
            _validate_finite_tree(item, f"{path}.{key}")


def validate_bundle(bundle: dict[str, Any]) -> None:
    _require(isinstance(bundle, dict), "INVALID_BUNDLE")
    _validate_finite_tree(bundle)
    _require(bundle.get("parityBundleSchemaVersion") == PARITY_BUNDLE_SCHEMA_VERSION,
             "PARITY_BUNDLE_SCHEMA_VERSION_MISMATCH")
    _require(bundle.get("datasetSchemaVersion") == SUPPORTED_DATASET_SCHEMA_VERSION,
             "DATASET_SCHEMA_VERSION_MISMATCH")
    _require(bundle.get("featureSchemaVersion") == SUPPORTED_FEATURE_SCHEMA_VERSION,
             "FEATURE_SCHEMA_VERSION_MISMATCH")
    _require(bundle.get("modelSchemaVersion") == SUPPORTED_MODEL_SCHEMA_VERSION,
             "MODEL_SCHEMA_VERSION_MISMATCH")
    _require(bundle.get("modelType") == SUPPORTED_MODEL_TYPE, "MODEL_TYPE_MISMATCH")
    feature_names = bundle.get("featureNames")
    reference_names = bundle.get("jsReference", {}).get("featureNames")
    _require(isinstance(feature_names, list) and len(feature_names) == FEATURE_COUNT,
             "INVALID_FEATURE_NAMES")
    _require(feature_names == reference_names, "FEATURE_NAMES_MISMATCH")
    _require(all(isinstance(name, str) and name for name in feature_names), "INVALID_FEATURE_NAMES")

    train_game_ids = bundle.get("trainGameIds")
    validation_game_ids = bundle.get("validationGameIds")
    _require(isinstance(train_game_ids, list) and train_game_ids, "INVALID_TRAIN_GAME_IDS")
    _require(isinstance(validation_game_ids, list) and len(validation_game_ids) == 1,
             "INVALID_VALIDATION_GAME_IDS")
    _require(bundle.get("validationGameId") == validation_game_ids[0],
             "VALIDATION_GAME_ID_MISMATCH")
    _require(not set(train_game_ids).intersection(validation_game_ids), "GAME_ID_LEAKAGE")

    counts = bundle.get("counts")
    _require(isinstance(counts, dict), "INVALID_COUNTS")
    train_decisions = bundle.get("trainDecisions")
    validation_decisions = bundle.get("validationDecisions")
    pairs = bundle.get("trainingPairs")
    _require(isinstance(train_decisions, list) and train_decisions, "INVALID_TRAIN_DECISIONS")
    _require(isinstance(validation_decisions, list) and validation_decisions,
             "INVALID_VALIDATION_DECISIONS")
    _require(isinstance(pairs, list) and pairs, "INVALID_TRAINING_PAIRS")
    _require(len(train_decisions) == counts.get("trainDecisionCount"), "TRAIN_DECISION_COUNT_MISMATCH")
    _require(len(validation_decisions) == counts.get("validationDecisionCount"),
             "VALIDATION_DECISION_COUNT_MISMATCH")
    _require(len(pairs) == counts.get("trainPairCount"), "TRAIN_PAIR_COUNT_MISMATCH")

    train_candidate_count = _validate_decisions(train_decisions, train_game_ids, feature_names)
    validation_candidate_count = _validate_decisions(
        validation_decisions, validation_game_ids, feature_names
    )
    _require(train_candidate_count == counts.get("trainCandidateCount"),
             "TRAIN_CANDIDATE_COUNT_MISMATCH")
    _require(validation_candidate_count == counts.get("validationCandidateCount"),
             "VALIDATION_CANDIDATE_COUNT_MISMATCH")
    _require(count_zero_difference_pairs(pairs) == counts.get("trainZeroDifferencePairCount"),
             "ZERO_DIFFERENCE_PAIR_COUNT_MISMATCH")
    train_duplicate_count = count_selected_feature_duplicate_decisions(train_decisions)
    validation_duplicate_count = count_selected_feature_duplicate_decisions(validation_decisions)
    _require(train_duplicate_count == counts.get("trainZeroDifferenceDecisionCount"),
             "ZERO_DIFFERENCE_DECISION_COUNT_MISMATCH")
    _require(train_duplicate_count == counts.get("trainSelectedFeatureDuplicateDecisionCount"),
             "TRAIN_SELECTED_FEATURE_DUPLICATE_COUNT_MISMATCH")
    _require(validation_duplicate_count == counts.get(
        "validationSelectedFeatureDuplicateDecisionCount"
    ), "VALIDATION_SELECTED_FEATURE_DUPLICATE_COUNT_MISMATCH")
    config = bundle.get("trainingConfig")
    _require(isinstance(config, dict), "INVALID_TRAINING_CONFIG")
    _require(isinstance(config.get("epochs"), int) and config["epochs"] > 0,
             "INVALID_TRAINING_EPOCHS")
    _require(_is_finite_number(config.get("learningRate")) and config["learningRate"] > 0,
             "INVALID_LEARNING_RATE")
    _require(_is_finite_number(config.get("l2")) and config["l2"] > 0, "INVALID_L2")


def _validate_decisions(
    decisions: list[dict[str, Any]], expected_game_ids: list[str], feature_names: list[str]
) -> int:
    candidate_count = 0
    decision_keys: set[str] = set()
    expected_game_set = set(expected_game_ids)
    for decision in decisions:
        _require(isinstance(decision, dict), "INVALID_DECISION")
        decision_key = decision.get("decisionKey")
        _require(isinstance(decision_key, str) and decision_key not in decision_keys,
                 "INVALID_OR_DUPLICATE_DECISION_KEY")
        decision_keys.add(decision_key)
        _require(decision.get("gameId") in expected_game_set, "DECISION_GAME_ID_MISMATCH")
        candidates = decision.get("candidates")
        _require(isinstance(candidates, list) and len(candidates) >= 2, "INSUFFICIENT_CANDIDATES")
        _require(all(isinstance(candidate.get("selected"), bool) for candidate in candidates),
                 "INVALID_CANDIDATE_SELECTED_FLAG")
        _require(sum(candidate.get("selected") is True for candidate in candidates) == 1,
                 "SELECTED_CANDIDATE_COUNT_MISMATCH")
        placement_keys: set[str] = set()
        for candidate in candidates:
            placement_key = candidate.get("placementKey")
            _require(isinstance(placement_key, str) and placement_key not in placement_keys,
                     "INVALID_OR_DUPLICATE_PLACEMENT_KEY")
            placement_keys.add(placement_key)
            raw_features = candidate.get("rawFeatures")
            _require(isinstance(raw_features, list) and len(raw_features) == len(feature_names),
                     "FEATURE_VECTOR_LENGTH_MISMATCH")
            _require(all(_is_finite_number(value) for value in raw_features),
                     "NON_FINITE_FEATURE_VECTOR")
        candidate_count += len(candidates)
    return candidate_count


def count_selected_feature_duplicate_decisions(decisions: list[dict[str, Any]]) -> int:
    count = 0
    for item in decisions:
        selected = next(candidate for candidate in item["candidates"] if candidate["selected"])
        if any(
            candidate is not selected and candidate["rawFeatures"] == selected["rawFeatures"]
            for candidate in item["candidates"]
        ):
            count += 1
    return count


def count_zero_difference_pairs(pairs: list[dict[str, Any]]) -> int:
    return sum(
        all(value == 0 for value in pair["featureDifference"])
        for pair in pairs
    )


def fit_population_scaler(train_decisions: list[dict[str, Any]]) -> dict[str, list[float]]:
    vectors = [
        candidate["rawFeatures"]
        for decision in train_decisions
        for candidate in decision["candidates"]
    ]
    feature_count = len(vectors[0])
    mean = [0.0] * feature_count
    for values in vectors:
        for index in range(feature_count):
            mean[index] += values[index]
    for index in range(feature_count):
        mean[index] /= len(vectors)
    variance = [0.0] * feature_count
    for values in vectors:
        for index in range(feature_count):
            delta = values[index] - mean[index]
            variance[index] += delta * delta
    scale = []
    for value in variance:
        population_variance = value / len(vectors)
        scale.append(1.0 if population_variance == 0 else math.sqrt(population_variance))
    return {"mean": mean, "scale": scale}


def _standardize(values: list[float], scaler: dict[str, list[float]]) -> list[float]:
    return [
        (value - scaler["mean"][index]) / scaler["scale"][index]
        for index, value in enumerate(values)
    ]


def create_training_pairs(
    train_decisions: list[dict[str, Any]], scaler: dict[str, list[float]]
) -> list[dict[str, Any]]:
    pairs = []
    for decision in train_decisions:
        selected = next(candidate for candidate in decision["candidates"] if candidate["selected"])
        selected_features = _standardize(selected["rawFeatures"], scaler)
        unselected = [candidate for candidate in decision["candidates"] if not candidate["selected"]]
        pair_weight = 1.0 / len(unselected)
        for candidate in unselected:
            candidate_features = _standardize(candidate["rawFeatures"], scaler)
            pairs.append({
                "decisionKey": decision["decisionKey"],
                "selectedPlacementKey": selected["placementKey"],
                "unselectedPlacementKey": candidate["placementKey"],
                "featureDifference": [
                    value - candidate_features[index]
                    for index, value in enumerate(selected_features)
                ],
                "weight": pair_weight,
            })
    return pairs


def _softplus(value: float) -> float:
    return value + math.log1p(math.exp(-value)) if value > 0 else math.log1p(math.exp(value))


def _sigmoid_negative_margin(margin: float) -> float:
    if margin >= 0:
        value = math.exp(-margin)
        return value / (1.0 + value)
    return 1.0 / (1.0 + math.exp(margin))


def calculate_js_objective(
    pairs: list[dict[str, Any]], weights: list[float], decision_count: int, l2: float
) -> tuple[float, list[float]]:
    gradient = [0.0] * len(weights)
    loss = 0.0
    for pair in pairs:
        margin = 0.0
        for index in range(len(weights)):
            margin += weights[index] * pair["featureDifference"][index]
        loss += pair["weight"] * _softplus(-margin)
        factor = -pair["weight"] * _sigmoid_negative_margin(margin)
        for index in range(len(gradient)):
            gradient[index] += factor * pair["featureDifference"][index]
    loss /= decision_count
    for index in range(len(weights)):
        loss += 0.5 * l2 * weights[index] * weights[index]
        gradient[index] = gradient[index] / decision_count + l2 * weights[index]
    return loss, gradient


def train_js_equivalent(bundle: dict[str, Any]) -> dict[str, Any]:
    validate_bundle(bundle)
    scaler = fit_population_scaler(bundle["trainDecisions"])
    pairs = create_training_pairs(bundle["trainDecisions"], scaler)
    config = bundle["trainingConfig"]
    weights = [0.0] * len(bundle["featureNames"])
    initial_loss, _ = calculate_js_objective(
        pairs, weights, len(bundle["trainDecisions"]), config["l2"]
    )
    for _ in range(config["epochs"]):
        _, gradient = calculate_js_objective(
            pairs, weights, len(bundle["trainDecisions"]), config["l2"]
        )
        for index in range(len(weights)):
            weights[index] -= config["learningRate"] * gradient[index]
    final_loss, _ = calculate_js_objective(
        pairs, weights, len(bundle["trainDecisions"]), config["l2"]
    )
    validation = score_validation(bundle["validationDecisions"], scaler, weights)
    return {
        "scaler": scaler,
        "pairs": pairs,
        "initialLoss": initial_loss,
        "finalLoss": final_loss,
        "weights": weights,
        "validation": validation,
    }


def score_validation(
    decisions: list[dict[str, Any]], scaler: dict[str, list[float]], weights: list[float]
) -> dict[str, Any]:
    results = []
    selected_ranks = []
    tie_aware_top1_results = []
    top_score_tie_decision_count = 0
    for decision in decisions:
        scored = []
        for canonical_index, candidate in enumerate(decision["candidates"]):
            features = _standardize(candidate["rawFeatures"], scaler)
            score = 0.0
            for index in range(len(weights)):
                score += weights[index] * features[index]
            scored.append({
                "placementKey": candidate["placementKey"],
                "selected": candidate["selected"],
                "score": score,
                "canonicalIndex": canonical_index,
            })
        ranked = sorted(scored, key=lambda candidate: (-candidate["score"], candidate["canonicalIndex"]))
        ranks = {candidate["placementKey"]: index + 1 for index, candidate in enumerate(ranked)}
        selected = next(candidate for candidate in scored if candidate["selected"])
        selected_rank = ranks[selected["placementKey"]]
        top_score = ranked[0]["score"]
        top_score_tie_count = sum(candidate["score"] == top_score for candidate in ranked)
        selected_ranks.append(selected_rank)
        tie_aware_top1_results.append(selected["score"] == top_score)
        if top_score_tie_count > 1:
            top_score_tie_decision_count += 1
        results.append({
            "decisionKey": decision["decisionKey"],
            "selectedPlacementKey": selected["placementKey"],
            "selectedRank": selected_rank,
            "candidates": [{
                "placementKey": candidate["placementKey"],
                "selected": candidate["selected"],
                "score": candidate["score"],
                "rank": ranks[candidate["placementKey"]],
            } for candidate in scored],
        })
    count = len(selected_ranks)
    return {
        "decisions": results,
        "metrics": {
            "decisionCount": count,
            "top1Accuracy": sum(rank == 1 for rank in selected_ranks) / count,
            "tieAwareTop1Accuracy": sum(tie_aware_top1_results) / count,
            "topScoreTieDecisionCount": top_score_tie_decision_count,
            "top3Accuracy": sum(rank <= 3 for rank in selected_ranks) / count,
            "mrr": sum(1.0 / rank for rank in selected_ranks) / count,
            "meanSelectedRank": sum(selected_ranks) / count,
        },
    }


def _maximum_absolute_error(left: list[float], right: list[float]) -> float:
    _require(len(left) == len(right), "VECTOR_LENGTH_MISMATCH")
    return max((abs(left[index] - right[index]) for index in range(len(left))), default=0.0)


def compare_js_reference(bundle: dict[str, Any], python_reference: dict[str, Any]) -> dict[str, Any]:
    js_reference = bundle["jsReference"]
    pair_differences = []
    pair_weight_differences = []
    pair_identity_matches = True
    for expected, actual in zip(bundle["trainingPairs"], python_reference["pairs"], strict=True):
        pair_identity_matches = pair_identity_matches and all(
            expected[key] == actual[key]
            for key in ["decisionKey", "selectedPlacementKey", "unselectedPlacementKey"]
        )
        pair_differences.append(_maximum_absolute_error(
            expected["featureDifference"], actual["featureDifference"]
        ))
        pair_weight_differences.append(abs(expected["weight"] - actual["weight"]))
    js_decisions = js_reference["validation"]["decisions"]
    python_decisions = python_reference["validation"]["decisions"]
    score_errors = []
    rank_matches = True
    selected_placement_matches = True
    candidate_selection_matches = True
    for expected, actual in zip(js_decisions, python_decisions, strict=True):
        rank_matches = rank_matches and expected["decisionKey"] == actual["decisionKey"]
        rank_matches = rank_matches and expected["selectedRank"] == actual["selectedRank"]
        selected_placement_matches = (
            selected_placement_matches
            and expected.get("selectedPlacementKey") == actual["selectedPlacementKey"]
        )
        for expected_candidate, actual_candidate in zip(
            expected["candidates"], actual["candidates"], strict=True
        ):
            rank_matches = rank_matches and expected_candidate["placementKey"] == actual_candidate["placementKey"]
            rank_matches = rank_matches and expected_candidate["rank"] == actual_candidate["rank"]
            candidate_selection_matches = (
                candidate_selection_matches
                and isinstance(expected_candidate.get("selected"), bool)
                and expected_candidate["selected"] == actual_candidate["selected"]
            )
            score_errors.append(abs(expected_candidate["score"] - actual_candidate["score"]))
    metric_errors = {
        name: abs(js_reference["validation"]["metrics"][name] -
                  python_reference["validation"]["metrics"][name])
        for name in RANK_METRIC_NAMES
    }
    errors = {
        "scalerMeanMaxAbsoluteError": _maximum_absolute_error(
            js_reference["scaler"]["mean"], python_reference["scaler"]["mean"]
        ),
        "scalerScaleMaxAbsoluteError": _maximum_absolute_error(
            js_reference["scaler"]["scale"], python_reference["scaler"]["scale"]
        ),
        "pairFeatureDifferenceMaxAbsoluteError": max(pair_differences, default=0.0),
        "pairWeightMaxAbsoluteError": max(pair_weight_differences, default=0.0),
        "initialLossAbsoluteError": abs(js_reference["initialLoss"] - python_reference["initialLoss"]),
        "finalLossAbsoluteError": abs(js_reference["finalLoss"] - python_reference["finalLoss"]),
        "weightMaxAbsoluteError": _maximum_absolute_error(
            js_reference["weights"], python_reference["weights"]
        ),
        "validationScoreMaxAbsoluteError": max(score_errors, default=0.0),
        "metricMaxAbsoluteError": max(metric_errors.values(), default=0.0),
    }
    passed = (pair_identity_matches and rank_matches and selected_placement_matches
              and candidate_selection_matches and all(
        value <= PARITY_ABSOLUTE_TOLERANCE for value in errors.values()
    ))
    return {
        "passed": passed,
        "absoluteTolerance": PARITY_ABSOLUTE_TOLERANCE,
        "pairIdentityMatches": pair_identity_matches,
        "rankMatches": rank_matches,
        "selectedPlacementMatches": selected_placement_matches,
        "candidateSelectionMatches": candidate_selection_matches,
        "metricErrors": metric_errors,
        **errors,
    }


def calculate_sklearn_c(decision_count: int, l2: float) -> float:
    _require(isinstance(decision_count, int) and decision_count > 0, "INVALID_DECISION_COUNT")
    _require(_is_finite_number(l2) and l2 > 0, "INVALID_L2")
    return 1.0 / (decision_count * l2)


def create_symmetric_samples(
    pairs: list[dict[str, Any]], feature_count: int
) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    features = []
    labels = []
    sample_weights = []
    for pair in pairs:
        difference = pair["featureDifference"]
        _require(len(difference) == feature_count, "FEATURE_VECTOR_LENGTH_MISMATCH")
        half_weight = pair["weight"] / 2.0
        features.append(difference)
        labels.append(1)
        sample_weights.append(half_weight)
        features.append([-value for value in difference])
        labels.append(0)
        sample_weights.append(half_weight)
    return (
        np.asarray(features, dtype=np.float64),
        np.asarray(labels, dtype=np.int64),
        np.asarray(sample_weights, dtype=np.float64),
    )


def validate_symmetric_sample_weights(
    pairs: list[dict[str, Any]], sample_weights: np.ndarray
) -> dict[str, float]:
    _require(
        sample_weights.ndim == 1 and sample_weights.shape[0] == len(pairs) * 2,
        "SYMMETRIC_SAMPLE_WEIGHT_COUNT_MISMATCH",
    )
    decision_weights: dict[str, float] = {}
    for index, pair in enumerate(pairs):
        positive_weight = float(sample_weights[index * 2])
        negative_weight = float(sample_weights[index * 2 + 1])
        expected_half_weight = pair["weight"] / 2.0
        _require(
            math.isfinite(positive_weight) and math.isfinite(negative_weight)
            and positive_weight >= 0 and negative_weight >= 0,
            "INVALID_SYMMETRIC_SAMPLE_WEIGHT",
        )
        _require(
            abs(positive_weight - expected_half_weight) <= PARITY_ABSOLUTE_TOLERANCE
            and abs(negative_weight - expected_half_weight) <= PARITY_ABSOLUTE_TOLERANCE,
            "SYMMETRIC_PAIR_SIDE_WEIGHT_MISMATCH",
        )
        transformed_pair_weight = positive_weight + negative_weight
        _require(
            abs(transformed_pair_weight - pair["weight"]) <= PARITY_ABSOLUTE_TOLERANCE,
            "SYMMETRIC_PAIR_WEIGHT_MISMATCH",
        )
        decision_key = pair["decisionKey"]
        decision_weights[decision_key] = (
            decision_weights.get(decision_key, 0.0) + transformed_pair_weight
        )
    _require(
        all(abs(weight - 1.0) <= PARITY_ABSOLUTE_TOLERANCE
            for weight in decision_weights.values()),
        "SYMMETRIC_DECISION_WEIGHT_MISMATCH",
    )
    return decision_weights


def train_sklearn_reference(
    bundle: dict[str, Any],
    pairs: list[dict[str, Any]],
    scaler: dict[str, list[float]],
) -> dict[str, Any]:
    decision_count = len(bundle["trainDecisions"])
    l2 = bundle["trainingConfig"]["l2"]
    c_value = calculate_sklearn_c(decision_count, l2)
    x_values, labels, sample_weights = create_symmetric_samples(pairs, len(bundle["featureNames"]))
    sample_weight_by_decision = validate_symmetric_sample_weights(pairs, sample_weights)
    model = LogisticRegression(
        C=c_value,
        l1_ratio=0.0,
        fit_intercept=False,
        class_weight=None,
        solver=SKLEARN_SOLVER,
        tol=SKLEARN_TOLERANCE,
        max_iter=SKLEARN_MAX_ITERATIONS,
    )
    with warnings.catch_warnings(record=True) as caught:
        warnings.simplefilter("always")
        model.fit(x_values, labels, sample_weight=sample_weights)
    convergence_warnings = [
        str(item.message) for item in caught if issubclass(item.category, ConvergenceWarning)
    ]
    if convergence_warnings:
        raise ContractError(f"SKLEARN_CONVERGENCE_WARNING:{convergence_warnings[0]}")
    unexpected_warnings = [
        f"{item.category.__name__}:{item.message}"
        for item in caught if not issubclass(item.category, ConvergenceWarning)
    ]
    weights = model.coef_[0].astype(np.float64, copy=True).tolist()
    objective, _ = calculate_js_objective(pairs, weights, decision_count, l2)
    decision_sample_weights = list(sample_weight_by_decision.values())
    validation = score_validation(bundle["validationDecisions"], scaler, weights)
    return {
        "solver": SKLEARN_SOLVER,
        "fitIntercept": False,
        "classWeight": None,
        "tolerance": SKLEARN_TOLERANCE,
        "maxIterations": SKLEARN_MAX_ITERATIONS,
        "iterationCount": int(model.n_iter_[0]),
        "converged": int(model.n_iter_[0]) < SKLEARN_MAX_ITERATIONS,
        "warnings": unexpected_warnings,
        "decisionCount": decision_count,
        "l2": l2,
        "c": c_value,
        "symmetricSampleCount": int(x_values.shape[0]),
        "sampleWeightTotal": float(sample_weights.sum(dtype=np.float64)),
        "pairSampleWeightsMatch": True,
        "decisionSampleWeightMinimum": min(decision_sample_weights),
        "decisionSampleWeightMaximum": max(decision_sample_weights),
        "decisionSampleWeightsAllOne": all(
            abs(value - 1.0) <= PARITY_ABSOLUTE_TOLERANCE
            for value in decision_sample_weights
        ),
        "weights": weights,
        "scaler": copy.deepcopy(scaler),
        "jsObjectiveFinalLoss": objective,
        "validation": validation,
    }


def compare_sklearn(bundle: dict[str, Any], sklearn_reference: dict[str, Any]) -> dict[str, Any]:
    js_reference = bundle["jsReference"]
    js_decisions = js_reference["validation"]["decisions"]
    sklearn_decisions = sklearn_reference["validation"]["decisions"]
    changed_candidates = []
    changed_selected_decisions = []
    tie_break_decisions = []
    for js_decision, sklearn_decision in zip(js_decisions, sklearn_decisions, strict=True):
        if js_decision["selectedRank"] != sklearn_decision["selectedRank"]:
            changed_selected_decisions.append({
                "decisionKey": js_decision["decisionKey"],
                "jsSelectedRank": js_decision["selectedRank"],
                "sklearnSelectedRank": sklearn_decision["selectedRank"],
            })
        js_selected_score = next(
            candidate["score"] for candidate in js_decision["candidates"] if candidate["selected"]
        )
        sklearn_selected_score = next(
            candidate["score"] for candidate in sklearn_decision["candidates"] if candidate["selected"]
        )
        if len({candidate["score"] for candidate in sklearn_decision["candidates"]}) < len(
            sklearn_decision["candidates"]
        ):
            tie_break_decisions.append(sklearn_decision["decisionKey"])
        for js_candidate, sklearn_candidate in zip(
            js_decision["candidates"], sklearn_decision["candidates"], strict=True
        ):
            if js_candidate["rank"] != sklearn_candidate["rank"]:
                changed_candidates.append({
                    "decisionKey": js_decision["decisionKey"],
                    "placementKey": js_candidate["placementKey"],
                    "selected": js_candidate["selected"],
                    "jsRank": js_candidate["rank"],
                    "sklearnRank": sklearn_candidate["rank"],
                    "jsScore": js_candidate["score"],
                    "sklearnScore": sklearn_candidate["score"],
                    "jsScoreMarginToSelected": js_candidate["score"] - js_selected_score,
                    "sklearnScoreMarginToSelected": (
                        sklearn_candidate["score"] - sklearn_selected_score
                    ),
                })
    metric_differences = {
        name: sklearn_reference["validation"]["metrics"][name] -
        js_reference["validation"]["metrics"][name]
        for name in RANK_METRIC_NAMES
    }
    return {
        "weightMaxAbsoluteDifferenceFromJs500Step": _maximum_absolute_error(
            js_reference["weights"], sklearn_reference["weights"]
        ),
        "jsObjectiveLossDifferenceFromJs500Step": (
            sklearn_reference["jsObjectiveFinalLoss"] - js_reference["finalLoss"]
        ),
        "metricDifferences": metric_differences,
        "changedSelectedDecisionCount": len(changed_selected_decisions),
        "changedSelectedDecisions": changed_selected_decisions,
        "changedCandidateCount": len(changed_candidates),
        "changedCandidates": changed_candidates,
        "canonicalTieBreakDecisionCount": len(tie_break_decisions),
        "canonicalTieBreakDecisionKeys": tie_break_decisions,
    }


def build_report(bundle: dict[str, Any]) -> dict[str, Any]:
    original = copy.deepcopy(bundle)
    python_reference = train_js_equivalent(bundle)
    parity = compare_js_reference(bundle, python_reference)
    _require(bundle == original, "INPUT_BUNDLE_MUTATED")
    report = {
        "parityReportSchemaVersion": 2,
        "runtimeIntegration": False,
        "datasetSchemaVersion": bundle["datasetSchemaVersion"],
        "featureSchemaVersion": bundle["featureSchemaVersion"],
        "modelSchemaVersion": bundle["modelSchemaVersion"],
        "modelType": bundle["modelType"],
        "featureNames": list(bundle["featureNames"]),
        "sourceDatasetSha256": bundle["sourceDatasetSha256"],
        "datasetInputSha256": bundle["datasetInputSha256"],
        "validationGameId": bundle["validationGameId"],
        "trainGameIds": list(bundle["trainGameIds"]),
        "validationGameIds": list(bundle["validationGameIds"]),
        "counts": copy.deepcopy(bundle["counts"]),
        "environment": {
            "python": platform.python_version(),
            "implementation": platform.python_implementation(),
            "machine": platform.machine(),
            "numpy": np.__version__,
            "scipy": importlib.metadata.version("scipy"),
            "scikitLearn": sklearn.__version__,
        },
        "trainingConfig": copy.deepcopy(bundle["trainingConfig"]),
        "jsEquivalent": {
            **parity,
            "initialLoss": python_reference["initialLoss"],
            "finalLoss": python_reference["finalLoss"],
            "metrics": python_reference["validation"]["metrics"],
        },
        "representationDiagnostics": {
            "trainSelectedFeatureDuplicateDecisionCount": count_selected_feature_duplicate_decisions(
                bundle["trainDecisions"]
            ),
            "trainZeroDifferencePairCount": count_zero_difference_pairs(
                python_reference["pairs"]
            ),
            "validationSelectedFeatureDuplicateDecisionCount": (
                count_selected_feature_duplicate_decisions(bundle["validationDecisions"])
            ),
            "validationTopScoreTieDecisionCount": (
                python_reference["validation"]["metrics"]["topScoreTieDecisionCount"]
            ),
            "validationTieAwareTop1Accuracy": (
                python_reference["validation"]["metrics"]["tieAwareTop1Accuracy"]
            ),
        },
        "analysis": {
            "objectiveScaling": "C=1/(trainDecisionCount*l2); symmetric pair weights sum to one per decision.",
            "optimizerDifference": None,
            "differenceAttribution": "Not assigned because JS/Python parity failed.",
        },
    }
    if not parity["passed"]:
        report["sklearn"] = {
            "status": "skipped",
            "reason": "JS_EQUIVALENT_PARITY_FAILED",
        }
        return report
    sklearn_reference = train_sklearn_reference(
        bundle, python_reference["pairs"], python_reference["scaler"]
    )
    _require(bundle == original, "INPUT_BUNDLE_MUTATED")
    sklearn_comparison = compare_sklearn(bundle, sklearn_reference)
    report["sklearn"] = {
        "status": "completed",
        **{key: value for key, value in sklearn_reference.items()
           if key not in ["weights", "validation"]},
        "weights": sklearn_reference["weights"],
        "metrics": sklearn_reference["validation"]["metrics"],
        "comparison": sklearn_comparison,
    }
    report["analysis"] = {
        "objectiveScaling": "C=1/(trainDecisionCount*l2); symmetric pair weights sum to one per decision.",
        "optimizerDifference": "JS uses 500 fixed full-batch gradient steps; sklearn lbfgs optimizes the same scaled objective toward convergence.",
        "differenceAttribution": "JS/Python parity passed for canonical order, raw features, train-only scaler, pair differences, pair weights, and validation scoring. Remaining differences may be attributed to the optimizer stopping point.",
    }
    return report


def _lexical_path(file_path: Path) -> Path:
    return Path(os.path.abspath(os.fspath(file_path)))


def assert_safe_output_path(bundle_path: Path, output_path: Path) -> None:
    bundle_lexical = _lexical_path(bundle_path)
    output_lexical = _lexical_path(output_path)
    bundle_resolved = bundle_path.resolve(strict=True)
    output_resolved = output_path.resolve(strict=False)
    same_file = False
    try:
        same_file = bundle_path.samefile(output_path)
    except FileNotFoundError:
        pass
    _require(
        bundle_lexical != output_lexical
        and bundle_resolved != output_resolved
        and not same_file,
        "OUTPUT_PATH_CONFLICTS_WITH_BUNDLE",
    )


def _random_staging_path(output_path: Path, _attempt: int) -> Path:
    return output_path.with_name(f".{output_path.name}.{secrets.token_hex(16)}.tmp")


def _assert_owned_staging_file(staging_path: Path, identity: os.stat_result) -> None:
    try:
        current = staging_path.lstat()
    except FileNotFoundError as error:
        raise ContractError("STAGING_FILE_REPLACED") from error
    _require(
        not staging_path.is_symlink()
        and current.st_dev == identity.st_dev
        and current.st_ino == identity.st_ino,
        "STAGING_FILE_REPLACED",
    )


def _remove_owned_staging_file(staging_path: Path | None, identity: os.stat_result | None) -> None:
    if staging_path is None or identity is None:
        return
    try:
        current = staging_path.lstat()
        if (not staging_path.is_symlink()
                and current.st_dev == identity.st_dev
                and current.st_ino == identity.st_ino):
            staging_path.unlink()
    except FileNotFoundError:
        pass


def _create_exclusive_staging_file(
    bundle_path: Path,
    output_path: Path,
    staging_path_factory: Callable[[Path, int], Path],
) -> tuple[int, Path, os.stat_result]:
    output_directory = _lexical_path(output_path.parent)
    for attempt in range(32):
        staging_path = Path(staging_path_factory(output_path, attempt))
        _require(
            _lexical_path(staging_path.parent) == output_directory,
            "STAGING_PATH_MUST_SHARE_OUTPUT_DIRECTORY",
        )
        assert_safe_output_path(bundle_path, staging_path)
        try:
            descriptor = os.open(
                staging_path,
                os.O_WRONLY | os.O_CREAT | os.O_EXCL,
                0o600,
            )
            return descriptor, staging_path, os.fstat(descriptor)
        except FileExistsError:
            continue
    raise ContractError("STAGING_PATH_ALLOCATION_FAILED")


def write_report_atomic(
    bundle_path: Path,
    output_path: Path,
    report: dict[str, Any],
    staging_path_factory: Callable[[Path, int], Path] | None = None,
) -> None:
    assert_safe_output_path(bundle_path, output_path)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    factory = staging_path_factory or _random_staging_path
    descriptor: int | None = None
    staging_path: Path | None = None
    identity: os.stat_result | None = None
    replaced = False
    try:
        descriptor, staging_path, identity = _create_exclusive_staging_file(
            bundle_path,
            output_path,
            factory,
        )
        report_file = os.fdopen(descriptor, "w", encoding="utf-8")
        descriptor = None
        with report_file:
            json.dump(report, report_file, indent=2, ensure_ascii=False, allow_nan=False)
            report_file.write("\n")
            report_file.flush()
            os.fsync(report_file.fileno())
        _assert_owned_staging_file(staging_path, identity)
        assert_safe_output_path(bundle_path, staging_path)
        assert_safe_output_path(bundle_path, output_path)
        os.replace(staging_path, output_path)
        replaced = True
    finally:
        if descriptor is not None:
            os.close(descriptor)
        if not replaced:
            _remove_owned_staging_file(staging_path, identity)


def parse_args(args: list[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--bundle", required=True, type=Path)
    parser.add_argument("--output", required=True, type=Path)
    return parser.parse_args(args)


def main(args: list[str] | None = None) -> int:
    options = parse_args(sys.argv[1:] if args is None else args)
    assert_safe_output_path(options.bundle, options.output)
    with options.bundle.open("r", encoding="utf-8") as bundle_file:
        bundle = json.load(bundle_file)
    report = build_report(bundle)
    write_report_atomic(options.bundle, options.output, report)
    print(json.dumps({
        "output": str(options.output.resolve()),
        "validationGameId": report["validationGameId"],
        "jsEquivalentPassed": report["jsEquivalent"]["passed"],
        "sklearnStatus": report["sklearn"]["status"],
        "sklearnConverged": report["sklearn"].get("converged", False),
    }, indent=2))
    return 0 if (
        report["jsEquivalent"]["passed"]
        and report["sklearn"]["status"] == "completed"
        and report["sklearn"]["converged"]
    ) else 1


if __name__ == "__main__":
    raise SystemExit(main())
