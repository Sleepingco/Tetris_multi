import ast
import json
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
NOTEBOOK_PATH = (
    ROOT / "scripts/ml/notebooks/placement_feature_collision_analysis.ipynb"
)


class PlacementFeatureCollisionNotebookContractTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.notebook = json.loads(NOTEBOOK_PATH.read_text(encoding="utf-8"))
        cls.markdown = "\n".join(
            "".join(cell.get("source", []))
            for cell in cls.notebook["cells"]
            if cell.get("cell_type") == "markdown"
        )
        cls.code = "\n".join(
            "".join(cell.get("source", []))
            for cell in cls.notebook["cells"]
            if cell.get("cell_type") == "code"
        )
        cls.syntax_tree = ast.parse(cls.code)

    @classmethod
    def literal_assignment(cls, name):
        for node in cls.syntax_tree.body:
            if not isinstance(node, ast.Assign) or len(node.targets) != 1:
                continue
            target = node.targets[0]
            if isinstance(target, ast.Name) and target.id == name:
                return ast.literal_eval(node.value)
        raise AssertionError(f"ASSIGNMENT_NOT_FOUND:{name}")

    @classmethod
    def function_source(cls, name):
        for node in cls.syntax_tree.body:
            if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)) and node.name == name:
                return ast.get_source_segment(cls.code, node)
        raise AssertionError(f"FUNCTION_NOT_FOUND:{name}")

    def test_notebook_has_required_sections_in_order(self):
        required_sections = [
            "분석 목표와 가설",
            "환경과 dataset snapshot",
            "source checksum 검증",
            "candidate JSONL 직접 로딩",
            "기존 16개 feature 재생성",
            "decision과 placement 계약 검증",
            "selected-vs-unselected pair 생성",
            "baseline zero-difference pair 재현",
            "geometry 후보 계산",
            "feature별 collision 분해",
            "feature 간 overlap 분석",
            "pieceType/game/difficulty/outcome segmentation",
            "geometry로 해결되지 않는 pair 분석",
            "단일 feature 후보 선정",
            "결정성 및 원본 불변성",
            "결론과 다음 실험 게이트",
        ]
        positions = [self.markdown.index(section) for section in required_sections]
        self.assertEqual(positions, sorted(positions))

    def test_notebook_loads_candidate_jsonl_directly_with_pandas(self):
        self.assertIn("pd.read_json", self.code)
        self.assertIn('SOURCE_FILES["train.jsonl"]', self.code)
        self.assertIn('SOURCE_FILES["validation.jsonl"]', self.code)
        self.assertIn("read_jsonl_frame", self.code)
        for forbidden_dependency in [
            "subprocess",
            "placement_pairwise_parity",
            "export-placement",
            "train-placement",
            "evaluation-report.json",
        ]:
            self.assertNotIn(forbidden_dependency, self.code)

    def test_fixed_feature_and_baseline_collision_contract(self):
        expected_features = [
            "candidateResult.linesCleared",
            "candidateResult.gameOver",
            "metricDelta.aggregateHeight",
            "metricDelta.maxHeight",
            "metricDelta.holes",
            "metricDelta.bumpiness",
            *[f"metricDelta.columnHeights[{index}]" for index in range(10)],
        ]
        expected_baseline = {
            "gameCount": 26,
            "decisionCount": 1158,
            "candidateCount": 39375,
            "selectedCandidateCount": 1158,
            "pairCount": 38217,
            "zeroDifferencePairCount": 1010,
            "zeroDifferenceDecisionCount": 670,
        }
        self.assertEqual(self.literal_assignment("FEATURE_NAMES"), expected_features)
        self.assertEqual(
            self.literal_assignment("EXPECTED_BASELINE_SUMMARY"),
            expected_baseline,
        )
        self.assertIn(
            "assert BASELINE_SUMMARY == EXPECTED_BASELINE_SUMMARY",
            self.code,
        )

    def test_geometry_candidates_and_formulas_are_explicit(self):
        expected_geometry_features = [
            "placement_row",
            "placement_col",
            "rotation",
            "minimum_cell_row",
            "maximum_cell_row",
            "mean_cell_row",
            "minimum_cell_col",
            "maximum_cell_col",
            "mean_cell_col",
            "row_span",
            "col_span",
            "normalized_placement_row",
            "normalized_placement_col",
            "normalized_average_cell_height",
            "left_wall_distance",
            "right_wall_distance",
            "nearest_wall_distance",
        ]
        self.assertEqual(
            self.literal_assignment("GEOMETRY_FEATURES"),
            expected_geometry_features,
        )
        for formula in [
            'float(placement["row"]) / (board_height - 1)',
            'float(placement["col"]) / (board_width - 1)',
            "(board_height - 1) - mean_row",
            "(board_width - 1) - maximum_col",
            "min(left_distance, right_distance)",
        ]:
            self.assertIn(formula, self.code)

    def test_label_outcome_and_forbidden_values_are_isolated(self):
        expected_usage = {
            "selectedBySource": "label_only",
            "metadata.isWinner": "segmentation_only",
            "winnerPlayerId": "not_used",
            "heuristicBaseline.score": "not_used",
            "metadata.inputSequence": "not_used",
            "foldMetrics": "not_used",
            "futureOutcome": "not_used",
        }
        self.assertEqual(
            self.literal_assignment("ANALYSIS_USAGE_CONTRACT"),
            expected_usage,
        )
        feature_source = self.function_source("extract_feature_vector")
        geometry_source = self.function_source("calculate_geometry")
        context_source = self.function_source("decision_context_signature")
        for forbidden in [
            "selectedBySource",
            "metadata",
            "winnerPlayerId",
            "heuristicBaseline",
            "inputSequence",
        ]:
            self.assertNotIn(forbidden, feature_source)
            self.assertNotIn(forbidden, geometry_source)
        self.assertNotIn("metadata", context_source)
        self.assertNotIn("isWinner", context_source)
        self.assertNotIn("finishType", context_source)
        self.assertNotIn("candidateResult", geometry_source)
        self.assertNotIn("metricDelta", geometry_source)

    def test_notebook_does_not_train_or_simulate_a_model(self):
        for forbidden in [
            "LogisticRegression",
            "StandardScaler",
            "fit_pairwise_model",
            "simulatePlacement",
            "post-placement",
            "T-Spin",
            "garbage",
        ]:
            self.assertNotIn(forbidden, self.code)
        self.assertIn('"modelTrainingPerformed": False', self.code)
        self.assertIn('"runtimeIntegrationPerformed": False', self.code)

    def test_deterministic_report_and_source_immutability_contract(self):
        for required in [
            "PLACEMENT_COLLISION_DATASET",
            "PLACEMENT_COLLISION_REPORT",
            "SOURCE_SHA256_BEFORE",
            "SOURCE_SHA256_AFTER",
            "SOURCE_DATASET_MUTATED",
            "atomic_write_report",
            "os.replace",
            "allow_nan=False",
            '"timestamp" not in report_text.lower()',
            'str(ROOT) not in report_text',
            'SELECTION_STATUS = "geometry_does_not_resolve_collision"',
        ]:
            self.assertIn(required, self.code)
        self.assertNotIn("/Users/", self.markdown + self.code)

    def test_source_code_cells_are_clean(self):
        for cell in self.notebook["cells"]:
            if cell.get("cell_type") != "code":
                continue
            self.assertIsNone(cell.get("execution_count"))
            self.assertEqual(cell.get("outputs"), [])


if __name__ == "__main__":
    unittest.main()
