# AI PVE Plan

## Purpose

This document defines the future PVE AI direction for the Tetris multiplayer project.
The codebase now has a first server authoritative input, ticker, state, and snapshot flow, but the final two-browser regression is still pending.
Pure AI analysis utilities can move forward, while AI must not be connected to the active game loop until that regression is complete.

The goal is to make AI a real opponent player later, not only a coaching recommendation layer.
The first playable AI should be a heuristic AI that chooses a best placement from the current game state.
After stable logs are collected, the project can compare human choices and AI choices, build ML datasets, and later replace or assist the heuristic evaluator with an ML model.

## Current State

Implemented today:

- Multiplayer room and match lifecycle exist on the server.
- Client input is validated and applied to server-owned player game state.
- Server bag chunks are created per player.
- A server authoritative ticker and snapshot flow exist.
- Server-side garbage, game over, and match finish handling exist.
- `placement_decision` logs and JSONL persistence exist.
- `boardMetrics` and its pure-function tests exist.

Not implemented yet:

- Final two-browser multiplayer regression for the authoritative flow.
- `placementGenerator`, `simulatePlacement`, and `heuristicEvaluator`.
- AI player connected to multiplayer or PVE game flow.
- ML model training or inference.

## PVE AI Goal

The PVE AI should eventually act as a real opponent player.
It should read game state, choose a placement, and produce a game action result that can be processed by the same game rules as a human player.

For the first MVP, the AI may choose a best placement and lock it immediately.
This avoids implementing human-like movement timing too early.

Later, the AI can generate an input sequence such as move left, rotate, soft drop, and hard drop.
That second stage is useful when the project needs replay compatibility, visible AI movement, or fairness under the same input pipeline as human players.

## Expansion Stages

### Stage 1. Pure Analysis Utilities

Build pure functions that do not depend on DOM, Canvas, Socket.IO, timers, or UI.

- `boardMetrics`
- `placementGenerator`
- `simulatePlacement`
- `heuristicEvaluator`

These can be tested independently and reused by future server-side logic.

### Stage 2. Heuristic PVE Prototype

After the server authoritative loop is stable, create an AI player controller that receives the same authoritative game state shape as a human player.

The first controller may:

1. Read `boardBefore`, `activePiece`, `nextQueue`, and `holdPiece`.
2. Generate candidate placements.
3. Simulate each candidate.
4. Score each candidate with the heuristic evaluator.
5. Select the highest-scoring placement.
6. Lock the selected placement immediately.

This should be isolated from multiplayer human-vs-human mode until the server authoritative flow is proven.

### Stage 3. Log Accumulation

Collect logs from both humans and heuristic AI.

The logs should show:

- What board state existed before a decision.
- Which placement the player or AI selected.
- What result the placement produced.
- What the heuristic AI would have selected on the same board.

This enables comparison before ML exists.

### Stage 4. ML Dataset and Baseline Model

Convert placement logs into feature and label rows.
Start with a simple baseline model that predicts placement score.
Do not start with reinforcement learning.

The model should first assist or replace the heuristic evaluator, not control the whole game.

### Stage 5. ML Inference

Once a baseline model exists, use it to score generated placement candidates.
The placement generator can stay rule-based.
The ML model only needs to rank or score candidates.

This keeps the system explainable and easier to debug.

## Boundaries

AI must not be attached to the multiplayer game loop until the current authoritative flow passes the final two-browser regression.
The safe work before that point is limited to pure functions, tests, data contracts, and design documents.

The PVE AI should not depend on browser DOM state.
It should depend on serialized game state or server game state.

LLM features are not part of the decision engine.
If added later, they should explain metrics, mistakes, and AI comparisons in natural language.

## Do Not Do Now

- Python AI server.
- Reinforcement learning.
- LLM coaching.
- React or NestJS migration.
- AI connected to the current multiplayer loop.
- Server authoritative loop and AI implementation in the same change.
