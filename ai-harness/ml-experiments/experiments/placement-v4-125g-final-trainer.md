# ML Experiment: Placement V4 125-game final trainer

## 상태

- Experiment ID: `placement-v4-125g-final-trainer`
- Recommended mode: `analyze-result`
- Result status: `candidate_artifact_validated`
- Lead decision: `candidate_artifact_validated`
- Preserve candidate artifact: `true`
- Program gate: `candidate_artifact_validated`
- Frozen policy: `V4`, `ready_to_freeze`

## 질문 하나

동결된 V4 feature·pair weight·scaler·estimator 계약을 일반 Python trainer로 추출하고, immutable 125-game accepted cohort에서 결정적인 candidate artifact를 만들 준비가 되었는가?

## Baseline과 변경 변수

- Baseline: 검증된 75-game V4 development fit과 50-game frozen temporal holdout
- Changed variable: Notebook이 아닌 Python CLI에서 누적 125-game cohort 전체를 batch fit하는 실행 경계
- Candidate: V4 단일 trainer. representation 또는 estimator 비교는 하지 않는다.

## 고정 조건

- Dataset/cohort: `data/datasets/human-behavior-v2-temporal-cumulative-125g-20260720`의 accepted train/validation rows 전체
- Feature: 기존 16-feature와 순서
- Scaler: 선택한 training cohort의 raw candidate 전체에 한 번 fit한 `StandardScaler`
- Pair: selected occupied-cell class 대 고유한 non-selected occupied-cell class
- Weight: decision별 physical-class pair weight 합 1, symmetric sample 양쪽에 절반씩 배분
- Estimator: `LogisticRegression(solver="lbfgs", fit_intercept=False, class_weight=None)`
- Hyperparameter: `tol=1e-12`, `max_iter=10000`, `l2=0.01`, `C=1/(accepted training decision count × l2)`
- Ordering: game, decision, placement, occupied-cell class 모두 Unicode code-point 순
- Metrics: scaler, coefficient, pair/sample weight, convergence와 optimization 진단만 기록한다.

이 trainer는 held-out 평가를 하지 않는다. 검증된 Full artifact도
`productionIntegration=false`, `canonicalArtifact=false`다.

## 입력

- Source: immutable cumulative dataset four-file bundle
- Historical checkpoint: `data/ml-experiments/placement-v4-cumulative-75g-development-fit/full-report.json`
- Temporal evidence: `data/ml-experiments/placement-v4-frozen-75g-temporal-holdout-50g/full-report.json`
- New dataset: `data/datasets/human-behavior-v2-temporal-cumulative-125g-20260720`
- Required environment variables: 없음. CLI 인자를 명시한다.

Expected SHA-256:

- `manifest.json`: `07fa9b76e868ac10f3cf4893aa7200ba0808971979f7f796152f7b3bfb3bd6ef`
- `train.jsonl`: `986b5a6214aad13f13a239e4fe4a7c81582383dea6b16b1be6f046f2dbadd436`
- `validation.jsonl`: `c468e24bbc48d94af5860bd2e5c7b90f2366a9cb9a32dba3abe7cdcce7af67bb`
- `rejected.jsonl`: `0a19fab244c167384fdd5584f7495987ba4833576664fb78c1feacdb14d120e0`

Expected accepted cohort:

- game: `125`
- decision: `5,682` (`normal 4,500`, `hard 1,182`)
- candidate: `192,129`
- source: `human`
- selection policy: `all-completed`
- JSON parse failure: `0`

## 허용 변경

- `scripts/ml/train_placement_v4.py`
- `python_tests/test_train_placement_v4.py`
- `ai-harness/ml-experiments/experiments/placement-v4-125g-final-trainer.md`

## 금지 변경

- Production/runtime/PVE와 migration
- JavaScript scorer 또는 runtime integration
- Dataset export, copy, mutation
- Notebook import 또는 실행
- V0/V1/V2/V3 비교, LOGO, held-out evaluation, gameplay metric
- Feature, V4 representation, scaler, estimator 또는 hyperparameter 변경
- 기존 dirty/untracked 파일

## 구현 산출물

- Trainer: `scripts/ml/train_placement_v4.py`
- Contract/unit test: `python_tests/test_train_placement_v4.py`
- Experiment specification: 이 파일
- Smoke model: `/private/tmp/placement-v4-125g-smoke/model.json`
- Smoke report: `/private/tmp/placement-v4-125g-smoke/training-report.json`
- Full candidate model: `data/models/placement-v4-125g-candidate/model.json`
- Full training report: `data/models/placement-v4-125g-candidate/training-report.json`
- Model SHA-256: `ff64b0d3e4cd9eb6c6d7920f2cbe961f1d70e4c90ccc69a5d9ab8bcd410cb33d`
- Training report SHA-256: `175fa886adec2f84de68da6e78ab79102ef707b4ccb54cf01ec7e93045ecc7ca`

Artifact writer는 source의 lexical path, realpath, symlink와 inode alias를
거부한다. JSON은 serialization 성공 후 같은 디렉터리의 무작위 exclusive
staging file에 열린 handle로 기록하고 `fsync`한 뒤 `os.replace`한다.

## Smoke 범위

125-game bundle 전체의 checksum, schema와 manifest count를 먼저 확인한 뒤,
Unicode code-point 순 첫 2게임만 선택한다. Full과 같은 loading, 16-feature,
raw-candidate scaler, V4 grouping, pair weight, symmetric sample, estimator와
artifact writer를 사용한다.

```bash
conda run -n tetris-ml python scripts/ml/train_placement_v4.py \
  --dataset data/datasets/human-behavior-v2-temporal-cumulative-125g-20260720 \
  --output-dir /private/tmp/placement-v4-125g-smoke \
  --max-games 2
```

Smoke result는 반드시 다음 경계를 유지한다.

- `runMode: smoke`
- `fullCohortCovered: false`
- `productionIntegration: false`
- `canonicalArtifact: false`
- `heldOutEvidence: false`
- `status: awaiting_user_full_run`

## Full 실행 계약

사용자 승인 후에만 125게임 full fit을 두 번 수행한다. 두 output directory의
`model.json`과 `training-report.json`은 각각 byte-identical이어야 한다.

```bash
conda run -n tetris-ml python scripts/ml/train_placement_v4.py \
  --dataset data/datasets/human-behavior-v2-temporal-cumulative-125g-20260720 \
  --output-dir /private/tmp/placement-v4-125g-final-run1 \
  --max-games 125

conda run -n tetris-ml python scripts/ml/train_placement_v4.py \
  --dataset data/datasets/human-behavior-v2-temporal-cumulative-125g-20260720 \
  --output-dir /private/tmp/placement-v4-125g-final-run2 \
  --max-games 125

cmp /private/tmp/placement-v4-125g-final-run1/model.json \
  /private/tmp/placement-v4-125g-final-run2/model.json
cmp /private/tmp/placement-v4-125g-final-run1/training-report.json \
  /private/tmp/placement-v4-125g-final-run2/training-report.json
```

Run1/Run2와 project ignored 보존본은 byte-identical하며 source checksum도
불변이다. 이 검증은 production 또는 canonical artifact 승격을 뜻하지 않는다.

## Full result analysis

- Result: `candidate_artifact_validated`
- Preservation: `preserve_candidate_artifact=true`
- Determinism: Run1/Run2 model과 training report의 byte 비교 통과
- Accepted cohort: 125 games, 5,682 decisions, 192,129 candidates
- Difficulty: normal 4,500 decisions, hard 1,182 decisions
- V4 representation: 123,130 pairs, 4 pairless decisions, 246,260 symmetric samples
- Fit: 21 iterations, convergence/unexpected warnings `0 / 0`
- Model/report linkage: report의 model SHA와 실제 model SHA 일치
- Dataset: 네 source checksum 실행 전후 불변
- Boundary: `canonicalArtifact=false`, `productionIntegration=false`, `heldOutEvidence=false`

75-game coefficient와 125-game coefficient의 cosine similarity는
`0.999745080616792`이며 데이터 확장으로 방향이 흔들린 증거는 없다. 이번
weighted training log loss는 optimization 진단일 뿐 성능 근거가 아니다.
성능 근거는 기존 50-game frozen temporal holdout에 한정한다.

## Primary metric과 진단

- Primary: 없음. 이 checkpoint는 held-out 성능을 계산하지 않는다.
- Secondary: 없음.
- Diagnostics: fitted game/decision/candidate 수, V4 pair와 pairless decision, symmetric sample, sample-weight 합, scaler mean/scale, coefficient, iteration, warning, weighted training log loss

`weightedTrainingLogLoss`는 optimizer 진단일 뿐 held-out 성능이 아니다.

## Decision rule

- Result: `candidate_artifact_validated`
- Preserve: ignored candidate 경로의 검증된 Run1 artifact를 유지한다.
- Reject: source/checksum/schema/V4/weight/scaler/convergence/determinism/output safety 계약 위반
- Full candidate: Run1/Run2 byte 결정성과 source 불변성 검증을 통과했다.
- Production: 이 experiment에서 자동 승인하지 않는다.

## Stop conditions

- Source checksum 또는 expected 125/5,682/192,129 cohort mismatch
- Human/all-completed/parse-failure 계약 위반
- selected candidate 또는 occupied-cell equivalence 계약 위반
- Non-finite scaler, coefficient, sample weight 또는 diagnostic
- Convergence/unexpected warning
- Decision-balanced weight 위반
- Source/output alias 또는 source mutation
- Non-deterministic smoke artifact
- Allowlist 밖 변경
- 사용자 승인 없는 125-game full fit

## 최종 보고

1. 상태와 user full-run gate
2. 변경 파일
3. Input/cohort와 checksum
4. Smoke pair·weight·fit 결과
5. output safety와 결정성 테스트
6. 전체 검증
7. 사용자 full 실행 명령
8. held-out/production 증거가 아니라는 한계
