# ML Experiment: <name>

## 상태

- Experiment ID: `<id>`
- Lifecycle: `<proposed / active / closed / deferred>`
- Task: `<placement ranking / action timing / next action / hold / data audit>`
- Recommended mode: `implement-smoke`
- Program gate: `continue_experimenting`

## 질문 하나

<이번 실험에서 답할 질문>

## Baseline과 변경 변수

- Baseline: <기존 방식>
- Changed variable: <하나만>
- Candidate: <비교 방식>

## 고정 조건

- Dataset/cohort:
- Feature:
- Scaler:
- Estimator:
- Hyperparameter:
- Ranking/tie-break:
- Metrics:
- Supported ruleset/geometry/observation stage:
- Learning unit and prediction time:
- Observed input / target label:
- History and hold boundary (if applicable):
- Missing-data and replay policy:

## 입력

- Source:
- Historical dataset:
- New dataset:
- Required environment variables:

## 허용 변경

- <file allowlist>

## 금지 변경

- Production/runtime/PVE
- Migration
- 기존 dirty/untracked 파일
- <experiment-specific restrictions>

## 구현 산출물

- Source Notebook:
- Contract test:
- Optional walkthrough:
- Smoke report:
- Full report:

## Smoke 범위

<full과 같은 경로로 처리할 작은 입력>

## Full 실행 계약

<사용자가 실행할 환경변수와 명령>

Routine report 상태:

- Smoke: `fullCohortCovered: false`, `policyDecisionEligible: false`, `canonicalResultEligible: false`
- Full 1회: `fullCohortCovered: true`, gate 통과 시 `policyDecisionEligible: true`, `canonicalResultEligible: false`
- Canonical/freeze: 반복 결정성 검증과 별도 승인 후에만 `canonicalResultEligible: true`

## Primary metric과 진단

- Primary:
- Secondary:
- Diagnostics:
- Execution/rollout checks (if applicable):
- Human-perception and speed-matched comparison (if applicable):

데이터 감사처럼 fit하지 않는 실험은 scaler/estimator를 해당 없음으로 표시하고,
복원 가능한 범위와 count invariant를 정의한다.

## Decision rule

- Adopt:
- Reject:
- Need more data:
- 정량 threshold가 비어 있으면 자동 채택하지 않고 `needs_policy_decision`으로 종료한다.

## Stop conditions

- Leakage
- Baseline mismatch
- Source mutation
- Non-deterministic ordering
- Allowlist 밖 변경
- <experiment-specific stop>

## 최종 보고

1. 상태
2. 변경 파일
3. Input/cohort와 checksum
4. Smoke 또는 full 결과
5. 검증
6. Decision 또는 다음 실행 명령
7. 남은 위험
