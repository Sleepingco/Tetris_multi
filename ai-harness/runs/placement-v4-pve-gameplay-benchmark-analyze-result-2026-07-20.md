# Placement V4 PVE gameplay benchmark — Full Analysis Record

## Scope

- Worktree: `Tetris_multi-ai`
- Branch: `codex/python-sklearn-logo-evaluation`
- Worktree HEAD at analysis: `34289162dcae4b0f84f04c3b509c65fdae793dda`
- MODE: `analyze-result`
- Experiment: `ai-harness/ml-experiments/experiments/placement-v4-pve-gameplay-benchmark.md`
- Full report: `data/ml-experiments/placement-v4-pve-gameplay-benchmark/full-report.json`
- Timing report: `data/ml-experiments/placement-v4-pve-gameplay-benchmark/timing-report.json`

The two reports are Git-ignored local evidence and were not staged. The full
benchmark was not rerun during analysis.

## Full-run evidence

- Report schema: `2`
- Full report SHA-256: `0eef91f9536b6192aecb7bfdc13412a566d0bc3b7aa3df84dd5afc12c97490d1`
- Timing report SHA-256: `0bbb064c63521c3572c35af519f2660236032bfa9b42c635b4581474446eec06`
- Model SHA-256: `ff64b0d3e4cd9eb6c6d7920f2cbe961f1d70e4c90ccc69a5d9ab8bcd410cb33d`
- `/private/tmp` source and ignored copies: byte-identical
- `runMode: full`
- `fullCohortCovered: true`
- `policyDecisionEligible: true`
- `canonicalResultEligible: false`
- `productionIntegration: false`

The fixed cohort contract was `30` streams, `500` placements, seed prefix
`placement-v4-gameplay-full`, policies `heuristic` and `placement_v4`, hard
execution profile, and no incoming garbage.

## Contract verification

- Pair count: `30`
- Heuristic/V4 horizon count: `30 / 27`
- Heuristic/V4 horizon rate: `1.0 / 0.9`
- Horizon count difference: `3`
- `bothSurvivedHorizon: 27`
- `v4SurvivalLoss: 3`
- `v4SurvivalWin: 0`
- `exactGameOverTie: 0`
- Invalid decision, model fallback, non-finite score, plan divergence, unexpected error: all `0`
- Benchmark status: `gameplay_screening_passed`

The three V4 survival losses were stream `004` at `313` placements, stream
`009` at `487`, and stream `025` at `220`. Heuristic reached the 500-placement
horizon in all three paired rollouts.

## Secondary diagnostics

Across the 30 streams, the unweighted per-stream averages were:

| Metric | Heuristic | V4 |
|---|---:|---:|
| Lines / 100 placements | 39.366667 | 38.144261 |
| Attack / 100 placements | 17.300000 | 15.586084 |
| Average holes | 2.179800 | 4.999518 |
| Final holes | 1.700000 | 8.466667 |
| Average max height | 5.236267 | 6.955337 |
| Final max height | 5.000000 | 10.200000 |

These are secondary diagnostics. The predefined primary screening rule uses
the 500-placement horizon count and safety events.

## Lead decision

- Benchmark status: `gameplay_screening_passed`
- Program decision: `imitation_only_not_gameplay_ready`
- Production decision: `keep_heuristic_default`
- Completion status: `placement_v4_gameplay_evaluation_closed`

The horizon difference of exactly three is the pass boundary, not evidence
that V4 is superior. V4 remains valid for deterministic Human-placement
imitation and offline ranking analysis, but that objective does not establish
long-horizon gameplay replacement quality. This objective mismatch, the three
V4-only game-overs, and the weaker secondary board diagnostics are sufficient
to keep heuristic as the default production/PVE policy.

This record does not claim that V4 is universally worse or that heuristic is
optimal. It concludes only that this candidate is not gameplay-ready under the
fixed benchmark and decision policy.

## Closed gate

- No 100-stream extension
- No hybrid experiment
- No retraining
- No production/PVE default change
- No stage, commit, push, merge, or rebase

The timing report remains non-canonical and is not policy evidence. No further
gameplay replacement experiment is authorized without a new question and an
explicit technical-lead decision.

## Verification performed

- Full report SHA-256 and schema-v2 contract validation
- Fixed full cohort, policy eligibility, model SHA, pair count and safety checks
- Byte comparison between `/private/tmp` reports and ignored stored copies
- Experiment/run-record consistency review
- `git diff --check`

Runner, Notebook, tests, model, dataset, runtime and PVE code were not changed.
