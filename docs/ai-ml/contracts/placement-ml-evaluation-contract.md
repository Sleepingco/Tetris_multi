# Placement ML Dataset and Evaluation Contract

Scope: legacy 20-row placement ranking, dataset schema v2 / feature schema v1.
This is not the v3 gameplay log or Human action dataset contract. See the
[current plan](../strategy/ai-plan.md), [action dataset design](human-action-dataset.md),
and [historical reading order](../../archive/ai-ml/README.md).

This contract prepares placement data for later ranking experiments. It does not
train a model or change PVE/runtime behavior.

## Dataset schema v2

`datasetSchemaVersion: 2` adds `candidateResult` to every candidate row.

- `candidateResult.linesCleared`: the non-negative integer returned by that
  candidate's simulation.
- `candidateResult.gameOver`: the boolean returned by that candidate's
  simulation.

The values are not inferred from heuristic score, heuristic reason, board
metrics, or the actual future game result. Existing v1 rows are not accepted as
v2 rows.

Game outcome context remains metadata only:
`metadata.isWinner`, `metadata.winnerPlayerId`, and `metadata.finishType`.
It is not a model feature.

## Feature schema v1

`extractPlacementFeatures(sample)` returns these 16 finite values in order:

1. candidate result lines cleared
2. candidate result game-over flag (`false = 0`, `true = 1`)
3. aggregate-height delta
4. max-height delta
5. holes delta
6. bumpiness delta
7. through 16. column-height deltas `0..9`

Heuristic score, outcome metadata, AI difficulty, candidate column/rotation,
and action count are excluded from this schema.

## Decision and evaluation contract

A decision is `(gameId, playerId, pieceIndex)`. It requires at least two
candidates, exactly one `selectedBySource`, identical context fields
(including AI difficulty and outcome metadata), unique candidate placements,
and valid feature vectors.

The evaluator ranks each decision deterministically. Heuristic baseline reuses
the existing heuristic comparator; seeded random gives every candidate an
independent score derived from the seed, decision key, and canonical placement
key. A scorer must supply one finite score for every candidate and no others,
or evaluation returns an explicit error. Metrics are Top-1, Top-3, MRR,
selected rank, and candidate-count summary. `isWinner` is used only for
`byOutcome` segmentation.

Leave-One-Game-Out makes every game validation once. A scorer factory receives
train groups and returns a scorer for validation groups. Aggregate metrics sum
only the held-out predictions from those folds; they never fit and evaluate on
the full dataset. This is the extension point for the future pairwise linear
ranker.
