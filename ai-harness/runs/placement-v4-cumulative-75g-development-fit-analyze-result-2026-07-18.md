# Placement V4 cumulative development fit — Full Analysis Record

## Scope

- Worktree: `Tetris_multi-ai`
- Branch: `codex/python-sklearn-logo-evaluation`
- Worktree HEAD at analysis: `198d515c479b7a90e9e058d17d5f3f6ae057be06`
- MODE: `analyze-result`
- Experiment: `ai-harness/ml-experiments/experiments/placement-v4-cumulative-75g-development-fit.md`
- Lead decision: `development_checkpoint_valid`

This is a development-only batch-fit checkpoint. It has no held-out game
cohort, ranking metric, model-policy decision, or production integration.

## Full-run evidence

The user executed the full Notebook once after the implement-smoke gate. This
analysis did not rerun the Notebook, export the dataset, or fit a model.

```bash
PLACEMENT_V4_DEVELOPMENT_DATASET=data/datasets/human-behavior-v2-temporal-cumulative-75g-20260718 \
PLACEMENT_V4_MAX_TRAINING_GAMES=75 \
PLACEMENT_V4_DEVELOPMENT_REPORT=/private/tmp/placement-v4-cumulative-75g-development-fit-full.json \
conda run -n tetris-ml python -m jupyter nbconvert \
  --to notebook \
  --execute scripts/ml/notebooks/placement_v4_cumulative_75g_development_fit.ipynb \
  --output placement-v4-cumulative-75g-development-fit-executed-full.ipynb \
  --output-dir /private/tmp \
  --ExecutePreprocessor.timeout=1200
```

After checksum verification, both files were copied byte-identically to the
ignored local evidence directory. They are not staged or canonical results.

- Full report: `data/ml-experiments/placement-v4-cumulative-75g-development-fit/full-report.json`
- Full report SHA-256: `2ea7fe659220279c786d8c9c8e6f7ab6af70f970e0db985d6067b7a095c0ad53`
- Executed Notebook: `data/ml-experiments/placement-v4-cumulative-75g-development-fit/executed-full.ipynb`
- Executed Notebook SHA-256: `1cd8a3d3b3c54413ea82e89f4793b46c70b535af36ce9a2ceb12152fcab48e56`
- Byte comparison against `/private/tmp`: passed for both files
- Executed Notebook error outputs: `0`

## Dataset and checkpoint contract

- Dataset four-file checksums before/after match actual source files.
- Accepted cohort: `75` games, `3,480` decisions, `117,805` candidates.
- Manifest lifecycle games: `76`; this is intentionally distinct from the
  accepted training-game count.
- `runMode: full`, `fullCohortCovered: true`
- `developmentOnly: true`, `productionIntegration: false`
- `canonicalResultEligible: false`, `policyDecisionEligible: false`
- `heldOutEvidence: false`, `evaluationMetricsIncluded: false`
- Representation: V4 occupied-cell physical class, `75,615` pairs, `4`
  pairless decisions, selected-class aliases excluded.
- Symmetric samples: `151,230`; decision weight min/max: `1 / 1`.
- Fit: `20` iterations, convergence warnings `0`, unexpected warnings `0`.
- Weighted training log loss: `0.16768123447440675`.

`policyDecisionEligible: false` is correct here: this is a fit-integrity
checkpoint rather than a temporal performance evaluation. The generic
performance-evaluation expectation for that field does not apply.

## Summarizer revalidation

```bash
conda run -n tetris-ml python \
  scripts/ml/summarize_placement_v4_development_fit.py \
  /private/tmp/placement-v4-cumulative-75g-development-fit-full.json \
  --output-json data/ml-experiments/placement-v4-cumulative-75g-development-fit/summary.json \
  --output-md data/ml-experiments/placement-v4-cumulative-75g-development-fit/summary.md
```

- Result: `development_checkpoint_valid`
- Summary JSON SHA-256: `f3f14c33328a2e1027a0c0365db97f90e3139a65f1a5d79574a560794ace7901`
- Summary Markdown SHA-256: `4df517db3dd8f94a281990eae2d7d8284c9599613240f6906c6eb196a9b07b83`
- Repeated summarization produced the same summary bytes.

The summarizer rechecked the fixed dataset SHA-256 values, source JSONL
schema/count/label contracts, V4 representation, scaler/feature order,
coefficient finiteness, estimator configuration, symmetric sample count,
decision-balanced weights, convergence, and non-production boundary flags.

## Lead decision and limitations

`development_checkpoint_valid`

The decision confirms that the immutable 75-game source, V4 pair contract,
raw-candidate scaler, coefficient vector, and development fit diagnostics are
internally consistent and reproducible on this environment.

It does not establish held-out generalization, ranking quality on new games,
gameplay win rate, PVE suitability, final trainer readiness, or production
promotion. No model parameter, including `linesCleared`, was adjusted during
analysis.

## Next gate

Collect a new immutable temporal holdout cohort and evaluate the fixed V4
checkpoint without refitting on that cohort. No feature, estimator, trainer,
JavaScript scorer, runtime, PVE, or production change is authorized by this
record.

## Verification performed

- Full report summarizer revalidation
- Full report and executed Notebook byte comparison and SHA-256 verification
- Executed Notebook error-output check
- Targeted Notebook and summarizer contract tests
- `npm run verify:ml`
- `bash scripts/verify.sh`
- `git diff --check`

The full Notebook was not rerun during analysis.
