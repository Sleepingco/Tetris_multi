#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

echo "[1/4] Checking Git diff..."
git diff --check

echo "[2/4] Type checking..."
npm run typecheck

echo "[3/4] Building client..."
npm run build

echo "[4/4] Running tests..."
npm test

echo "Verification passed."
