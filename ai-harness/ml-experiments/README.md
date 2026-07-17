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

규칙 기반 PVE 구현이나 runtime 통합에는 이 하네스를 사용하지 않는다. 그 작업은 `tasks/ai-analysis.md`와 해당 구현·리뷰 모드를 사용한다.

## 읽기 순서

1. `AGENTS.md`
2. `ai-harness/README.md`
3. `ai-harness/ml-experiments/README.md`
4. `ai-harness/ml-experiments/constraints.md`
5. `ai-harness/ml-experiments/workflow.md`
6. `ai-harness/ml-experiments/verification.md`
7. `CURRENT_EXPERIMENT_FILE`
8. `ai-harness/tasks/ai-analysis.md`
9. 작업에 필요한 `ai-harness/tasks/*.md`
10. `ai-harness/guides/teaching-style.md`

현재 실험 파일 하나만 읽고 미래 실험을 선행 구현하지 않는다.

## MODE

| MODE | 책임 | 기본 실행 주체 |
|---|---|---|
| `implement-smoke` | Notebook·테스트 구현, 작은 smoke, full 명령 제공 | 구현 에이전트 |
| `run-full` | 이미 검증된 명령으로 full report 한 번 생성 | 사용자 또는 실행 전담 에이전트 |
| `analyze-result` | report 검증, 결과 해석, 다음 gate 결정 | 기술 리드 |
| `freeze-audit` | 동결 후보의 결정성·재현성·승격 근거 감사 | 기술 리드 |

기본 MODE는 `implement-smoke`다. 명시적인 `run-full` 권한 없이 긴 전체 평가를 실행하지 않는다.

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

## 권장 모델

| MODE | 모델 | 추론 수준 |
|---|---|---|
| `implement-smoke` | GPT-5.6 Sol | high |
| `run-full` | GPT-5.6 Terra | medium |
| `analyze-result` | GPT-5.6 Sol | xhigh |
| `freeze-audit` | GPT-5.6 Sol | max |
