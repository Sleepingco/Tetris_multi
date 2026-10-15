# ML Experiment Harness

이 하네스는 placement ML 실험에서 반복되는 데이터·Notebook·leakage·검증·Git 규칙을 한곳에 둔다.

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
- 공통 계약은 이 디렉터리의 `constraints.md`, `workflow.md`, `verification.md`
- 실행 결과 기록이 필요하면 기존 `ai-harness/runs/` 사용

## 새 실험 추가

1. `experiments/_template.md`를 복사한다.
2. 질문 하나와 변경 변수 하나만 적는다.
3. 고정 조건과 stop condition을 적는다.
4. 사용자 검토 후 아래 한 줄 호출로 실행한다.

## 호출 방법

긴 프롬프트를 만들지 않고 다음 한 문장만 전달한다.

```text
ai-harness/ml-experiments/experiments/placement-temporal-holdout-v0-v4.md를
MODE=implement-smoke로 실행해. 사용자 full-run gate에서 멈춰.
```

Full report 분석은 다음처럼 호출한다.

```text
같은 실험을 MODE=analyze-result로 실행해.
FULL_REPORT=/private/tmp/<report>.json
```

모델명과 추론 수준은 실험 계약에 고정하지 않는다. 실행 환경의 현재 설정과 사용자 선택을 따른다.
