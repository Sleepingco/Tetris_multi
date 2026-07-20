import importlib.util
import json
import tempfile
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
SCRIPT_PATH = ROOT / "scripts/ml/summarize_placement_temporal_report.py"
SPEC = importlib.util.spec_from_file_location("temporal_summary", SCRIPT_PATH)
MODULE = importlib.util.module_from_spec(SPEC)
assert SPEC.loader is not None
SPEC.loader.exec_module(MODULE)


def metric(decisions, top1, top3, mrr, mean_rank):
    return {
        "decisionCount": decisions,
        "top1Count": top1,
        "top3Count": top3,
        "top1Accuracy": top1 / decisions,
        "top3Accuracy": top3 / decisions,
        "mrr": mrr,
        "meanSelectedRank": mean_rank,
        "tieAwareTop1Count": top1,
        "topScoreTieDecisionCount": 0,
    }


def fixture_report():
    checksums = {
        "base": {name: "a" * 64 for name in MODULE.DATASET_FILES},
        "cumulative": {name: "b" * 64 for name in MODULE.DATASET_FILES},
    }
    game_ids = ["game-a", "game-b"]
    per_game = {
        "V0": [metric(2, 1, 2, 0.75, 1.5), metric(2, 1, 2, 0.625, 2.0)],
        "V4": [metric(2, 1, 2, 0.875, 1.25), metric(2, 1, 2, 0.5, 2.25)],
    }
    evaluation = {}
    for variant in MODULE.VARIANTS:
        rows = [
            {"gameId": game_id, "all": game_metric, "choiceRequired": game_metric}
            for game_id, game_metric in zip(game_ids, per_game[variant])
        ]
        aggregate = metric(
            4,
            2,
            4,
            sum(item["mrr"] * 2 for item in per_game[variant]) / 4,
            sum(item["meanSelectedRank"] * 2 for item in per_game[variant]) / 4,
        )
        evaluation[variant] = {
            "physicalClass": {
                "all": aggregate,
                "choiceRequired": aggregate,
                "perGame": rows,
                "worstGame": {"gameId": "game-b", **per_game[variant][1]},
            },
            "rawCandidate": {
                "all": aggregate,
                "choiceRequired": aggregate,
                "perGame": rows,
                "worstGame": {"gameId": "game-b", **per_game[variant][1]},
            },
        }
    training = {
        variant: {
            "pairCount": 10,
            "symmetricSampleCount": 20,
            "sampleWeightTotal": 4.0,
            "iterations": 10,
            "c": 0.1,
            "convergenceWarnings": [],
            "unexpectedWarnings": [],
        }
        for variant in MODULE.VARIANTS
    }
    return {
        "experimentId": MODULE.EXPERIMENT_ID,
        "runMode": "full",
        "fullCohortCovered": True,
        "policyDecisionEligible": True,
        "canonicalResultEligible": False,
        "productionIntegration": False,
        "status": "needs_policy_decision",
        "sourceChecksumBefore": "c" * 64,
        "sourceChecksumAfter": "c" * 64,
        "datasetChecksums": checksums,
        "datasetChecksumsAfter": checksums,
        "cohorts": {
            "baseGameCount": 26,
            "cumulativeGameCount": 28,
            "newGameCount": 2,
            "evaluatedNewGameCount": 2,
            "evaluatedGameIds": game_ids,
        },
        "diagnostics": {"gameIdLeakageCount": 0},
        "training": training,
        "evaluation": evaluation,
    }


class PlacementTemporalReportSummaryTest(unittest.TestCase):
    def test_valid_report_produces_compact_policy_handoff(self):
        report = fixture_report()
        summary = MODULE.summarize_report(report, "d" * 64)
        self.assertTrue(summary["validation"]["passed"])
        self.assertEqual(summary["analysisStatus"], "needs_policy_decision")
        self.assertFalse(summary["policy"]["automaticAdoptionAllowed"])
        self.assertEqual(summary["gameDistributionByMrr"], {
            "v4Better": 1,
            "equal": 0,
            "v4Worse": 1,
            "tolerance": MODULE.GAME_DELTA_TOLERANCE,
        })
        self.assertAlmostEqual(
            summary["primaryPhysicalClassChoiceRequired"]["deltaV4MinusV0"]["mrr"],
            0.0,
        )

    def test_contract_failure_is_blocked(self):
        report = fixture_report()
        report["diagnostics"]["gameIdLeakageCount"] = 1
        summary = MODULE.summarize_report(report, "d" * 64)
        self.assertFalse(summary["validation"]["passed"])
        self.assertEqual(summary["analysisStatus"], "blocked")
        self.assertIn("GAME_ID_LEAKAGE", summary["validation"]["errors"])

    def test_aggregate_false_green_is_rejected(self):
        report = fixture_report()
        report["evaluation"]["V4"]["physicalClass"]["choiceRequired"]["top1Count"] = 3
        summary = MODULE.summarize_report(report, "d" * 64)
        self.assertEqual(summary["analysisStatus"], "blocked")
        self.assertTrue(any(
            error.startswith("AGGREGATE_COUNT_MISMATCH")
            or error.startswith("TOP1_ACCURACY_MISMATCH")
            for error in summary["validation"]["errors"]
        ))

    def test_cli_writes_deterministic_json_and_markdown(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            report_path = root / "full-report.json"
            output_json = root / "summary.json"
            output_md = root / "summary.md"
            report_path.write_text(
                json.dumps(fixture_report(), sort_keys=True), encoding="utf-8"
            )
            exit_code = MODULE.main([
                str(report_path),
                "--output-json", str(output_json),
                "--output-md", str(output_md),
            ])
            self.assertEqual(exit_code, 0)
            first_json = output_json.read_bytes()
            first_md = output_md.read_bytes()
            self.assertEqual(MODULE.main([
                str(report_path),
                "--output-json", str(output_json),
                "--output-md", str(output_md),
            ]), 0)
            self.assertEqual(first_json, output_json.read_bytes())
            self.assertEqual(first_md, output_md.read_bytes())
            self.assertEqual(report_path.read_text(encoding="utf-8"), json.dumps(fixture_report(), sort_keys=True))


if __name__ == "__main__":
    unittest.main()
