# ML Experiment: Placement V4 cumulative 75-game development fit

## 상태

- Experiment ID: `placement-v4-cumulative-75g-development-fit`
- Recommended mode: `analyze-result`
- Program gate: `continue_experimenting`
- Current checkpoint: `development_checkpoint_valid`
- Lead decision: `development_checkpoint_valid`

## 질문 하나

이미 temporal holdout에서 채택한 V4 pair representation을 고정한 채, 검증된 cumulative 75-game cohort 전체로 결정적인 development-only batch fit checkpoint를 만들 수 있는가?

## Baseline과 변경 변수

- Baseline: temporal holdout에서 채택한 V4 occupied-cell class-balanced pair contract
- Changed variable: training cohort를 immutable 26-game snapshot에서 cumulative 75 accepted games로 확장
- Candidate: 비교 candidate 없음. V4 단일 fit만 수행한다.

## 고정 조건

- Dataset/cohort: `data/datasets/human-behavior-v2-temporal-cumulative-75g-20260718`의 accepted train/validation rows 전체
- Feature: 기존 16-feature와 순서 고정
- Scaler: 선택한 training cohort의 raw candidate 전체에 한 번 fit한 `StandardScaler`
- Estimator: `LogisticRegression(solver="lbfgs", fit_intercept=False, class_weight=None)`
- Hyperparameter: `tol=1e-12`, `max_iter=10000`, `l2=0.01`, `C=1/(training decision count × l2)`
- Ranking/tie-break: 평가를 수행하지 않는다. 이 checkpoint는 held-out 성능 증거가 아니다.
- Metrics: scaler, coefficient, pair/sample weight, convergence와 optimization 진단만 기록한다.

## 입력

- Source: immutable cumulative dataset four-file bundle
- Historical dataset: 없음
- New dataset: `data/datasets/human-behavior-v2-temporal-cumulative-75g-20260718`
- Required environment variables:
  - `PLACEMENT_V4_DEVELOPMENT_REPORT`
  - `PLACEMENT_V4_MAX_TRAINING_GAMES` (`2` smoke, `75` full)
  - `PLACEMENT_V4_DEVELOPMENT_DATASET`는 기본 상대 경로를 바꿔야 할 때만 사용

Expected SHA-256:

- `manifest.json`: `dbf1dd5f30177abc3b44d7bdcc7e21aaf2f8a3d0015a96ba6bdfd9506c71487a`
- `train.jsonl`: `0a71b121514016721d50bda5e01b298002fe8820e0a110f6b62945b4f1550120`
- `validation.jsonl`: `65511767072d46484a5e4e15821bde2ee91957d02b1e16af35ec5e9da2c5274d`
- `rejected.jsonl`: `84c93b3b1d8e4d82eb4dcf094bab28c35d8834dedf9566bfbe72b008b47b1085`

Expected accepted cohort:

- game: `75`
- decision: `3,480`
- candidate: `117,805`
- manifest lifecycle game count: `76` (accepted training game count와 다른 의미)

## 허용 변경

- `ai-harness/ml-experiments/experiments/placement-v4-cumulative-75g-development-fit.md`
- `scripts/ml/notebooks/placement_v4_cumulative_75g_development_fit.ipynb`
- `scripts/ml/tests/test_placement_v4_cumulative_development_fit_notebook.py`
- `scripts/ml/summarize_placement_v4_development_fit.py`
- `scripts/ml/tests/test_summarize_placement_v4_development_fit.py`

## 금지 변경

- Production/runtime/PVE
- Migration
- 기존 dirty/untracked 파일
- Dataset export, copy, mutation
- V0/V1/V2/V3 비교, LOGO, held-out 성능 평가
- Feature, scaler, estimator 또는 hyperparameter 변경
- Final trainer `.py`, JavaScript scorer, deployable model artifact

## 구현 산출물

- Source Notebook: `scripts/ml/notebooks/placement_v4_cumulative_75g_development_fit.ipynb`
- Contract test: `scripts/ml/tests/test_placement_v4_cumulative_development_fit_notebook.py`
- Full report summarizer: `scripts/ml/summarize_placement_v4_development_fit.py`
- Summarizer test: `scripts/ml/tests/test_summarize_placement_v4_development_fit.py`
- Optional walkthrough: Notebook Markdown 자체
- Smoke report: `/private/tmp/placement-v4-cumulative-75g-development-fit-smoke.json`
- Full report: `/private/tmp/placement-v4-cumulative-75g-development-fit-full.json`

## Smoke 범위

Unicode code-point 순서의 첫 2개 accepted game을 선택한다. Full과 같은 checksum, schema, V4 class grouping, raw-candidate scaler, symmetric sample, decision-balanced weight, estimator와 checkpoint writer를 사용한다. Smoke coefficient는 full checkpoint가 아니며 보존·승격 대상이 아니다.

## Full 실행 계약

사용자 승인 후에만 다음을 실행한다.

```bash
PLACEMENT_V4_DEVELOPMENT_DATASET=data/datasets/human-behavior-v2-temporal-cumulative-75g-20260718 \
PLACEMENT_V4_MAX_TRAINING_GAMES=75 \
PLACEMENT_V4_DEVELOPMENT_REPORT=/private/tmp/placement-v4-cumulative-75g-development-fit-full.json \
conda run -n tetris-ml python -m jupyter nbconvert \
  --to notebook \
  --execute scripts/ml/notebooks/placement_v4_cumulative_75g_development_fit.ipynb \
  --output placement-v4-cumulative-75g-development-fit-executed-full.ipynb \
  --output-dir /private/tmp \
  --ExecutePreprocessor.timeout=1200
```

Full report가 생성된 뒤 다음 명령으로 source dataset과 checkpoint 계약을
교차 검증하고 프로젝트의 ignored 실험 디렉터리에 결정적 요약을 만든다.

```bash
conda run -n tetris-ml python \
  scripts/ml/summarize_placement_v4_development_fit.py \
  /private/tmp/placement-v4-cumulative-75g-development-fit-full.json \
  --output-json data/ml-experiments/placement-v4-cumulative-75g-development-fit/summary.json \
  --output-md data/ml-experiments/placement-v4-cumulative-75g-development-fit/summary.md
```

Routine report 상태:

- Smoke: `fullCohortCovered: false`, `policyDecisionEligible: false`, `canonicalResultEligible: false`
- Full 1회: `fullCohortCovered: true`, `policyDecisionEligible: false`, `canonicalResultEligible: false`
- 이 실험은 development fit이므로 full 후에도 `developmentOnly: true`, `productionIntegration: false`를 유지한다.

## Primary metric과 진단

- Primary: 없음. held-out metric을 계산하지 않는다.
- Secondary: 없음.
- Diagnostics: fitted game/decision/candidate 수, V4 pair와 pairless decision, symmetric sample 수, sample-weight 합, scaler mean/scale, coefficient, iteration, convergence warning, weighted training log loss

## Decision rule

- Adopt: 해당 없음. 기존 `adopt_v4` 정책을 적용해 development checkpoint를 생성할 뿐이다.
- Reject: source/checksum/schema/V4/weight/scaler/convergence/determinism 계약 위반
- Need more data: 이 checkpoint로 held-out 성능이나 gameplay promotion을 판단하려는 경우
- 정량 threshold가 비어 있으면 자동 채택하지 않고 `awaiting_user_full_run`으로 종료한다.

## Full result analysis

2026-07-18 `MODE=analyze-result`에서 user-run full report와 executed
Notebook을 재학습 없이 검증했다.

- Lead decision: `development_checkpoint_valid`
- Full report SHA-256: `2ea7fe659220279c786d8c9c8e6f7ab6af70f970e0db985d6067b7a095c0ad53`
- Executed Notebook SHA-256: `1cd8a3d3b3c54413ea82e89f4793b46c70b535af36ce9a2ceb12152fcab48e56`
- Summarizer: `development_checkpoint_valid`, validation passed
- Accepted cohort: 75 games, 3,480 decisions, 117,805 candidates
- V4: 75,615 physical-class pairs, 4 pairless decisions, 151,230 symmetric samples
- Fit: 20 iterations, convergence/unexpected warnings `0 / 0`, weighted training log loss `0.16768123447440675`

`policyDecisionEligible: false` is intentional for this development-only
batch-fit experiment. Unlike a temporal evaluation, it has no held-out
performance metric and cannot change representation policy or promote a
production model.

The checkpoint therefore proves dataset/scaler/weight/estimator execution
integrity, not generalization, gameplay win rate, PVE readiness, or production
fitness.

## Next gate after development checkpoint

Collect and validate a new immutable temporal holdout cohort, then evaluate
the fixed V4 checkpoint without refitting it on those new games. Feature,
representation, scaler, estimator, runtime/PVE, JavaScript scorer, and final
trainer changes remain out of scope.

## Stop conditions

- Leakage
- Baseline mismatch
- Source mutation
- Non-deterministic ordering
- Allowlist 밖 변경
- expected 75/3,480/117,805 accepted cohort 불일치
- V4 외 representation 또는 evaluation 경로 진입
- non-finite scaler/coefficient/diagnostic
- convergence warning 또는 decision-balanced weight 위반

## 최종 보고

1. 상태
2. 변경 파일
3. Input/cohort와 checksum
4. Smoke 결과
5. 검증
6. 사용자 full 실행 명령
7. held-out 증거가 아니라는 한계
