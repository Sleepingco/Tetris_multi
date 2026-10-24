# ML Experiment: Placement Temporal Holdout V0 vs V4

## 상태

- Experiment ID: `placement-temporal-holdout-v0-v4`
- Recommended mode: `implement-smoke`
- Program gate: `v4_selected_for_next_temporal_cycle`
- Required history: Phase 8 commit `5f607b5`

## 질문 하나

기존 26게임으로만 학습했을 때 이후 추가된 신규 게임에서 V0와 V4 중 어느 pair representation이 더 안정적인가?

## Baseline과 변경 변수

- Baseline V0: raw generator candidate와 기존 pair weighting
- Candidate V4: 동일 occupied-cell class당 대표 row 하나와 alias-independent weighting
- Changed variable: pair representation과 그에 결합된 Phase 8의 V0/V4 weighting 계약

V1~V3 decomposition은 반복하지 않는다.

정확한 V0/V4 수학 계약의 단일 원천:

- `docs/ai-ml/contracts/placement-ml-evaluation-contract.md`
- `docs/ai-ml/experiments/placement-pair-weight-decomposition.md`
- `docs/ai-ml/experiments/results/placement-pair-weight-decomposition-result.json`
- `scripts/ml/notebooks/placement_pair_weight_decomposition_experiment.ipynb`
- `scripts/ml/tests/test_placement_pair_weight_decomposition_notebook.py`

이 명세의 요약 문장은 탐색을 돕기 위한 것이며 위 tracked 계약을 대체하지 않는다.

## 고정 조건

- Feature: 기존 16-feature allowlist와 순서
- Scaler: base 26게임의 training candidate에만 fit한 `StandardScaler`
- Estimator: 기존 `LogisticRegression`
- Solver, C, tolerance와 tie-break: Phase 8과 동일
- Training cohort: 기존 26게임 전체
- Validation cohort: cumulative dataset에서 26게임을 제외한 신규 game 전체
- Main evaluation unit: occupied-cell physical class

각 dataset의 `train.jsonl`과 `validation.jsonl`은 과거 exporter split과 무관하게 함께 읽는다. Temporal split은 그다음 `gameId` cohort로 새로 정의한다.

## 입력

- Base dataset: `data/datasets/human-behavior-v2-snapshot-26g-20260717`
- Cumulative source log: `/Users/parkseongho/visualstudio-workspace/Tetris_multi/data/logs/game-events.jsonl`
- Dataset exporter: `npm run dataset:export`
- Cumulative dataset: 실제 game count와 날짜를 사용한 새 경로

환경변수:

- `PLACEMENT_TEMPORAL_BASE_DATASET`
- `PLACEMENT_TEMPORAL_CUMULATIVE_DATASET`
- `PLACEMENT_TEMPORAL_REPORT`
- `PLACEMENT_TEMPORAL_MAX_VALIDATION_GAMES`

## Dataset 준비

- 새 전처리를 구현하지 않고 기존 exporter를 사용한다.
- Export 전에 source lifecycle, SHA와 line 수를 확인한다.
- Export 중 source가 바뀌면 중단한다.
- 기존 26게임 경로를 덮어쓰지 않는다.
- Base gameId가 cumulative gameId의 부분집합이어야 한다.
- New gameId는 `cumulative - base`로 계산한다.
- 외부 archive나 복구 실험은 이번 연구 gate가 아니다.

## 허용 변경

- `scripts/ml/notebooks/placement_temporal_holdout_v0_v4_experiment.ipynb`
- `scripts/ml/tests/test_placement_temporal_holdout_notebook.py`
- 필요할 때 `ai-harness/ml-experiments/experiments/placement-temporal-holdout-v0-v4.md`
- Git ignored 새 cumulative dataset 경로

## 금지 변경

- Preflight에서 발견한 기존 dirty/untracked 파일
- `docs/ai-ml/experiments/ai-experiments-log.md`
- 기존 Notebook과 canonical result
- `environment-ml.yml`, `package.json`과 JavaScript exporter
- `src/`, runtime, PVE, production과 migration
- Commit, push, merge와 rebase

## 구현 산출물

Notebook 단계:

1. 질문과 고정 조건
2. Base/cumulative manifest와 checksum
3. Base/new gameId 분리와 leakage gate
4. 기존 16-feature 추출
5. Base-only scaler
6. Phase 8과 동일한 V0/V4 train pair
7. 동일 estimator fit
8. New-game score와 rank
9. 전체·choice-required physical-class metric
10. Raw-candidate compatibility metric
11. Game별 분포, worst game, rank delta와 tie 진단
12. Source checksum 재확인과 결정적 JSON report

Worked example은 동일 physical class의 alias가 V0에서 반복 pair가 되고 V4에서 하나로 축약되는 과정을 보여 준다.

## Report

필수 필드:

- `runMode`
- `fullCohortCovered`
- `policyDecisionEligible`
- `canonicalResultEligible`
- Base/cumulative 네 checksum
- Base/new game count와 gameId digest
- Feature 순서와 scaler fit scope
- Estimator config
- V0/V4 pair·weight 진단
- Leakage와 convergence
- 전체·choice-required physical-class metric
- Raw-candidate diagnostic metric
- Game별 metric과 worst game
- Pairless, tie, duplicate와 rank-delta count
- Source checksum before/after
- `productionIntegration: false`

Timestamp, 사용자 절대 경로와 실행시간은 넣지 않는다.

## Smoke

- 정렬된 신규 gameId의 처음 1~2게임
- Base 26게임 training cohort는 줄이지 않음
- Full과 같은 함수와 변환 경로
- `runMode: smoke`
- `fullCohortCovered: false`
- `policyDecisionEligible: false`
- `canonicalResultEligible: false`
- Status: `awaiting_full_temporal_evaluation`
- 성능 결론 금지

## Primary metric과 진단

Primary:

- Choice-required physical-class Top-1, Top-3, MRR, mean selected rank

Secondary:

- 전체 physical-class metric
- Game별 macro와 worst game

Diagnostics:

- Raw-candidate metric
- Rank가 바뀐 decision
- Pairless decision
- Top-score tie와 selected-feature duplicate
- Pair 수, weight 총합, iteration과 convergence

## Decision rule

- 사전 합의된 정량 threshold가 없으므로 report만으로 V0/V4를 자동 채택하지 않는다.
- 결과 분석은 metric, game 분포, worst case와 alias-independent 의미를 함께 제시하고 `needs_policy_decision`으로 기술 리드에게 인계한다.
- 기술 리드가 V4의 physical semantics와 관측 trade-off를 검토해 `adopt_v0`, `adopt_v4`, `needs_more_data` 또는 `blocked`를 결정한다.
- Smoke 결과로 결정하지 않는다.
- Report를 본 뒤 임의 threshold를 새로 만들어 자동 승격하지 않는다.

## Full result decision

2026-07-18 `MODE=analyze-result`에서 full report를 독립 validator로
재검증했다. Full cohort 49게임, gameId leakage 0, source/dataset checksum
불변, V0/V4 convergence와 per-game aggregate 계약이 모두 통과했다.

- Full report SHA-256: `95695c460f5885d199212b07792636b14bdfc9a524104e278bd1c43bac431732`
- Primary choice-required physical-class MRR: V0 `0.7263681328680218`, V4
  `0.7265167713464018` (V4 - V0 `+0.000148638478379981`)
- Primary Top-1 count: V0 `1314`, V4 `1315`
- Game MRR distribution: V4 better `3`, equal `43`, worse `3`

기술 리드의 명시적 결정은 `adopt_v4`다. 이 결정은 사후 threshold로
자동 채택한 것이 아니라, V4의 alias-independent occupied-cell physical
semantics와 full cohort에서 관측된 작은 비열등 결과를 함께 고려한 정책
결정이다. 이는 production model, runtime/PVE 연결 또는 freeze 승인이 아니다.

다음 gate는 V4만 사용하는 다음 temporal cycle 전에 75-game cohort를 위한
immutable training snapshot의 provenance·checksum·gameId 경계를 검증하는
것이다. 새 feature, estimator, trainer 또는 runtime 통합은 이 gate에 포함하지
않는다.

## Stop conditions

- Source log 변경 또는 lifecycle 이상
- Base가 cumulative의 부분집합이 아님
- Base/new gameId leakage
- New candidate가 scaler, pair 또는 fit에 포함됨
- Phase 8 V0/V4 계약 불일치
- 기존 canonical result 또는 allowlist 밖 파일 변경
- Smoke 또는 필수 검증 실패

## `implement-smoke` 최종 보고

1. `implementation_ready_for_user_full_run` 또는 `blocked`
2. 변경 파일
3. Cumulative dataset과 base/new count
4. Checksum과 leakage
5. Notebook·V0/V4 계약
6. Smoke와 검증 결과
7. 실제 dataset 경로가 들어간 full 실행 명령 하나
8. 보존한 기존 dirty 파일
9. Commit하지 않았다는 확인
