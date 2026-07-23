"""동결 V4 model의 Python reference inference와 안전한 report 출력을 검증한다.

fixture candidate를 복사해 schema·수치 계약, physical-class grouping, 결정적 tie-break와
game-over filter를 검사한다. 임시 파일 출력 테스트는 같은 입력의 byte 결정성과 보호된
출력 경로 거부를 확인하며 model·fixture 원본이 변경되지 않아야 한다.
"""

import copy
import hashlib
import json
import math
import os
import tempfile
import unittest
from pathlib import Path

from scripts.ml import placement_v4_reference_inference as inference
from scripts.ml import train_placement_v4 as trainer


ROOT = Path(__file__).resolve().parents[1]
FIXTURE_PATH = ROOT / "python_tests/fixtures/placement_v4_reference_inference_fixture.json"


class PlacementV4ReferenceInferenceTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.fixture = json.loads(FIXTURE_PATH.read_text(encoding="utf-8"))

    def valid_model(self):
        coefficients = [0.0, 0.0, -1.0, -1.0, -1.0, -1.0, *([-0.1] * 10)]
        return {
            "canonicalArtifact": False,
            "coefficients": coefficients,
            "datasetSchemaVersion": 2,
            "featureNames": list(inference.FEATURE_NAMES),
            "featureSchemaVersion": 1,
            "modelSchemaVersion": 1,
            "modelType": "pairwise_linear_ranker",
            "productionIntegration": False,
            "representation": {
                "name": "V4",
                "selectedClassAliasesExcluded": True,
                "unit": "occupied-cell physical class",
            },
            "scaler": {
                "mean": [0.0] * 16,
                "scale": [1.0] * 16,
            },
            "weights": list(coefficients),
        }

    def scenario(self, scenario_id):
        return copy.deepcopy(next(
            scenario for scenario in self.fixture["scenarios"]
            if scenario["scenarioId"] == scenario_id
        ))

    def test_linear_score_uses_raw_minus_mean_over_scale_dot_coefficient(self):
        model = self.valid_model()
        model["scaler"]["mean"] = [float(index) for index in range(16)]
        model["scaler"]["scale"] = [float(index + 1) for index in range(16)]
        model["coefficients"] = [float(index - 8) for index in range(16)]
        model["weights"] = list(model["coefficients"])
        parameters = inference.validate_model(model)
        features = tuple(float(index * 2) for index in range(16))
        expected = sum(
            coefficient * ((raw - mean) / scale)
            for raw, mean, scale, coefficient in zip(
                features,
                parameters["mean"],
                parameters["scale"],
                parameters["coefficients"],
            )
        )
        self.assertEqual(inference.linear_score(features, parameters), expected)

    def test_artifact_schema_feature_order_and_numeric_contract(self):
        inference.validate_model(self.valid_model())
        with self.assertRaises(inference.ContractError):
            inference.validate_model(None)
        mutations = {
            "schema": lambda model: model.update(modelSchemaVersion=2),
            "feature_order": lambda model: model.update(featureNames=list(reversed(model["featureNames"]))),
            "weight_length": lambda model: model.update(weights=model["weights"][:-1]),
            "coefficient_mismatch": lambda model: model["weights"].__setitem__(0, 1.0),
            "missing_scaler": lambda model: model.pop("scaler"),
            "zero_scale": lambda model: model["scaler"]["scale"].__setitem__(0, 0.0),
            "nan_coefficient": lambda model: model["coefficients"].__setitem__(0, float("nan")),
            "production_enabled": lambda model: model.update(productionIntegration=True),
        }
        for name, mutate in mutations.items():
            with self.subTest(name=name):
                model = self.valid_model()
                mutate(model)
                with self.assertRaises(inference.ContractError):
                    inference.validate_model(model)

    def test_alias_grouping_and_candidate_order_are_deterministic(self):
        scenario = self.scenario("alias-grouping")
        parameters = inference.validate_model(self.valid_model())
        forward = inference.rank_candidates(scenario["candidates"], parameters)
        reverse = inference.rank_candidates(list(reversed(scenario["candidates"])), parameters)
        self.assertEqual(forward, reverse)
        self.assertEqual(forward["physicalClassCount"], 2)
        selected = next(row for row in forward["classes"] if row["finalRank"] == 1)
        self.assertEqual(selected["aliasCount"], 2)
        self.assertEqual(selected["representativeKey"], "tee:0:10:0")

    def test_game_over_class_is_filtered_even_when_its_score_is_higher(self):
        scenario = self.scenario("game-over-filter")
        result = inference.rank_candidates(
            scenario["candidates"],
            inference.validate_model(self.valid_model()),
        )
        by_key = {row["classKey"]: row for row in result["classes"]}
        unsafe = by_key[scenario["expected"]["highestLinearScoreClassKey"]]
        safe = by_key[scenario["expected"]["selectedClassKey"]]
        self.assertGreater(unsafe["linearScore"], safe["linearScore"])
        self.assertTrue(unsafe["excludedByGameOverSafety"])
        self.assertIsNone(unsafe["finalRank"])
        self.assertEqual(result["selectedClassKey"], safe["classKey"])
        self.assertEqual(result["filteredGameOverClassCount"], 1)

    def test_all_game_over_fallback_uses_unicode_class_key_tie_break(self):
        scenario = self.scenario("all-game-over-fallback")
        result = inference.rank_candidates(
            list(reversed(scenario["candidates"])),
            inference.validate_model(self.valid_model()),
        )
        self.assertFalse(result["safeClassAvailable"])
        self.assertTrue(result["unavoidableGameOver"])
        self.assertEqual(result["filteredGameOverClassCount"], 0)
        self.assertEqual(result["selectedClassKey"], min(scenario["expected"]["classRanks"]))

    def test_empty_missing_nonfinite_and_inconsistent_class_inputs_are_rejected(self):
        parameters = inference.validate_model(self.valid_model())
        base = self.scenario("alias-grouping")["candidates"]
        invalid_inputs = [
            [],
            [{"candidatePlacement": {}}],
            [copy.deepcopy(base[0])],
            [copy.deepcopy(base[0])],
        ]
        invalid_inputs[2][0]["metricDelta"]["holes"] = float("nan")
        invalid_inputs[3][0]["metricDelta"]["holes"] = float("inf")
        duplicate_cell = copy.deepcopy(base[0])
        duplicate_cell["candidatePlacement"]["cells"][1] = copy.deepcopy(
            duplicate_cell["candidatePlacement"]["cells"][0]
        )
        invalid_inputs.append([duplicate_cell])
        for candidates in invalid_inputs:
            with self.subTest(candidates=candidates):
                with self.assertRaises(inference.ContractError):
                    inference.rank_candidates(candidates, parameters)

        inconsistent = copy.deepcopy(base[:2])
        inconsistent[1] = copy.deepcopy(base[0])
        inconsistent[1]["candidatePlacement"]["rotation"] = 1
        inconsistent[1]["metricDelta"]["holes"] = 1
        with self.assertRaises(inference.ContractError):
            inference.rank_candidates(inconsistent, parameters)

    def test_report_and_atomic_output_are_byte_deterministic_and_preserve_inputs(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            model_path = root / "model.json"
            fixture_path = root / "fixture.json"
            model_path.write_bytes(trainer.json_bytes(self.valid_model()))
            model_sha = hashlib.sha256(model_path.read_bytes()).hexdigest()
            fixture = copy.deepcopy(self.fixture)
            fixture["modelSha256"] = model_sha
            fixture_path.write_bytes(trainer.json_bytes(fixture))
            model_before = model_path.read_bytes()
            fixture_before = fixture_path.read_bytes()

            report_one = inference.build_report(model_path, fixture_path, model_sha)
            report_two = inference.build_report(model_path, fixture_path, model_sha)
            output_one = root / "run1.json"
            output_two = root / "run2.json"
            inference.write_report_atomic(output_one, report_one, [model_path, fixture_path])
            inference.write_report_atomic(output_two, report_two, [model_path, fixture_path])

            self.assertEqual(output_one.read_bytes(), output_two.read_bytes())
            self.assertEqual(model_path.read_bytes(), model_before)
            self.assertEqual(fixture_path.read_bytes(), fixture_before)
            self.assertEqual(report_one["status"], "reference_inference_valid")
            self.assertEqual(report_one["gameOverSafetyStatus"], "gameover_safety_contract_valid")
            self.assertFalse(report_one["canonicalArtifact"])
            self.assertFalse(report_one["productionIntegration"])

    def test_output_exact_alias_symlink_and_hardlink_are_rejected(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            model_path = root / "model.json"
            fixture_path = root / "fixture.json"
            model_path.write_text("model\n", encoding="utf-8")
            fixture_path.write_text("fixture\n", encoding="utf-8")
            protected = [model_path, fixture_path]
            report = {"status": "safe"}

            with self.assertRaises(inference.ContractError):
                inference.write_report_atomic(model_path, report, protected)
            nested = root / "nested"
            nested.mkdir()
            with self.assertRaises(inference.ContractError):
                inference.write_report_atomic(nested / ".." / "model.json", report, protected)
            symlink = root / "symlink.json"
            symlink.symlink_to(model_path)
            with self.assertRaises(inference.ContractError):
                inference.write_report_atomic(symlink, report, protected)
            hardlink = root / "hardlink.json"
            os.link(model_path, hardlink)
            with self.assertRaises(inference.ContractError):
                inference.write_report_atomic(hardlink, report, protected)
            self.assertEqual(model_path.read_bytes(), b"model\n")
            self.assertEqual(fixture_path.read_bytes(), b"fixture\n")


if __name__ == "__main__":
    unittest.main()
