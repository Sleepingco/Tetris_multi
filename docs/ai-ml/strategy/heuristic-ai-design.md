# Heuristic AI Design

## Purpose

This document describes the heuristic AI path on top of the server authoritative multiplayer MVP.
It separates pure decision logic from game loop integration so the AI work does not change the current multiplayer or server authoritative flow.

The first AI chooses a reachable placement for the current piece and plays as a real PVE opponent.
It is intentionally simple, testable, and explainable.
It is not a recommendation coach. Coaching and LLM explanations come later, after gameplay AI and logs exist.

## Current vs Future

Current implementation:

- Core board functions exist for collision, locking, and line clearing.
- Runtime and server authoritative services reuse core/state concepts for lock, line clear, garbage, game over, and snapshot flow.
- `src/client/game/core/boardMetrics.ts` exists as a pure module with Node tests in `test/testBoardMetrics.js`.
- `placementGenerator.ts`, `reachablePlacementPlanner.ts`, `simulatePlacement.ts`, and `heuristicEvaluator.ts` exist under `src/client/game/ai/heuristic`.
- `src/server/services/pveAiPlayerService.ts` runs AI plans through the same authoritative input path as human players.
- Placement decision logs, dataset export/evaluation, and JS/Python parity checks exist.
- User-selected Experimental PVE can use the V4 imitation model, but production/default PVE remains heuristic.

Future improvements:

- Improve evaluation weights only with a named benchmark and dataset.
- Keep V4 as opt-in Human imitation unless a separate gameplay promotion gate proves it should change.
- Add richer user-vs-AI analysis before considering LLM coaching.
- Python AI server, reinforcement learning, and production model serving remain later layers.

## Components

### boardMetrics

`boardMetrics` reads a board and returns numeric features.
It is already implemented at `src/client/game/core/boardMetrics.ts`.

Implemented metrics:

- `columnHeights`: height of each column.
- `aggregateHeight`: sum of all column heights.
- `maxHeight`: tallest column height.
- `holes`: empty cells that have at least one filled cell above them in the same column.
- `bumpiness`: sum of height differences between adjacent columns.
- `completeLines`: number of full rows.

This module should be pure.
It must not mutate the board.
It should be reusable for heuristic scoring now and later ML feature extraction.

It currently lives in `src/client/game/core` because it uses the same board representation as the pure core rules and does not depend on DOM, runtime, rendering, sockets, or browser APIs.
If both server-side AI and client-side tooling need a wider shared import boundary later, this module can move to a `shared` layer without changing its contract.

### placementGenerator

`placementGenerator` enumerates legal final placements for the active piece.

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

Reachability and action planning live in `reachablePlacementPlanner.ts`, which filters candidates to placements the current piece can reach through existing movement rules.

### simulatePlacement

`simulatePlacement` applies one candidate placement to a cloned board.

It should return:

- `boardAfter`
- `linesCleared`
- `gameOver`
- optional attack-related result when the caller passes the needed state

It must not mutate `boardBefore`.
This is important because the evaluator will simulate many candidates from the same state.

### heuristicEvaluator

`heuristicEvaluator` scores simulated reachable placements.

A first scoring formula can combine:

- lower aggregate height is better
- fewer holes is better
- lower bumpiness is better
- more complete lines is better
- lower max height is safer

The exact weights are policy parameters, not permanent game rules.

The evaluator should return both:

- numeric score
- explanation fields, such as metric deltas and applied weights

This helps debugging and portfolio explanation.

### pveAiPlayerService

`pveAiPlayerService` is the current integration boundary.
It should stay outside the browser runtime and run through the server authoritative input path.

Current responsibilities:

1. Receive authoritative game state.
2. Choose heuristic or opt-in V4 policy.
3. Generate reachable candidate plans.
4. Simulate and score candidates.
5. Execute the selected plan as authoritative actions.
6. Save placement log evidence without blocking gameplay on log failure.

The AI no longer directly places the piece on the board. That older shortcut was removed so human and AI gameplay use the same lock/garbage/game-over rules.

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

This flow exists today for heuristic PVE. Experimental V4 can replace the scoring choice only when the user explicitly selects it, and falls back to heuristic on model load or validation failure.

## Testing Strategy

Test pure modules first:

- empty board metrics
- holes and height metrics
- mutation prevention for board metrics
- legal placement enumeration
- simulation does not mutate input board
- evaluator chooses a safer board when line clear is equal

Browser tests are useful for PVE lifecycle, policy display, and authoritative input execution. Pure AI modules should still be tested with data-in, data-out tests.

## Server Authoritative Dependency

The AI integration depends on these server-side boundaries:

- server owns tick progression
- server owns board and active piece
- server decides piece lock
- server emits authoritative snapshots
- placement logs can be generated from server-confirmed state

These boundaries are now implemented. Future AI work should not bypass them.

## Out of Scope For Now

- Do not implement PVE as a recommendation coach. It is a real opponent mode.
- Do not make V4 the default PVE policy from this document alone.
- Do not add a Python AI server before there is a concrete runtime serving requirement.
- Do not start reinforcement learning before replayable state, metrics, and evaluation criteria are available.
- Do not attach LLM coaching until AI decisions and user-vs-AI comparison data can be summarized reliably.
