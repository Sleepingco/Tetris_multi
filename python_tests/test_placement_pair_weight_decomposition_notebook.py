"""Pair weight 분해 실험 Notebook과 학습용 문서의 정적 계약을 검증한다.

고정 dataset checksum에서 V0~V4 pair와 weight가 만들어지고 같은 train-only scaler와
estimator로 비교되는 흐름을 확인한다. source 입력 불변성, 결정적 atomic report와
production 미적용 경계까지 검사해 실험 결과가 과장되지 않게 한다.
"""

import json
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
NOTEBOOK_PATH = (
    ROOT / "scripts/ml/notebooks/placement_pair_weight_decomposition_experiment.ipynb"
)
DOCUMENTATION_PATH = ROOT / "docs/placement-pair-weight-decomposition.md"


class PlacementPairWeightDecompositionNotebookContractTest(unittest.TestCase):
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
        cls.documentation = DOCUMENTATION_PATH.read_text(encoding="utf-8")

    def test_required_sections_are_ordered(self):
        sections = [
            "## 1. 실험 질문",
            "## 2. 고정 조건과 환경",
            "## 3. Source snapshot checksum 검증",
            "## 4. JSONL 로딩과 schema 검증",
            "## 5. 기존 16-feature 추출",
            "## 6. Occupied-cell equivalence key",
            "## 7. Worked example",
            "## 8. V0~V4 pair와 weight 생성",
            "## 9. 전체 variant pair와 weight 진단",
            "## 10. Shared scaler, symmetric sample, fixed estimator",
            "## 11. Held-out raw/class metric",
            "## 12. 26-fold LOGO",
            "## 13. Raw-candidate와 physical-class 결과",
            "## 14. Coefficient, score, rank 비교",
            "## 15. Fold delta, multiplicity segmentation, pairless 진단",
            "## 16. Baseline reproduction과 sanity gate",
            "## 17. Attribution 결과",
            "## 18. Source checksum 재검증과 결정적 report",
            "## 19. 관측, 해석, 결정과 다음 gate",
        ]
        positions = [self.markdown.index(section) for section in sections]
        self.assertEqual(positions, sorted(positions))

    def test_each_major_step_explains_learning_contract(self):
        for token in [
            "왜 실행하는가",
            "입력",
            "계산",
            "읽는 법",
            "보류 조건",
            "candidate",
            "physical placement",
            "decision-balanced weight",
            "Shapley attribution",
        ]:
            self.assertIn(token, self.markdown)

    def test_snapshot_path_and_all_checksums_are_fixed(self):
        for token in [
            "data/datasets/human-behavior-v2-snapshot-26g-20260717",
            "51027be0ebad578f2c38bb8715aa491daa8f13208e3da551a5e4a2dd08bef088",
            "85034a66373add54324a56673cb99ed5854810e4299abcaf9c195ae8cbca631e",
            "23b832d95a2057b7b29e7062286c58c68524fa8db00f00870e6076a0a846f58a",
            "06ede14119014e2b040f8a4d62e00532ca6eecae9424b93e9cc882394db8a85f",
            "SOURCE_SHA256_AFTER == SOURCE_SHA256_BEFORE",
        ]:
            self.assertIn(token, self.code)

    def test_feature_allowlist_order_and_leakage_exclusions_are_explicit(self):
        features = [
            "candidateResult.linesCleared",
            "candidateResult.gameOver",
            "metricDelta.aggregateHeight",
            "metricDelta.maxHeight",
            "metricDelta.holes",
            "metricDelta.bumpiness",
        ]
        positions = [self.code.index(feature) for feature in features]
        self.assertEqual(positions, sorted(positions))
        self.assertIn("range(10)", self.code)
        for forbidden in [
            '"selectedBySource"',
            '"metadata.isWinner"',
            '"winnerPlayerId"',
            '"heuristicBaseline.score"',
            '"metadata.inputSequence"',
        ]:
            self.assertIn(forbidden, self.code)

    def test_equivalence_key_is_label_free(self):
        start = self.code.index("def create_equivalence_key")
        end = self.code.index("assert set(EQUIVALENCE_KEY_FIELDS)", start)
        function = self.code[start:end]
        self.assertIn("placement['pieceType']", function)
        self.assertIn('placement["cells"]', function)
        for forbidden in [
            "selectedBySource",
            "rotation",
            "placementKey",
            "isWinner",
            "foldMetric",
        ]:
            self.assertNotIn(forbidden, function)

    def test_five_variants_and_weight_formulas_are_visible(self):
        for token in [
            '"raw_baseline"',
            '"drop_zero_keep_weight"',
            '"drop_zero_renormalized"',
            '"class_balanced_expanded"',
            '"cell_grouped"',
            "1.0 / raw_count",
            "1.0 / len(informative)",
            "1.0 / (len(class_keys) * len(members))",
            "1.0 / len(class_keys)",
            "WORKED_DECISION",
            "worked_variant_table",
        ]:
            self.assertIn(token, self.code)

    def test_shared_train_only_scaler_and_logo_are_explicit(self):
        for token in [
            "def fit_shared_scaler",
            "scaler.fit_transform(train_values)",
            "scaler.transform(validation_values)",
            "n_samples_seen_",
            "GAME_IDS = sorted",
            "assert len(GAME_IDS) == 26",
            "validation_mask",
            "sharedScalerAcrossVariants",
            "raw_train_candidates_only",
            "gameIdLeakageCount",
        ]:
            self.assertIn(token, self.code)

    def test_symmetric_weight_and_fixed_c_contract_are_explicit(self):
        for token in [
            "def create_symmetric_samples",
            "sample_weights[0::2]",
            "sample_weights[1::2]",
            "actual.loc[expected.index]",
            "full_train_decision_count",
            "1.0 / (full_train_decision_count * MODEL_CONFIG",
            '"solver": "lbfgs"',
            '"fitIntercept": False',
            '"classWeight": None',
            '"tolerance": 1e-12',
            '"maxIterations": 10000',
            '"l2": 0.01',
        ]:
            self.assertIn(token, self.code)

    def test_metrics_comparisons_and_baseline_gates_are_explicit(self):
        for token in [
            "physical-class held-out MRR",
            "rawCandidate",
            "physicalClass",
            "top1Count",
            "top3Count",
            "meanSelectedRank",
            "maximumAbsoluteValidationCandidateScoreDifference",
            "rawCandidateRankChangeCount",
            "physicalClassRankChangeCount",
            "V0_REPRODUCED",
            "V4_REPRODUCED",
            "blocked_by_baseline_mismatch",
        ]:
            self.assertIn(token, self.code + self.markdown)

    def test_report_is_deterministic_and_does_not_claim_production(self):
        for token in [
            "PLACEMENT_PAIR_WEIGHT_REPORT",
            "sort_keys=True",
            "allow_nan=False",
            "atomic_write_text",
            "continue_experimenting",
            "pair_weight_tradeoff_explained",
            '"productionModelUpdated": False',
            '"runtimeIntegration": False',
        ]:
            self.assertIn(token, self.code + self.markdown)
        self.assertNotIn('"timestamp":', self.code)
        self.assertNotIn('"pid":', self.code)

    def test_source_notebook_is_clean_and_python_native(self):
        for cell in self.cells:
            if cell["cell_type"] == "code":
                self.assertIsNone(cell.get("execution_count"))
                self.assertEqual(cell.get("outputs", []), [])
        combined = self.code + self.markdown + self.documentation
        self.assertNotIn("/Users/", combined)
        self.assertNotIn("subprocess", self.code)
        self.assertNotIn("node ", self.code.lower())
        self.assertNotIn(".js\"", self.code)

    def test_documentation_covers_execution_and_interpretation(self):
        for token in [
            "5~10분 walkthrough",
            "Python (tetris-ml)",
            "Run All",
            "Headless 실행",
            "Snapshot checksum",
            "정상 checkpoint",
            "Metric 읽는 법",
            "흔한 실패",
            "안전하게 바꿔볼 값",
            "변경하면 안 되는 leakage 값",
            "byte 결정성",
            "다른 platform",
        ]:
            self.assertIn(token, self.documentation)


if __name__ == "__main__":
    unittest.main()
