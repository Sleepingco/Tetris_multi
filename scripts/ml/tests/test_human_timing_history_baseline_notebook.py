"""Execute history Notebook definitions with synthetic inputs, never the real Test."""

import copy
from contextlib import redirect_stdout
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

NOTEBOOK = ROOT / "scripts/ml/notebooks/human_timing_history_baseline.ipynb"
BOOK = json.loads(NOTEBOOK.read_text(encoding="utf-8"))
FUNCTIONS = {"__name__": "history_test"}
for cell in BOOK["cells"]:
    if cell["cell_type"] == "code" and "definitions" in cell["metadata"].get("tags", []):
        exec(compile("".join(cell["source"]), str(NOTEBOOK), "exec"), FUNCTIONS)


class HumanTimingHistoryTest(unittest.TestCase):
    def setUp(self):
        self.rows = FUNCTIONS["synthetic_rows"]()
        self.bundle = FUNCTIONS["fit_history"](self.rows["train"])

    def test_notebook_contract_separates_smoke_full_and_keeps_empty_outputs(self):
        ids = [c["id"] for c in BOOK["cells"]]
        self.assertEqual(len(ids), len(set(ids)))
        text = "\n".join("".join(c["source"]) for c in BOOK["cells"])
        for n in range(1, 7):
            self.assertIn(f"# {n}.", text)
        for phrase in ("RUN_FULL = False", "SMOKE_REPORT", "FULL_REPORT", "import pandas as pd",
                       "import matplotlib.pyplot as plt", "futureIndependentCohortRequired"):
            self.assertIn(phrase, text)
        self.assertNotIn("def crps(", text)
        self.assertNotIn("/Users/", text)
        for c in BOOK["cells"]:
            if c["cell_type"] == "code":
                self.assertIsNone(c["execution_count"])
                self.assertEqual(c["outputs"], [])

    def test_exact_history_and_current_label_is_not_current_feature(self):
        rows = self.rows["validation"]
        history = {r["currentInputIndex"]: r for r in FUNCTIONS["with_history"](rows)}
        self.assertIsNone(history[1]["priorIntervalMs"])
        self.assertEqual(history[2]["priorIntervalMs"], 0)
        self.assertEqual(history[3]["priorIntervalMs"], 50)
        changed = copy.deepcopy(rows)
        changed[1]["recordedIntervalMs"] = 99999
        after = {r["currentInputIndex"]: r for r in FUNCTIONS["with_history"](changed)}
        self.assertEqual(after[2]["priorIntervalMs"], history[2]["priorIntervalMs"])
        self.assertEqual(after[3]["priorIntervalMs"], 99999)
        self.assertEqual(FUNCTIONS["support_for"](self.bundle, after[2], "B3"),
                         FUNCTIONS["support_for"](self.bundle, history[2], "B3"))

    def test_gap_does_not_bridge_and_order_does_not_matter(self):
        rows = self.rows["validation"]
        self.assertEqual(FUNCTIONS["with_history"](rows), FUNCTIONS["with_history"](list(reversed(rows))))
        result = {r["currentInputIndex"]: r for r in FUNCTIONS["with_history"]([rows[0], *rows[2:]])}
        self.assertIsNone(result[3]["priorIntervalMs"])
        self.assertEqual(result[3]["historyStatus"], "gap_or_missing")
        self.assertEqual(result[4]["priorIntervalMs"], 100)

    def test_lineage_boundaries_never_connect(self):
        for field, value in (("gameId", "different"), ("playerNumber", 2), ("pieceIndex", 2),
                             ("sourceLine", 2), ("split", "train")):
            rows = copy.deepcopy(self.rows["validation"][:2])
            rows[1][field] = value
            lineage = {k: rows[1][k] for k in ("gameId", "playerNumber", "pieceIndex", "sourceLine",
                                             "previousInputIndex", "currentInputIndex")}
            rows[1]["sampleId"] = FUNCTIONS["hashlib"].sha256(FUNCTIONS["json_bytes"](lineage)).hexdigest()
            with self.subTest(field=field):
                self.assertTrue(all(r["priorIntervalMs"] is None for r in FUNCTIONS["with_history"](rows)))

    def test_duplicate_mismatched_actions_bad_label_and_test_are_rejected(self):
        rows = self.rows["validation"]
        with self.assertRaisesRegex(ValueError, "DUPLICATE_LINEAGE"):
            FUNCTIONS["with_history"]([*rows, rows[0]])
        changed = copy.deepcopy(rows)
        changed[0]["nextActionDiagnostic"] = "rotate"
        with self.assertRaisesRegex(ValueError, "HISTORY_ACTION_MISMATCH"):
            FUNCTIONS["with_history"](changed)
        for value in (-1, True, float("nan"), float("inf")):
            with self.subTest(value=value), self.assertRaises(ValueError):
                FUNCTIONS["with_history"]([{**rows[0], "recordedIntervalMs": value}])
        with self.assertRaisesRegex(ValueError, "TEST_NOT_ALLOWED"):
            FUNCTIONS["with_history"]([sample("test-game", "test")])

    def test_train_only_cuts_and_duplicate_boundaries(self):
        self.assertEqual(self.bundle["bucketCutsMs"], [50.0, 150.0])
        with self.assertRaisesRegex(ValueError, "TRAIN_ONLY_REQUIRED"):
            FUNCTIONS["fit_history"](self.rows["validation"])
        equal = [{**r, "recordedIntervalMs": 0} for r in self.rows["train"]]
        bundle = FUNCTIONS["fit_history"](equal)
        self.assertEqual(bundle["bucketCutsMs"], [0.0, 0.0])
        self.assertEqual(set(bundle["historyCells"]), {"move_left:2"})
        self.assertTrue(all(x == 0 for x in bundle["global"]))

    def test_boundary_equality_goes_right_and_fallbacks_are_frozen(self):
        row = {**self.rows["validation"][0], "priorIntervalMs": 50}
        self.assertEqual(FUNCTIONS["support_for"](self.bundle, row, "B3"),
                         (self.bundle["historyCells"]["move_left:1"], "history_cell"))
        for context, reason in ((None, "missing_history"),):
            support, route = FUNCTIONS["support_for"](self.bundle, {**row, "priorIntervalMs": context}, "B3")
            self.assertEqual((support, route), (self.bundle["actions"]["move_left"], reason))
        altered = copy.deepcopy(self.bundle)
        del altered["historyCells"]["move_left:1"]
        self.assertEqual(FUNCTIONS["support_for"](altered, row, "B3")[1], "unseen_history_cell")
        self.assertEqual(FUNCTIONS["support_for"](self.bundle, {**row, "previousAction": "rotate"}, "B3"),
                         (self.bundle["global"], "unseen_action_global"))

    def test_evaluation_same_denominator_no_fit_and_bundle_is_unchanged(self):
        before = copy.deepcopy(self.bundle)
        with patch.dict(FUNCTIONS, {"fit_history": lambda *_: self.fail("evaluation must not fit")}):
            result = FUNCTIONS["evaluate_history"](self.bundle, self.rows["validation"])
        self.assertEqual(self.bundle, before)
        self.assertEqual(result["pairs"], 4)
        self.assertEqual(result["evaluationFitCount"], 0)
        self.assertEqual(result["historyCounts"], {"available": 3, "segment_start": 1})
        for model in ("B2", "B3"):
            self.assertEqual(sum(x["pairs"] for x in result["perGame"] if x["model"] == model), 4)
            self.assertEqual(sum(x["pairs"] for x in result["historySubsets"] if x["model"] == model), 4)
        self.assertAlmostEqual(result["deltaB3MinusB2Ms"],
                               result["metrics"][1]["gameMacroCrpsMs"] - result["metrics"][0]["gameMacroCrpsMs"])
        with self.assertRaisesRegex(ValueError, "VALIDATION_ONLY_REQUIRED"):
            FUNCTIONS["evaluate_history"](self.bundle, self.rows["train"])
        with self.assertRaisesRegex(ValueError, "GAME_SPLIT_LEAKAGE"):
            FUNCTIONS["evaluate_history"]({**self.bundle, "trainGameIds": ["fixture-validation"]},
                                           self.rows["validation"])

    def test_scores_match_bruteforce_empirical_crps(self):
        history = FUNCTIONS["with_history"](self.rows["validation"])
        result = FUNCTIONS["evaluate_history"](self.bundle, self.rows["validation"])
        for metric in result["metrics"]:
            scores = []
            for row in history:
                support, _ = FUNCTIONS["support_for"](self.bundle, row, metric["model"])
                y = row["recordedIntervalMs"]
                scores.append(sum(abs(x - y) for x in support) / len(support)
                              - sum(abs(x - z) for x in support for z in support) / (2 * len(support)**2))
            self.assertAlmostEqual(metric["pairMicroCrpsMs"], sum(scores) / len(scores), places=12)

    def test_validation_changes_cannot_modify_trained_bundle(self):
        before = FUNCTIONS["json_bytes"](self.bundle)
        changed = [{**r, "recordedIntervalMs": 1234} for r in self.rows["validation"]]
        FUNCTIONS["evaluate_history"](self.bundle, changed)
        self.assertEqual(FUNCTIONS["json_bytes"](self.bundle), before)

    def test_default_all_cells_never_open_real_dataset_or_run_full(self):
        namespace = {"__name__": "default_history"}
        original = Path.open
        def guarded(path, *args, **kwargs):
            self.assertNotEqual(path.suffix, ".jsonl")
            self.assertNotEqual(path.name, "full-report-run1.json")
            return original(path, *args, **kwargs)
        with patch.object(Path, "open", guarded), redirect_stdout(io.StringIO()), patch.dict(os.environ, {
            "HUMAN_TIMING_HISTORY_MODE": "full", "HUMAN_TIMING_HISTORY_SMOKE_REPORT": ""
        }):
            for cell in BOOK["cells"]:
                if cell["cell_type"] == "code" and cell["id"] not in ("smoke-results", "full-results"):
                    exec(compile("".join(cell["source"]), str(NOTEBOOK), "exec"), namespace)
        self.assertFalse(namespace["RUN_FULL"])
        self.assertIsNone(namespace["FULL_REPORT"])
        self.assertTrue(namespace["SMOKE_REPORT"]["synthetic"])

    def test_report_determinism_and_existing_alias_symlink_hardlink_protection(self):
        with tempfile.TemporaryDirectory() as name:
            directory = Path(name)
            one, two = directory / "one.json", directory / "two.json"
            first = FUNCTIONS["run_history"]("smoke", str(one), synthetic=True)
            second = FUNCTIONS["run_history"]("smoke", str(two), synthetic=True)
            self.assertEqual(first, second)
            self.assertEqual(one.read_bytes(), two.read_bytes())
            self.assertFalse(first["testFileRead"] or first["policyDecisionEligible"])
            self.assertTrue(first["futureIndependentCohortRequired"])
            link, hard = directory / "link.json", directory / "hard.json"
            link.symlink_to(one)
            os.link(one, hard)
            for output in (one, directory / ".." / directory.name / one.name, link, hard):
                with self.subTest(output=output), self.assertRaises(ValueError):
                    FUNCTIONS["run_history"]("smoke", str(output), synthetic=True)
            self.assertEqual(one.read_bytes(), two.read_bytes())

    def test_full_path_uses_only_train_validation_loader_and_keeps_test_closed(self):
        manifest = {"files": {s + ".jsonl": {"sha256": "fixture", "rows": len(rr)}
                               for s, rr in self.rows.items()}}
        def load(dataset, mode):
            self.assertEqual(mode, "full")
            return manifest, self.rows, {}
        original = Path.open
        def guarded(path, *args, **kwargs):
            self.assertNotEqual(path.suffix, ".jsonl")
            return original(path, *args, **kwargs)
        with tempfile.TemporaryDirectory() as name, patch.object(Path, "open", guarded), patch.dict(
            FUNCTIONS, {"load_inputs": load}
        ):
            output = Path(name) / "full.json"
            result = FUNCTIONS["run_history"]("full", str(output))
            self.assertTrue(output.exists())
            self.assertTrue(result["fullCohortCovered"] and result["policyDecisionEligible"])
            self.assertFalse(result["testFileRead"] or result["canonicalResultEligible"])
            self.assertEqual(result["validation"]["evaluationFitCount"], 0)

    def test_changed_dependency_code_is_rejected_before_execution(self):
        original = Path.read_text
        def changed(path, *args, **kwargs):
            text = original(path, *args, **kwargs)
            if path.name == "human_timing_baseline.ipynb":
                book = json.loads(text)
                cell = next(c for c in book["cells"] if c["id"] == "metric-definitions")
                cell["source"].append("\nraise AssertionError('must not execute')\n")
                return json.dumps(book)
            return text
        cell = next(c for c in BOOK["cells"] if c["id"] == "shared-definitions")
        with patch.object(Path, "read_text", changed), self.assertRaisesRegex(ValueError, "BASELINE_DEFINITIONS_CHANGED"):
            exec(compile("".join(cell["source"]), str(NOTEBOOK), "exec"), {})

    def test_input_mutation_prevents_report_publication(self):
        original = FUNCTIONS["sha256_file"]
        count = 0
        def changed(path):
            nonlocal count
            if Path(path) == NOTEBOOK:
                count += 1
                if count > 1:
                    return "0" * 64
            return original(path)
        with tempfile.TemporaryDirectory() as name, patch.dict(FUNCTIONS, {"sha256_file": changed}):
            output = Path(name) / "never.json"
            with self.assertRaisesRegex(ValueError, "INPUT_CHANGED"):
                FUNCTIONS["run_history"]("smoke", str(output), synthetic=True)
            self.assertFalse(output.exists())

    def test_report_only_display_has_tables_and_graph(self):
        import matplotlib
        matplotlib.use("Agg")
        import matplotlib.pyplot as plt
        report = FUNCTIONS["run_history"](synthetic=True)
        before = copy.deepcopy(report)
        with redirect_stdout(io.StringIO()), patch("IPython.display.display") as display, patch.object(
            plt, "show", side_effect=lambda: plt.gcf().canvas.draw()
        ) as show:
            FUNCTIONS["show_history"](report)
        self.assertEqual(report, before)
        self.assertEqual(display.call_count, 5)
        self.assertEqual(show.call_count, 1)
        self.assertFalse(plt.get_fignums())


if __name__ == "__main__":
    unittest.main()
