"""신규 game temporal holdout에서 V0와 V4를 비교하는 Notebook 계약을 검증한다.

고정 checksum, 과거·신규 gameId 분리, train-only scaler와 physical-class metric이
명시되어 있는지 source cell을 읽어 확인한다. 일부 game만 쓰는 smoke 결과가 자동으로
정책 채택이나 canonical 결과로 승격되지 않는 것도 중요한 검증 대상이다.
"""

import json
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[3]
NOTEBOOK_PATH = (
    ROOT / "scripts/ml/notebooks/placement_temporal_holdout_v0_v4_experiment.ipynb"
)


class PlacementTemporalHoldoutNotebookContractTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.notebook = json.loads(NOTEBOOK_PATH.read_text(encoding="utf-8"))
        cls.cells = cls.notebook["cells"]
        cls.markdown = "\n".join(
            "".join(cell.get("source", []))
            for cell in cls.cells
            if cell["cell_type"] == "markdown"
        )
        cls.code = "\n".join(
            "".join(cell.get("source", []))
            for cell in cls.cells
            if cell["cell_type"] == "code"
        )

    def test_sections_follow_the_experiment_flow(self):
        sections = [
            "## 1. 질문과 고정 조건",
            "## 2. 경로와 source checksum",
            "## 3. Base/cumulative dataset 검증",
            "## 4. Temporal cohort와 leakage gate",
            "## 5. 기존 16-feature와 occupied-cell class",
            "## 6. Worked example: alias가 pair weight에 미치는 영향",
            "## 7. V0/V4 pair, shared scaler, estimator",
            "## 8. 신규 game held-out 평가",
            "## 9. 진단과 결정적 smoke report",
            "## 10. 결과를 읽는 법과 user full-run gate",
        ]
        positions = [self.markdown.index(section) for section in sections]
        self.assertEqual(positions, sorted(positions))

    def test_temporal_contract_and_fixed_inputs_are_explicit(self):
        for token in [
            "data/datasets/human-behavior-v2-snapshot-26g-20260717",
            "PLACEMENT_TEMPORAL_CUMULATIVE_DATASET",
            "PLACEMENT_TEMPORAL_MAX_VALIDATION_GAMES",
            "BASE_GAME_IDS.issubset(CUMULATIVE_GAME_IDS)",
            "NEW_GAME_IDS",
            "SOURCE_SHA256_AFTER == SOURCE_SHA256_BEFORE",
            "BASE_SHA256_AFTER == BASE_SHA256",
            "CUMULATIVE_SHA256_AFTER == CUMULATIVE_SHA256",
            "fullCohortCovered",
            "policyDecisionEligible",
            "canonicalResultEligible",
        ]:
            self.assertIn(token, self.code)

    def test_v0_v4_shared_scaler_and_fixed_estimator_are_visible(self):
        for token in [
            'VARIANT_NAMES = ["V0", "V4"]',
            '"V0": "raw selected-vs-all-unselected candidate pairs"',
            '"V4": "one representative per non-selected physical class"',
            "def build_pairs",
            "1.0 / raw_count",
            "1.0 / len(class_keys)",
            "scaler.fit_transform(train_values)",
            "scaler.transform(validation_values)",
            "full_train_decision_count",
            "1.0 / (full_train_decision_count * MODEL_CONFIG[\"l2\"])",
            '"solver": "lbfgs"',
            '"fitIntercept": False',
            '"classWeight": None',
            '"tolerance": 1e-12',
            '"maxIterations": 10000',
        ]:
            self.assertIn(token, self.code)

    def test_leakage_and_physical_class_metrics_are_explicit(self):
        for token in [
            "selectedBySource",
            "metadata.isWinner",
            "heuristicBaseline.score",
            "validation candidate must not enter scaler fit or pair construction",
            "choiceRequired",
            "score_physical_classes",
            "score_raw_candidates",
            "gameIdLeakageCount",
            "productionIntegration",
        ]:
            self.assertIn(token, self.code + self.markdown)

    def test_smoke_cannot_be_promoted_to_a_policy_decision(self):
        for token in [
            '"awaiting_full_temporal_evaluation"',
            '"needs_policy_decision"',
            "Smoke 결과로 V0 또는 V4를 채택하지 않는다",
            "full 실행은 사용자가 명시적으로 수행한다",
        ]:
            self.assertIn(token, self.code + self.markdown)

    def test_report_is_deterministic_and_source_notebook_is_clean(self):
        for token in [
            "PLACEMENT_TEMPORAL_REPORT",
            "sort_keys=True",
            "allow_nan=False",
            "atomic_write_text",
            "sourceChecksumBefore",
            "sourceChecksumAfter",
            "REPORT_SOURCE_COLLISION",
            "same_inode",
        ]:
            self.assertIn(token, self.code)
        self.assertNotIn('"timestamp":', self.code)
        self.assertNotIn('"pid":', self.code)
        for cell in self.cells:
            if cell["cell_type"] == "code":
                self.assertIsNone(cell.get("execution_count"))
                self.assertEqual(cell.get("outputs", []), [])
        self.assertNotIn("/Users/", self.code + self.markdown)
        self.assertNotIn("subprocess", self.code)
        self.assertNotIn("node ", self.code.lower())


if __name__ == "__main__":
    unittest.main()
