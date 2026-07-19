# ML Experiment: Placement V4 PVE gameplay benchmark

## 상태

- Experiment ID: `placement-v4-pve-gameplay-benchmark`
- Recommended mode: `analyze-result`
- Program gate: `placement_v4_gameplay_evaluation_closed`
- Full benchmark status: `gameplay_screening_passed`
- Program decision: `imitation_only_not_gameplay_ready`
- Production decision: `keep_heuristic_default`
- `productionIntegration=false`
- `canonicalArtifact=false`
- `canonicalResultEligible=false`

## 질문 하나

동일한 결정적 7-bag stream에서 frozen V4가 기존 heuristic보다 큰 gameplay 회귀 없이 생존하는가?

## Baseline과 변경 변수

- Baseline: 기존 heuristic placement policy
- Changed variable: placement 선택 policy만 `heuristic`에서 `placement_v4`로 변경
- Candidate: SHA가 고정된 V4 pairwise linear ranker

## 고정 조건

- 같은 seed에서 만든 동일 7-bag stream
- 같은 빈 초기 board
- 기존 authoritative core와 `processAiStep()`
- hard execution profile
- incoming garbage 없음
- 정상 종료는 `GAME_OVER` 또는 `PLACEMENT_CAP`만 허용 (`NO_LEGAL_PLACEMENT` game-over 포함)
- model 재학습, feature 변경, production 기본값 변경 없음

## 입력

- Model: `data/models/placement-v4-125g-candidate/model.json`
- Model SHA-256: `ff64b0d3e4cd9eb6c6d7920f2cbe961f1d70e4c90ccc69a5d9ab8bcd410cb33d`
- Runner: `scripts/run-placement-v4-pve-gameplay-benchmark.js`

## 구현 산출물

- Source Notebook: `scripts/ml/notebooks/placement_v4_pve_gameplay_benchmark.ipynb`
- Node test: `test/testPlacementV4PveGameplayBenchmark.js`
- Notebook contract test: `python_tests/test_placement_v4_pve_gameplay_benchmark_notebook.py`
- Smoke report: `/private/tmp/placement-v4-pve-gameplay-smoke-run{1,2}.json`
- Timing report: `/private/tmp/placement-v4-pve-gameplay-smoke-timing-run{1,2}.json`

## Smoke 범위

- stream 3개
- policy 2개
- stream당 최대 50 placements
- 총 6 rollout
- 같은 실행을 두 번 수행하고 canonical raw report bytes를 비교
- timing은 별도 non-canonical report로 분리

## Primary metric과 진단

- Primary: game-over 또는 cap까지 placement 수
- Secondary: lines/attack lines per 100 placements, average/final holes, average/final max height
- Safety: invalid decision, model fallback, plan divergence, non-finite score, unexpected error
- Paired diagnostics: cap/cap horizon 생존, cap/game-over survival win/loss, 동일 game-over placement의 exact tie와 V4-minus-heuristic placement delta
- Non-canonical timing: first decision latency와 decision latency p50/p95

## Screening decision rule

- safety event가 하나라도 있으면 `gameplay_benchmark_safety_failed`
- 고정 full cohort는 `streams=30`, `maxPlacements=500`, `seedPrefix=placement-v4-gameplay-full`을 모두 만족해야 한다
- 30-stream 고정 full cohort에서 `heuristicHorizonCount - v4HorizonCount`가 3 이하면 pass, 4 이상이면 `gameplay_regression_detected`
- 그 외에는 `gameplay_screening_passed`

Screening pass는 production 승격이나 V4 우월 판정이 아니다. lines, attack, holes, max height는 secondary diagnostic으로만 유지한다.
Report는 `runMode`, `fullCohortCovered`, `policyDecisionEligible`, `canonicalResultEligible=false`와 horizon count/rate를 함께 기록한다. 고정 full cohort 밖에서는 `runMode=smoke`, `fullCohortCovered=false`, `policyDecisionEligible=false`다.

## Full 결과와 기술 리드 결정

2026-07-20 고정 full cohort 30개를 한 번 실행했다.

- 보존 report: `data/ml-experiments/placement-v4-pve-gameplay-benchmark/full-report.json`
- Report schema: `2`
- Report SHA-256: `0eef91f9536b6192aecb7bfdc13412a566d0bc3b7aa3df84dd5afc12c97490d1`
- Model SHA-256: `ff64b0d3e4cd9eb6c6d7920f2cbe961f1d70e4c90ccc69a5d9ab8bcd410cb33d`
- `runMode=full`, `fullCohortCovered=true`, `policyDecisionEligible=true`
- `canonicalResultEligible=false`, `productionIntegration=false`
- Heuristic/V4 500-placement horizon 도달: `30/30`, `27/30`
- `bothSurvivedHorizon=27`, `v4SurvivalLoss=3`, `v4SurvivalWin=0`
- Safety event와 model fallback: 모두 `0`

사전 고정 rule에서 horizon count 차이 `3`은 pass 경계이므로 benchmark status는 `gameplay_screening_passed`다. 그러나 V4는 세 stream에서 각각 313, 487, 220 placements에 game-over가 발생했고 heuristic은 30개 모두 horizon에 도달했다. Secondary board diagnostics도 V4의 gameplay replacement를 지지하지 않았다.

V4는 Human placement imitation과 결정적 ranking을 위한 모델로는 유효하다. 하지만 Human이 고른 placement를 모사하는 목적과 장기 생존 gameplay policy를 대체하는 목적은 동일하지 않다. 따라서 program decision은 `imitation_only_not_gameplay_ready`, production decision은 `keep_heuristic_default`다.

이 결론은 V4가 모든 gameplay 상황에서 열등하다는 주장도, heuristic이 최적이라는 주장도 아니다. 고정 30-stream screening에서 V4를 기본 gameplay policy로 교체할 근거가 부족하다는 범위의 결론이다.

## Smoke 실행

~~~bash
node scripts/run-placement-v4-pve-gameplay-benchmark.js \
  --model data/models/placement-v4-125g-candidate/model.json \
  --output /private/tmp/placement-v4-pve-gameplay-smoke-run1.json \
  --timing-output /private/tmp/placement-v4-pve-gameplay-smoke-timing-run1.json \
  --streams 3 \
  --max-placements 50 \
  --seed-prefix placement-v4-gameplay-smoke
~~~

Run2는 output 이름만 `run2`로 바꾼 뒤 canonical report 두 개를 `cmp`한다. Timing report는 비교 대상이 아니다.

## Full 실행 기록

`implement-smoke`의 이번 작업에서는 실행하지 않는다. 이후 사용자가 아래 고정 명령으로 30 paired streams, policy 2개, 총 60 rollout을 한 번 실행했고 위 full 결과로 분석했다.

~~~bash
node scripts/run-placement-v4-pve-gameplay-benchmark.js \
  --model data/models/placement-v4-125g-candidate/model.json \
  --output /private/tmp/placement-v4-pve-gameplay-full.json \
  --timing-output /private/tmp/placement-v4-pve-gameplay-full-timing.json \
  --streams 30 \
  --max-placements 500 \
  --seed-prefix placement-v4-gameplay-full
~~~

## 수동 smoke

각 실행은 별도 터미널과 별도 log를 사용한다.

~~~bash
env -u PVE_PLACEMENT_V4_MODEL_PATH \
GAME_EVENTS_LOG_PATH=/private/tmp/pve-heuristic-normal.jsonl npm start

PVE_PLACEMENT_V4_MODEL_PATH=data/models/placement-v4-125g-candidate/model.json \
GAME_EVENTS_LOG_PATH=/private/tmp/pve-v4-normal.jsonl npm start

PVE_PLACEMENT_V4_MODEL_PATH=data/models/placement-v4-125g-candidate/model.json \
GAME_EVENTS_LOG_PATH=/private/tmp/pve-v4-hard.jsonl npm start
~~~

각 서버에서 PVE를 한 게임씩 시작해 heuristic normal, V4 normal, V4 hard를 확인한다. 서버 오류, ticker 정지, AI placement, garbage 반영과 game-over 종료를 확인한다. V4 성공 게임 log에 `source=heuristic_ai`, `modelType=heuristic` placement가 있으면 fallback으로 판정한다.

## 중단 조건

- model SHA 불일치
- 같은 paired stream의 bag checksum 불일치
- invalid decision, plan divergence, non-finite score 또는 unexpected error
- V4 fallback을 성공 V4 rollout으로 오인
- canonical report 비결정성
- full 30-stream 실행 또는 production 정책 변경

## 다음 gate

이 gameplay evaluation은 `placement_v4_gameplay_evaluation_closed`로 종료한다.

- 100-stream 확장 없음
- hybrid 실험 없음
- 재학습 없음
- production/PVE 기본값 변경 없음
- 기본 policy는 heuristic 유지

V4 artifact는 Human imitation·offline analysis 용도로만 유지한다. 별도의 새로운 질문과 기술 리드 승인이 없는 한 gameplay replacement 실험을 이어가지 않는다.
