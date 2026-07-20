import json
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
NOTEBOOK_PATH = ROOT / "scripts/ml/notebooks/placement_v4_pve_gameplay_benchmark.ipynb"
EXPERIMENT_PATH = ROOT / "ai-harness/ml-experiments/experiments/placement-v4-pve-gameplay-benchmark.md"
RUNNER_PATH = ROOT / "scripts/run-placement-v4-pve-gameplay-benchmark.js"


class PlacementV4PveGameplayBenchmarkNotebookTest(unittest.TestCase):
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
        cls.runner = RUNNER_PATH.read_text(encoding="utf-8")

    def test_notebook_follows_input_run_pair_safety_order(self):
        headings = [
            "# Placement V4 PVE gameplay benchmark",
            "## 1. 실험 질문과 고정 조건",
            "## 2. 입력과 frozen artifact 확인",
            "## 3. Raw report 실행 또는 로딩",
            "## 4. Paired gameplay 비교",
            "## 5. 안전성과 fallback 진단",
            "## 6. Non-canonical timing 진단",
            "## 7. Smoke 해석과 사용자 full-run gate",
        ]
        positions = [self.source.index(heading) for heading in headings]
        self.assertEqual(positions, sorted(positions))

    def test_frozen_model_and_non_production_state_are_explicit(self):
        required = [
            "data/models/placement-v4-125g-candidate/model.json",
            "ff64b0d3e4cd9eb6c6d7920f2cbe961f1d70e4c90ccc69a5d9ab8bcd410cb33d",
            "productionIntegration",
            "canonicalArtifact",
            "canonicalResultEligible",
            "fullCohortCovered",
            "policyDecisionEligible",
            "runMode",
        ]
        for value in required:
            self.assertIn(value, self.source)
            self.assertIn(value, self.experiment)
        self.assertIn("productionIntegration: false", self.runner)
        self.assertIn("canonicalArtifact: false", self.runner)

    def test_runner_reuses_authoritative_pve_and_deterministic_bags(self):
        for required in [
            "createPveAiPlayerService",
            "processAiStep",
            "loadGameCore",
            "generateBagStream",
            '["heuristic", "placement_v4"]',
            'aiDifficulty: "hard"',
            "pendingGarbageQueue: []",
        ]:
            self.assertIn(required, self.runner)
        self.assertNotIn("Python Tetris", self.source)

    def test_metrics_safety_and_paired_diagnostics_are_visible(self):
        required = [
            "placementCount",
            "linesPer100Placements",
            "attackLinesPer100Placements",
            "averageHoles",
            "finalHoles",
            "averageMaxHeight",
            "finalMaxHeight",
            "invalidDecision",
            "modelFallback",
            "planDivergence",
            "nonFiniteScore",
            "unexpectedError",
            "placementDelta",
            "bothSurvivedHorizon",
            "v4SurvivalWin",
            "v4SurvivalLoss",
            "exactGameOverTie",
        ]
        for value in required:
            self.assertIn(value, self.runner + self.source)

    def test_timing_is_separate_from_canonical_report(self):
        self.assertIn("firstDecisionLatencyMs", self.runner)
        self.assertNotIn("coldModelLoadMs", self.runner)
        self.assertIn("decisionLatencyP50Ms", self.runner)
        self.assertIn("decisionLatencyP95Ms", self.runner)
        self.assertIn("const { timing, ...deterministic } = rollout", self.runner)
        self.assertIn("timing은 별도 non-canonical report", self.experiment)
        self.assertIn("canonical report SHA", self.source)

    def test_notebook_rejects_stale_or_different_cohort_reports(self):
        for required in [
            "PLACEMENT_V4_GAMEPLAY_SEED_PREFIX",
            "benchmarkSchemaVersion",
            "modelSha256",
            "streamCount",
            "maxPlacements",
            "seedPrefix",
            "policies",
            "executionProfile",
            "incomingGarbage",
            "placement-v4-gameplay-full",
            "is_fixed_full_cohort",
            "stale or different cohort report",
        ]:
            self.assertIn(required, self.code)

    def test_smoke_full_and_manual_gates_are_explicit(self):
        for required in [
            "--streams 3",
            "--max-placements 50",
            "총 6 rollout",
            "--streams 30",
            "--max-placements 500",
            "총 60 rollout",
            "GAME_EVENTS_LOG_PATH=/private/tmp/pve-heuristic-normal.jsonl",
            "GAME_EVENTS_LOG_PATH=/private/tmp/pve-v4-normal.jsonl",
            "GAME_EVENTS_LOG_PATH=/private/tmp/pve-v4-hard.jsonl",
        ]:
            self.assertIn(required, self.experiment)
        self.assertIn("env -u PVE_PLACEMENT_V4_MODEL_PATH", self.experiment)
        self.assertIn("이번 작업에서는 실행하지 않는다", self.experiment)

    def test_source_notebook_is_clean_and_deterministic(self):
        ids = []
        for cell in self.cells:
            self.assertIsInstance(cell.get("id"), str)
            self.assertTrue(cell["id"])
            ids.append(cell["id"])
            if cell.get("cell_type") == "code":
                self.assertIsNone(cell.get("execution_count"))
                self.assertEqual(cell.get("outputs"), [])
        self.assertEqual(len(ids), len(set(ids)))
        for forbidden in ["/Users/", "datetime.now", '"timestamp"']:
            self.assertNotIn(forbidden, self.source + self.runner)


if __name__ == "__main__":
    unittest.main()
