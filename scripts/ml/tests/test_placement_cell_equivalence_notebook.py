"""Occupied-cell equivalence 실험 Notebook과 설명 문서의 정적 계약을 검증한다.

Notebook JSON을 실행하지 않고 Markdown과 코드 cell을 이어 붙여 실험 순서, 누수 방지,
공유 scaler, 2×2 평가와 결정적 report 규칙을 확인한다. 또한 source Notebook의 실행
결과가 비어 있어 누구나 같은 입력에서 처음부터 재현할 수 있는지도 함께 검증한다.
"""

import json
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[3]
NOTEBOOK_PATH = ROOT / "scripts/ml/notebooks/placement_cell_equivalence_logo_experiment.ipynb"
DOC_PATH = ROOT / "docs/ai-ml/experiments/placement-cell-equivalence-logo.md"


class PlacementCellEquivalenceNotebookContractTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.notebook = json.loads(NOTEBOOK_PATH.read_text(encoding="utf-8"))
        cls.cells = cls.notebook["cells"]
        cls.markdown = "\n".join(
            "".join(cell.get("source", []))
            for cell in cls.cells if cell["cell_type"] == "markdown"
        )
        cls.code = "\n".join(
            "".join(cell.get("source", []))
            for cell in cls.cells if cell["cell_type"] == "code"
        )
        cls.documentation = DOC_PATH.read_text(encoding="utf-8")

    def test_required_sections_are_ordered(self):
        sections = [
            "## 0. 읽는 방법과 학습 목표", "## 1. 실험 카드", "## 2. 환경과 경로",
            "## 3. Snapshot 무결성", "## 4. 기존 16-feature 설명",
            "## 5. 기존 candidate pair의 작은 예제", "## 6. Equivalence key 정의",
            "## 7. 실제 duplicate decision worked example",
            "## 8. 전체 equivalence contract 검증", "## 9. 전체 class 압축 통계",
            "## 10. LOGO와 shared scaler 설명", "## 11. 두 pair representation 구현",
            "## 12. 모델 설정", "## 13. Metric을 작은 예제로 계산",
            "## 14. 2×2 평가", "## 15. Fold와 모델 차이 진단",
            "## 16. 관측·해석·결정",
        ]
        positions = [self.markdown.index(section) for section in sections]
        self.assertEqual(positions, sorted(positions))

    def test_experiment_card_and_teaching_examples_exist(self):
        for token in [
            "EXPERIMENT_CARD", "changedVariable", "primaryMetrics",
            "WORKED_DECISION", "worked_flow", "pair_example", "metric_example_rows",
            "candidate", "physical placement", "decision-balanced weight",
        ]:
            self.assertIn(token, self.code + self.markdown)

    def test_equivalence_key_is_label_free_and_uses_only_geometry(self):
        start = self.code.index("def create_equivalence_key")
        end = self.code.index("assert set(EQUIVALENCE_KEY_FIELDS)", start)
        function_code = self.code[start:end]
        self.assertIn("placement['pieceType']", function_code)
        self.assertIn('placement["cells"]', function_code)
        for forbidden in [
            "selectedBySource", "rotation", "placementKey", "isWinner",
            "winnerPlayerId", "heuristicBaseline", "inputSequence", "foldMetric",
        ]:
            self.assertNotIn(forbidden, function_code)
        self.assertIn("EQUIVALENCE_KEY_FORBIDDEN_FIELDS", self.code)

    def test_feature_allowlist_and_leakage_contract_are_explicit(self):
        expected_features = [
            "candidateResult.linesCleared", "candidateResult.gameOver",
            "metricDelta.aggregateHeight", "metricDelta.maxHeight",
            "metricDelta.holes", "metricDelta.bumpiness",
        ]
        for feature in expected_features:
            self.assertIn(feature, self.code)
        self.assertIn("range(10)", self.code)
        for token in [
            '"selectedBySourceUsage": "label_only"',
            '"isWinnerUsage": "evaluation_segmentation_only"',
            '"winnerPlayerId"', '"heuristicBaseline.score"',
            '"metadata.inputSequence"', "validationExcludedFromScaler",
        ]:
            self.assertIn(token, self.code)

    def test_logo_shared_scaler_and_two_pair_representations_are_visible(self):
        for token in [
            "GAME_IDS = sorted", "assert len(GAME_IDS) == 26",
            "def fit_shared_scaler", "StandardScaler", "n_samples_seen_",
            "baseline_scaler_mean", "grouped_scaler_mean",
            "np.array_equal(baseline_scaler_mean, grouped_scaler_mean)",
            "def create_baseline_pairs", "def create_grouped_pairs",
            "selectedClass", "representativeIndex", "groupedZeroDifferencePairCount",
        ]:
            self.assertIn(token, self.code)

    def test_weight_and_estimator_contract_are_explicit(self):
        for token in [
            "def create_symmetric_samples", "sample_weights[0::2]",
            "sample_weights[1::2]", "WEIGHT_TOLERANCE", "np.ones(len(sums))",
            '"solver": "lbfgs"', '"fitIntercept": False', '"classWeight": None',
            '"tolerance": 1e-12', '"maxIterations": 10000', '"l2": 0.01',
            "1.0 / (train_decision_count * MODEL_CONFIG",
        ]:
            self.assertIn(token, self.code)

    def test_candidate_class_2x2_and_baseline_gate_are_explicit(self):
        for token in [
            "RESULTS_2X2", "baselineModel", "groupedModel", "rawCandidate",
            "physicalClass", "baseline_reproduction", "canonicalTop1Count",
            "full_baseline_zero", "full_grouped_zero", "full_grouped_weight_check",
            '"canonicalTop1Count": 561', '"canonicalTop3Count": 886',
            '"tieAwareTop1Count": 659', '"mrrRounded6": 0.645290',
            '"meanSelectedRankRounded6": 2.961140',
        ]:
            self.assertIn(token, self.code)

    def test_deterministic_report_and_gate_contract_are_explicit(self):
        for token in [
            "PLACEMENT_CELL_EQUIVALENCE_REPORT", "CANONICAL_RESULT_PATH",
            "json.dumps", "sort_keys=True", "allow_nan=False", "atomic_write_text",
            "blocked_by_equivalence_contract", "unexpected_pipeline_regression",
            "pair_canonicalization_supported",
            "pair_canonicalization_valid_but_metric_tradeoff",
        ]:
            self.assertIn(token, self.code + self.markdown)

    def test_documentation_is_reproducible_and_educational(self):
        for token in [
            "5~10분 walkthrough", "Python (tetris-ml)", "Run All", "Headless 실행",
            "Dataset snapshot과 checksum", "정상 실행 checkpoint", "Metric 읽는 법",
            "흔한 실패와 원인", "안전하게 변경해볼 값",
            "변경하면 안 되는 leakage 값", "결정성 확인", "다른 platform",
        ]:
            self.assertIn(token, self.documentation)

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


if __name__ == "__main__":
    unittest.main()
