# ML Dataset Plan

## Purpose

This document describes how future machine learning data should be collected from human and AI play.
It does not define an immediate ML implementation.

The current project already has `placement_decision` logs and JSONL storage.
Those logs are useful, but they are currently generated from the client runtime.
After server authoritative mode is complete, server-confirmed placement logs should become the preferred training source.

## Current vs Future

Current implementation:

- `game_start`, `placement_decision`, and `game_over` logs exist.
- JSONL persistence exists under `data/logs`.
- A basic dataset policy exists in `docs/game-log-dataset-policy.md`.

Future implementation:

- Logs include feature-ready metrics.
- Human and AI decisions can be compared on the same `boardBefore`.
- Dataset rows can be generated from placement candidates.
- ML models can learn to score placements.

## Required Log Fields

Future placement logs should include:

- `gameId`
- `roomId`
- `playerId`
- `source`: `human`, `heuristic_ai`, or `ml_ai`
- `tick`
- `pieceIndex`
- `boardBefore`
- `boardAfter`
- `activePiece`
- `nextQueue`
- `holdPiece`
- `inputSequence`
- `selectedPlacement`
- `placementResult`
- `metricsBefore`
- `metricsAfter`
- `aiEvaluation`

`source` is important because human, heuristic AI, and ML AI decisions should be separable in analysis.

## Human and AI Comparison

For the same `boardBefore`, the system should eventually compare:

- the placement selected by the human
- the placement selected by the heuristic AI
- the placement selected by the ML model
- the result of each placement

This comparison should not require the UI.
It should be computed from serialized game state and pure simulation.

## Dataset Generation Flow

The future flow should be:

1. Collect human placement logs.
2. Collect heuristic AI placement logs.
3. For each decision state, generate all legal placement candidates.
4. Simulate each candidate.
5. Calculate metrics before and after each candidate.
6. Assign a score or label to each candidate.
7. Write feature rows for training and validation.

The first dataset should be small and explainable.
It should not try to train a complex model before the feature and label definitions are stable.

## Feature Candidates

Initial features can include:

- aggregate height before and after
- max height before and after
- holes before and after
- bumpiness before and after
- complete lines
- score delta
- attack lines
- canceled garbage lines
- hold usage
- piece type
- rotation
- landing column

Feature names should stay stable once training starts.
Changing feature meaning without versioning makes model comparison unreliable.

## Label Candidates

Early labels can be simple:

- heuristic score for each candidate
- whether the candidate was selected by the human
- whether the candidate was selected by the heuristic AI
- placement result score derived from lines, holes, height, and survival

The first baseline should predict a placement score.
It should not attempt full reinforcement learning.

## Baseline ML Model

The baseline model should answer:

```text
Given a board state and one candidate placement, how good is this placement?
```

This keeps ML scoped to placement scoring.
The placement generator remains rule-based.

The ML model can later:

- replace heuristic scoring
- blend with heuristic scoring
- explain why it prefers a candidate through feature contribution analysis

## Data Quality Rules

Prefer logs where:

- `game_start`, `placement_decision`, and `game_over` share the same `gameId`
- board size is valid
- `pieceIndex` is present
- `boardBefore`, `boardAfter`, and `selectedPlacement` are valid
- `source` is present
- schema version is known

Treat these as lower confidence:

- client-authored logs before server authoritative mode
- disconnect or leave games
- very short games
- game-over-adjacent placements

## Do Not Do Now

- Build a Python training pipeline before feature and label schemas are stable.
- Train a model from client-authored logs as if they were authoritative truth.
- Use reinforcement learning.
- Let an ML model directly drive multiplayer input before PVE rules are stable.

