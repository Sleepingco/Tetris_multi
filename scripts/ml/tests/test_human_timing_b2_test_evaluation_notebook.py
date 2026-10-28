"""Execute notebook definitions with synthetic data; never evaluate the real Test cohort."""

import copy
from contextlib import redirect_stdout
import hashlib
import io
import json
import os
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[3]
if not __package__:
    sys.path.insert(0, str(ROOT))

from scripts.ml.tests.test_human_timing_baseline_notebook import sample

NOTEBOOK = ROOT / "scripts/ml/notebooks/human_timing_b2_test_evaluation.ipynb"
BOOK = json.loads(NOTEBOOK.read_text(encoding="utf-8"))
FUNCTIONS = {"__name__": "fixed_b2_test"}
for cell in BOOK["cells"]:
    if cell["cell_type"] == "code" and "definitions" in cell["metadata"].get("tags", []):
        exec(compile("".join(cell["source"]), str(NOTEBOOK), "exec"), FUNCTIONS)


class HumanTimingB2TestEvaluationTest(unittest.TestCase):
    def setUp(self):
        self.bundle, self.rows, self.flagged = FUNCTIONS["synthetic_inputs"]()
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.directory = Path(temporary.name).resolve()

    def test_notebook_contract_has_separate_manual_full_and_no_outputs(self):
        ids = [c["id"] for c in BOOK["cells"]]
        self.assertEqual(len(ids), len(set(ids)))
        text = "\n".join("".join(c["source"]) for c in BOOK["cells"])
        for n in range(1, 7):
            self.assertIn(f"# {n}.", text)
        for phrase in ("RUN_FULL = False", "SMOKE_REPORT", "FULL_REPORT", "human_timing_baseline.ipynb",
                       "import pandas as pd", "import matplotlib.pyplot as plt"):
            self.assertIn(phrase, text)
        self.assertNotIn("/Users/", text)
        self.assertNotIn("def crps(", text)
        self.assertNotIn("def fit_baselines(", text)
        for c in BOOK["cells"]:
            if c["cell_type"] == "code":
                self.assertIsNone(c["execution_count"])
                self.assertEqual(c["outputs"], [])

    def test_b2_scores_match_worked_example_without_scoring_other_models(self):
        result = FUNCTIONS["evaluate_b2"](self.bundle, [sample("other", "test", 0)])
        self.assertEqual(result["gameMacroCrpsMs"], 25)
        self.assertEqual(result["modelsScored"], ["B2"])
        self.assertEqual(result["evaluationFitCount"], 0)

    def test_changed_reused_definition_is_rejected_before_execution(self):
        original = Path.read_text
        def changed(path, *args, **kwargs):
            text = original(path, *args, **kwargs)
            if path.name == "human_timing_baseline.ipynb":
                data = json.loads(text)
                cell = next(c for c in data["cells"] if c["id"] == "metric-definitions")
                cell["source"].append("\nraise AssertionError('must not execute modified code')\n")
                return json.dumps(data)
            return text
        cell = next(c for c in BOOK["cells"] if c["id"] == "shared-definitions")
        with patch.object(Path, "read_text", changed), self.assertRaisesRegex(ValueError, "BASELINE_DEFINITIONS_CHANGED"):
            exec(compile("".join(cell["source"]), str(NOTEBOOK), "exec"), {})

    def test_scopes_partition_same_bundle_and_never_fit(self):
        before = copy.deepcopy(self.bundle)
        with patch.dict(FUNCTIONS["baseline"], {"fit_baselines": lambda *_: self.fail("no fit"),
                        "evaluate_bundle": lambda *_: self.fail("B0/B1 must not be scored")}):
            result = FUNCTIONS["evaluate_scopes"](self.bundle, self.rows, self.flagged)
        self.assertEqual([r["pairs"] for r in result.values()], [6, 4, 2])
        self.assertEqual(len({r["bundleSha256"] for r in result.values()}), 1)
        self.assertTrue(all(r["evaluationFitCount"] == 0 for r in result.values()))
        self.assertEqual(self.bundle, before)
        all_score = result["test_all"]["pairMicroCrpsMs"]
        weighted = (4 * result["test_without_flagged_game"]["pairMicroCrpsMs"]
                    + 2 * result["flagged_game_only"]["pairMicroCrpsMs"]) / 6
        self.assertAlmostEqual(all_score, weighted, places=12)

    def test_changed_shared_notebook_is_rejected_before_loading_definitions(self):
        original = Path.read_bytes
        def changed(path):
            data = original(path)
            return data + b"\n" if path.name == "human_action_data_readiness.ipynb" else data
        cell = next(c for c in BOOK["cells"] if c["id"] == "shared-definitions")
        with patch.object(Path, "read_bytes", changed), self.assertRaisesRegex(ValueError, "SHARED_DEPENDENCY_CHANGED"):
            exec(compile("".join(cell["source"]), str(NOTEBOOK), "exec"), {})

    def test_unknown_normal_action_uses_frozen_global_fallback(self):
        row = sample("other", "test", 0, "soft_drop")
        result = FUNCTIONS["evaluate_b2"](self.bundle, [row])
        self.assertEqual(result["unseenActionFallbackPairs"], 1)
        expected = FUNCTIONS["crps"](FUNCTIONS["prepare_distribution"](self.bundle["models"]["B1"]), [0])[0]
        self.assertEqual(result["gameMacroCrpsMs"], expected)

    def test_bundle_schema_support_and_flags_are_validated(self):
        for change in ({"feature": "nextActionDiagnostic"}, {"canonicalArtifact": True},
                       {"productionIntegration": True}, {"trainPairs": True}, {"bundleSchemaVersion": 99}):
            with self.subTest(change=change), self.assertRaises(ValueError):
                FUNCTIONS["validate_bundle"]({**self.bundle, **change})
        for values in ([], [float("nan")], [-1], [True], [100, 0]):
            altered = copy.deepcopy(self.bundle)
            altered["models"]["B2"]["move_left"] = values
            with self.subTest(values=values), self.assertRaises(ValueError):
                FUNCTIONS["validate_bundle"](altered)

    def test_duplicate_leakage_invalid_label_and_wrong_split_fail(self):
        cases = [self.rows + [self.rows[0]], [sample("fixture-train", "test")],
                 [{**self.rows[0], "recordedIntervalMs": -1}],
                 [{**self.rows[0], "recordedIntervalMs": True}],
                 [{**self.rows[0], "split": "validation"}]]
        for rows in cases:
            with self.subTest(rows=len(rows)), self.assertRaises(ValueError):
                FUNCTIONS["evaluate_scopes"](self.bundle, rows, self.flagged)
        with self.assertRaisesRegex(ValueError, "EVALUATION_GAME_LEAKAGE"):
            FUNCTIONS["evaluate_scopes"](self.bundle, self.rows, self.flagged, [self.flagged])

    def test_changed_labels_do_not_change_bundle_and_input_order_is_irrelevant(self):
        original = FUNCTIONS["json_bytes"](self.bundle)
        forward = FUNCTIONS["evaluate_scopes"](self.bundle, self.rows, self.flagged)
        reverse = FUNCTIONS["evaluate_scopes"](self.bundle, list(reversed(self.rows)), self.flagged)
        self.assertEqual(forward, reverse)
        changed = copy.deepcopy(self.rows)
        changed[0]["recordedIntervalMs"] = 12345
        FUNCTIONS["evaluate_scopes"](self.bundle, changed, self.flagged)
        self.assertEqual(FUNCTIONS["json_bytes"](self.bundle), original)

    def test_default_all_cells_do_not_open_real_data_even_with_full_environment(self):
        namespace = {"__name__": "default_all_cells"}
        original_open = Path.open
        def guarded(path, *args, **kwargs):
            self.assertNotEqual(path.suffix, ".jsonl")
            self.assertNotEqual(path.name, "full-report-run1.json")
            return original_open(path, *args, **kwargs)
        with patch.object(Path, "open", guarded), patch.dict(os.environ, {
            "HUMAN_TIMING_B2_MODE": "full", "HUMAN_TIMING_B2_SMOKE_REPORT": ""
        }), redirect_stdout(io.StringIO()):
            for cell in BOOK["cells"]:
                if cell["cell_type"] == "code" and cell["id"] not in ("smoke-results", "full-results"):
                    exec(compile("".join(cell["source"]), str(NOTEBOOK), "exec"), namespace)
        self.assertFalse(namespace["RUN_FULL"])
        self.assertIsNone(namespace["FULL_REPORT"])
        self.assertEqual(namespace["SMOKE_REPORT"]["runMode"], "smoke")

    def test_smoke_reports_are_deterministic_and_non_policy(self):
        first = FUNCTIONS["run_smoke"](str(self.directory / "one.json"))
        second = FUNCTIONS["run_smoke"](str(self.directory / "two.json"))
        self.assertEqual(first, second)
        self.assertEqual((self.directory / "one.json").read_bytes(), (self.directory / "two.json").read_bytes())
        self.assertFalse(first["fullCohortCovered"] or first["policyDecisionEligible"] or first["testFileRead"])
        self.assertEqual(first["modelFitCount"], 0)

    def test_existing_alias_symlink_hardlink_outputs_are_protected(self):
        existing = self.directory / "keep.json"
        existing.write_text("KEEP", encoding="utf-8")
        hard = self.directory / "hard.json"
        os.link(existing, hard)
        link = self.directory / "link.json"
        link.symlink_to(existing)
        dangling = self.directory / "dangling.json"
        dangling.symlink_to(self.directory / "absent.json")
        for output in (existing, hard, link, dangling, self.directory / ".." / self.directory.name / "keep.json"):
            with self.subTest(output=output), self.assertRaises(ValueError):
                FUNCTIONS["run_smoke"](str(output))
        self.assertEqual(existing.read_text(), "KEEP")

    def fixture_files(self):
        root = self.directory / "repo"
        root.mkdir()
        source = root / NOTEBOOK.relative_to(ROOT)
        source.parent.mkdir(parents=True)
        source.write_bytes(NOTEBOOK.read_bytes())
        dataset = root / "dataset"
        dataset.mkdir()
        report_path = root / "frozen.json"
        train, validation = ["fixture-train"], ["fixture-validation"]
        test_games = sorted({r["gameId"] for r in self.rows})
        payload = b"".join((json.dumps(row) + "\n").encode() for row in self.rows)
        (dataset / "test.jsonl").write_bytes(payload)
        manifest = {"datasetSchemaVersion": 1, "experimentId": "human-timing-dataset", "runMode": "full",
                    "fullCohortCovered": True, "featureColumns": ["previousAction"], "labelColumn": "recordedIntervalMs",
                    "split": {"gameIds": {"train": train, "validation": validation, "test": test_games}},
                    "cohort": {"selectedGameIds": sorted(train + validation + test_games)},
                    "files": {"test.jsonl": {"sha256": hashlib.sha256(payload).hexdigest(),
                                             "bytes": len(payload), "rows": len(self.rows)},
                              "train.jsonl": {"rows": 4, "sha256": "fixture-train-sha"},
                              "validation.jsonl": {"rows": 2, "sha256": "fixture-validation-sha"}}}
        (dataset / "manifest.json").write_bytes(FUNCTIONS["json_bytes"](manifest))
        manifest_sha = FUNCTIONS["sha256_file"](dataset / "manifest.json")
        bundle = copy.deepcopy(self.bundle)
        bundle["provenance"] = {"manifestSha256": manifest_sha, "trainSha256": "fixture-train-sha"}
        bundle_sha = hashlib.sha256(FUNCTIONS["json_bytes"](bundle)).hexdigest()
        report = {"reportSchemaVersion": 1, "experimentId": "human-timing-baseline", "runMode": "full",
                  "fullCohortCovered": True, "policyDecisionEligible": True, "testFileRead": False,
                  "testEvaluated": False, "candidateBundle": bundle, "candidateBundleSha256": bundle_sha,
                  "cohort": {"train": {"gameIds": train, "pairs": 4},
                             "validation": {"gameIds": validation, "pairs": 2}}}
        report_path.write_bytes(FUNCTIONS["json_bytes"](report))
        return {"ROOT": root, "FROZEN_REPORT": "frozen.json", "DATASET": "dataset",
                "REPORT_SHA": FUNCTIONS["sha256_file"](report_path), "BUNDLE_SHA": bundle_sha,
                "MANIFEST_SHA": manifest_sha,
                "TEST_SHA": hashlib.sha256(payload).hexdigest(), "FLAGGED_GAME": self.flagged,
                "EXPECTED_COUNTS": {"test_all": (3, 6), "test_without_flagged_game": (2, 4),
                                    "flagged_game_only": (1, 2)}}

    def test_full_loader_and_runner_with_synthetic_files_only(self):
        settings = self.fixture_files()
        with patch.dict(FUNCTIONS, settings):
            report = FUNCTIONS["run_full_evaluation"](str(self.directory / "full.json"))
        self.assertTrue(report["fullCohortCovered"] and report["testFileRead"])
        self.assertEqual(report["modelFitCount"], 0)
        self.assertEqual(report["status"], "fixed_b2_test_evaluation_complete")
        self.assertEqual(report["candidateBundleSha256"], settings["BUNDLE_SHA"])

    def test_bad_frozen_sha_and_full_count_mismatch_stop_before_scoring(self):
        settings = self.fixture_files()
        with patch.dict(FUNCTIONS, {**settings, "REPORT_SHA": "bad"}):
            with self.assertRaisesRegex(ValueError, "FROZEN_REPORT_SHA_MISMATCH"):
                FUNCTIONS["load_frozen_inputs"]()
        with patch.dict(FUNCTIONS, {**settings, "EXPECTED_COUNTS": {"test_all": (33, 9859)},
                                  "evaluate_b2": lambda *_: self.fail("check cohort before scoring")}):
            with self.assertRaisesRegex(ValueError, "FULL_COHORT_MISMATCH"):
                FUNCTIONS["run_full_evaluation"](str(self.directory / "wrong.json"))
        self.assertFalse((self.directory / "wrong.json").exists())

    def test_corrupted_test_file_stops_before_scoring(self):
        settings = self.fixture_files()
        (settings["ROOT"] / "dataset/test.jsonl").write_text("corrupted", encoding="utf-8")
        with patch.dict(FUNCTIONS, {**settings, "evaluate_b2": lambda *_: self.fail("validate before scoring")}):
            with self.assertRaisesRegex(ValueError, "TEST_SHA_OR_SIZE_MISMATCH"):
                FUNCTIONS["run_full_evaluation"](str(self.directory / "corrupted.json"))
        self.assertFalse((self.directory / "corrupted.json").exists())

    def test_input_change_during_scoring_prevents_publication(self):
        settings = self.fixture_files()
        original = FUNCTIONS["make_report"]
        def changed(*args, **kwargs):
            report = original(*args, **kwargs)
            with (settings["ROOT"] / "dataset/test.jsonl").open("ab") as handle:
                handle.write(b"\n")
            return report
        with patch.dict(FUNCTIONS, {**settings, "make_report": changed}):
            with self.assertRaisesRegex(ValueError, "INPUT_CHANGED"):
                FUNCTIONS["run_full_evaluation"](str(self.directory / "changed.json"))
        self.assertFalse((self.directory / "changed.json").exists())

    def test_display_has_forecast_and_observed_cdf_without_refitting(self):
        import matplotlib
        matplotlib.use("Agg")
        import matplotlib.pyplot as plt
        report = json.loads(FUNCTIONS["json_bytes"](FUNCTIONS["run_smoke"]()))
        before = copy.deepcopy(report)
        def draw():
            figure = plt.gcf()
            if len(figure.axes) == 3:
                self.assertTrue(all(len(a.lines) == 2 for a in figure.axes))
                self.assertTrue(figure.axes[0].get_title().startswith("test_all\n"))
            figure.canvas.draw()
        with redirect_stdout(io.StringIO()), patch("IPython.display.display") as display, patch.object(
            plt, "show", side_effect=draw
        ) as show:
            FUNCTIONS["show_results"](report)
        self.assertEqual(report, before)
        self.assertEqual(display.call_count, 3)
        self.assertEqual(show.call_count, 2)
        self.assertFalse(plt.get_fignums())


if __name__ == "__main__":
    unittest.main()
