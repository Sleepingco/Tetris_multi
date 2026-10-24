"""V4 development checkpoint 요약기가 dataset과 비생산 경계를 검증하는지 확인한다.

임시 JSONL dataset과 manifest를 만들고 checksum·count를 계산한 뒤 요약을 실행한다.
입력 변조와 과장된 checkpoint flag는 blocked로 처리하고, 입력과 충돌하는 출력 경로는
예외로 거부한다. 정상 CLI는 원본 dataset/report를 바꾸지 않고 결정적인 JSON·Markdown을 기록한다.
"""

import hashlib
import importlib.util
import json
import math
import tempfile
import unittest
from pathlib import Path
from unittest import mock


ROOT = Path(__file__).resolve().parents[3]
SCRIPT_PATH = ROOT / "scripts/ml/summarize_placement_v4_development_fit.py"
SPEC = importlib.util.spec_from_file_location("v4_development_summary", SCRIPT_PATH)
MODULE = importlib.util.module_from_spec(SPEC)
assert SPEC.loader is not None
SPEC.loader.exec_module(MODULE)


FIXTURE_COUNTS = {
    "manifestLifecycleGameCount": 1,
    "acceptedGameCount": 1,
    "decisionCount": 1,
    "candidateCount": 2,
}


def write_jsonl(path, rows):
    path.write_text("".join(json.dumps(row, sort_keys=True) + "\n" for row in rows), encoding="utf-8")


def create_dataset(root):
    dataset = root / "dataset"
    dataset.mkdir()
    candidates = [
        {
            "datasetSchemaVersion": 2,
            "gameId": "game-a",
            "playerId": "human-a",
            "pieceIndex": 5,
            "source": "human",
            "selectedBySource": True,
        },
        {
            "datasetSchemaVersion": 2,
            "gameId": "game-a",
            "playerId": "human-a",
            "pieceIndex": 5,
            "source": "human",
            "selectedBySource": False,
        },
    ]
    write_jsonl(dataset / "train.jsonl", candidates)
    write_jsonl(dataset / "validation.jsonl", [])
    write_jsonl(dataset / "rejected.jsonl", [{"reason": "fixture"}])
    manifest = {
        "datasetSchemaVersion": 2,
        "selectionPolicy": "all-completed",
        "sourceFilter": "human",
        "jsonParseFailureCount": 0,
        "totalGameCount": 1,
        "trainSampleCount": 2,
        "validationSampleCount": 0,
        "rejectedPlacementLogCount": 1,
        "acceptedPlacementLogCount": 1,
        "sampleCountBySource": {"human": 2},
    }
    (dataset / "manifest.json").write_text(json.dumps(manifest, sort_keys=True), encoding="utf-8")
    checksums = {name: MODULE.sha256_file(dataset / name) for name in MODULE.DATASET_FILES}
    return dataset, checksums


def fixture_report(checksums):
    coefficients = [1.0, *([0.0] * 15)]
    return {
        "experimentId": MODULE.EXPERIMENT_ID,
        "status": "development_checkpoint_created",
        "runMode": "full",
        "fullCohortCovered": True,
        "developmentOnly": True,
        "productionIntegration": False,
        "canonicalResultEligible": False,
        "policyDecisionEligible": False,
        "heldOutEvidence": False,
        "evaluationMetricsIncluded": False,
        "dataset": {
            "relativePath": MODULE.DATASET_RELATIVE_PATH,
            "checksumsBefore": checksums,
            "checksumsAfter": checksums,
            "manifestLifecycleGameCount": 1,
            "availableAcceptedGameCount": 1,
            "availableDecisionCount": 1,
            "availableCandidateCount": 2,
        },
        "trainingCohort": {
            "gameCount": 1,
            "decisionCount": 1,
            "candidateCount": 2,
            "representedDecisionCount": 1,
            "gameIdSha256": hashlib.sha256(b"game-a").hexdigest(),
        },
        "featureContract": {
            "featureNames": list(MODULE.FEATURE_NAMES),
            "forbiddenLeakageInputs": ["selectedBySource"],
            "scalerFitScope": "selected training cohort raw candidates only",
            "scalerFitCandidateCount": 2,
            "mean": [0.0] * 16,
            "scale": [1.0] * 16,
        },
        "representation": {
            "name": "V4",
            "unit": "occupied-cell physical class",
            "pairWeight": "one over unique non-selected physical classes",
            "selectedClassAliasesExcluded": True,
            "pairCount": 1,
            "pairlessDecisionCount": 0,
        },
        "estimator": {
            "solver": "lbfgs",
            "fitIntercept": False,
            "classWeight": None,
            "tolerance": 1e-12,
            "maxIterations": 10_000,
            "l2": 0.01,
            "c": 100.0,
        },
        "modelCheckpoint": {
            "coefficientFeatureOrder": list(MODULE.FEATURE_NAMES),
            "coefficients": coefficients,
            "coefficientL2Norm": math.sqrt(sum(value * value for value in coefficients)),
            "coefficientMaxAbsolute": 1.0,
            "intercept": False,
        },
        "trainingDiagnostics": {
            "symmetricSampleCount": 2,
            "sampleWeightTotal": 1.0,
            "minimumDecisionWeight": 1.0,
            "maximumDecisionWeight": 1.0,
            "iterations": 3,
            "convergenceWarnings": [],
            "unexpectedWarnings": [],
            "weightedTrainingLogLoss": 0.2,
            "weightedTrainingLogLossRole": "optimization diagnostic only; not held-out performance",
        },
        "environment": {"python": "fixture"},
    }


def validated_fixture(root):
    dataset, checksums = create_dataset(root)
    report = fixture_report(checksums)
    facts, errors = MODULE.collect_dataset_facts(dataset, FIXTURE_COUNTS, checksums)
    return dataset, report, facts, errors


class PlacementV4DevelopmentFitSummaryTest(unittest.TestCase):
    def test_valid_checkpoint_produces_korean_development_summary(self):
        with tempfile.TemporaryDirectory() as directory:
            _, report, facts, errors = validated_fixture(Path(directory))
            summary = MODULE.summarize_report(report, "a" * 64, facts, errors, FIXTURE_COUNTS)
        self.assertTrue(summary["validation"]["passed"])
        self.assertEqual(summary["analysisStatus"], "development_checkpoint_valid")
        self.assertFalse(summary["checkpointBoundary"]["heldOutEvidence"])
        self.assertEqual(len(summary["modelParameters"]["features"]), 16)
        markdown = MODULE.render_markdown(summary)
        self.assertIn("아직 말할 수 없는 것", markdown)
        self.assertIn("production readiness", markdown)

    def test_false_green_checkpoint_fields_are_rejected(self):
        with tempfile.TemporaryDirectory() as directory:
            _, report, facts, errors = validated_fixture(Path(directory))
            report["developmentOnly"] = False
            report["modelCheckpoint"]["coefficientL2Norm"] = 99.0
            report["trainingDiagnostics"]["sampleWeightTotal"] = 2.0
            summary = MODULE.summarize_report(report, "a" * 64, facts, errors, FIXTURE_COUNTS)
        self.assertEqual(summary["analysisStatus"], "blocked")
        self.assertIn("FIELD_MISMATCH:developmentOnly:expected=True", summary["validation"]["errors"])
        self.assertIn("COEFFICIENT_L2_NORM_MISMATCH", summary["validation"]["errors"])
        self.assertIn("SAMPLE_WEIGHT_TOTAL_MISMATCH", summary["validation"]["errors"])

    def test_dataset_mutation_is_rejected(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            dataset, report, _, _ = validated_fixture(root)
            with (dataset / "train.jsonl").open("a", encoding="utf-8") as handle:
                handle.write("{}\n")
            facts, errors = MODULE.collect_dataset_facts(
                dataset,
                FIXTURE_COUNTS,
                report["dataset"]["checksumsBefore"],
            )
            summary = MODULE.summarize_report(report, "a" * 64, facts, errors, FIXTURE_COUNTS)
        self.assertEqual(summary["analysisStatus"], "blocked")
        self.assertIn("SOURCE_DATASET_CHECKSUM_MISMATCH", summary["validation"]["errors"])

    def test_report_rejects_absolute_path_and_timestamp(self):
        with tempfile.TemporaryDirectory() as directory:
            _, report, facts, errors = validated_fixture(Path(directory))
            report["temporaryPath"] = "/tmp/report.json"
            report["createdTimestamp"] = "now"
            summary = MODULE.summarize_report(report, "a" * 64, facts, errors, FIXTURE_COUNTS)
        self.assertEqual(summary["analysisStatus"], "blocked")
        self.assertTrue(any(error.startswith("ABSOLUTE_PATH_FORBIDDEN") for error in summary["validation"]["errors"]))
        self.assertTrue(any(error.startswith("TIMESTAMP_FIELD_FORBIDDEN") for error in summary["validation"]["errors"]))

    def test_cli_writes_deterministic_summary_files(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            dataset, report, _, _ = validated_fixture(root)
            report_path = root / "full-report.json"
            output_json = root / "summary.json"
            output_md = root / "summary.md"
            report_path.write_text(json.dumps(report, sort_keys=True), encoding="utf-8")
            fixture_sha = {name: MODULE.sha256_file(dataset / name) for name in MODULE.DATASET_FILES}
            with mock.patch.object(MODULE, "EXPECTED_COUNTS", FIXTURE_COUNTS), mock.patch.object(MODULE, "EXPECTED_SHA256", fixture_sha):
                arguments = [
                    str(report_path),
                    "--dataset-dir", str(dataset),
                    "--output-json", str(output_json),
                    "--output-md", str(output_md),
                ]
                self.assertEqual(MODULE.main(arguments), 0)
                first_json = output_json.read_bytes()
                first_md = output_md.read_bytes()
                self.assertEqual(MODULE.main(arguments), 0)
            self.assertEqual(first_json, output_json.read_bytes())
            self.assertEqual(first_md, output_md.read_bytes())
            self.assertEqual(report_path.read_text(encoding="utf-8"), json.dumps(report, sort_keys=True))

    def test_source_dataset_and_report_cannot_be_outputs(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            dataset, report, _, _ = validated_fixture(root)
            report_path = root / "full-report.json"
            report_path.write_text(json.dumps(report), encoding="utf-8")
            protected = [report_path, *[dataset / name for name in MODULE.DATASET_FILES]]
            with self.assertRaisesRegex(ValueError, "OUTPUT_INPUT_COLLISION"):
                MODULE.assert_safe_output(report_path, protected, [dataset])
            with self.assertRaisesRegex(ValueError, "OUTPUT_INSIDE_SOURCE_DATASET"):
                MODULE.assert_safe_output(dataset / "summary.json", protected, [dataset])


if __name__ == "__main__":
    unittest.main()
