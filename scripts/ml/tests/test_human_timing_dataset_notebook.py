"""Run notebook definitions directly; fixtures are synthetic, not a copied implementation."""

import copy
from contextlib import redirect_stdout
import io
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

from scripts.ml.tests.test_human_action_data_readiness_notebook import action, placement
from scripts.ml.tests.test_human_game_quality_notebook import FUNCTIONS as QUALITY, game_events


ROOT = Path(__file__).resolve().parents[3]
NOTEBOOK = ROOT / "scripts/ml/notebooks/human_timing_dataset.ipynb"
BOOK = json.loads(NOTEBOOK.read_text(encoding="utf-8"))
FUNCTIONS = {"__name__": "human_timing_dataset_test"}
for cell in BOOK["cells"]:
    if cell["cell_type"] == "code" and "definitions" in cell["metadata"].get("tags", []):
        exec(compile("".join(cell["source"]), str(NOTEBOOK), "exec"), FUNCTIONS)


class HumanTimingDatasetTest(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.directory = Path(self.temporary.name)
        self.source = self.directory / "source.jsonl"
        self.events = [row for i in range(6) for row in game_events(game=f"game-{i}")]

    def prepare(self, events=None):
        events = self.events if events is None else events
        self.source.write_text("".join(json.dumps(row) + "\n" for row in events), encoding="utf-8")
        return QUALITY["audit_game_quality"](self.source, "fixture.jsonl", "full")

    def build(self, events=None, mode="full"):
        quality = self.prepare(events)
        return FUNCTIONS["build_timing_dataset"](self.source, quality, mode)

    def test_notebook_contract_and_no_duplicate_parser_or_trainer(self):
        ids = [c["id"] for c in BOOK["cells"]]
        self.assertEqual(len(ids), len(set(ids)))
        text = "\n".join("".join(c["source"]) for c in BOOK["cells"])
        for number in range(1, 11):
            self.assertIn(f"# {number}.", text)
        self.assertIn("human_action_data_readiness.ipynb", text)
        self.assertIn("import pandas as pd", text)
        self.assertIn("import matplotlib.pyplot as plt", text)
        self.assertNotIn("def normalize_event", text)
        self.assertNotIn("/Users/", text)
        for cell in BOOK["cells"]:
            if cell["cell_type"] == "code":
                self.assertIsNone(cell["execution_count"])
                self.assertEqual(cell["outputs"], [])

    def test_full_and_smoke_counts_flags_and_no_leakage(self):
        for mode, games in (("full", 6), ("smoke", 5)):
            with self.subTest(mode=mode):
                rows, segments, pairs, manifest = self.build(mode=mode)
                self.assertEqual(len(rows), games * 5)
                self.assertFalse(segments or pairs)
                self.assertEqual(manifest["counts"]["eligibleSegments"], games * 5)
                self.assertEqual(manifest["counts"]["candidatePairs"], len(rows) + len(pairs))
                self.assertEqual(manifest["fullCohortCovered"], mode == "full")
                self.assertFalse(manifest["policyDecisionEligible"])
                self.assertFalse(manifest["canonicalResultEligible"])
                self.assertEqual(manifest["modelFitCount"], 0)
                by_game = {}
                for row in rows:
                    by_game.setdefault(row["gameId"], set()).add(row["split"])
                self.assertTrue(all(len(splits) == 1 for splits in by_game.values()))
                self.assertEqual(manifest["featureColumns"], ["previousAction"])
                self.assertEqual(manifest["labelColumn"], "recordedIntervalMs")
                self.assertNotIn("PRIVATE_PLAYER_SENTINEL", json.dumps((rows, manifest)))
                self.assertNotIn("createdAt", json.dumps(rows))

    def test_game_split_is_stable_and_213_game_counts_are_fixed(self):
        fn = FUNCTIONS["split_games"]
        games = [f"g-{i:03d}" for i in range(213)]
        self.assertEqual(fn(games), fn(list(reversed(games))))
        self.assertEqual({k: len(v) for k, v in fn(games).items()}, {"train": 149, "validation": 31, "test": 33})
        for bad in ([], ["a", "b"], ["a", "a", "b"]):
            with self.assertRaisesRegex(ValueError, "THREE_UNIQUE_GAMES_REQUIRED"):
                fn(bad)

    def test_pvp_both_people_stay_together_and_ai_is_never_a_sample(self):
        events = copy.deepcopy(self.events)
        second = copy.deepcopy(events[1])
        second["playerId"] = "OTHER_PERSON_SENTINEL"
        events.insert(2, second)
        for row in events:
            if row["gameId"] == "game-0":
                row["mode"] = "pvp"
        events.insert(-1, placement(game="game-5", piece=80, source="heuristic_ai", playerId="AI_SENTINEL"))
        rows, _, _, manifest = self.build(events)
        players = {row["playerNumber"] for row in rows if row["gameId"] == "game-0"}
        self.assertEqual(len(players), 2)
        self.assertEqual(len({row["split"] for row in rows if row["gameId"] == "game-0"}), 1)
        self.assertEqual(len(rows), 31)
        self.assertEqual(manifest["counts"]["humanSegments"], 31)

    def test_quality_review_games_are_not_used(self):
        events = [*self.events, *game_events(game="review-game", seconds=15, only_drop=True)]
        rows, _, _, manifest = self.build(events)
        self.assertNotIn("review-game", {r["gameId"] for r in rows})
        self.assertIn("review-game", manifest["qualityPolicy"]["gameLists"]["review"])

    def test_hold_and_invalid_timing_segments_are_separated(self):
        events = copy.deepcopy(self.events)
        events[1]["inputSequence"][0]["action"] = "hold"
        events[2]["inputSequence"][1]["createdAt"] = 0
        rows, rejected, _, manifest = self.build(events)
        self.assertEqual(len(rows), 28)
        self.assertEqual({r["reason"] for r in rejected}, {"HOLD_SEGMENT", "TIMING_UNUSABLE"})
        self.assertEqual(manifest["counts"]["rejectedSegments"], 2)

    def test_sequence_gap_does_not_create_a_bridge_and_tick_reversal_is_rejected(self):
        events = copy.deepcopy(self.events)
        events[1]["inputSequence"] = [action("move_left", 1, 1000, 0), action("rotate", 3, 1120, 0), action("hard_drop", 4, 1300, 0)]
        events[2]["inputSequence"][1]["tick"] = 0
        rows, _, rejected, manifest = self.build(events)
        target = [row for row in rows if row["gameId"] == "game-0" and row["pieceIndex"] == 0]
        self.assertEqual([(r["previousInputIndex"], r["currentInputIndex"], r["recordedIntervalMs"]) for r in target], [(1, 2, 180)])
        self.assertEqual(len(rejected), 2)
        self.assertEqual(manifest["pairRejectionReasons"], {"PAIR_SEQUENCE_NOT_ADJACENT": 1, "PAIR_TICK_REVERSED_OR_INVALID": 1})

    def test_zero_and_long_intervals_are_not_clipped_and_piece_gaps_are_not_bridged(self):
        events = copy.deepcopy(self.events)
        events[1]["inputSequence"][1]["createdAt"] = events[1]["inputSequence"][0]["createdAt"]
        events[2]["inputSequence"][1]["createdAt"] = 1_000_000
        events[3]["pieceIndex"] = 20
        for value in events[3]["inputSequence"]:
            value["pieceIndex"] = 20
        rows, _, _, manifest = self.build(events)
        values = [row["recordedIntervalMs"] for row in rows]
        self.assertIn(0, values)
        self.assertIn(998800, values)
        self.assertEqual(len(rows), 30)
        self.assertGreater(manifest["counts"]["pieceGapSegments"], 0)

    def test_quality_checksum_flags_counts_and_policy_are_required(self):
        quality = self.prepare()
        for key in ("fullCohortCovered", "sourceContractValid", "sourceUnchanged"):
            changed = copy.deepcopy(quality); changed[key] = False
            with self.assertRaisesRegex(ValueError, "QUALITY_FULL_VALID_REQUIRED"):
                FUNCTIONS["build_timing_dataset"](self.source, changed)
        changed = copy.deepcopy(quality); changed["policy"]["shortGameReviewSeconds"] = 31
        with self.assertRaisesRegex(ValueError, "QUALITY_POLICY_MISMATCH"):
            FUNCTIONS["build_timing_dataset"](self.source, changed)
        changed = copy.deepcopy(quality); changed["lists"]["include_candidate"].pop()
        with self.assertRaisesRegex(ValueError, "QUALITY_LIST_COUNT_MISMATCH"):
            FUNCTIONS["build_timing_dataset"](self.source, changed)
        self.source.write_text(self.source.read_text() + "\n")
        with self.assertRaisesRegex(ValueError, "QUALITY_SOURCE_MISMATCH"):
            FUNCTIONS["build_timing_dataset"](self.source, quality)

    def test_source_changes_and_empty_splits_fail(self):
        quality = self.prepare()
        real_hash = FUNCTIONS["sha256_file"]
        calls = 0
        def changed(path):
            nonlocal calls
            calls += 1
            return real_hash(path) if calls == 1 else "changed"
        with patch.dict(FUNCTIONS, {"sha256_file": changed}):
            with self.assertRaisesRegex(ValueError, "SOURCE_CHECKSUM_CHANGED"):
                FUNCTIONS["build_timing_dataset"](self.source, quality)
        events = copy.deepcopy(self.events)
        for event in events:
            if event.get("eventType") == "placement_decision":
                event["inputSequence"][0]["action"] = "hold"
        with self.assertRaisesRegex(ValueError, "SPLIT_WITHOUT_PAIRS"):
            self.build(events)

    def test_unsupported_geometry_and_pair_contract_errors_are_not_silently_repaired(self):
        events = copy.deepcopy(self.events)
        unsupported_game = FUNCTIONS["split_games"]([f"game-{i}" for i in range(6)])["train"][0]
        for event in events:
            if event["gameId"] == unsupported_game and event["eventType"] == "placement_decision":
                event["boardBefore"] = [[None] * 10 for _ in range(40)]
        _, rejected, _, manifest = self.build(events)
        self.assertEqual(rejected[0]["reason"], "UNSUPPORTED_LOG_CONTRACT")
        self.assertEqual(manifest["observedHumanSegmentMetadata"]["geometry"]["40x10"], 5)
        meta = {"gameId": "g", "pieceIndex": 5, "line": 1}
        for change, expected in (({"pieceIndex": 6}, "PAIR_PIECE_MISMATCH"),
                                 ({"createdAt": -1}, "PAIR_TIMESTAMP_INVALID"),
                                 ({"sequence": 4}, "PAIR_SEQUENCE_NOT_ADJACENT")):
            with self.subTest(change=change):
                inputs = [action(), {**action("hard_drop", 2, 1120), **change}]
                rows, rejected = FUNCTIONS["extract_pairs"](inputs, meta, 1)
                self.assertEqual(rows, [])
                self.assertIn(expected, rejected[0]["reasons"])

    def test_publication_is_deterministic_and_existing_paths_are_preserved(self):
        quality = self.prepare()
        first = FUNCTIONS["build_timing_dataset"](self.source, quality)
        self.assertEqual(first, FUNCTIONS["build_timing_dataset"](self.source, quality))
        before = self.source.read_bytes()
        outputs = []
        for i in range(2):
            output = self.directory / f"run-{i}"
            manifest = FUNCTIONS["publish_dataset"](output, *first)
            outputs.append(output)
            for name, item in manifest["files"].items():
                self.assertEqual(FUNCTIONS["sha256_file"](output / name), item["sha256"])
                self.assertEqual((output / name).stat().st_size, item["bytes"])
        for path in outputs[0].iterdir():
            self.assertEqual(path.read_bytes(), (outputs[1] / path.name).read_bytes())
        with self.assertRaises(FileExistsError):
            FUNCTIONS["publish_dataset"](outputs[0], *first)
        self.assertEqual(self.source.read_bytes(), before)
        symlink = self.directory / "alias"; symlink.symlink_to(self.source)
        for path in (self.source, symlink, self.directory / "missing/../other"):
            with self.assertRaises(ValueError):
                FUNCTIONS["checked_dataset_output"](ROOT, path, "smoke")
        dangling = self.directory / "dangling"; dangling.symlink_to(self.directory / "absent")
        with self.assertRaisesRegex(ValueError, "OUTPUT_ALREADY_EXISTS_OR_SYMLINK"):
            FUNCTIONS["checked_dataset_output"](ROOT, dangling, "smoke")
        fake_root = self.directory / "root"
        (fake_root / "data").mkdir(parents=True)
        (fake_root / "data/datasets").symlink_to(self.directory, target_is_directory=True)
        with self.assertRaisesRegex(ValueError, "FULL_DATASET_LOCATION_NOT_ALLOWED"):
            FUNCTIONS["checked_dataset_output"](fake_root, "data/datasets/human-timing-v1-escape", "full")

    def test_tables_and_graph_render_without_mutating_samples(self):
        import matplotlib
        matplotlib.use("Agg")
        import matplotlib.pyplot as plt
        rows, _, _, manifest = self.build()
        before = copy.deepcopy((rows, manifest))
        namespace = {**FUNCTIONS, "rows": rows, "manifest": manifest}
        cell = next(c for c in BOOK["cells"] if c["id"] == "show-tables")
        with redirect_stdout(io.StringIO()), patch("IPython.display.display"), patch.object(plt, "show", side_effect=lambda: plt.gcf().canvas.draw()):
            exec(compile("".join(cell["source"]), str(NOTEBOOK), "exec"), namespace)
        self.assertEqual((rows, manifest), before)
        self.assertEqual(namespace["split_table"]["pairs"].sum(), len(rows))
        self.assertEqual(plt.get_fignums(), [])


if __name__ == "__main__":
    unittest.main()
