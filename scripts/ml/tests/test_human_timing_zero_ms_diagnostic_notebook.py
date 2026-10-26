"""Synthetic checks for the notebook; authored only, not executed by the agent."""

import copy
import json
from pathlib import Path
import unittest


ROOT = Path(__file__).resolve().parents[3]
NOTEBOOK = ROOT / "scripts/ml/notebooks/human_timing_zero_ms_diagnostic.ipynb"
BOOK = json.loads(NOTEBOOK.read_text(encoding="utf-8"))
FUNCTIONS = {"__name__": "zero_ms_diagnostic_test"}
for cell in BOOK["cells"]:
    if cell["cell_type"] == "code" and "definitions" in cell["metadata"].get("tags", []):
        exec(compile("".join(cell["source"]), str(NOTEBOOK), "exec"), FUNCTIONS)


def recorded_input(sequence=1, tick=10, time=1000, action="move_left", piece=1):
    return {"action": action, "pieceIndex": piece, "sequence": sequence, "tick": tick, "createdAt": time}


class HumanZeroMsDiagnosticTest(unittest.TestCase):
    def diagnose(self, items):
        payload = {"inputSequence": items}
        before = copy.deepcopy(payload)
        result = FUNCTIONS["diagnose_segment"](payload, {"gameId": "synthetic", "pieceIndex": 1, "line": 1}, 1)
        self.assertEqual(payload, before)
        return result

    def test_notebook_is_unexecuted_and_reuses_parser(self):
        self.assertEqual(len({c["id"] for c in BOOK["cells"]}), len(BOOK["cells"]))
        text = "\n".join("".join(c["source"]) for c in BOOK["cells"])
        for number in range(1, 9):
            self.assertIn(f"# {number}.", text)
        for required in ("human_action_data_readiness.ipynb", "import pandas as pd", "import matplotlib.pyplot as plt", "causeStatus"):
            self.assertIn(required, text)
        self.assertNotIn("def normalize_event", text)
        self.assertNotIn("/Users/", text)
        for cell in BOOK["cells"]:
            if cell["cell_type"] == "code":
                self.assertIsNone(cell["execution_count"])
                self.assertEqual(cell["outputs"], [])

    def test_equal_timestamp_does_not_mean_equal_tick_or_duplicate_input(self):
        rows, summary = self.diagnose([recorded_input(), recorded_input(2, 11, 1000, "rotate"), recorded_input(3, 12, 1120, "hard_drop")])
        self.assertEqual([r["recordedDeltaMs"] for r in rows], [None, 0, 120])
        self.assertEqual(summary["zeroWithTickAdvance"], 1)
        self.assertEqual(summary["maxZeroRunPairs"], 1)
        self.assertEqual(summary["sequenceProblems"], 0)
        self.assertEqual(summary["repeatedRecordedInputFields"], 0)

    def test_zero_runs_do_not_cross_segment_boundaries(self):
        _, first = self.diagnose([recorded_input(), recorded_input(2, 11), recorded_input(3, 12)])
        _, second = self.diagnose([recorded_input(4, 13)])
        self.assertTrue(first["allInputTimesEqual"])
        self.assertEqual(first["maxZeroRunPairs"], 2)
        self.assertFalse(second["allInputTimesEqual"])
        self.assertEqual(second["validTimedPairs"], 0)

    def test_invalid_and_missing_values_are_not_filled_with_zero(self):
        rows, summary = self.diagnose([recorded_input(), {"action": [], "pieceIndex": 1}, None])
        self.assertEqual([r["recordedDeltaMs"] for r in rows], [None, None, None])
        self.assertEqual(rows[1]["action"], "invalid_or_missing")
        self.assertEqual(summary["zeroPairs"], 0)
        self.assertEqual(summary["sequenceProblems"], 2)
        self.assertEqual(summary["tickProblems"], 2)

    def test_reversals_piece_mismatch_and_repeated_fields_remain_diagnostics(self):
        rows, summary = self.diagnose([recorded_input(), recorded_input(3, 9, 900, piece=2)])
        self.assertEqual(rows[1]["recordedDeltaMs"], -100)
        self.assertFalse(rows[1]["pieceMatches"])
        self.assertEqual(summary["timeReversals"], 1)
        self.assertEqual(summary["sequenceProblems"], 1)
        self.assertEqual(summary["tickProblems"], 1)
        _, repeated = self.diagnose([recorded_input(), recorded_input()])
        self.assertEqual(repeated["repeatedRecordedInputFields"], 1)

    def test_controls_use_only_context_matched_train_games_in_id_order(self):
        manifest = {"cohort": {"selectedGameIds": ["target", "a", "b", "c", "d", "other", "validation"]},
                    "split": {"gameIds": {"train": ["other", "d", "c", "b", "a"], "validation": ["validation"], "test": ["target"]}}}
        quality = {"games": [{"gameId": game, "mode": "pve", "difficulty": "hard"} for game in ("target", "a", "b", "c", "d", "validation")]}
        quality["games"].append({"gameId": "other", "mode": "pve", "difficulty": "normal"})
        self.assertEqual(FUNCTIONS["select_games"](manifest, quality, "target"), ["target", "a", "b", "c"])
        with self.assertRaisesRegex(ValueError, "TARGET_NOT_IN_DATASET"):
            FUNCTIONS["select_games"](manifest, quality, "missing")


if __name__ == "__main__":
    unittest.main()
