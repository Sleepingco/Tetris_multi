import copy
import json
import math
import os
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock


ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts" / "ml"))

import placement_pairwise_parity as parity  # noqa: E402


FEATURE_NAMES = [f"feature-{index}" for index in range(parity.FEATURE_COUNT)]


def vector(first: float, second: float = 0.0) -> list[float]:
    return [first, second, *([0.0] * (parity.FEATURE_COUNT - 2))]


def decision(game_id: str, index: int, selected: list[float], unselected: list[list[float]]):
    candidates = [{
        "placementKey": f"piece:0:18:{index}",
        "selected": True,
        "rawFeatures": selected,
    }]
    candidates.extend({
        "placementKey": f"piece:0:18:{index + offset + 1}",
        "selected": False,
        "rawFeatures": values,
    } for offset, values in enumerate(unselected))
    return {
        "decisionKey": f"{game_id}:human:{index}",
        "gameId": game_id,
        "candidates": candidates,
    }


def make_bundle() -> dict:
    train_decisions = [
        decision("game-a", 1, vector(2.0), [vector(0.0), vector(1.0)]),
        decision("game-b", 4, vector(3.0), [vector(0.0)]),
    ]
    validation_decisions = [decision("game-c", 8, vector(2.0), [vector(0.0), vector(1.0)])]
    scaler = parity.fit_population_scaler(train_decisions)
    pairs = parity.create_training_pairs(train_decisions, scaler)
    config = {"epochs": 40, "learningRate": 0.05, "l2": 0.01, "seed": "fixture"}
    weights = [0.0] * parity.FEATURE_COUNT
    initial_loss, _ = parity.calculate_js_objective(pairs, weights, len(train_decisions), config["l2"])
    for _ in range(config["epochs"]):
        _, gradient = parity.calculate_js_objective(pairs, weights, len(train_decisions), config["l2"])
        weights = [
            weight - config["learningRate"] * gradient[index]
            for index, weight in enumerate(weights)
        ]
    final_loss, _ = parity.calculate_js_objective(pairs, weights, len(train_decisions), config["l2"])
    validation = parity.score_validation(validation_decisions, scaler, weights)
    return {
        "parityBundleSchemaVersion": 2,
        "datasetSchemaVersion": 2,
        "featureSchemaVersion": 1,
        "modelSchemaVersion": 1,
        "modelType": "pairwise_linear_ranker",
        "featureNames": list(FEATURE_NAMES),
        "sourceDatasetSha256": "fixture-dataset",
        "datasetInputSha256": "fixture-input",
        "validationGameId": "game-c",
        "trainGameIds": ["game-a", "game-b"],
        "validationGameIds": ["game-c"],
        "trainingConfig": config,
        "pairWeightContract": {
            "difference": "standardized(selected)-standardized(unselected)",
            "pairWeight": "1/unselectedCandidateCount",
            "decisionPairWeightTotal": 1,
            "lossReduction": "weightedPairLossSum/trainDecisionCount",
        },
        "counts": {
            "trainGameCount": 2,
            "validationGameCount": 1,
            "trainDecisionCount": len(train_decisions),
            "validationDecisionCount": len(validation_decisions),
            "trainCandidateCount": sum(len(item["candidates"]) for item in train_decisions),
            "validationCandidateCount": sum(len(item["candidates"]) for item in validation_decisions),
            "trainPairCount": len(pairs),
            "trainZeroDifferencePairCount": parity.count_zero_difference_pairs(pairs),
            "trainZeroDifferenceDecisionCount": parity.count_selected_feature_duplicate_decisions(
                train_decisions
            ),
            "trainSelectedFeatureDuplicateDecisionCount": (
                parity.count_selected_feature_duplicate_decisions(train_decisions)
            ),
            "validationSelectedFeatureDuplicateDecisionCount": (
                parity.count_selected_feature_duplicate_decisions(validation_decisions)
            ),
        },
        "trainDecisions": train_decisions,
        "validationDecisions": validation_decisions,
        "trainingPairs": pairs,
        "jsReference": {
            "featureNames": list(FEATURE_NAMES),
            "scaler": scaler,
            "initialLoss": initial_loss,
            "finalLoss": final_loss,
            "weights": weights,
            "validation": validation,
        },
        "runtimeIntegration": False,
    }


class PlacementPairwiseParityTest(unittest.TestCase):
    def test_feature_duplicate_and_zero_difference_diagnostics(self):
        duplicate = decision("game-a", 1, vector(2.0), [vector(2.0), vector(0.0)])
        scaler = parity.fit_population_scaler([duplicate])
        pairs = parity.create_training_pairs([duplicate], scaler)

        self.assertEqual(parity.count_selected_feature_duplicate_decisions([duplicate]), 1)
        self.assertEqual(parity.count_zero_difference_pairs(pairs), 1)

    def test_scaler_uses_population_variance_and_zero_variance_scale(self):
        decisions = [decision("game-a", 1, vector(0.0), [vector(2.0)])]
        scaler = parity.fit_population_scaler(decisions)

        self.assertEqual(scaler["mean"][0], 1.0)
        self.assertEqual(scaler["scale"][0], 1.0)
        self.assertTrue(all(value == 1.0 for value in scaler["scale"][1:]))

    def test_validation_candidates_do_not_affect_scaler(self):
        bundle = make_bundle()
        before = parity.fit_population_scaler(bundle["trainDecisions"])
        bundle["validationDecisions"][0]["candidates"][0]["rawFeatures"][0] = 1_000_000.0
        after = parity.fit_population_scaler(bundle["trainDecisions"])

        self.assertEqual(before, after)

    def test_symmetric_samples_preserve_pair_and_decision_weight(self):
        bundle = make_bundle()
        x_values, labels, sample_weights = parity.create_symmetric_samples(
            bundle["trainingPairs"], parity.FEATURE_COUNT
        )
        decision_weights = parity.validate_symmetric_sample_weights(
            bundle["trainingPairs"], sample_weights
        )

        self.assertTrue((x_values[0] == -x_values[1]).all())
        self.assertEqual(labels.tolist()[:2], [1, 0])
        self.assertAlmostEqual(float(sample_weights.sum()), 2.0)
        self.assertEqual(decision_weights, {"game-a:human:1": 1.0, "game-b:human:4": 1.0})

    def test_sklearn_rejects_corrupted_transformed_sample_weights(self):
        bundle = make_bundle()
        python_reference = parity.train_js_equivalent(bundle)
        transformed = parity.create_symmetric_samples(
            python_reference["pairs"], parity.FEATURE_COUNT
        )
        corrupted_weights = transformed[2].copy()
        corrupted_weights[0] += 0.1

        with mock.patch.object(
            parity,
            "create_symmetric_samples",
            return_value=(transformed[0], transformed[1], corrupted_weights),
        ):
            with self.assertRaisesRegex(
                parity.ContractError, "SYMMETRIC_PAIR_SIDE_WEIGHT_MISMATCH"
            ):
                parity.train_sklearn_reference(
                    bundle,
                    python_reference["pairs"],
                    python_reference["scaler"],
                )

    def test_c_uses_decision_count_and_l2(self):
        self.assertEqual(parity.calculate_sklearn_c(50, 0.01), 2.0)

    def test_train_validation_game_id_overlap_is_rejected(self):
        bundle = make_bundle()
        bundle["validationGameIds"] = ["game-a"]
        bundle["validationGameId"] = "game-a"

        with self.assertRaisesRegex(parity.ContractError, "GAME_ID_LEAKAGE"):
            parity.validate_bundle(bundle)

    def test_schema_and_feature_order_mismatch_are_rejected(self):
        bundle = make_bundle()
        bundle["featureNames"].reverse()
        with self.assertRaisesRegex(parity.ContractError, "FEATURE_NAMES_MISMATCH"):
            parity.validate_bundle(bundle)

        bundle = make_bundle()
        bundle["featureSchemaVersion"] = 2
        with self.assertRaisesRegex(parity.ContractError, "FEATURE_SCHEMA_VERSION_MISMATCH"):
            parity.validate_bundle(bundle)

    def test_candidate_selected_must_be_boolean_and_exactly_one(self):
        bundle = make_bundle()
        bundle["trainDecisions"][0]["candidates"][1]["selected"] = 0
        with self.assertRaisesRegex(parity.ContractError, "INVALID_CANDIDATE_SELECTED_FLAG"):
            parity.validate_bundle(bundle)

        bundle = make_bundle()
        bundle["trainDecisions"][0]["candidates"][1]["selected"] = True
        with self.assertRaisesRegex(parity.ContractError, "SELECTED_CANDIDATE_COUNT_MISMATCH"):
            parity.validate_bundle(bundle)

    def test_nan_and_infinity_are_rejected(self):
        for invalid in [math.nan, math.inf, -math.inf]:
            bundle = make_bundle()
            bundle["trainDecisions"][0]["candidates"][0]["rawFeatures"][0] = invalid
            with self.assertRaisesRegex(parity.ContractError, "NON_FINITE"):
                parity.validate_bundle(bundle)

    def test_js_equivalent_training_is_deterministic(self):
        bundle = make_bundle()
        first = parity.train_js_equivalent(bundle)
        second = parity.train_js_equivalent(bundle)

        self.assertEqual(first, second)

    def test_training_does_not_mutate_bundle(self):
        bundle = make_bundle()
        original = copy.deepcopy(bundle)
        parity.train_js_equivalent(bundle)

        self.assertEqual(bundle, original)

    def test_synthetic_selected_candidate_scores_higher(self):
        result = parity.train_js_equivalent(make_bundle())
        validation = result["validation"]["decisions"][0]
        selected = next(candidate for candidate in validation["candidates"] if candidate["selected"])

        self.assertEqual(selected["rank"], 1)
        self.assertTrue(all(
            selected["score"] > candidate["score"]
            for candidate in validation["candidates"] if not candidate["selected"]
        ))

    def test_tie_aware_top1_keeps_canonical_metric_and_reports_top_score_tie(self):
        tied = decision("game-c", 8, vector(1.0), [vector(1.0), vector(0.0)])
        tied["candidates"] = [tied["candidates"][1], tied["candidates"][0], tied["candidates"][2]]
        result = parity.score_validation(
            [tied],
            {"mean": [0.0] * parity.FEATURE_COUNT, "scale": [1.0] * parity.FEATURE_COUNT},
            [1.0, *([0.0] * (parity.FEATURE_COUNT - 1))],
        )

        self.assertEqual(result["metrics"]["top1Accuracy"], 0.0)
        self.assertEqual(result["metrics"]["tieAwareTop1Accuracy"], 1.0)
        self.assertEqual(result["metrics"]["topScoreTieDecisionCount"], 1)

    def test_pair_feature_difference_matches_bundle(self):
        bundle = make_bundle()
        result = parity.train_js_equivalent(bundle)

        self.assertEqual(result["pairs"], bundle["trainingPairs"])

    def test_full_report_is_deterministic_and_preserves_input(self):
        bundle = make_bundle()
        original = copy.deepcopy(bundle)
        first = parity.build_report(bundle)
        second = parity.build_report(bundle)

        self.assertEqual(first, second)
        self.assertEqual(bundle, original)
        self.assertTrue(first["jsEquivalent"]["passed"])
        self.assertTrue(first["sklearn"]["converged"])
        self.assertTrue(first["sklearn"]["decisionSampleWeightsAllOne"])
        self.assertEqual(first["sklearn"]["decisionSampleWeightMinimum"], 1.0)
        self.assertEqual(first["sklearn"]["decisionSampleWeightMaximum"], 1.0)

    def test_sklearn_validation_uses_python_training_scaler(self):
        bundle = make_bundle()
        python_reference = parity.train_js_equivalent(bundle)
        bundle["jsReference"]["scaler"]["mean"][0] = 1_000_000.0
        sklearn_reference = parity.train_sklearn_reference(
            bundle, python_reference["pairs"], python_reference["scaler"]
        )
        expected = parity.score_validation(
            bundle["validationDecisions"],
            python_reference["scaler"],
            sklearn_reference["weights"],
        )

        self.assertEqual(sklearn_reference["scaler"], python_reference["scaler"])
        self.assertEqual(sklearn_reference["validation"], expected)

    def test_parity_failure_skips_sklearn_and_does_not_assign_optimizer_cause(self):
        bundle = make_bundle()
        bundle["jsReference"]["weights"][0] += 1.0
        report = parity.build_report(bundle)

        self.assertFalse(report["jsEquivalent"]["passed"])
        self.assertEqual(report["sklearn"]["status"], "skipped")
        self.assertEqual(report["sklearn"]["reason"], "JS_EQUIVALENT_PARITY_FAILED")
        self.assertIsNone(report["analysis"]["optimizerDifference"])
        self.assertIn("Not assigned", report["analysis"]["differenceAttribution"])

    def test_parity_compares_selected_placement_candidate_flag_and_decision_count(self):
        cases = []

        selected_placement_bundle = make_bundle()
        selected_placement_bundle["jsReference"]["validation"]["decisions"][0][
            "selectedPlacementKey"
        ] = "piece:0:18:9"
        cases.append((selected_placement_bundle, "selectedPlacementMatches"))

        candidate_selected_bundle = make_bundle()
        candidate_selected_bundle["jsReference"]["validation"]["decisions"][0][
            "candidates"
        ][1]["selected"] = True
        cases.append((candidate_selected_bundle, "candidateSelectionMatches"))

        decision_count_bundle = make_bundle()
        decision_count_bundle["jsReference"]["validation"]["metrics"][
            "decisionCount"
        ] += 1
        cases.append((decision_count_bundle, "metricErrors"))

        for bundle, failed_field in cases:
            with self.subTest(failed_field=failed_field):
                report = parity.build_report(bundle)
                self.assertFalse(report["jsEquivalent"]["passed"])
                self.assertEqual(report["sklearn"]["status"], "skipped")
                if failed_field == "metricErrors":
                    self.assertEqual(
                        report["jsEquivalent"]["metricErrors"]["decisionCount"], 1
                    )
                else:
                    self.assertFalse(report["jsEquivalent"][failed_field])

    def test_output_exact_alias_symlink_and_hardlink_are_rejected_without_mutating_bundle(self):
        with tempfile.TemporaryDirectory() as temporary_directory:
            root = Path(temporary_directory)
            bundle_path = root / "bundle.json"
            bundle_bytes = json.dumps(make_bundle()).encode("utf-8")
            bundle_path.write_bytes(bundle_bytes)
            alias_path = root / "nested" / ".." / "bundle.json"
            symlink_path = root / "bundle-link.json"
            hardlink_path = root / "bundle-hardlink.json"
            os.symlink(bundle_path, symlink_path)
            os.link(bundle_path, hardlink_path)

            for output_path in [bundle_path, alias_path, symlink_path, hardlink_path]:
                with self.assertRaisesRegex(parity.ContractError, "OUTPUT_PATH_CONFLICTS_WITH_BUNDLE"):
                    parity.write_report_atomic(bundle_path, output_path, {"safe": True})

            self.assertEqual(bundle_path.read_bytes(), bundle_bytes)

    def test_staging_exact_alias_symlink_and_hardlink_preserve_source_and_output(self):
        with tempfile.TemporaryDirectory() as temporary_directory:
            root = Path(temporary_directory)
            bundle_path = root / "bundle.json"
            output_path = root / "report.json"
            bundle_bytes = json.dumps(make_bundle()).encode("utf-8")
            output_bytes = b"existing-report\n"
            bundle_path.write_bytes(bundle_bytes)
            output_path.write_bytes(output_bytes)
            staging_symlink = root / "staging-symlink.tmp"
            staging_hardlink = root / "staging-hardlink.tmp"
            os.symlink(bundle_path, staging_symlink)
            os.link(bundle_path, staging_hardlink)
            staging_paths = [
                bundle_path,
                root / "nested" / ".." / "bundle.json",
                staging_symlink,
                staging_hardlink,
            ]

            for staging_path in staging_paths:
                with self.subTest(staging_path=staging_path):
                    with self.assertRaisesRegex(
                        parity.ContractError, "OUTPUT_PATH_CONFLICTS_WITH_BUNDLE"
                    ):
                        parity.write_report_atomic(
                            bundle_path,
                            output_path,
                            {"safe": True},
                            staging_path_factory=lambda _output, _attempt, value=staging_path: value,
                        )
                    self.assertEqual(bundle_path.read_bytes(), bundle_bytes)
                    self.assertEqual(output_path.read_bytes(), output_bytes)

    def test_atomic_report_output_is_deterministic(self):
        with tempfile.TemporaryDirectory() as temporary_directory:
            root = Path(temporary_directory)
            bundle_path = root / "bundle.json"
            output_one = root / "report-one.json"
            output_two = root / "report-two.json"
            bundle_path.write_text(json.dumps(make_bundle()), encoding="utf-8")
            report = parity.build_report(make_bundle())

            parity.write_report_atomic(bundle_path, output_one, report)
            parity.write_report_atomic(bundle_path, output_two, report)

            self.assertEqual(output_one.read_bytes(), output_two.read_bytes())

    def test_atomic_report_serialization_failure_preserves_source_and_existing_output(self):
        with tempfile.TemporaryDirectory() as temporary_directory:
            root = Path(temporary_directory)
            bundle_path = root / "bundle.json"
            output_path = root / "report.json"
            bundle_bytes = json.dumps(make_bundle()).encode("utf-8")
            output_bytes = b"existing-report\n"
            bundle_path.write_bytes(bundle_bytes)
            output_path.write_bytes(output_bytes)

            with self.assertRaises(TypeError):
                parity.write_report_atomic(
                    bundle_path,
                    output_path,
                    {"notJsonSerializable": {1, 2, 3}},
                )

            self.assertEqual(bundle_path.read_bytes(), bundle_bytes)
            self.assertEqual(output_path.read_bytes(), output_bytes)


if __name__ == "__main__":
    unittest.main()
