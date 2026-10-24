# Placement Temporal Holdout V0/V4 — Full Analysis Record

경로 안내 (2026-10-24): 아래 실행 명령은 당시 기록이다. 현재 테스트 위치는
[scripts/ml/tests](../../scripts/ml/README.md)이며 `python_tests.<module>` 대신
`scripts.ml.tests.<module>`을 사용한다. 당시 결과·명령·checksum은 보존했다.

## Scope

- Worktree: `Tetris_multi-ai`
- Branch: `codex/python-sklearn-logo-evaluation`
- Worktree HEAD at full-run analysis: `5f607b500219bfdb3842452c76da54c084b98851`
- MODE: `analyze-result`
- Experiment: `ai-harness/ml-experiments/experiments/placement-temporal-holdout-v0-v4.md`
- Full report: `data/ml-experiments/placement-temporal-holdout-v0-v4/full-report.json`
- Executed Notebook: `data/ml-experiments/placement-temporal-holdout-v0-v4/full-executed.ipynb`

The report and executed Notebook are Git-ignored local evidence. They are not
canonical results and were not staged.

## Full-run evidence

The user executed the full Notebook once after the implement-smoke gate. The
analysis did not rerun model training.

```bash
PLACEMENT_TEMPORAL_SOURCE_LOG=../Tetris_multi/data/logs/game-events.jsonl \
PLACEMENT_TEMPORAL_CUMULATIVE_DATASET=data/datasets/human-behavior-v2-temporal-cumulative-75g-20260718 \
PLACEMENT_TEMPORAL_MAX_VALIDATION_GAMES=49 \
PLACEMENT_TEMPORAL_REPORT=/private/tmp/placement-temporal-holdout-full-report.json \
conda run -n tetris-ml python -m jupyter nbconvert --to notebook --execute \
  scripts/ml/notebooks/placement_temporal_holdout_v0_v4_experiment.ipynb \
  --output placement-temporal-holdout-full-executed.ipynb --output-dir /private/tmp \
  --ExecutePreprocessor.timeout=1200
```

After verification, the two full-run files were moved unchanged from
`/private/tmp` to the ignored local evidence directory above.

- Full report SHA-256: `95695c460f5885d199212b07792636b14bdfc9a524104e278bd1c43bac431732`
- Executed Notebook SHA-256: `9d9f1c6e4dced2ddd23d4a90205be6c9ac0f5bd0e426e3b31c9cea75b379f22e`
- Executed Notebook error outputs: `0`

## Contract verification

- `runMode: full`
- `fullCohortCovered: true`
- `policyDecisionEligible: true`
- `canonicalResultEligible: false`
- `productionIntegration: false`
- Base/new/evaluated games: `26 / 49 / 49`
- gameId leakage: `0`
- V0/V4 convergence warnings: `0 / 0`
- Source log SHA before/after:
  `44c53a3107b466b3917f28e30e1c7813e2933289a99fdfb2ab299761d7565961`
- Base and cumulative four-file checksums before/after: identical
- Compact validator result: `needs_policy_decision`, validation passed

The validator rechecked full flags, SHA-256 continuity, finite metrics,
per-game aggregation for raw/physical and all/choice-required metrics, pair
diagnostics, and output safety. It did not fit a model.

## Full result

Primary unit: choice-required occupied-cell physical class.

| Metric | V0 | V4 | V4 - V0 |
|---|---:|---:|---:|
| Decision count | 2,320 | 2,320 | 0 |
| Top-1 count | 1,314 | 1,315 | +1 |
| Top-3 count | 2,025 | 2,025 | 0 |
| MRR | 0.7263681329 | 0.7265167713 | +0.0001486385 |
| Mean selected rank | 2.0965517241 | 2.0961206897 | -0.0004310345 |

Game-level MRR distribution: V4 better `3`, equal `43`, worse `3`.

The largest V4 improvement was `+0.0106382979` MRR for a 47-decision game.
The largest regression was `-0.0027777778` MRR for a 60-decision game. Only
seven physical-class selected ranks changed across the full cohort.

## Lead decision

`adopt_v4`

This is a policy decision made with the full cohort evidence and V4's
alias-independent occupied-cell semantics. It is not an automatic threshold
decision and does not imply production promotion, final trainer creation, or
runtime/PVE integration.

## Next gate

Before the next temporal evaluation, build and validate an immutable 75-game
training snapshot with explicit provenance, four-file checksums, and gameId
boundaries. The next temporal cycle uses V4 only. No feature, scaler,
estimator, trainer, production model, runtime, or PVE change is authorized by
this record.

## Verification performed

- `conda run -n tetris-ml python scripts/ml/summarize_placement_temporal_report.py data/ml-experiments/placement-temporal-holdout-v0-v4/full-report.json`
- `conda run -n tetris-ml python -m unittest python_tests.test_summarize_placement_temporal_report`
- `npm run verify:ml`
- `bash scripts/verify.sh`
- `git diff --check`

All completed successfully. The full Notebook was not rerun during analysis.
