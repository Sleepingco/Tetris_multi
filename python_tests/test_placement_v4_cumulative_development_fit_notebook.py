import json
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
NOTEBOOK_PATH = ROOT / "scripts/ml/notebooks/placement_v4_cumulative_75g_development_fit.ipynb"
EXPERIMENT_PATH = ROOT / "ai-harness/ml-experiments/experiments/placement-v4-cumulative-75g-development-fit.md"


class PlacementV4CumulativeDevelopmentFitNotebookTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.notebook = json.loads(NOTEBOOK_PATH.read_text(encoding="utf-8"))
        cls.cells = cls.notebook["cells"]
        cls.source = "\n".join("".join(cell.get("source", [])) for cell in cls.cells)
        cls.code = "\n".join(
            "".join(cell.get("source", []))
            for cell in cls.cells
            if cell.get("cell_type") == "code"
        )
        cls.experiment = EXPERIMENT_PATH.read_text(encoding="utf-8")

    def test_sections_follow_the_development_fit_flow(self):
        headings = [
            "# Placement V4 cumulative 75-game development fit",
            "## 1. 실험 질문과 경계",
            "## 2. 환경, 경로와 checksum",
            "## 3. JSONL과 accepted cohort 계약",
            "## 4. Smoke/full training cohort",
            "## 5. 고정 16-feature와 occupied-cell V4",
            "## 6. V4 pair와 weight 진단",
            "## 7. Shared raw-candidate scaler와 symmetric sample",
            "## 8. Development-only batch fit",
            "## 9. 결정적 checkpoint",
            "## 10. 사용자 full-run gate",
        ]
        positions = [self.source.index(heading) for heading in headings]
        self.assertEqual(positions, sorted(positions))

    def test_fixed_dataset_and_checksums_are_explicit(self):
        required = [
            "data/datasets/human-behavior-v2-temporal-cumulative-75g-20260718",
            "dbf1dd5f30177abc3b44d7bdcc7e21aaf2f8a3d0015a96ba6bdfd9506c71487a",
            "0a71b121514016721d50bda5e01b298002fe8820e0a110f6b62945b4f1550120",
            "65511767072d46484a5e4e15821bde2ee91957d02b1e16af35ec5e9da2c5274d",
            "84c93b3b1d8e4d82eb4dcf094bab28c35d8834dedf9566bfbe72b008b47b1085",
        ]
        for value in required:
            self.assertIn(value, self.source)
            self.assertIn(value, self.experiment)

    def test_v4_is_the_only_training_representation(self):
        self.assertIn('REPRESENTATION = "V4"', self.code)
        self.assertIn("1.0 / alternative_class_count", self.code)
        self.assertNotIn('variant == "V0"', self.code)
        self.assertNotIn('variant == "V1"', self.code)
        self.assertNotIn('variant == "V2"', self.code)
        self.assertNotIn('variant == "V3"', self.code)
        self.assertNotIn("LeaveOneGroupOut", self.code)

    def test_feature_scaler_weight_and_estimator_contracts_are_visible(self):
        expected_features = [
            "candidateResult.linesCleared",
            "candidateResult.gameOver",
            "metricDelta.aggregateHeight",
            "metricDelta.maxHeight",
            "metricDelta.holes",
            "metricDelta.bumpiness",
        ]
        for feature in expected_features:
            self.assertIn(feature, self.source)
        self.assertIn('*[f"metricDelta.columnHeights[{index}]" for index in range(10)]', self.code)
        for required in [
            "StandardScaler(with_mean=True, with_std=True)",
            "pair_weights / 2.0",
            "1.0 / (training_decision_count * MODEL_CONFIG[\"l2\"])",
            'solver="lbfgs"',
            "fit_intercept=False",
            "class_weight=None",
            "tol=1e-12",
            "max_iter=10_000",
        ]:
            self.assertIn(required, self.code)

    def test_checkpoint_is_explicitly_non_production(self):
        for required in [
            '"developmentOnly": True',
            '"productionIntegration": False',
            '"canonicalResultEligible": False',
            '"policyDecisionEligible": False',
            '"heldOutEvidence": False',
            '"evaluationMetricsIncluded": False',
        ]:
            self.assertIn(required, self.code)

    def test_smoke_and_full_use_one_path_and_full_gate_is_75_games(self):
        self.assertIn('os.environ.get("PLACEMENT_V4_MAX_TRAINING_GAMES", "2")', self.code)
        self.assertIn("EXPECTED_ACCEPTED_GAME_COUNT = 75", self.code)
        self.assertIn("TRAINING_GAME_IDS = ALL_GAME_IDS[:MAX_TRAINING_GAMES]", self.code)
        self.assertIn("fullCohortCovered", self.source)
        self.assertIn("PLACEMENT_V4_MAX_TRAINING_GAMES=75", self.experiment)

    def test_deterministic_report_and_source_protection_are_present(self):
        for required in [
            "json.dumps(CHECKPOINT, ensure_ascii=False, sort_keys=True, separators=(\",\", \":\"), allow_nan=False)",
            "atomic_write_text",
            "exclusive",
            "source_checksums_after",
        ]:
            self.assertIn(required, self.code)
        for forbidden in ["datetime.now", "/Users/", "traceback"]:
            self.assertNotIn(forbidden, self.source)
        self.assertNotIn('"timestamp"', self.code)

    def test_source_notebook_is_clean(self):
        for cell in self.cells:
            if cell.get("cell_type") == "code":
                self.assertIsNone(cell.get("execution_count"))
                self.assertEqual(cell.get("outputs"), [])


if __name__ == "__main__":
    unittest.main()
