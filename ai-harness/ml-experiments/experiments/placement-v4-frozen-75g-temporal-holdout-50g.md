# ML Experiment: Frozen V4 75-game temporal holdout on 50 games

## 상태

- Experiment ID: `placement-v4-frozen-75g-temporal-holdout-50g`
- Recommended mode: `implement-smoke`
- Result status: `temporal_holdout_passed`
- V4 policy: `keep_v4`
- Training pool decision: `admit_50g_to_training_pool`
- Program gate: `ready_to_freeze`

## 질문 하나

75게임으로 학습된 고정 V4 checkpoint가 이후 신규 50게임의 Human placement를 보통·어려움 난이도에서 얼마나 안정적으로 모방하는가?

## Baseline과 변경 변수

- Baseline: 75게임 V4 development checkpoint
- Changed variable: 시간상 이후에 수집된 50게임 평가 cohort
- Candidate: 재학습 없이 frozen scaler와 coefficient로 physical class ranking

## 고정 조건

- Dataset/cohort: 기존 75게임과 누적 125게임의 gameId 차집합
- Feature: checkpoint의 16-feature와 순서
- Scaler: checkpoint mean/scale, fit 금지
- Estimator: checkpoint V4 coefficient, fit 금지
- Ranking/tie-break: 높은 linear score 우선, occupied-cell class key Unicode code-point 순
- Metrics: choice-required physical-class Top-1, Top-3, MRR, mean selected rank

## 입력

- Source: `../Tetris_multi/data/logs/game-events.jsonl`
- Historical dataset: `data/datasets/human-behavior-v2-temporal-cumulative-75g-20260718`
- New dataset: `data/datasets/human-behavior-v2-temporal-cumulative-125g-20260720`
- Checkpoint: `data/ml-experiments/placement-v4-cumulative-75g-development-fit/full-report.json`
- Required environment variables: `PLACEMENT_V4_FROZEN_RUN_MODE`, `PLACEMENT_V4_FROZEN_REPORT`

## 허용 변경

- `scripts/export-placement-dataset.js`
- `ai-harness/ml-experiments/experiments/placement-v4-frozen-75g-temporal-holdout-50g.md`
- `scripts/ml/notebooks/placement_v4_frozen_75g_temporal_holdout_50g.ipynb`
- `scripts/ml/tests/test_placement_v4_frozen_temporal_holdout_notebook.py`

## 금지 변경

- Production/runtime/PVE와 migration
- 기존 75게임 dataset과 checkpoint
- JavaScript scorer/trainer와 final trainer
- 기존 dirty/untracked 파일

## 구현 산출물

- Source Notebook: `scripts/ml/notebooks/placement_v4_frozen_75g_temporal_holdout_50g.ipynb`
- Contract test: `scripts/ml/tests/test_placement_v4_frozen_temporal_holdout_notebook.py`
- Smoke report: `/private/tmp/placement-v4-frozen-75g-temporal-holdout-50g-smoke.json`
- Full report: `data/ml-experiments/placement-v4-frozen-75g-temporal-holdout-50g/full-report.json`
- Full report SHA-256: `e7e2af381d420999dd2d993f542d897767ff5bf4563c2d553df5e57b2f921264`
- Executed Notebook: `data/ml-experiments/placement-v4-frozen-75g-temporal-holdout-50g/full-executed.ipynb`
- Executed Notebook SHA-256: `f08e36da895c45623afc49260f636c04c131ddf2168e6f69db674fd2a44bd7de`

## Smoke 범위

신규 cohort를 Unicode code-point로 정렬해 첫 normal game 1개와 첫 hard game 1개만 고른다. Full과 같은 loading, grouping, frozen scaling, scoring과 metric 함수를 사용한다.

## Full 실행 계약

`PLACEMENT_V4_FROZEN_RUN_MODE=full`로 신규 50게임 전체를 평가한다. Full도 parameter를 fit하거나 조정하지 않는다.

Routine report 상태:

- Smoke: `fullCohortCovered: false`, `policyDecisionEligible: false`, `canonicalResultEligible: false`
- Full 1회: `fullCohortCovered: true`, gate 통과 시 `policyDecisionEligible: true`, `canonicalResultEligible: false`

## Primary metric과 진단

- Primary: 전체·normal·hard choice-required physical-class Top-1, Top-3, MRR, mean selected rank
- Diagnostics: game macro/median/min/max, worst game, tie, duplicate, line-clear option, gameOver, checksum과 leakage

## Decision rule

- Result: `temporal_holdout_passed`
- Representation: `keep_v4`
- Cohort: `admit_50g_to_training_pool`
- Next gate: `ready_to_freeze`
- 이 결정은 Human imitation ranking에만 적용되며 production 또는 game-over safety 승인이 아니다.

## Stop conditions

- Source, dataset 또는 checkpoint checksum mismatch
- Base/new gameId leakage
- Frozen parameter fit 또는 non-finite score
- Expected cohort count mismatch
- Allowlist 밖 변경

## 최종 보고

1. 상태
2. Input/cohort와 checksum
3. Smoke 결과
4. 검증
5. Full 실행 명령
6. game-over 안전성 한계
