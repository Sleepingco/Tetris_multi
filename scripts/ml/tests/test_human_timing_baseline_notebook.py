"""Synthetic fixtures execute notebook definitions, not a copied timing implementation."""

import copy
from contextlib import redirect_stdout
import hashlib
import io
import json
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

import numpy as np


ROOT = Path(__file__).resolve().parents[3]
NOTEBOOK = ROOT / "scripts/ml/notebooks/human_timing_baseline.ipynb"
BOOK = json.loads(NOTEBOOK.read_text(encoding="utf-8"))
FUNCTIONS = {"__name__": "timing_baseline_test"}
for cell in BOOK["cells"]:
    if cell["cell_type"] == "code" and (
        "definitions" in cell["metadata"].get("tags", []) or cell["id"] == "visualization-definitions"
    ):
        exec(compile("".join(cell["source"]), str(NOTEBOOK), "exec"), FUNCTIONS)


def sample(game="train-a", split="train", value=100, action="move_left", index=0):
    lineage = {"gameId": game, "playerNumber": 1, "pieceIndex": 1, "sourceLine": index + 1,
               "previousInputIndex": index, "currentInputIndex": index + 1}
    return {"schemaVersion": 1, "sampleId": hashlib.sha256(FUNCTIONS["json_bytes"](lineage)).hexdigest(),
            **lineage, "previousAction": action, "nextActionDiagnostic": "hard_drop",
            "recordedIntervalMs": value, "split": split}


class HumanTimingBaselineTest(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.directory = Path(temporary.name).resolve()
        self.root = self.directory / "repo"
        self.dataset = self.root / "fixture"
        self.dataset.mkdir(parents=True)
        self.groups = {"train": [f"train-{i}" for i in range(6)],
                       "validation": [f"validation-{i}" for i in range(4)], "test": ["test-a", "test-b"]}
        self.manifest = {"datasetSchemaVersion": 1, "experimentId": "human-timing-dataset",
                         "runMode": "full", "fullCohortCovered": True, "dataDecisionEligible": True,
                         "featureColumns": ["previousAction"], "labelColumn": "recordedIntervalMs",
                         "split": {"gameIds": self.groups},
                         "cohort": {"selectedGameIds": sorted(sum(self.groups.values(), []))}, "files": {}}
        for split in ("train", "validation"):
            rows = [sample(game, split, 0 if i == 0 else i * 100,
                           "move_left" if i % 2 else "rotate", i)
                    for i, game in enumerate(self.groups[split])]
            path = self.dataset / (split + ".jsonl")
            path.write_bytes(b"".join((json.dumps(row) + "\n").encode() for row in rows))
            self.manifest["files"][path.name] = {"sha256": FUNCTIONS["sha256_file"](path),
                                                 "bytes": path.stat().st_size, "rows": len(rows)}
        # Deliberately invalid: any Test read must be caught, not treated as acceptable input.
        (self.dataset / "test.jsonl").write_text("DO_NOT_READ_TEST", encoding="utf-8")
        self.write_manifest()

    def write_manifest(self):
        path = self.dataset / "manifest.json"
        path.write_bytes(FUNCTIONS["json_bytes"](self.manifest))
        self.manifest_sha = FUNCTIONS["sha256_file"](path)

    def load(self, mode="smoke"):
        with patch.dict(FUNCTIONS, {"ROOT": self.root, "EXPECTED_MANIFEST_SHA": self.manifest_sha}):
            return FUNCTIONS["load_inputs"]("fixture", mode)

    def run_fixture(self, name="report.json", mode="smoke"):
        env = {"HUMAN_TIMING_BASELINE_MODE": mode, "HUMAN_TIMING_BASELINE_DATASET": "fixture",
               "HUMAN_TIMING_BASELINE_REPORT": str(self.directory / name)}
        with patch.dict(FUNCTIONS, {"ROOT": self.root, "EXPECTED_MANIFEST_SHA": self.manifest_sha}), patch.dict(
            os.environ, env
        ):
            return FUNCTIONS["run_baseline_from_environment"]()

    def test_notebook_contract_keeps_explanations_ids_and_empty_outputs(self):
        ids = [c["id"] for c in BOOK["cells"]]
        self.assertEqual(len(ids), len(set(ids)))
        text = "\n".join("".join(c["source"]) for c in BOOK["cells"])
        for number in range(1, 9):
            self.assertIn(f"# {number}.", text)
        for required in ("human_action_data_readiness.ipynb", "import pandas as pd",
                         "import matplotlib.pyplot as plt", "Test", "gameMacroCrpsMs"):
            self.assertIn(required, text)
        self.assertNotIn("/Users/", text)
        self.assertNotIn("def normalize_event", text)
        for cell in BOOK["cells"]:
            if cell["cell_type"] == "code":
                self.assertIsNone(cell["execution_count"])
                self.assertEqual(cell["outputs"], [])

    def test_crps_worked_example_and_point_mass(self):
        self.assertEqual(FUNCTIONS["crps"](FUNCTIONS["prepare_distribution"]([0, 100]), [0]).tolist(), [25])
        np.testing.assert_allclose(FUNCTIONS["crps"](FUNCTIONS["prepare_distribution"]([50]), [0, 50, 120]),
                                   [50, 0, 70], atol=1e-12, rtol=0)

    def test_fast_crps_matches_small_brute_force_and_preserves_order(self):
        for values in ([0, 0, 10, 100], [0, 2, 3, 9, 1000], [1_000_000], [1, 1, 1]):
            x = np.asarray(values)
            observed = [0, 1, 99, 2000]
            expected = [np.abs(x - y).mean() - .5 * np.abs(x[:, None] - x).mean() for y in observed]
            before = copy.deepcopy(values)
            np.testing.assert_allclose(FUNCTIONS["crps"](FUNCTIONS["prepare_distribution"](values), observed),
                                       expected, atol=1e-12, rtol=0)
            self.assertEqual(values, before)

    def test_invalid_support_and_observations_are_rejected(self):
        for values in ([], [True], [-1], [float("nan")], [float("inf")], ["1"]):
            with self.subTest(values=values), self.assertRaisesRegex(ValueError, "SUPPORT_INVALID"):
                FUNCTIONS["prepare_distribution"](values)
        for observed in ([], [-1], [True], [float("inf")]):
            with self.subTest(observed=observed), self.assertRaisesRegex(ValueError, "OBSERVATION_INVALID"):
                FUNCTIONS["crps"](FUNCTIONS["prepare_distribution"]([0]), observed)

    def test_quantiles_and_zero_probability_follow_empirical_support(self):
        result = FUNCTIONS["distribution_summary"]([0, 100])
        self.assertEqual(result, {"meanMs": 50, "medianMs": 0, "p95Ms": 100, "zeroProbability": .5})
        weighted = FUNCTIONS["distribution_summary"]([0, 100], [1, 3])
        self.assertEqual(weighted["medianMs"], 100)
        self.assertEqual(weighted["zeroProbability"], .25)

    def test_uniform_quantiles_do_not_shift_at_floating_point_cdf_boundaries(self):
        for count in (14, 20, 100, 140):
            values = list(range(count))
            for weights in (None, [1] * count):
                with self.subTest(count=count, weighted=weights is not None):
                    result = FUNCTIONS["distribution_summary"](values, weights)
                    self.assertEqual(result["medianMs"], (count + 1) // 2 - 1)
                    self.assertEqual(result["p95Ms"], int(np.ceil(.95 * count)) - 1)

    def test_loading_validates_files_but_never_opens_test(self):
        original = Path.open
        def guarded(path, *args, **kwargs):
            self.assertNotEqual(path.name, "test.jsonl")
            return original(path, *args, **kwargs)
        with patch.object(Path, "open", guarded):
            for mode, expected in (("smoke", (5, 3)), ("full", (6, 4))):
                _, rows, watched = self.load(mode)
                self.assertEqual(tuple(len(rows[s]) for s in ("train", "validation")), expected)
                self.assertEqual({p.name for p in watched}, {"manifest.json", "train.jsonl", "validation.jsonl"})

    def test_checksum_schema_lineage_and_duplicate_rejections(self):
        original = sample()
        for key, value in (("recordedIntervalMs", True), ("recordedIntervalMs", -1),
                           ("previousAction", "hold"), ("previousAction", []),
                           ("currentInputIndex", 99), ("sampleId", "fake"), ("schemaVersion", True)):
            changed = {**original, key: value}
            with self.subTest(key=key, value=value), self.assertRaises(ValueError):
                FUNCTIONS["validate_sample"](changed, "train", {"train-a"})
        (self.dataset / "train.jsonl").write_text("corrupted", encoding="utf-8")
        with self.assertRaisesRegex(ValueError, "DATASET_FILE_SHA_MISMATCH"):
            self.load()

    def test_split_leakage_and_manifest_sha_fail_before_fit(self):
        with patch.dict(FUNCTIONS, {"EXPECTED_MANIFEST_SHA": "bad", "ROOT": self.root}):
            with self.assertRaisesRegex(ValueError, "MANIFEST_SHA_MISMATCH"):
                FUNCTIONS["load_inputs"]("fixture")
        self.groups["test"] = ["train-0"]
        self.write_manifest()
        with self.assertRaisesRegex(ValueError, "GAME_SPLIT_LEAKAGE"):
            self.load()

    def test_duplicate_sample_is_rejected_even_with_matching_file_checksum(self):
        path = self.dataset / "train.jsonl"
        path.write_bytes(path.read_bytes() + path.read_bytes().splitlines(keepends=True)[0])
        info = self.manifest["files"][path.name]
        info.update(sha256=FUNCTIONS["sha256_file"](path), bytes=path.stat().st_size, rows=info["rows"] + 1)
        self.write_manifest()
        with self.assertRaisesRegex(ValueError, "DUPLICATE_SAMPLE"):
            self.load()

    def test_relative_report_path_is_resolved_from_repository_not_kernel_cwd(self):
        output = self.root / "data/ml-experiments/human-timing-baseline"
        output.mkdir(parents=True)
        env = {"HUMAN_TIMING_BASELINE_MODE": "smoke", "HUMAN_TIMING_BASELINE_DATASET": "fixture",
               "HUMAN_TIMING_BASELINE_REPORT": "data/ml-experiments/human-timing-baseline/relative.json"}
        with patch.dict(FUNCTIONS, {"ROOT": self.root, "EXPECTED_MANIFEST_SHA": self.manifest_sha}), patch.dict(
            os.environ, env
        ):
            FUNCTIONS["run_baseline_from_environment"]()
        self.assertTrue((output / "relative.json").is_file())

    def test_train_only_fit_and_evaluation_cannot_change_bundle(self):
        train = [sample(value=0), sample(value=100, index=1)]
        fit = FUNCTIONS["fit_baselines"]
        bundle = fit(train)
        before = FUNCTIONS["json_bytes"](bundle)
        validation = [sample("v", "validation", 50)]
        FUNCTIONS["evaluate_bundle"](bundle, validation)
        validation[0]["recordedIntervalMs"] = 10000
        validation[0]["nextActionDiagnostic"] = "rotate"
        FUNCTIONS["evaluate_bundle"](bundle, validation)
        self.assertEqual(before, FUNCTIONS["json_bytes"](bundle))
        self.assertEqual(fit(list(reversed(train))), bundle)
        with self.assertRaisesRegex(ValueError, "TRAIN_ONLY_REQUIRED"):
            fit(validation)
        with self.assertRaisesRegex(ValueError, "EVALUATION_GAME_LEAKAGE"):
            FUNCTIONS["evaluate_bundle"](bundle, [sample("train-a", "validation")])

    def test_game_macro_not_pair_micro_is_primary_and_unseen_falls_back(self):
        bundle = FUNCTIONS["fit_baselines"]([sample(value=0), sample(value=20, index=1)])
        rows = [sample("v0", "validation", 0, "rotate")] + [
            sample("v1", "validation", 100, "rotate", i) for i in range(3)]
        result = FUNCTIONS["evaluate_bundle"](bundle, rows)
        self.assertEqual(result["metrics"][0]["gameMacroCrpsMs"], 50)
        self.assertEqual(result["metrics"][0]["pairMicroCrpsMs"], 70)
        self.assertEqual(result["metrics"][2]["unseenActionFallbackPairs"], 4)
        self.assertEqual(result["metrics"][1]["gameMacroCrpsMs"], result["metrics"][2]["gameMacroCrpsMs"])

    def test_forecast_mixture_uses_action_counts_not_labels(self):
        bundle = FUNCTIONS["fit_baselines"]([sample(value=0), sample(value=100, action="rotate", index=1)])
        values, weights = FUNCTIONS["forecast_values"](bundle, "B2", {"move_left": 1, "rotate": 3})
        self.assertEqual(FUNCTIONS["distribution_summary"](values, weights)["meanMs"], 75)

    def test_sensitivity_uses_same_bundle_and_no_fit(self):
        bundle = FUNCTIONS["fit_baselines"]([sample()])
        rows = [sample("flag", "test", 0)] + [sample("other", "test", 200, index=i) for i in range(2)]
        before = FUNCTIONS["json_bytes"](bundle)
        with patch.dict(FUNCTIONS, {"fit_baselines": lambda *_: self.fail("no refit permitted")}):
            result = FUNCTIONS["sensitivity_views"](bundle, rows, "flag")
        self.assertEqual({r["bundleSha256"] for r in result.values()}, {hashlib.sha256(before).hexdigest()})
        self.assertEqual([r["pairs"] for r in result.values()], [3, 2, 1])
        self.assertTrue(all(r["evaluationFitCount"] == 0 for r in result.values()))
        self.assertEqual(FUNCTIONS["json_bytes"](bundle), before)

    def test_reports_are_byte_deterministic_and_all_test_flags_are_false(self):
        before = {p: p.read_bytes() for p in self.dataset.iterdir()}
        for mode in ("smoke", "full"):
            first = self.run_fixture(f"{mode}-1.json", mode)
            self.run_fixture(f"{mode}-2.json", mode)
            self.assertEqual((self.directory / f"{mode}-1.json").read_bytes(),
                             (self.directory / f"{mode}-2.json").read_bytes())
            self.assertFalse(first["testFileRead"] or first["testEvaluated"] or first["canonicalResultEligible"])
            self.assertEqual(first["candidateBundleSha256"],
                             hashlib.sha256(FUNCTIONS["json_bytes"](first["candidateBundle"])).hexdigest())
            self.assertEqual(first["modelFitCount"], 3)
            self.assertNotIn("/Users/", json.dumps(first))
        self.assertEqual(before, {p: p.read_bytes() for p in before})

    def test_existing_symlink_hardlink_and_alias_outputs_are_rejected(self):
        source = self.dataset / "manifest.json"
        existing = self.directory / "existing.json"
        existing.write_text("KEEP", encoding="utf-8")
        hardlink = self.directory / "hardlink.json"
        os.link(source, hardlink)
        symlink = self.directory / "link.json"
        symlink.symlink_to(source)
        dangling = self.directory / "dangling.json"
        dangling.symlink_to(self.directory / "missing.json")
        for output in (source, existing, hardlink, symlink, dangling, self.dataset / ".." / "fixture" / "manifest.json"):
            with self.subTest(output=output), self.assertRaises(ValueError):
                FUNCTIONS["checked_paths"](self.root, "fixture/manifest.json", str(output), "smoke")
        self.assertEqual(existing.read_text(), "KEEP")
        report = self.run_fixture()
        self.assertEqual(report["runMode"], "smoke")
        with patch.dict(FUNCTIONS, {"fit_baselines": lambda *_: self.fail("output must fail before fit")}):
            with self.assertRaisesRegex(ValueError, "REPORT_ALREADY_EXISTS_OR_SYMLINK"):
                self.run_fixture()

    def test_pandas_and_matplotlib_show_report_without_fit_or_mutation(self):
        import matplotlib
        matplotlib.use("Agg")
        import matplotlib.pyplot as plt
        report = self.run_fixture()
        before = copy.deepcopy(report)
        def draw_and_check_cdf():
            figure = plt.gcf()
            if len(figure.axes) == 2:
                fixed_cdf = figure.axes[0].lines[0]
                self.assertGreaterEqual(len(fixed_cdf.get_xdata()), 3)
                self.assertEqual(fixed_cdf.get_ydata()[0], 0)
                self.assertEqual(fixed_cdf.get_ydata()[-1], 1)
            figure.canvas.draw()
        with redirect_stdout(io.StringIO()), patch("IPython.display.display") as display, patch.object(
            plt, "show", side_effect=draw_and_check_cdf
        ) as show, patch.dict(FUNCTIONS, {"fit_baselines": lambda *_: self.fail("display cannot fit")}):
            FUNCTIONS["show_results"](report)
        self.assertEqual(report, before)
        self.assertEqual(display.call_count, 5)
        self.assertEqual(show.call_count, 2)
        self.assertEqual(plt.get_fignums(), [])


if __name__ == "__main__":
    unittest.main()
