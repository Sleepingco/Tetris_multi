# Placement Pairwise Linear Ranker

Historical placement/parity reference · [Reading order](../../archive/ai-ml/README.md) ·
[Previous: dataset contract](../contracts/placement-ml-evaluation-contract.md) ·
[Next: Python LOGO](../../archive/ai-ml/experiments/placement-python-experiment-notebook.md).
The parity path still serves regression checks; this document is not the new action model spec.

## Purpose

This experiment learns to imitate Human placement choices from placement
dataset schema v2. It is not a stronger-gameplay objective: the label says
which reachable placement the Human selected, not which placement maximizes
survival, attack, score, or win probability.

The model remains offline. It is not connected to PVE, the authoritative
executor, candidate generation, planned actions, or game rules.

## Pairwise objective

Each decision group has one selected candidate and one or more unselected
candidates. Training creates one pair per unselected candidate:

```text
difference = standardized(selected) - standardized(unselected)
loss = log(1 + exp(-dot(weights, difference)))
```

There is no intercept because adding the same intercept to every candidate does
not change a ranking. If a decision has `N` unselected candidates, every pair
has weight `1 / N`. The weighted pair loss is then averaged by decision count,
so decisions with many reachable placements do not dominate training.

The optimizer is deterministic full-batch gradient descent. It uses fixed
epochs, learning rate, L2 regularization, canonical decision/candidate order,
and no stochastic shuffle. The seed is stored as reproduction metadata even
though the optimizer does not consume randomness.

## Features and leakage boundary

Training and scoring call `extractPlacementFeatures(sample)` directly. Feature
names and order are owned by placement feature schema v1:

1. candidate lines cleared
2. candidate game-over flag
3. aggregate-height delta
4. max-height delta
5. holes delta
6. bumpiness delta
7. through 16. column-height deltas `0..9`

Heuristic score and reason, `selectedBySource`, `isWinner`, `winnerPlayerId`,
`finishType`, `aiDifficulty`, IDs, and future game results are forbidden model
features. Outcome and difficulty are evaluation segmentation metadata only.

## Train-only scaler and LOGO

Every Leave-One-Game-Out fold fits feature mean and population standard
deviation from that fold's train candidate rows only. A zero-variance feature
uses scale `1`. Held-out candidates are transformed with the train scaler and
never influence scaler values or weights.

Each game is held out exactly once. Aggregate Top-1, Top-3, MRR, and mean
selected rank combine only those held-out predictions. The model trained later
on all games exists only to create `model.json`; its in-sample ranking is not
reported as model performance.

## Artifact contract

`model.json` records model/dataset/feature schema versions, ordered feature
names, weights, scaler, fixed training config, seed, source dataset hash,
production-log input hash, training-pipeline source hash, and full-data training
summary.

`evaluation.json` records heuristic and seeded-random baselines, pairwise LOGO
folds and aggregate segmentation, baseline deltas, final-training summary, and
`runtimeIntegration: false`. Artifact JSON contains no generation timestamp or
temporary absolute path, so identical inputs, source, and config produce
identical content.

The CLI stages both JSON files as temporary files. `model.json` is renamed last,
so a failed run does not present a partially written model as a completed
artifact.

## Runtime fallback and limitations

If the model is integrated in a future task, schema validation or inference
failure must fall back to the existing heuristic scorer. This task does not add
that runtime branch.

The current Human dataset contains only one winner game. Winner-segment metrics
are reference values and cannot support a separate performance conclusion.
Human imitation quality also does not establish that the model plays stronger
Tetris than the heuristic baseline.

## Python single-fold parity spike

The Python path consumes a JavaScript-exported parity bundle. JavaScript remains
the source of truth for dataset construction, decision grouping, canonical
candidate order, and the 16 raw feature values. Python does not reproduce game
rules, placement simulation, or feature extraction.

```text
human-behavior-v2 dataset
-> JavaScript parity bundle for one held-out game
-> Python full-batch reference
-> scikit-learn LogisticRegression reference
-> separate parity report
```

The default held-out game is the first canonical game ID. It can be overridden
with `--validation-game-id`. Bundle and report content contain no timestamp,
PID, or absolute path.

```bash
npm run model:export-placement-parity -- \
  --dataset-dir data/datasets/human-behavior-v2 \
  --output /tmp/placement-parity-bundle.json

conda run -n tetris-ml python scripts/ml/placement_pairwise_parity.py \
  --bundle /tmp/placement-parity-bundle.json \
  --output /tmp/placement-parity-report.json
```

The npm comparison command also pins this environment; it does not invoke a
bare system Python. The fixed ML verification entry point is:

```bash
npm run verify:ml
```

It runs the Node parity contract tests and Python tests through the `tetris-ml`
Conda environment. The normal `scripts/verify.sh` remains dependency-free and
does not require Conda.

The JS-equivalent path uses canonical bundle order and scalar float64 loops.
Its single absolute tolerance is `1e-12`, intended only for JavaScript/Python
math-library differences. It compares scaler values, every pair difference and
weight, losses, model weights, validation scores, all candidate ranks, and
metrics.

The exporter rejects an output that resolves to `manifest.json`, `train.jsonl`,
`validation.jsonl`, or `rejected.jsonl`, including lexical aliases, symlinked
parents, symlinked files, and existing hard-link identities. Python applies the
same rule between its input bundle and output report. Final and staging paths
are checked against these protected inputs. Both writers create a random temp
file in the output directory with exclusive-create, write through its open
handle, flush and close it, recheck its identity, and atomically replace the
final output. A failed write leaves the protected source and existing output
bytes unchanged.

Parity export also recalculates the Human-only source contract from the JSONL:
every candidate selection flag is boolean, each decision has exactly one
selected candidate, and manifest decision/sample/game/source/difficulty counts
match the rows being serialized. Python compares selected placement identity,
each candidate selection flag, and validation decision count in addition to
score and rank parity.

For scikit-learn, each original pair becomes two symmetric binary samples with
half the original pair weight. The actual transformed `sample_weight` array is
validated on both sides of every pair and must sum to one per decision before
`fit()` is called.
With `D` training decisions and JS regularization `l2`, the matching
regularization parameter is:

```text
C = 1 / (D * l2)
```

The reference uses `LogisticRegression`, `solver="lbfgs"`, no intercept, no
class weighting, `tol=1e-12`, and `max_iter=10000`. A convergence warning is a
hard failure. The report evaluates the sklearn weights again with the JS
objective and records optimizer, weight, rank, score-margin, and metric
differences. It remains an offline artifact with `runtimeIntegration: false`.

scikit-learn training pairs and validation scoring use the same Python-fitted
train-only scaler. The JS scaler is comparison data only. If JS/Python parity
fails, the sklearn step is skipped and the report does not attribute any
difference to optimizer behavior.

Canonical strings use locale-independent Unicode code-point order in every JS
grouping, ranker, evaluator, and parity export path. Python consumes that
serialized order directly.

Existing canonical Top-1/Top-3/MRR metrics remain unchanged. Reports also
record selected-feature duplicate decisions, zero-difference training pairs,
top-score tie decisions, and tie-aware Top-1. Tie-aware Top-1 counts a decision
as correct when the selected candidate belongs to the maximum-score tie set;
it is a representation diagnostic, not a replacement model metric.

The isolated environment is defined only in `environment-ml.yml`. Python tests
use the standard-library `unittest` runner, so no separate test dependency is
required.
