# Inference Strategy

## Purpose

This document defines where heuristic and ML inference should run in future AI work.
It keeps inference planning separate from the current server authoritative transition.

## Current Position

No official PVE AI inference should run in the current multiplayer game loop yet.
The project now has a first server authoritative input, ticker, state, and snapshot flow, while client prediction and correction remain part of the multiplayer experience.
The final two-browser regression for this flow is still pending.

Pure analysis modules may be implemented now, but an official PVE opponent should wait until server authoritative state ownership is verified through that regression.

## Heuristic Inference

The first PVE AI should use heuristic inference.

The heuristic evaluator should be a pure function.
It should receive candidate features and return a score.
It should not depend on:

- DOM
- Canvas
- browser timers
- Socket.IO
- local storage
- UI state

After server authoritative mode is stable, the PVE AI can run near the authoritative game instance.
That may be inside the Node.js server process or another server-side game instance, depending on how the authoritative loop is structured.

## Browser Inference

Browser inference can be useful for an AI coach.
For example, the browser can show "the AI would prefer this placement" without changing official game state.

Browser inference is less suitable for an official PVE opponent because:

- users can tamper with browser state
- timing is harder to control
- AI decisions may diverge from server-confirmed game state
- official opponent behavior should be reproducible

Use browser inference only for non-authoritative coaching or debug visualization.

## Node.js Server Inference

Node.js server inference is the preferred first target for official PVE heuristic AI after server authoritative mode is stable.

Reasons:

- the server can use authoritative game state
- no separate service boundary is needed
- pure JavaScript modules can be reused
- tests can run with `node --test`

The first server-side AI should not require a Python service.

## Python AI Server

A Python AI server should wait until an ML model exists.
It should not be introduced for the heuristic AI MVP.

Python becomes useful when:

- a trained model exists
- model dependencies are hard to run in Node.js
- batching or model serving is needed
- model versioning becomes important

Before that point, a Python service adds operational complexity without solving the current design problem.

## ML Inference

ML inference should score placement candidates, not replace the whole game engine.

Recommended flow:

```text
authoritative game state
  -> placementGenerator
  -> simulatePlacement per candidate
  -> feature extraction
  -> ML model scores candidates
  -> selectedPlacement
  -> server applies selected placement or generated input sequence
```

The model should be replaceable with the heuristic evaluator.
This makes it possible to compare:

- heuristic-only AI
- ML-only AI
- hybrid heuristic + ML AI

## Failure Handling

Official PVE gameplay should continue even if optional inference fails.

Possible fallback order:

1. ML model score.
2. Heuristic evaluator score.
3. Safe default placement policy.
4. Forfeit or idle only if no legal placement exists.

The fallback behavior should be deterministic and testable.

## Do Not Do Now

- Python AI server.
- ML model serving.
- LLM coaching.
- Browser-controlled official PVE opponent.
- AI connected to the authoritative game loop before the final multiplayer regression passes.
- Server authoritative loop and AI implementation in the same change.
