# AI Analysis Mode

이 모드는 규칙 기반 AI, feature 추출, 데이터셋 준비, ML 평가처럼 결과를 비교하고 검증해야 하는 AI 작업에 사용한다.
LLM 코칭 문구 작성이나 게임 규칙 구현을 대신하는 모드는 아니다.

## 목표

- AI가 해결할 문제와 성공 기준을 먼저 정의한다.
- 게임 상태, AI 판단, 게임 규칙의 책임을 분리한다.
- 같은 입력으로 같은 결과를 재현할 수 있게 만든다.
- 복잡한 모델보다 설명 가능한 baseline을 먼저 둔다.

## 입력

- 현재 AI 단계와 작업 목표
- AI가 읽는 state 또는 dataset schema
- AI가 반환하는 결과 계약
- 비교할 baseline과 평가 지표
- 현재 변경에서 허용된 통합 범위

## 출력 형식

1. 목표 또는 가설
2. 입력과 출력 계약
3. 비교 baseline
4. 최소 구현 또는 실험
5. 평가 지표와 결과
6. 위험 요소와 fallback
7. 재현 및 검증 방법

## 공통 설계 원칙

- AI는 직렬화 가능한 데이터만 읽고 DOM, Canvas, Socket.IO, 브라우저 타이머에 의존하지 않는다.
- 게임 규칙은 기존 `core`가 결정하고 AI는 후보 생성, 평가, 선택만 담당한다.
- 입력 board와 game state를 직접 변경하지 않는다.
- 점수 weight와 model parameter를 영구적인 게임 규칙처럼 취급하지 않는다.
- 후보 정렬과 동점 처리 규칙을 명시해 결과를 결정론적으로 만든다.
- 추론 실패 시 heuristic 또는 안전한 기본 정책으로 이어지는 fallback을 둔다.

## 규칙 기반 AI 확인 항목

- 모든 후보가 실제 게임 규칙상 유효한가
- 같은 입력에서 후보 목록과 선택 결과가 같은가
- simulation이 원본 state를 mutate하지 않는가
- evaluator가 score와 score 근거를 함께 제공하는가
- 빈 후보, game over 인접 상태, hold 사용 같은 경계 조건이 정의되어 있는가

## 데이터와 ML 작업 확인 항목

- feature 이름과 의미, `schemaVersion`, 데이터 `source`가 기록되는가
- 학습/검증 데이터가 같은 `gameId`에서 섞이지 않는가
- 미래 결과나 label 정보가 feature에 섞이는 leakage가 없는가
- `NaN`, `Infinity`, 누락값과 잘못된 board를 처리하는가
- 새 모델이 heuristic baseline보다 어떤 지표에서 나은지 비교할 수 있는가
- model version, feature version, 실행 조건으로 결과를 다시 만들 수 있는가

## 현재 프로젝트 단계

- 현재 범위와 선행 조건은 `PLAN.md`와 `docs/ai-ml/strategy/ai-plan.md`를 먼저 확인한다.
- 초기 PVE 단계 계획의 역사적 근거가 필요할 때만
  `docs/archive/ai-ml/plans/ai-pve-plan.md`를 확인한다.
- `boardMetrics -> placementGenerator -> simulatePlacement -> heuristicEvaluator`의
  순수 모듈 흐름은 현재도 재사용하는 분석 기준이다.
- Production/PVE 기본 정책은 heuristic이다. V4 경로는 명시적인 dev-only opt-in
  범위를 넘겨 승격하지 않는다.
- Python AI 서버, 강화학습, LLM 코칭은 별도 승인이 없는 한 현재 작업에 섞지 않는다.

## 반복 ML 실험 라우팅

Placement dataset, Notebook, feature, pair weighting 또는 sklearn 평가를 반복 실행하는 작업은 이 파일에 세부 계약을 복제하지 않는다.

다음 순서로 `ai-harness/ml-experiments/`를 추가 적용한다.

1. 공통 constraints와 workflow
2. verification profile
3. 현재 experiment 파일 하나
4. 현재 MODE에 필요한 implementation, documentation 또는 review task

기본 MODE는 `implement-smoke`다. Full 실행과 결과 분석은 각각 별도 gate로 분리한다.

## 검증 예시

- 고정 board fixture에서 예상한 후보 수와 최종 placement가 나오는가
- 같은 fixture를 여러 번 평가해도 같은 placement가 선택되는가
- 여러 후보를 평가한 뒤에도 원본 board가 바뀌지 않는가
- 안전한 board가 위험한 board보다 높은 점수를 받는가
- AI 관련 변경 후에도 `bash scripts/verify.sh`가 통과하는가
- ML Notebook·테스트 변경이면 targeted test와 `npm run verify:ml`도 통과하는가
