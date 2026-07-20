# ML Experiment Constraints

모든 placement ML 실험에 적용하는 고정 계약이다. 실험 명세는 이 규칙을 반복하지 않고, 예외가 필요하면 이유와 승인을 명시한다.

## 1. 책임 경계

- 기존 JavaScript exporter는 로그 schema와 candidate 생성·전처리 경계다.
- 새 feature·pair·weight·모델·평가 실험은 Python에서만 수행한다.
- JavaScript에서 Python 실험을 다시 구현하지 않는다.
- 실험은 Jupyter Notebook으로 작성한다.
- Representation, feature, weight, scaler, estimator와 metric이 동결된 뒤에만 최종 trainer를 `.py`로 추출한다.
- Production model, runtime, PVE와 migration은 실험 범위에 포함하지 않는다.

## 2. 한 실험에서 한 질문

- 한 번에 feature, representation, weight, scaler, estimator 또는 metric 중 하나만 바꾼다.
- 비교 baseline과 고정 조건을 실행 전에 적는다.
- 결과를 본 뒤 tolerance, metric 또는 cohort 경계를 바꾸지 않는다.
- 기각 결과도 정상적인 완료 상태로 기록한다.

## 3. 데이터 계약

- Live log를 모델 fit에 직접 사용하지 않고 기존 exporter로 versioned dataset을 만든다.
- 기존 dataset 경로를 덮어쓰지 않는다.
- Source checksum과 line 수를 실행 전후 비교한다.
- Dataset schema, exporter 정책, 네 output checksum을 기록한다.
- Split은 `gameId` 단위다.
- Validation game과 candidate는 scaler, pair 생성, weight 계산과 model fit에 들어가지 않는다.
- `selectedBySource`는 label 식별에만, `metadata.isWinner`는 사후 segment에만 사용한다.
- Label, winner, 미래 outcome, heuristic score와 Human input sequence를 feature로 사용하지 않는다.
- 데이터만 추가하는 일반 반복에서는 외부 archive 복구를 연구 gate로 만들지 않는다. 원본 로그, cohort gameId와 checksum을 보존한다.

## 4. Notebook 계약

- `왜 → 무엇 → 어떻게 → 결과 → 한계 → 다음 gate` 흐름을 갖는다.
- 사용자가 손으로 따라갈 수 있는 작은 worked example을 포함한다.
- Source Notebook output과 execution count는 비워 둔다.
- 환경변수로 dataset과 report 경로를 받는다.
- 사용자 절대 경로, timestamp와 실행시간을 canonical report에 넣지 않는다.
- 정렬과 tie-break를 결정적으로 만든다.
- JSON report는 key를 결정적으로 정렬하고 `NaN`을 허용하지 않는다.
- `NaN`, `Infinity`, 누락값과 잘못된 입력을 거부한다.

## 5. 실행 분리

- `implement-smoke`는 정적 계약, targeted test와 작은 smoke까지만 수행한다.
- Smoke는 full과 같은 함수·변환 경로를 사용한다.
- Smoke report는 `runMode: smoke`, `fullCohortCovered: false`, `policyDecisionEligible: false`, `canonicalResultEligible: false`다.
- Smoke metric으로 모델 성능을 결론 내리지 않는다.
- Full 실행은 사용자가 복사할 명령으로 인계하는 것이 기본이다.
- 데이터만 추가되고 계산 코드가 같다면 full 한 번으로 시작한다.
- 계산 코드가 바뀌거나 동결 후보를 감사할 때만 full run1/run2 결정성을 요구한다.
- Routine full 한 번은 정책 판단 자료일 뿐 canonical/freeze 결과가 아니다.

## 6. 파일과 Git

- Source Notebook, 테스트와 설명 문서는 repository에 둔다.
- Executed Notebook, smoke/full report와 일시적 recheck는 `/private/tmp`에 둔다.
- `/private/tmp`를 source 또는 유일한 canonical 보관 위치로 사용하지 않는다.
- 실험 명세의 allowlist 밖 파일은 수정하지 않는다.
- 기존 dirty/untracked 변경을 stage, reset, stash, checkout 또는 삭제하지 않는다.
- Commit, push, merge와 rebase는 명시적인 권한이 있을 때만 수행한다.

## 7. 현재 연구 방향

- 26게임 cohort는 파이프라인·representation·weight 원인 분석을 끝낸 historical baseline이다.
- 새 로그는 먼저 temporal holdout으로 평가한 뒤 누적 training pool에 편입한다.
- V1~V3 decomposition을 새 데이터마다 반복하지 않는다.
- V0와 V4 비교는 신규 cohort에서 정책을 정하기 위한 비교이며, 결정 후에는 선택한 정책만 반복 학습한다.
- Full LOGO는 feature·weight·estimator 변경 또는 freeze 시점에만 다시 검토한다.
