# Placement Pairwise Linear Ranker

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
