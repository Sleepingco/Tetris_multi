#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

echo "[1/3] Checking Git diff..."
git diff --check

echo "[2/3] Running Node parity tests..."
node --test test/testPlacementParityBundle.js test/testPlacementEvaluation.js test/testPlacementPairwiseRanker.js

echo "[3/3] Running Python parity tests in conda env tetris-ml..."
conda run -n tetris-ml python -m unittest discover -s python_tests -p 'test_*.py'

echo "ML verification passed."
