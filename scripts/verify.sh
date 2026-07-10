#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

echo "[1/2] Checking Git diff..."
git diff --check

echo "[2/2] Running tests..."
npm test

echo "Verification passed."
