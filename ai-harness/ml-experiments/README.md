# ML Experiment Harness

이 하네스는 placement ranking과 Human 조작 ML 실험의 데이터·Notebook·leakage·검증·Git 규칙을 한곳에 둔다.

현재 방향은 [AI 계획](../../docs/ai-ml/strategy/ai-plan.md), 과거 실험은
[시간순 목차](../../docs/archive/ai-ml/README.md)를 본다. 기존 `placement-*` 명세
6개는 종료된 V4 연구/검증 기록이다. 경로와 당시 결과·명령을 보존하며 추천 MODE를
자동 실행 지시로 읽지 않는다. [조작 데이터 적합성](experiments/human-action-data-readiness.md)은
구현·사용자 full 감사·결과 분석을 완료했다. 다음 범위는 해당 명세와 현재 AI 계획을 따른다.
[게임 품질 감사](experiments/human-game-quality-audit.md)의 사용자 full과 첫 정책 승인을 완료했다.
[timing-only dataset](experiments/human-timing-dataset.md)의 사용자 full 생성·무결성 검토도 완료했다.
[0ms 마지막 재현](../runs/human-timing-zero-ms-reproduction-2026-10-26.md)은 기록 메커니즘을 확인하고
과거 입력 원천 미확인으로 종료했다. [고정 v1 timing baseline](experiments/human-timing-baseline.md)은
Notebook·smoke와 사용자 full Validation 검토를 완료하고 B2를 Test 후보로 고정했다. 기존 source 형식 검사 보류와 구분한다.
후속 [고정 B2 Test 평가](experiments/human-timing-b2-test-evaluation.md)는 사용자 full 결과를 검토하고 마감했다.
[과거 간격 조건 탐색](experiments/human-timing-history-baseline.md)의 사용자 Full 결과도 해석했다. B3의 Validation 개선은 상태를 보지 않는 timing 기준선의 근거이며 최종 구조 채택은 아니다.
현재 [관측 연결 감사](../../docs/ai-ml/experiments/human-action-observation-link-audit.md)는 마쳤지만 후속 [신규 trace 수집](../../docs/ai-ml/contracts/human-action-trace-v1.md)은 2026-10-28 사용자 결정으로 취소하고 구현을 제거했다. 기존 로그만 활용하며 재수집을 선행 조건으로 삼지 않는다. 기존 사용자 Notebook 출력/Full 설정 때문에 ML 전체 gate는 보류다. 학습/전체 replay를 자동 시작하지 않는다.
기존 source output/count 형식 검사는 별도 보류다. B3를 이미 관측한 Test에서 평가하지 않는다.
이전 implement-smoke/full 예시는 재실행 지시가 아니다.

새 요청에서는 긴 규칙을 다시 적지 않고 다음 두 값만 선택한다.

- `CURRENT_EXPERIMENT_FILE`: 현재 실험 명세 하나
- `MODE`: 이번 작업 단계

## 사용 시점

- 게임 로그를 추가해 기존 모델을 다시 평가할 때
- feature, representation, pair weight 또는 estimator 가설을 비교할 때
- Notebook 구현과 긴 full 실행을 분리할 때
- 사용자가 실행한 report를 해석해 다음 gate를 정할 때

규칙 기반 PVE 구현이나 runtime 통합에는 이 하네스를 사용하지 않는다. 그 작업은 [AI 분석](../tasks/ai-analysis.md)과 해당 구현·리뷰 모드를 사용한다.

## 읽기 순서

1. [AGENTS.md](../../AGENTS.md)와 이 안내를 확인한다. 이번 작업에서 이미 확인했고 변경되지 않았다면 반복해서 읽지 않는다.
2. [공통 constraints](constraints.md)와 현재 `CURRENT_EXPERIMENT_FILE` 하나를 읽는다.
3. [workflow](workflow.md)의 공통 실행 규칙과 현재 MODE 절, [verification](verification.md)의 공통 preflight와 아래 표의 검증 절을 읽는다.
4. AI 목표·baseline·평가 기준을 정하거나 변경하면 [AI 분석](../tasks/ai-analysis.md)을 추가한다. 구현·설명·리뷰 지침도 현재 작업에 필요한 것만 선택한다.
5. 학습 중심 요청에는 [teaching guide](../guides/teaching-style.md)를 추가한다.

미래 실험을 선행 구현하지 않는다. 과거 실행 기록은 현재 입력·결과의 근거가 필요할 때만 읽는다.

## MODE

| MODE | 책임 | 읽을 검증 절 |
|---|---|---|
| `implement-smoke` | Notebook·테스트 구현, 작은 smoke, full 명령 제공 | implement-smoke gate |
| `run-full` | 승인된 명령으로 full report 생성 | run-full gate |
| `analyze-result` | 기존 report 검증·해석과 다음 판단 근거 제시 | analyze-result gate |
| `freeze-audit` | 동결 후보의 결정성·재현성·승격 근거 감사 | run-full gate와 analyze-result gate, workflow의 freeze 조건 |

기본 MODE는 `implement-smoke`다. 명시적인 `run-full` 권한 없이 긴 전체 평가를 실행하지 않는다.
MODE나 환경변수 설정은 실행 승인이 아니다. `analyze-result`와 `freeze-audit`에서 결과가 부족하면 부족한 증거를 보고하고, 승인되지 않은 full 실행·재학습·production 승격은 하지 않는다.
문서만 변경하면 verification의 문서 검증 절을 적용한다.

## 디렉터리

- `experiments/`: 실험별로 달라지는 질문과 입력·비교 변수
- 실험 코드·검사: [scripts/ml](../../scripts/ml/README.md)의 `notebooks/`와 `tests/`.
  공통 fixture는 `scripts/ml/tests/fixtures/`에 둔다. 제목·문자열 계약 검사도 유지한다.
- 공통 계약은 이 디렉터리의 `constraints.md`, `workflow.md`, `verification.md`
- 실행 결과 기록이 필요하면 기존 `ai-harness/runs/` 사용

## 새 실험 추가

1. `experiments/_template.md`를 복사한다.
2. 질문 하나와 변경 변수 하나만 적는다.
3. 고정 조건과 stop condition을 적는다.
4. 사용자 검토 후 아래 한 줄 호출로 실행한다.

## 호출 방법

현재 다음 계획은 기존 로그에서 확인 가능한 행동열·리듬·Hold 시도와 문맥으로 과제를 한정하는 것이다. 신규 수집은 취소됐으며 ML 검사 정합 문제는 별도로 남아 있다.

```text
docs/ai-ml/strategy/ai-plan.md의 기존 로그 전용 방향을 확인해.
추가 수집 없이 확인 가능한 행동열·리듬·Hold 시도와 문맥으로 실험 범위를 제안해.
기존 사용자 출력·dataset을 보존하고 신규 수집·전체 replay·학습을 자동 시작하지 마.
```

후속 실험 명세가 정해지면 CURRENT_EXPERIMENT_FILE과 MODE를 지정한다. 기존 Full report를 다시 검토하려는 경우에만 다음처럼 호출한다.

```text
ai-harness/ml-experiments/experiments/human-timing-history-baseline.md를 MODE=analyze-result로 검토해.
FULL_REPORT=data/ml-experiments/human-timing-history-baseline/full-report-run1.json
```

모델명과 추론 수준은 실험 계약에 고정하지 않는다. 실행 환경의 현재 설정과 사용자 선택을 따른다.
