"""V4 학습기의 feature·pair weight·결정적 artifact와 atomic I/O를 검증한다.

각 테스트는 임시 JSONL dataset을 준비해 occupied-cell class grouping과 decision별 weight를
확인하고 같은 입력의 model/report byte를 비교한다. 잘못된 JSON, 유한하지 않은 수, 경로 alias나
두 번째 replace 실패가 발생해도 기존 model/report artifact는 보존되어야 한다.
"""

import hashlib
import json
import os
import tempfile
import unittest
from pathlib import Path
from unittest import mock

import numpy as np

from scripts.ml import train_placement_v4 as trainer


class PlacementV4TrainerTest(unittest.TestCase):
    def candidate(
        self,
        game_id,
        difficulty,
        selected,
        rotation,
        anchor_col,
        cells,
        feature_seed,
    ):
        return {
            "datasetSchemaVersion": 2,
            "gameId": game_id,
            "playerId": f"human-{game_id}",
            "pieceIndex": 5,
            "source": "human",
            "aiDifficulty": difficulty,
            "candidatePlacement": {
                "pieceType": "tee",
                "rotation": rotation,
                "row": 10,
                "col": anchor_col,
                "cells": [{"row": row, "col": col} for row, col in cells],
            },
            "metricDelta": {
                "aggregateHeight": feature_seed,
                "maxHeight": feature_seed % 3,
                "holes": feature_seed % 2,
                "bumpiness": feature_seed + 1,
                "columnHeights": [feature_seed + index for index in range(10)],
            },
            "candidateResult": {"linesCleared": feature_seed % 2, "gameOver": False},
            "selectedBySource": selected,
            "metadata": {"isWinner": game_id == "game-a", "finishType": "normal"},
        }

    def write_fixture(self, root):
        dataset = root / "dataset"
        dataset.mkdir()
        selected_cells = [(10, 0), (10, 1), (10, 2), (11, 1)]
        rows = {
            "train.jsonl": [
                self.candidate("game-a", "normal", True, 0, 0, selected_cells, 1),
                self.candidate("game-a", "normal", False, 2, 1, selected_cells, 1),
                self.candidate("game-a", "normal", False, 0, 3, [(10, 3), (10, 4), (10, 5), (11, 4)], 3),
            ],
            "validation.jsonl": [
                self.candidate("game-b", "hard", True, 0, 0, selected_cells, 2),
                self.candidate("game-b", "hard", False, 0, 4, [(10, 4), (10, 5), (10, 6), (11, 5)], 4),
                self.candidate("game-b", "hard", False, 2, 5, [(10, 4), (10, 5), (10, 6), (11, 5)], 4),
            ],
        }
        for name, values in rows.items():
            (dataset / name).write_text(
                "".join(json.dumps(value, separators=(",", ":")) + "\n" for value in values),
                encoding="utf-8",
            )
        (dataset / "rejected.jsonl").write_text("", encoding="utf-8")
        manifest = {
            "datasetSchemaVersion": 2,
            "inputSha256": "0" * 64,
            "selectionPolicy": "all-completed",
            "sourceFilter": "human",
            "jsonParseFailureCount": 0,
            "trainGameCount": 1,
            "validationGameCount": 1,
            "acceptedPlacementLogCount": 2,
            "trainSampleCount": 3,
            "validationSampleCount": 3,
            "acceptedPlacementLogCountByAiDifficulty": {"normal": 1, "hard": 1},
        }
        (dataset / "manifest.json").write_text(
            json.dumps(manifest, sort_keys=True) + "\n",
            encoding="utf-8",
        )
        return dataset

    def simple_artifacts(self):
        model = {"canonicalArtifact": False, "productionIntegration": False}
        report = {
            "modelArtifact": {"modelSha256": hashlib.sha256(trainer.json_bytes(model)).hexdigest()},
            "productionIntegration": False,
        }
        return model, report

    def test_feature_order_and_v4_pair_weight_contract(self):
        self.assertEqual(len(trainer.FEATURE_NAMES), 16)
        with tempfile.TemporaryDirectory() as temporary:
            dataset = self.write_fixture(Path(temporary))
            inspection = trainer.inspect_dataset(dataset, expected_checksums=None, expected_counts=None)
            candidates = trainer.load_training_candidates(dataset, set(inspection["gameIds"]))
            decisions = trainer.group_candidates(candidates)
            raw = np.asarray([candidate["features"] for candidate in candidates])
            scaler = trainer.StandardScaler().fit(raw)
            transformed = scaler.transform(raw)
            scaled = {
                (candidate["decisionKey"], candidate["placementKey"]): transformed[index]
                for index, candidate in enumerate(candidates)
            }
            pairs, pairless = trainer.create_v4_pairs(decisions, scaled)
            _, _, weights, totals = trainer.symmetric_samples(pairs)

            self.assertEqual(pairless, [])
            self.assertEqual(len(pairs), 2)
            self.assertAlmostEqual(float(weights.sum()), 2.0)
            self.assertEqual(totals, {key: 1.0 for key in decisions})

    def test_fixture_training_is_byte_deterministic_and_has_no_leakage_metadata(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            dataset = self.write_fixture(root)
            first = root / "first"
            second = root / "second"
            trainer.train_and_write(dataset, first, 2, expected_checksums=None, expected_counts=None)
            trainer.train_and_write(dataset, second, 2, expected_checksums=None, expected_counts=None)

            for name in ("model.json", "training-report.json"):
                self.assertEqual((first / name).read_bytes(), (second / name).read_bytes())
                text = (first / name).read_text(encoding="utf-8")
                self.assertNotIn(str(root), text)
                self.assertNotIn("timestamp", text.lower())
            model = json.loads((first / "model.json").read_text(encoding="utf-8"))
            report = json.loads((first / "training-report.json").read_text(encoding="utf-8"))
            self.assertFalse(model["productionIntegration"])
            self.assertFalse(model["canonicalArtifact"])
            self.assertFalse(report["heldOutEvidence"])
            self.assertFalse(report["evaluationMetricsIncluded"])
            self.assertEqual(model["coefficients"], model["weights"])
            self.assertEqual(model["dataset"]["manifestInputSha256"], "0" * 64)
            self.assertEqual(model["trainingDiagnostics"]["convergenceWarningCount"], 0)
            self.assertEqual(model["trainingDiagnostics"]["unexpectedWarningCount"], 0)

    def test_output_exact_dotdot_symlink_and_hardlink_aliases_are_rejected(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            dataset = self.write_fixture(root)
            source = dataset / "train.jsonl"
            protected = [dataset / name for name in trainer.DATASET_FILES]
            model, report = self.simple_artifacts()
            safe_report = root / "report.json"

            with self.assertRaises(trainer.ContractError):
                trainer.write_artifacts_atomic(source, safe_report, model, report, protected)

            (dataset / "nested").mkdir()
            dotdot_alias = dataset / "nested" / ".." / "train.jsonl"
            with self.assertRaises(trainer.ContractError):
                trainer.write_artifacts_atomic(dotdot_alias, safe_report, model, report, protected)

            symlink_path = root / "symlink.json"
            symlink_path.symlink_to(source)
            with self.assertRaises(trainer.ContractError):
                trainer.write_artifacts_atomic(symlink_path, safe_report, model, report, protected)

            hardlink_path = root / "hardlink.json"
            os.link(source, hardlink_path)
            with self.assertRaises(trainer.ContractError):
                trainer.write_artifacts_atomic(hardlink_path, safe_report, model, report, protected)
            self.assertTrue(source.samefile(hardlink_path))

    def test_invalid_json_and_nonfinite_feature_preserve_existing_artifacts(self):
        for corruption in ("malformed", "nonfinite"):
            with self.subTest(corruption=corruption), tempfile.TemporaryDirectory() as temporary:
                root = Path(temporary)
                dataset = self.write_fixture(root)
                output = root / "output"
                output.mkdir()
                model_path = output / "model.json"
                report_path = output / "training-report.json"
                model_path.write_bytes(b"existing-model\n")
                report_path.write_bytes(b"existing-report\n")
                source = dataset / "train.jsonl"
                if corruption == "malformed":
                    source.write_text("{not json}\n", encoding="utf-8")
                else:
                    row = json.loads(source.read_text(encoding="utf-8").splitlines()[0])
                    row["metricDelta"]["holes"] = float("nan")
                    source.write_text(json.dumps(row) + "\n", encoding="utf-8")

                with self.assertRaises(trainer.ContractError):
                    trainer.train_and_write(dataset, output, 2, expected_checksums=None, expected_counts=None)
                self.assertEqual(model_path.read_bytes(), b"existing-model\n")
                self.assertEqual(report_path.read_bytes(), b"existing-report\n")

    def test_invalid_input_creates_no_partial_artifact(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            dataset = self.write_fixture(root)
            (dataset / "train.jsonl").write_text("{not json}\n", encoding="utf-8")
            output = root / "output"
            with self.assertRaises(trainer.ContractError):
                trainer.train_and_write(dataset, output, 2, expected_checksums=None, expected_counts=None)
            self.assertFalse((output / "model.json").exists())
            self.assertFalse((output / "training-report.json").exists())

    def test_second_replace_failure_restores_existing_artifacts(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            dataset = self.write_fixture(root)
            protected = [dataset / name for name in trainer.DATASET_FILES]
            output = root / "output"
            output.mkdir()
            model_path = output / "model.json"
            report_path = output / "training-report.json"
            model_path.write_bytes(b"existing-model\n")
            report_path.write_bytes(b"existing-report\n")
            model, report = self.simple_artifacts()
            real_replace = trainer.os.replace
            call_count = 0

            def fail_second_replace(source, destination):
                nonlocal call_count
                call_count += 1
                if call_count == 2:
                    raise OSError("simulated report replace failure")
                return real_replace(source, destination)

            with mock.patch.object(trainer.os, "replace", side_effect=fail_second_replace):
                with self.assertRaises(OSError):
                    trainer.write_artifacts_atomic(model_path, report_path, model, report, protected)
            self.assertEqual(model_path.read_bytes(), b"existing-model\n")
            self.assertEqual(report_path.read_bytes(), b"existing-report\n")

    def test_output_directory_cannot_be_inside_dataset(self):
        with tempfile.TemporaryDirectory() as temporary:
            dataset = self.write_fixture(Path(temporary))
            with self.assertRaises(trainer.ContractError):
                trainer.train_and_write(dataset, dataset / "artifact", 2, expected_checksums=None, expected_counts=None)


if __name__ == "__main__":
    unittest.main()
