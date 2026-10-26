"""Inspect the notebook and execute its definitions; do not duplicate the audit implementation."""

import copy
from contextlib import redirect_stdout
import io
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

from scripts.ml.tests.test_human_action_data_readiness_notebook import action, placement, db_row


ROOT = Path(__file__).resolve().parents[3]
NOTEBOOK = ROOT / "scripts/ml/notebooks/human_game_quality_audit.ipynb"
BOOK = json.loads(NOTEBOOK.read_text(encoding="utf-8"))
FUNCTIONS = {"__name__": "human_game_quality_test"}
for cell in BOOK["cells"]:
    if cell["cell_type"] == "code" and "definitions" in cell["metadata"].get("tags", []):
        exec(compile("".join(cell["source"]), str(NOTEBOOK), "exec"), FUNCTIONS)


def game_events(game="g-001", seconds=90, only_drop=False, pieces=5, mode="pve", winner="PRIVATE_PLAYER_SENTINEL"):
    start = {"eventType": "game_start", "schemaVersion": 1, "gameId": game,
             "mode": mode, "startedAt": 0}
    end = {"eventType": "game_over", "schemaVersion": 1, "gameId": game,
           "mode": mode, "endedAt": seconds * 1000, "finishType": "normal", "winnerPlayerId": winner}
    rows = []
    for piece in range(pieces):
        inputs = [action("hard_drop", piece + 1, 1000 + piece, piece)] if only_drop else [
            action("move_left", piece * 2 + 1, 1000 + piece * 200, piece),
            action("hard_drop", piece * 2 + 2, 1120 + piece * 200, piece)]
        rows.append(placement(game, piece, inputs=inputs, mode=mode, createdAt=2000 + piece * 200))
    return [start, *rows, end]


class HumanGameQualityTest(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.directory = Path(self.temporary.name)
        self.source = self.directory / "source.jsonl"

    def write(self, rows):
        self.source.write_text("".join(json.dumps(row) + "\n" for row in rows), encoding="utf-8")
        return self.source

    def audit(self, rows, mode="full", policy=None):
        return FUNCTIONS["audit_game_quality"](self.write(rows), "fixture.jsonl", mode, policy)

    def test_notebook_contract_and_shared_implementation(self):
        ids = [c["id"] for c in BOOK["cells"]]
        self.assertEqual(len(ids), len(set(ids)))
        text = "\n".join("".join(c["source"]) for c in BOOK["cells"])
        for section in range(1, 11):
            self.assertIn(f"# {section}.", text)
        self.assertIn("human_action_data_readiness.ipynb", text)
        self.assertNotIn("def normalize_event", text)
        self.assertNotIn("/Users/", text)
        self.assertEqual(BOOK["metadata"]["kernelspec"]["name"], "python3")
        for cell in BOOK["cells"]:
            if cell["cell_type"] == "code":
                self.assertIsNone(cell["execution_count"])
                self.assertEqual(cell["outputs"], [])

    def test_all_event_metadata_is_internal_and_identity_deduplicated(self):
        rows = game_events()
        rows.insert(2, copy.deepcopy(rows[1]))
        index = FUNCTIONS["scan_source"](self.write(rows))
        self.assertEqual(len(index["allValidByLine"]), 7)
        self.assertEqual(index["counts"]["exactDuplicate"], 1)
        report = self.audit(rows)
        self.assertEqual(report["summary"]["humanSegments"], 5)
        self.assertNotIn("allValidByLine", report["sourceScan"])

    def test_pandas_tables_and_matplotlib_render_without_changing_report(self):
        import matplotlib
        matplotlib.use("Agg")
        import matplotlib.pyplot as plt

        cell = next(c for c in BOOK["cells"] if c["id"] == "show-tables")
        text = "".join(cell["source"])
        self.assertIn("import pandas as pd", text)
        self.assertIn("import matplotlib.pyplot as plt", text)
        scenarios = [game_events(), game_events(seconds=15, only_drop=True), game_events()[:-1]]
        for rows in scenarios:
            with self.subTest(rows=len(rows)):
                report = self.audit(rows)
                before = copy.deepcopy(report)
                namespace = {"report": report}
                with redirect_stdout(io.StringIO()), patch("IPython.display.display") as display, patch.object(
                    plt, "show", side_effect=lambda: plt.gcf().canvas.draw()
                ) as show:
                    exec(compile(text, str(NOTEBOOK), "exec"), namespace)
                self.assertEqual(report, before)
                self.assertEqual(namespace["classification_table"]["games"].sum(), len(report["games"]))
                self.assertAlmostEqual(namespace["classification_table"]["percent"].sum(), 100)
                self.assertEqual(len(namespace["review_table"]), report["summary"]["classificationCounts"]["review"])
                self.assertEqual(len(namespace["durations"]), sum(g["durationSeconds"] is not None for g in report["games"]))
                self.assertEqual(namespace["outcome_table"].to_numpy().sum(), sum(len(g["humanPlayers"]) for g in report["games"]))
                self.assertEqual(display.call_count, 6)
                self.assertEqual(show.call_count, 1)
                self.assertEqual(plt.get_fignums(), [])

    def test_pve_human_loss_is_kept_without_training_on_ai(self):
        rows = game_events(winner="AI_SENTINEL")
        rows.insert(-1, placement(piece=50, game="g-001", source="heuristic_ai",
                                  playerId="AI_SENTINEL", createdAt=3000, aiDifficulty="hard"))
        report = self.audit(rows)
        game = report["games"][0]
        self.assertEqual(game["status"], "include_candidate")
        self.assertEqual(game["aiPlacementCount"], 1)
        self.assertEqual(len(game["humanPlayers"]), 1)
        self.assertEqual(game["humanPlayers"][0]["outcome"], "loss")
        self.assertEqual(report["summary"]["humanSegments"], 5)

    def test_pvp_both_players_and_mode_aliases(self):
        for mode in ("multi", "multiplayer", "pvp"):
            with self.subTest(mode=mode):
                rows = game_events(mode=mode)
                second = copy.deepcopy(rows[1:6])
                for row in second:
                    row["playerId"] = "OTHER_PRIVATE_PERSON"
                report = self.audit([*rows[:-1], *second, rows[-1]])
                game = report["games"][0]
                self.assertEqual(game["mode"], "pvp")
                self.assertEqual(game["status"], "include_candidate")
                self.assertEqual(sorted(p["outcome"] for p in game["humanPlayers"]), ["loss", "win"])
                self.assertEqual(report["summary"]["humanSegments"], 10)

    def test_short_normal_and_abandonment_boundary(self):
        normal = self.audit(game_events(seconds=15))["games"][0]
        self.assertEqual(normal["status"], "include_candidate")
        for seconds, pieces, expected in ((15, 5, "review"), (15, 4, "include_candidate"), (30, 5, "include_candidate")):
            with self.subTest(seconds=seconds, pieces=pieces):
                row = self.audit(game_events(seconds=seconds, only_drop=True, pieces=pieces))["games"][0]
                self.assertEqual(row["status"], expected)
                self.assertEqual("EARLY_ABANDONMENT_SUSPECTED" in row["reasons"], expected == "review")

    def test_piece_gap_and_non_drop_break_abandonment_tail(self):
        rows = game_events(seconds=15, only_drop=True, pieces=5)
        rows[3]["pieceIndex"] = 20
        rows[3]["inputSequence"][0]["pieceIndex"] = 20
        row = self.audit(rows)["games"][0]
        self.assertNotIn("EARLY_ABANDONMENT_SUSPECTED", row["reasons"])
        rows = game_events(seconds=15, only_drop=True, pieces=5)
        rows[-2]["inputSequence"] = [action("move_left", 20, 5000, 4)]
        row = self.audit(rows)["games"][0]
        self.assertEqual(row["humanPlayers"][0]["endingHardDropTail"]["pieces"], 0)

    def test_long_game_strict_boundary(self):
        self.assertEqual(self.audit(game_events(seconds=600))["games"][0]["status"], "include_candidate")
        row = self.audit(game_events(seconds=600.001))["games"][0]
        self.assertEqual(row["status"], "exclude_candidate")
        self.assertIn("ABNORMAL_LONG_GAME", row["reasons"])

    def test_missing_duplicate_reversed_lifecycle_and_non_normal_finish(self):
        cases = []
        rows = game_events(); cases.append(rows[:-1])
        rows = game_events(); rows[-1]["endedAt"] = 0; cases.append(rows)
        rows = game_events(); rows[-1]["finishType"] = "disconnect"; cases.append(rows)
        rows = game_events(); rows[0]["startedAt"] = None; cases.append(rows)
        rows = game_events(); extra = copy.deepcopy(rows[0]); extra["startedAt"] = 1; cases.append([*rows, extra])
        for rows in cases:
            with self.subTest(rows=len(rows)):
                row = self.audit(rows)["games"][0]
                self.assertEqual(row["status"], "review")

    def test_db_timestamps_require_timezone_and_do_not_use_ingestion(self):
        event = {"eventType": "game_start"}
        fn = FUNCTIONS["event_time_ms"]
        self.assertEqual(fn({"event_type": "game_start", "occurred_at": "1970-01-01T00:00:00Z"}, event, {}), 0)
        self.assertIsNone(fn({"event_type": "game_start", "occurred_at": "2026-01-01", "ingested_at": "2026-01-01T00:00:00Z"}, event, {}))
        rows = [db_row(row, f"event-{i}") for i, row in enumerate(game_events())]
        for row in rows:
            row["ingested_at"] = "2026-01-01T00:00:00Z"
        report = self.audit(rows)
        self.assertIsNone(report["games"][0]["durationSeconds"])
        self.assertIn("GAME_DURATION_UNVERIFIED", report["games"][0]["reasons"])

    def test_ai_tail_uses_ai_span_not_human_clock_and_is_only_suspected(self):
        for span, suspected in ((60, False), (60.001, True)):
            with self.subTest(span=span):
                rows = game_events(seconds=180)
                rows[-2]["createdAt"] = 10**14
                for i, time in enumerate((100000, 100000 + span * 1000)):
                    rows.insert(-1, placement(game="g-001", piece=100 + i, playerId="AI_SENTINEL",
                                              source="heuristic_ai", createdAt=time))
                row = self.audit(rows)["games"][0]
                self.assertAlmostEqual(row["aiTailObservedSpanSeconds"], span)
                self.assertEqual("AI_ONLY_CONTINUATION_SUSPECTED" in row["reasons"], suspected)
                self.assertNotIn("AI_ONLY_CONTINUATION_CONFIRMED", row["reasons"])

    def test_ai_only_incomplete_game_is_not_human_training_data(self):
        rows = game_events()
        rows = [rows[0], *[dict(row, source="heuristic_ai") for row in rows[1:-1]]]
        row = self.audit(rows)["games"][0]
        self.assertEqual(row["status"], "exclude_candidate")
        self.assertIn("NO_HUMAN_DATA", row["reasons"])
        self.assertIsNone(row["durationSeconds"])

    def test_source_conflicts_and_parse_errors_prevent_include_candidates(self):
        rows = game_events()
        changed = copy.deepcopy(rows[1]); changed["inputSequence"] = [action("hold", piece=0)]
        report = self.audit([*rows, changed])
        self.assertFalse(report["sourceContractValid"])
        self.assertEqual(report["status"], "source_contract_invalid")
        self.assertNotIn("include_candidate", [r["status"] for r in report["games"]])
        self.write(game_events())
        with self.source.open("a", encoding="utf-8") as handle:
            handle.write("{broken\n")
        report = FUNCTIONS["audit_game_quality"](self.source, "fixture.jsonl", "full")
        self.assertFalse(report["sourceContractValid"])

    def test_policy_rejects_unknown_nonfinite_bool_and_bad_bounds(self):
        base = FUNCTIONS["DRAFT_POLICY"]
        for changes in ({"other": 1}, {"maxGameDurationSeconds": float("inf")},
                        {"shortGameReviewSeconds": True}, {"shortGameReviewSeconds": 0},
                        {"shortGameReviewSeconds": 601}, {"abandonmentTailMinPieces": 1},
                        {"abandonmentTailMinPieces": 2.5}):
            with self.subTest(changes=changes), self.assertRaises(ValueError):
                FUNCTIONS["validate_policy"]({**base, **changes})

    def test_smoke_full_cohort_counts_and_no_approval(self):
        rows = sum((game_events(game=f"g-{i}") for i in range(5)), [])
        rows.append(placement(game="ai-only", source="heuristic_ai"))
        smoke = self.audit(rows, "smoke")
        self.assertEqual(smoke["cohort"]["gameIds"], ["ai-only", "g-0", "g-1", "g-2"])
        self.assertFalse(smoke["fullCohortCovered"])
        full = self.audit(rows)
        self.assertEqual(len(full["games"]), 6)
        self.assertEqual(sum(full["summary"]["classificationCounts"].values()), 6)
        self.assertTrue(full["fullCohortCovered"])
        self.assertTrue(full["qualityReviewComplete"])
        for flag in ("dataDecisionEligible", "policyDecisionEligible", "canonicalResultEligible", "datasetExported"):
            self.assertFalse(full[flag])
        self.assertEqual(full["modelFitCount"], 0)
        self.assertEqual(full["policyStatus"], "provisional_review_only")

    def test_determinism_privacy_and_input_preservation(self):
        rows = game_events(mode="PRIVATE_MODE_SENTINEL")
        first = self.audit(rows)
        before = self.source.read_bytes()
        second = FUNCTIONS["audit_game_quality"](self.source, "fixture.jsonl", "full")
        encode = FUNCTIONS["shared"]["json_bytes"]
        self.assertEqual(encode(first), encode(second))
        self.assertEqual(before, self.source.read_bytes())
        serialized = encode(first).decode()
        for sentinel in ("PRIVATE_PLAYER_SENTINEL", "PRIVATE_MODE_SENTINEL", str(self.directory)):
            self.assertNotIn(sentinel, serialized)

    def test_source_and_dependency_mutation_stop_publication(self):
        self.write(game_events())
        original = FUNCTIONS["sha256_file"]
        for target, error in ((self.source, "SOURCE_CHECKSUM_CHANGED"), (FUNCTIONS["DEPENDENCY"], "DEPENDENCY_CHECKSUM_CHANGED")):
            calls = 0
            def changed(path):
                nonlocal calls
                if Path(path) == target:
                    calls += 1
                    if calls > 1:
                        return "changed"
                return original(path)
            with self.subTest(target=target.name), patch.dict(FUNCTIONS, {"sha256_file": changed}):
                with self.assertRaisesRegex(ValueError, error):
                    FUNCTIONS["audit_game_quality"](self.source, "fixture.jsonl", "full")

    def test_output_scope_and_no_overwrite(self):
        root = self.directory
        source = root / "source.json"
        source.write_text("[]", encoding="utf-8")
        evidence = root / "data/ml-experiments/human-game-quality-audit"
        evidence.mkdir(parents=True)
        output = evidence / "report.json"
        checked = FUNCTIONS["checked_paths"]
        self.assertEqual(checked(root, "source.json", str(output), "smoke"), (source.resolve(), output.resolve()))
        FUNCTIONS["publish_report"]({"test": True}, output)
        before = output.read_bytes()
        with self.assertRaises(ValueError):
            checked(root, "source.json", str(output), "full")
        with self.assertRaises(ValueError):
            checked(root, "source.json", str(source), "full")
        link = evidence / "link.json"
        link.symlink_to(source)
        with self.assertRaises(ValueError):
            checked(root, "source.json", str(link), "full")
        self.assertEqual(output.read_bytes(), before)


if __name__ == "__main__":
    unittest.main()
