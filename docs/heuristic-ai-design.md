# Heuristic AI Design

## Purpose

This document describes the future heuristic AI components.
It separates pure decision logic from game loop integration so that the work does not interfere with the current server authoritative transition.

The first AI should choose the best placement for the current piece.
It should be simple, testable, and explainable.

## Current vs Future

Current implementation:

- Core board functions exist for collision, locking, and line clearing.
- Runtime currently handles lock flow and placement logging on the client.
- No board metrics module exists yet.
- No placement generator, simulator, evaluator, or AI controller exists yet.

Future implementation:

- Pure AI utility modules calculate metrics and candidate placements.
- The AI controller runs only after the authoritative game state boundary is stable.
- PVE mode uses the same game rules as human play.

## Components

### boardMetrics

`boardMetrics` reads a board and returns numeric features.

Expected metrics:

- `columnHeights`: height of each column.
- `aggregateHeight`: sum of all column heights.
- `maxHeight`: tallest column height.
- `holes`: empty cells that have at least one filled cell above them in the same column.
- `bumpiness`: sum of height differences between adjacent columns.
- `completeLines`: number of full rows.

This module should be pure.
It must not mutate the board.
It should be reusable for both heuristic scoring and ML feature extraction.

### placementGenerator

`placementGenerator` should enumerate legal final placements for the active piece.

Input candidates:

- `board`
- `activePiece`
- `holdPiece`
- `nextQueue`
- piece shape definitions

Output candidates should include:

- piece type
- rotation
- row
- col
- whether hold was used
- optional path metadata for later input sequence generation

In the first version, this module does not need to generate human-like movement inputs.
It only needs to find legal final placements.

### simulatePlacement

`simulatePlacement` applies one candidate placement to a cloned board.

It should return:

- `boardAfter`
- `linesCleared`
- `gameOver`
- optional attack-related result if the server rules are ready

It must not mutate `boardBefore`.
This is important because the evaluator will simulate many candidates from the same state.

### heuristicEvaluator

`heuristicEvaluator` scores a simulated placement.

A first scoring formula can combine:

- lower aggregate height is better
- fewer holes is better
- lower bumpiness is better
- more complete lines is better
- lower max height is safer

The exact weights should be treated as tunable parameters, not permanent game rules.

The evaluator should return both:

- numeric score
- explanation fields, such as metric deltas and applied weights

This helps debugging and portfolio explanation.

### aiPlayerController

`aiPlayerController` is the integration boundary.
It should not exist inside the current multiplayer loop yet.

Future responsibilities:

1. Receive authoritative game state.
2. Call placement generation.
3. Simulate each placement.
4. Score candidates.
5. Select a placement.
6. Return either an immediate placement command or a human-like input sequence.

For the first PVE MVP, immediate lock is acceptable.
Later, input sequence generation can make the AI move like a human player.

## Recommended First API Shape

The first internal flow can be described as:

```text
gameState
  -> boardMetrics(boardBefore)
  -> placementGenerator(gameState)
  -> simulatePlacement(candidate)
  -> boardMetrics(boardAfter)
  -> heuristicEvaluator(candidateFeatures)
  -> selectedPlacement
```

This is only a design shape, not a current implementation.

## Testing Strategy

Test pure modules first:

- empty board metrics
- holes and height metrics
- legal placement enumeration
- simulation does not mutate input board
- evaluator chooses a safer board when line clear is equal

Do not test AI through browser UI in the first step.
The useful tests are data-in, data-out tests.

## Server Authoritative Dependency

The AI controller should wait until these server-side boundaries are stable:

- server owns tick progression
- server owns board and active piece
- server decides piece lock
- server emits authoritative snapshots
- placement logs can be generated from server-confirmed state

Until then, implement only pure functions and documentation.

