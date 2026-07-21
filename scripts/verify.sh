#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

echo "[1/5] Checking Git diff..."
git diff --check

echo "[2/5] Type checking..."
npm run typecheck

echo "[3/5] Building application artifacts..."
npm run build

echo "[4/5] Verifying production artifacts..."
npm run test:artifact

echo "[5/5] Running tests..."
npm run test:compiled

echo "Verification passed."
