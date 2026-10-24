# ML Experiment: Placement V4 reference inference and game-over safety

## 상태

- Experiment ID: `placement-v4-reference-inference-safety`
- Recommended mode: `implement-smoke`
- Result status: `reference_inference_valid`
- Game-over safety status: `gameover_safety_contract_valid`
- Program gate: `reference_inference_valid`
- Candidate artifact status: `candidate_artifact_validated`

## 질문 하나

동결된 artifact가 고정 candidate 입력에 결정적인 physical-class ranking을 만들고, 안전 후보가 있을 때 game-over 후보를 항상 제외하는가?

## Baseline과 변경 변수

- Baseline: 검증된 125-game V4 candidate artifact
- Changed variable: 학습 없이 Python reference inference와 game-over hard-safety policy를 적용한다.
- Candidate: 새 모델이나 score 변환 없이 raw linear score를 사용한다.

## 고정 조건

- Model: `data/models/placement-v4-125g-candidate/model.json`
- Feature: artifact에 기록된 기존 16-feature와 순서
- Scaler: artifact mean/scale
- Score: `coefficient dot ((raw - mean) / scale)`, 높은 값 우선
- Representation: V4 occupied-cell physical class
- Canonical representative: placement key Unicode code-point 순
- Score tie-break: occupied-cell equivalence key Unicode code-point 순
- Safety: 안전 class가 있으면 `gameOver=true` class를 ranking 전에 제외
- Metrics: 성능 metric 없음. score/rank/safety invariant만 검증한다.

Sigmoid와 확률 변환은 사용하지 않는다. `gameOver` coefficient가 0이므로
회피 정책은 score 밖의 명시적인 hard-safety 경계다.

## 입력

- Model: `data/models/placement-v4-125g-candidate/model.json`
- Training report: `data/models/placement-v4-125g-candidate/training-report.json`
- Fixture: `scripts/ml/tests/fixtures/placement_v4_reference_inference_fixture.json`
- Dataset/live log: 읽지 않음
- Required environment variables: 없음

Expected SHA-256:

- Model: `ff64b0d3e4cd9eb6c6d7920f2cbe961f1d70e4c90ccc69a5d9ab8bcd410cb33d`
- Training report: `175fa886adec2f84de68da6e78ab79102ef707b4ccb54cf01ec7e93045ecc7ca`
- Training report 내부 model SHA: model SHA와 동일

Artifact는 `canonicalArtifact=false`, `productionIntegration=false`,
`heldOutEvidence=false`를 유지한다.

## 허용 변경

- `scripts/ml/placement_v4_reference_inference.py`
- `scripts/ml/tests/test_placement_v4_reference_inference.py`
- `scripts/ml/tests/fixtures/placement_v4_reference_inference_fixture.json`
- `ai-harness/ml-experiments/experiments/placement-v4-reference-inference-safety.md`

## 금지 변경

- Production/runtime/PVE와 migration
- Model 재학습 또는 artifact 수정
- Feature, scaler, coefficient, representation 변경
- JavaScript scorer/parity
- Dataset/live log 접근 또는 변경
- Notebook, 새 dependency, framework, CSV
- 기존 dirty/untracked 파일

## 구현 산출물

- Reference inference: `scripts/ml/placement_v4_reference_inference.py`
- Contract test: `scripts/ml/tests/test_placement_v4_reference_inference.py`
- Fixture: `scripts/ml/tests/fixtures/placement_v4_reference_inference_fixture.json`
- Smoke run1: `/private/tmp/placement-v4-reference-inference-run1.json`
- Smoke run2: `/private/tmp/placement-v4-reference-inference-run2.json`
- Preserved report (ignored): `data/ml-experiments/placement-v4-reference-inference-safety/reference-report.json`

## Artifact validation

Loader는 schema version, model type, V4 representation, 16-feature 순서,
coefficient/weights 동일성, scaler 길이·finite·양수 scale을 검사한다. 누락,
잘못된 type, unsupported schema, NaN과 Infinity는 명시적으로 실패한다.

## V4와 hard-safety 계약

```text
candidate
→ occupied-cell physical class grouping
→ class feature/result 동일성 검사
→ raw linear score
→ 안전 class 존재 시 game-over class 제외
→ score 내림차순, class key 오름차순 tie-break
```

- Alias multiplicity는 class score와 선택에 영향을 주지 않는다.
- 안전 class가 하나 이상이면 game-over class의 final rank는 `null`이다.
- 모든 class가 game-over이면 모두 score하고 결정적인 하나를 선택하며
  `unavoidableGameOver=true`로 기록한다.

## Smoke 범위

Fixture의 세 scenario만 actual preserved artifact로 평가한다.

1. occupied-cell alias grouping과 canonical representative
2. 더 높은 score의 game-over class hard filter
3. all-game-over deterministic fallback

```bash
conda run -n tetris-ml python \
  scripts/ml/placement_v4_reference_inference.py \
  --model data/models/placement-v4-125g-candidate/model.json \
  --fixture scripts/ml/tests/fixtures/placement_v4_reference_inference_fixture.json \
  --output /private/tmp/placement-v4-reference-inference-run1.json

conda run -n tetris-ml python \
  scripts/ml/placement_v4_reference_inference.py \
  --model data/models/placement-v4-125g-candidate/model.json \
  --fixture scripts/ml/tests/fixtures/placement_v4_reference_inference_fixture.json \
  --output /private/tmp/placement-v4-reference-inference-run2.json

cmp /private/tmp/placement-v4-reference-inference-run1.json \
  /private/tmp/placement-v4-reference-inference-run2.json
```

Expected smoke status:

- `reference_inference_valid`
- `gameover_safety_contract_valid`
- `canonicalArtifact=false`
- `productionIntegration=false`
- `heldOutEvidence=false`

Observed smoke result:

- Run1/Run2 report SHA-256: `0a3e22013f2d8dbebb046d89a0cdd81ba06a42187c3919604ec91e5d18c10ac4`
- Fixture SHA-256: `98d1b9749f8ea1d0c43d0fddf305a228629d09b8356a207fc37ff8cf623b23ae`
- Run1/Run2 byte comparison: passed
- Alias scenario: 3 candidates → 2 physical classes, selected alias count 2
- Safety scenario: higher-score game-over class 1개 제외, safe class 선택
- All-game-over scenario: class-key tie-break로 deterministic fallback

## Full 실행 계약

별도 full 실행은 없다. 고정 fixture 전체가 이 reference contract의 smoke이자
완료 범위다. Dataset, live log 또는 gameplay benchmark로 확장하지 않는다.

## Primary metric과 진단

- Primary: 동일 입력의 selected physical class와 final rank 결정성
- Safety: safe class 존재 시 filtered game-over class 수와 선택 결과
- Diagnostics: class linear score, alias count, representative, final rank,
  `safeClassAvailable`, `filteredGameOverClassCount`, `unavoidableGameOver`

## Decision rule

- Valid: artifact·score·V4·tie-break·hard-safety·atomic output·결정성 계약 모두 통과
- Reject: schema, finite, class equivalence, safety, ordering, checksum 또는 source 불변성 위반
- Production: 이 실험에서 승인하지 않는다.

## Stop conditions

- Model 또는 training report SHA mismatch
- Report 내부 model SHA mismatch
- Model/fixture mutation
- Unsupported artifact schema 또는 feature order mismatch
- Same-class feature/result mismatch
- Safe class가 있는데 game-over class가 선택됨
- Candidate 순서에 따른 결과 변경
- Non-deterministic report
- Allowlist 밖 변경

## 최종 보고

1. 상태
2. 변경 파일
3. Artifact validation 계약
4. Fixture scenario와 결과
5. Run1/Run2 report SHA
6. Targeted/전체 검증
7. Model과 입력 불변성
8. Runtime integration이 아니라는 한계
9. 현재 Git 상태
