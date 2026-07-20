import json
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
NOTEBOOK_PATH = (
    ROOT / "scripts/ml/notebooks/placement_v4_frozen_75g_temporal_holdout_50g.ipynb"
)


class PlacementV4FrozenTemporalHoldoutNotebookContractTest(unittest.TestCase):
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
            "## 1. 질문과 고정 계약",
            "## 2. Source, dataset과 checkpoint checksum",
            "## 3. 75게임과 125게임의 gameId 차집합",
            "## 4. Frozen 16-feature와 V4 occupied-cell grouping",
            "## 5. Frozen score와 canonical physical-class ranking",
            "## 6. Worked example",
            "## 7. 전체·normal·hard metric과 진단",
            "## 8. Rejection과 game-over 안전성 한계",
            "## 9. Source 재검증과 결정적 report",
            "## 10. 결과를 읽는 법과 user full-run gate",
        ]
        positions = [self.markdown.index(section) for section in sections]
        self.assertEqual(positions, sorted(positions))

    def test_all_cells_have_unique_meaningful_ids(self):
        cell_ids = [cell.get("id") for cell in self.cells]
        self.assertEqual(len(cell_ids), 20)
        self.assertTrue(all(cell_ids))
        self.assertEqual(len(cell_ids), len(set(cell_ids)))
        self.assertEqual(
            set(cell_ids),
            {
                "experiment-overview",
                "question-and-contract",
                "imports-and-fixed-contract",
                "checksum-rationale",
                "verify-input-checksums",
                "temporal-cohort-rationale",
                "build-temporal-cohort",
                "v4-grouping-rationale",
                "load-and-group-candidates",
                "frozen-ranking-rationale",
                "score-and-rank-classes",
                "worked-example-rationale",
                "show-worked-example",
                "metric-diagnostics-rationale",
                "aggregate-metrics",
                "game-over-limit-rationale",
                "verify-top-out-rejections",
                "report-rationale",
                "write-deterministic-report",
                "full-run-gate",
            },
        )

    def test_immutable_input_contract_is_fixed(self):
        for token in [
            "17485",
            "6ab15deed40cedfcb094795aeffaef9003b4ce87694324063b81fed201615ec5",
            "2ea7fe659220279c786d8c9c8e6f7ab6af70f970e0db985d6067b7a095c0ad53",
            "human-behavior-v2-temporal-cumulative-75g-20260718",
            "human-behavior-v2-temporal-cumulative-125g-20260720",
            "EXPECTED_BASE_SHA256",
            "EXPECTED_CUMULATIVE_SHA256",
        ]:
            self.assertIn(token, self.code)

    def test_new_cohort_contract_is_exact(self):
        for token in [
            "NEW_GAME_IDS = sorted(CUMULATIVE_GAME_IDS - BASE_GAME_IDS",
            '"normal": {"games": 26, "decisions": 1430, "candidates": 48323}',
            '"hard": {"games": 24, "decisions": 772, "candidates": 26001}',
            "len(NEW_GAME_IDS) == 50",
            "GAME_ID_LEAKAGE_COUNT == 0",
        ]:
            self.assertIn(token, self.code)

    def test_checkpoint_is_frozen_without_fit_paths(self):
        for token in [
            'CHECKPOINT["featureContract"]',
            'CHECKPOINT["modelCheckpoint"]',
            "SCALER_MEAN",
            "SCALER_SCALE",
            "COEFFICIENTS",
            '"parameterFitCount": 0',
            '"frozenCheckpoint": True',
        ]:
            self.assertIn(token, self.code)
        self.assertNotIn("StandardScaler", self.code)
        self.assertNotIn("LogisticRegression", self.code)
        self.assertNotIn(".fit(", self.code)

    def test_feature_and_leakage_allowlist_is_explicit(self):
        for token in [
            "candidateResult.linesCleared",
            "candidateResult.gameOver",
            "metricDelta.columnHeights[{index}]",
            "selectedBySource",
            "metadata.isWinner",
            "heuristicBaseline.score",
            "metadata.inputSequence",
        ]:
            self.assertIn(token, self.code)

    def test_v4_grouping_and_ranking_are_deterministic(self):
        for token in [
            "def equivalence_key",
            "sorted((int(cell[\"row\"]), int(cell[\"col\"]))",
            "higher_linear_score_first",
            "unicode_codepoint_equivalence_key",
            "scaled @ COEFFICIENTS",
            "(-row[\"score\"], codepoint_key(row[\"key\"]))",
            "choiceRequired",
        ]:
            self.assertIn(token, self.code)

    def test_smoke_and_full_gates_cannot_be_confused(self):
        for token in [
            "PLACEMENT_V4_FROZEN_RUN_MODE",
            'RUN_MODE in {"smoke", "full"}',
            "NEW_GAME_IDS_BY_DIFFICULTY[\"normal\"][0]",
            "NEW_GAME_IDS_BY_DIFFICULTY[\"hard\"][0]",
            '"awaiting_user_full_run"',
            "FULL_COHORT_COVERED",
            "POLICY_DECISION_ELIGIBLE",
            "CANONICAL_RESULT_ELIGIBLE = False",
        ]:
            self.assertIn(token, self.code + self.markdown)

    def test_required_metrics_and_diagnostics_are_visible(self):
        for token in [
            "top1Count",
            "top3Count",
            "mrr",
            "meanSelectedRank",
            "macroMrr",
            "medianMrr",
            "minimumMrr",
            "maximumMrr",
            "worstGame",
            "selectedFeatureDuplicateDecisionCount",
            "lineClearOptionSegment",
            "gameOverCandidateCount",
        ]:
            self.assertIn(token, self.code)

    def test_top_out_limit_is_preserved(self):
        for token in [
            "1692219B-1784370584589",
            "3C3114C6-1784430567426",
            "50487EB2-1784466429659",
            "accepted cohort has zero gameOver=true candidates",
            "game-over avoidance safety is not validated",
            "runtime hard safety remains separate future work",
        ]:
            self.assertIn(token, self.code + self.markdown)

    def test_report_is_deterministic_and_source_notebook_is_clean(self):
        for token in [
            "sort_keys=True",
            "allow_nan=False",
            "atomic_write_text",
            "SOURCE_SHA256_AFTER == SOURCE_SHA256_BEFORE",
            "REPORT_SOURCE_COLLISION",
        ]:
            self.assertIn(token, self.code)
        self.assertNotIn('"timestamp":', self.code)
        self.assertNotIn('"pid":', self.code)
        self.assertNotIn("/Users/", self.code + self.markdown)
        for cell in self.cells:
            if cell["cell_type"] == "code":
                self.assertIsNone(cell.get("execution_count"))
                self.assertEqual(cell.get("outputs", []), [])


if __name__ == "__main__":
    unittest.main()
