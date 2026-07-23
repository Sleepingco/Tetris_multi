"""Pairwise LOGO 실험 Notebook의 학습 순서와 재현 환경을 검증한다.

Notebook 파일을 실제 학습시키지 않고 Markdown·코드 cell을 읽어 데이터 로딩부터
gameId 분할, train-only scaler, metric 해석까지의 순서를 확인한다. 실행 결과가 제거된
깨끗한 source와 고정된 Python 의존성도 계약의 일부로 검사한다.
"""

import json
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
NOTEBOOK_PATH = ROOT / "scripts/ml/notebooks/placement_pairwise_logo_experiment.ipynb"
ENVIRONMENT_PATH = ROOT / "environment-ml.yml"


class PlacementExperimentNotebookContractTest(unittest.TestCase):
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

    def test_notebook_has_ordered_experiment_sections(self):
        required_sections = [
            "실험 목표와 가설",
            "환경 및 라이브러리 버전",
            "입력 경로와 source SHA-256",
            "manifest/train/validation/rejected 로딩",
            "source/schema/count 검증",
            "decisionKey와 placementKey 생성",
            "명시적인 feature allowlist",
            "feature DataFrame 생성",
            "데이터와 label 분포",
            "duplicate/zero-difference/tie 진단",
            "gameId 기준 LOGO split",
            "fold별 train-only StandardScaler",
            "decision-balanced pair 생성",
            "symmetric binary sample 생성",
            "sklearn LogisticRegression 학습",
            "fold별 metric",
            "micro/macro/median/range/worst-fold 집계",
            "결정성 및 원본 불변성 확인",
            "결과 해석과 다음 실험 판단",
        ]
        positions = [self.markdown.index(section) for section in required_sections]
        self.assertEqual(positions, sorted(positions))

    def test_notebook_is_python_native_and_has_no_local_absolute_path(self):
        self.assertIn("pd.read_json", self.code)
        self.assertIn("StandardScaler", self.code)
        self.assertIn("LogisticRegression", self.code)
        self.assertNotIn("placement_pairwise_parity", self.code)
        self.assertNotIn("export-placement-feature-table", self.code)
        self.assertNotIn("evaluation-report.json", self.code)
        self.assertNotIn("/Users/", self.markdown + self.code)

    def test_notebook_declares_reproducible_gate_and_clean_cells(self):
        self.assertIn("continue_experimenting", self.markdown)
        self.assertIn("PLACEMENT_EXPERIMENT_REPORT", self.code)
        self.assertIn("PLACEMENT_EXPERIMENT_DATASET", self.code)
        self.assertIn("manifest[\"totalGameCount\"]", self.code)
        self.assertIn("len(GAME_IDS)", self.code)
        self.assertNotIn("manifest[\"totalGameCount\"] == 13", self.code)
        self.assertIn("summarize_segments", self.code)
        self.assertIn("\"aiDifficulty\": summarize_segments", self.code)
        self.assertIn("\"outcome\": summarize_segments", self.code)
        for cell in self.notebook["cells"]:
            if cell.get("cell_type") == "code":
                self.assertIsNone(cell.get("execution_count"))
                self.assertEqual(cell.get("outputs"), [])

    def test_environment_pins_notebook_runtime(self):
        environment = ENVIRONMENT_PATH.read_text(encoding="utf-8")
        for dependency in [
            "python=3.12.13",
            "numpy=2.5.1",
            "scipy=1.18.0",
            "scikit-learn=1.9.0",
            "pandas=3.0.3",
            "ipykernel=7.2.0",
            "nbconvert=7.17.1",
        ]:
            self.assertIn(dependency, environment)


if __name__ == "__main__":
    unittest.main()
