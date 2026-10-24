"""Execute notebook definitions against small audit fixtures, without a Jupyter kernel."""

import copy
import json
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch


ROOT = Path(__file__).resolve().parents[3]
NOTEBOOK = ROOT / "scripts/ml/notebooks/human_action_data_readiness.ipynb"
BOOK = json.loads(NOTEBOOK.read_text(encoding="utf-8"))
FUNCTIONS = {"__name__": "human_action_readiness_test"}
for cell in BOOK["cells"]:
    if cell["cell_type"] == "code" and "definitions" in cell["metadata"].get("tags", []):
        exec(compile("".join(cell["source"]), str(NOTEBOOK), "exec"), FUNCTIONS)


def action(name="move_left", sequence=1, timestamp=1000, piece=5):
    return {"action": name, "tick": sequence, "sequence": sequence,
            "createdAt": timestamp, "pieceIndex": piece}


def placement(game="game-001", piece=5, inputs=None, **extra):
    return {"eventType": "placement_decision", "schemaVersion": 2,
            "gameId": game, "playerId": "PRIVATE_PLAYER_SENTINEL", "pieceIndex": piece,
            "source": "human", "mode": "pve",
            "boardBefore": [[None] * 10 for _ in range(20)],
            "inputSequence": inputs if inputs is not None else
            [action(piece=piece), action("hard_drop", 2, 1120, piece)], **extra}


def lifecycle(kind, game="game-001"):
    return {"eventType": kind, "schemaVersion": 1, "gameId": game, "finishType": "normal"}


def db_row(event, event_id="event-1"):
    payload = copy.deepcopy(event)
    row = {"identity_version": "identity-v1", "event_id": event_id, "trust_level": "client_reported"}
    for inner, outer in {"eventType": "event_type", "schemaVersion": "schema_version",
                         "gameId": "game_id", "playerId": "player_id", "pieceIndex": "piece_index"}.items():
        row[outer] = payload.pop(inner, None)
    return {**row, "payload": payload}


class HumanActionReadinessTest(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.directory = Path(self.temporary.name)
        self.source = self.directory / "source.jsonl"

    def write(self, events):
        self.source.write_text("".join(json.dumps(e) + "\n" for e in events), encoding="utf-8")
        return self.source

    def inspect(self, inputs, lineage=()):
        return FUNCTIONS["inspect_segment"]({"inputSequence": inputs}, {"pieceIndex": 5}, lineage)

    def audit(self, events, mode="smoke"):
        return FUNCTIONS["audit_source"](self.write(events), "fixture.jsonl", mode)

    def test_notebook_contract_and_no_execution_side_effects(self):
        ids = [cell["id"] for cell in BOOK["cells"]]
        self.assertEqual(len(ids), len(set(ids)))
        markdown = "\n".join("".join(c["source"]) for c in BOOK["cells"] if c["cell_type"] == "markdown")
        for section in range(1, 11):
            self.assertIn(f"# {section}.", markdown)
        for cell in BOOK["cells"]:
            if cell["cell_type"] == "code":
                self.assertIsNone(cell["execution_count"])
                self.assertEqual(cell["outputs"], [])
        self.assertNotIn("/Users/", json.dumps(BOOK))
        self.assertEqual(BOOK["metadata"]["kernelspec"]["name"], "python3")

    def test_db_and_app_formats_and_envelope_conflict(self):
        event = placement()
        _, app, _, _ = FUNCTIONS["normalize_event"](event)
        _, db, _, trust = FUNCTIONS["normalize_event"](db_row(event))
        self.assertEqual(app, db)
        self.assertEqual(trust, "client_reported")
        conflict = db_row(event)
        conflict["payload"]["gameId"] = "different"
        with self.assertRaisesRegex(ValueError, "ENVELOPE_PAYLOAD_CONFLICT"):
            FUNCTIONS["normalize_event"](conflict)
        wrong_identity = db_row(event)
        wrong_identity["identity_version"] = 1
        with self.assertRaisesRegex(ValueError, "IDENTITY_VERSION_REQUIRED"):
            FUNCTIONS["normalize_event"](wrong_identity)

    def test_exact_duplicates_and_all_conflicting_rows_are_rebucketed(self):
        first = placement()
        changed = placement(inputs=[action("hold")])
        self.write([first, first, changed, placement(game="game-002"), placement(game="game-002")])
        report = FUNCTIONS["scan_source"](self.source)
        self.assertEqual(report["counts"]["identityConflictRows"], 3)
        self.assertEqual(report["counts"]["exactDuplicate"], 1)
        self.assertEqual(report["counts"]["uniqueValid"], 1)
        self.assertEqual(report["humanCount"], 1)

    def test_distinct_ids_for_same_piece_mark_lineage_problem(self):
        report = self.audit([db_row(placement(), "first"), db_row(placement(), "second")])
        self.assertEqual(report["detail"]["readiness"]["logged_inter_action_timing"]["unusable"], 2)
        self.assertEqual(report["detail"]["reasonCounts"]["DUPLICATE_PIECE"], 2)

    def test_malformed_json_and_nonfinite_are_counted_not_published_as_numbers(self):
        self.source.write_bytes(b'\n{\n{"x":NaN}\n{"x":1e999}\n' +
                                (json.dumps(placement()) + "\n").encode())
        report = FUNCTIONS["audit_source"](self.source, "fixture.jsonl")
        self.assertEqual(report["sourceScan"]["counts"]["blank"], 1)
        self.assertEqual(report["sourceScan"]["counts"]["parse_failure"], 3)
        self.assertEqual(report["detail"]["counts"]["humanSegments"], 1)

    def test_missing_and_empty_inputs_are_not_treated_as_successful_sequences(self):
        event = placement()
        event.pop("inputSequence")
        report = self.audit([event, placement(piece=6, inputs=[])])
        self.assertEqual(report["detail"]["readiness"]["logged_inter_action_timing"]["unusable"], 2)
        self.assertIn("INPUT_SEQUENCE_MISSING_OR_INVALID", report["detail"]["reasonCounts"])
        self.assertIn("INPUT_SEQUENCE_EMPTY", report["detail"]["reasonCounts"])

    def test_timing_zero_missing_reversal_and_sequence_order(self):
        zero = self.inspect([action(), action("hard_drop", 2, 1000)])
        self.assertEqual(zero["intervals"], [0])
        self.assertEqual(zero["readiness"]["logged_inter_action_timing"], "usable")
        missing = action()
        missing.pop("createdAt")
        self.assertEqual(self.inspect([missing, action("hard_drop", 2)])["readiness"]["logged_inter_action_timing"], "unverified")
        for inputs in ([action(), action("hard_drop", 2, 900)],
                       [action(), action("hard_drop", 1, 1200)]):
            self.assertEqual(self.inspect(inputs)["readiness"]["logged_inter_action_timing"], "unusable")
        no_sequence = action()
        no_sequence.pop("sequence")
        self.assertEqual(self.inspect([no_sequence, action("hard_drop", 2, 1200)])["readiness"]["logged_inter_action_timing"], "limited")

    def test_invalid_action_and_piece_mismatch(self):
        for bad in (None, {**action(), "action": []}, action(piece=6)):
            result = self.inspect([action(), bad])
            self.assertEqual(result["readiness"]["logged_inter_action_timing"], "unusable")
        with self.assertRaisesRegex(ValueError, "UNSUPPORTED_SCHEMA"):
            FUNCTIONS["normalize_event"](placement(schemaVersion=True))

    def test_hold_empty_swap_same_type_and_unverified_or_failed_outcomes(self):
        for slot in (None, "bar", "ess"):
            event = placement(inputs=[action("hold"), action("hard_drop", 2, 1200)], holdPiece=slot)
            result = FUNCTIONS["inspect_segment"](event, {"pieceIndex": 5})
            self.assertEqual(result["counts"]["holdAttempts"], 1)
            self.assertEqual(result["counts"]["holdOutcomeUnknown"], 1)
            self.assertEqual(result["readiness"]["hold_decision"], "unverified")
        for applied, bucket in ((False, "holdReportedAppliedFalse"), (True, "holdReportedAppliedTrue")):
            result = self.inspect([{**action("hold"), "applied": applied}])
            self.assertEqual(result["counts"][bucket], 1)
            self.assertEqual(result["readiness"]["hold_decision"], "unverified")

    def test_piece_gap_is_unknown_and_incomplete_game_is_not_blanket_rejected(self):
        report = self.audit([lifecycle("game_start"), placement(), placement(piece=8)])
        self.assertFalse(report["cohort"]["games"]["game-001"]["completeNormal"])
        self.assertEqual(report["detail"]["counts"]["humanSegments"], 2)
        self.assertEqual(report["detail"]["reasonCounts"]["PIECE_GAP"], 1)
        self.assertIn("piece_gap_cause_unknown", report["limits"])

    def test_mixed_rulesets_are_not_silently_combined(self):
        first = placement(gameplayRulesVersion="legacy20-v1")
        second = placement(piece=6, schemaVersion=3, gameplayRulesVersion="buffer20-v1",
                           boardBefore=[[None] * 10 for _ in range(40)])
        report = self.audit([first, second])
        self.assertTrue(report["cohort"]["games"]["game-001"]["mixedRuleset"])
        self.assertEqual(report["detail"]["readiness"]["logged_inter_action_timing"]["unusable"], 2)

    def test_smoke_selection_and_full_invariants_use_same_auditor(self):
        events = [placement(game=f"game-{i:03d}") for i in range(6)]
        events[-1]["inputSequence"] = [action("hold")]
        smoke = self.audit(events)
        self.assertEqual(smoke["cohort"]["gameIds"], ["game-000", "game-001", "game-002", "game-005"])
        self.assertEqual(smoke["detail"]["counts"]["humanSegments"], 4)
        self.assertFalse(smoke["fullCohortCovered"])
        full = self.audit(events, "full")
        self.assertEqual(full["detail"]["counts"]["humanSegments"], 6)
        self.assertTrue(full["dataDecisionEligible"])
        self.assertFalse(full["policyDecisionEligible"])
        self.assertEqual(full["modelFitCount"], 0)
        self.assertEqual(full["replayStatus"], "unverified")

    def test_report_is_deterministic_and_has_no_raw_identity_or_wall_clock(self):
        self.write([placement()])
        one = FUNCTIONS["audit_source"](self.source, "fixture.jsonl")
        two = FUNCTIONS["audit_source"](self.source, "fixture.jsonl")
        self.assertEqual(FUNCTIONS["json_bytes"](one), FUNCTIONS["json_bytes"](two))
        text = json.dumps(one)
        self.assertNotIn("PRIVATE_PLAYER_SENTINEL", text)
        self.assertNotIn('"createdAt"', text)
        self.assertNotIn(str(self.directory), text)

    def test_source_mutation_prevents_report(self):
        self.write([placement()])
        calls = iter(("before", "after"))
        with patch.dict(FUNCTIONS, {"sha256_file": lambda _: next(calls)}):
            with self.assertRaisesRegex(ValueError, "SOURCE_CHECKSUM_CHANGED"):
                FUNCTIONS["audit_source"](self.source, "fixture.jsonl")

    def test_output_rejects_existing_source_hardlink_and_symlink_aliases(self):
        root = self.directory / "repo"
        root.mkdir()
        (root / "source.jsonl").write_text("{}")
        source = root / "source.jsonl"
        outputs = [source, self.directory / "hardlink.json", self.directory / "symlink.json",
                   self.directory / "dangling.json"]
        os.link(source, outputs[1])
        outputs[2].symlink_to(source)
        outputs[3].symlink_to(self.directory / "missing")
        for output in outputs:
            with self.assertRaises(ValueError):
                FUNCTIONS["checked_paths"](root, "source.jsonl", output, "smoke")
        with self.assertRaises(ValueError):
            FUNCTIONS["checked_paths"](root, "source.jsonl", root / "new.json", "smoke")
        for name in (str(source), "../source.jsonl"):
            with self.assertRaises(ValueError):
                FUNCTIONS["checked_paths"](root, name, self.directory / "new.json", "smoke")

    def test_atomic_publication_never_overwrites_concurrent_destination(self):
        output = self.directory / "report.json"
        FUNCTIONS["publish_report"]({"valid": True}, output)
        self.assertEqual(json.loads(output.read_text()), {"valid": True})
        with self.assertRaises(ValueError):
            FUNCTIONS["publish_report"]({"valid": False}, output)
        self.assertEqual(json.loads(output.read_text()), {"valid": True})
        self.assertEqual(list(self.directory.glob(".human-action-*")), [])


if __name__ == "__main__":
    unittest.main()
