# ML Experiment Constraints

Placement ranking과 Human 조작 ML 실험의 공통 계약이다. 과제별 입력·정답·시간과
지원 ruleset은 현재 실험 명세와 연결된 dataset 계약에서 정한다.

## 1. 책임 경계

- 기존 게임 core·validator·후보 생성을 재사용한다. 기존 placement exporter는
  legacy dataset 경계이며 Human 행동 dataset의 필수 형식으로 강제하지 않는다.
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

- Live log를 모델 fit에 직접 사용하지 않고 원본을 고정한 뒤 과제에 맞는 versioned dataset을 만든다.
- 기존 dataset 경로를 덮어쓰지 않는다.
- Source checksum과 line 수를 실행 전후 비교한다.
- Dataset schema, 생성 정책·revision, ruleset·좌표·관찰 단계·trust와 output checksum을 기록한다.
- Split은 `gameId` 단위다.
- Validation/test는 scaler, 학습용 pair·weight·시간 기준 계산과 model fit에 들어가지 않는다.
- 예측 시점 이후 label·winner·outcome·미래 행동을 feature로 사용하지 않는다.
  조작 모델은 그 시점까지 관측된 입력 이력을 사용할 수 있다. 다음 행동과 대기시간은
  정답이며 완성된 inputSequence 전체를 현재 판단의 입력으로 제공하지 않는다.
- 관측하지 못한 상태·입력 성공·hold 직전 문맥은 추정값으로 조용히 채우지 않는다.
  Human 로그와 AI 로그, client_reported와 서버 확정 결과를 구분한다.
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

## 7. 과제별 계약

- Legacy placement ranking: [기존 dataset·평가 계약](../../docs/ai-ml/contracts/placement-ml-evaluation-contract.md).
  `selectedBySource`는 label 전용, outcome은 사후 segment 전용이며 heuristic score와
  Human inputSequence는 이 16-feature 모델의 입력에서 제외한다. 기존 26게임·V0~V4의
  판단은 [역사 목차](../../docs/archive/ai-ml/README.md)를 따른다.
- Human 조작·시간·hold: [설계 계약](../../docs/ai-ml/contracts/human-action-dataset.md).
  행동 구간의 경계·지원 상태·시간 의미·누락 처리를 먼저 검증한다.
- 현재 작업 순서는 [AI 계획](../../docs/ai-ml/strategy/ai-plan.md)에서 확인한다.
  과거 spec의 next gate나 추천 MODE는 새 작업을 시작하는 지시가 아니다.
