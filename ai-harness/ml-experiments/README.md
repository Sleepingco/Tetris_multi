# ML Experiment Harness

현재 [Human 배치 ID 분류 vs 공유 후보 점수화](experiments/human-placement-candidate-scoring.md)의 사용자 Full 검토를 완료했다(2026-11-09). 공유 scorer의 macro Top-1은43.56%로 후보 제한 ID25.08%보다 높지만 과적합은 남았다. 다음은 [조기 종료 명세](experiments/human-placement-candidate-early-stopping.md)와 [새 Notebook](../../scripts/ml/notebooks/human_placement_candidate_early_stopping.ipynb)4절의 사용자 Full이다. Train 내부119/30게임에서 종료 epoch를 정하고 전체149게임에 재학습하며 실제30epoch report를 기준선으로 재사용한다. 실제 두 학습 경로·내부 검증까지 구현했고 기본 Full=False다. 원본 행동/데이터 증강·외부Validation 기반 epoch 선택·Node 재호출·게임 수 실험·runtime은 추가하지 않았다.

2026-11-04 커밋 전 정리로 실행본16개를 ignored `data/ml-experiments/source-checkpoint-20261104/`에 보존하고 source의 출력/count·실행 기본값을 복구했다. `verify:ml` Node35/35·Python220/220 통과다. 아래 기존 실행본 형식 문제와 코드 준비 상태는 당시 이력이며 새 Full/다음 실험 지시가 아니다.

현재 [Human 배치 입력·정답 진단](experiments/human-placement-input-target-audit.md)의 승인 Full2회/해석을 완료했다. [AI 계획](../../docs/ai-ml/strategy/ai-plan.md)의 모듈형 V4 재사용과 통합 신경망은 미채택 비교 후보이며 후속 구조·실험은 사용자 선택을 기다린다. 이전 준비/실행 기록을 새 구현·Full·수집·runtime 승인으로 읽지 않는다.

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
현재 [기존 로그 활용 조사](../../docs/ai-ml/experiments/human-action-observation-link-audit.md#6-기존-로그만으로-완성할-경로-조사-2026-10-28)를 마쳤다. 신규 수집 계획/문서는 삭제했다. 기존 pair의 다음 행동·간격 공동 예측과 기존 raw의 Hold 시도 확장이 가능하다는 조사이며 새 모델을 학습/채택한 결과는 아니다. Git 저장 source는 ML 검증을 통과했고 로컬 사용자 실행 Notebook은 보존한다. 학습/전체 replay를 자동 시작하지 않는다.
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
사용자가 Full-only를 명시한 경우에는 현재 명세의 승인·고정 조건 아래 별도 Smoke 학습을 생략할 수 있다. 짧은 내부 검사·필수 회귀·기본 Full 비활성·출력 보호는 유지하고 과거 Smoke 이력을 일괄 삭제하지 않는다.
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

기존 pair의 [공동 예측 명세](experiments/human-action-timing-joint-baseline.md)는 사용자 Full 해석을 완료했다. 후속 [배치·조작 연결 점검](experiments/human-placement-action-link-readiness.md)은 Notebook·가상 smoke·작은 Train 3개/28 pair 점검을 마쳤다. 현재 다음 gate는 표본 coverage 해석과 과거 관측/규칙 근거 확인 범위 선택이다. 신규 수집·전량 replay·dataset/학습·runtime은 자동 시작하지 않는다. 아래 implement-smoke 호출은 joint 최초 구현 범위의 재현 예시이며 현재 다음 실행 지시가 아니다.

이후 [상태·규칙 근거 점검](experiments/human-placement-context-evidence.md)의 사용자 작은 표본 해석을 완료했다. 현재 [오프라인 view 구성](experiments/human-placement-action-offline-views.md)은 Notebook·가상 Smoke 검증을 마쳤으며 다음은 사용자 작은 Train 실행/해석이다. 학습 사용은 [offline-use-v1](../../docs/ai-ml/contracts/human-placement-action-link.md#9-기존-로그의-학습-사용-범위--offline-use-v1)을 따른다. 전체 ML gate는 기존 실행본의 차이로 보류하며 실제 전체 생성·학습·replay·runtime을 자동 시작하지 않는다.

```text
CURRENT_EXPERIMENT_FILE=ai-harness/ml-experiments/experiments/human-action-timing-joint-baseline.md
MODE=implement-smoke
이 명세의 Notebook 하나와 내부 assert·가상 smoke만 구현해. 사용자 출력·dataset은 보존해.
신규 수집·실제 Full·Hold raw 확장·신경망·runtime 통합·commit은 하지 마.
```

offline view와 [목표 조건 prefix](experiments/human-goal-conditioned-prefix.md)의 사용자 Full 해석은 완료했다. 후속 [정보 분리 실험](experiments/human-goal-information-ablation.md)도 사용자 Full-only 승인으로 실행/해석했다. 현재는 [배치 snapshot 기준선](experiments/human-placement-snapshot-baseline.md)의 코드/내부 검사·로딩을 준비했고 사용자 Full 학습 전이다. 위 joint 최초 호출은 역사적 재현 예시다. 별도 승인 없이 추가 fit·runtime·다음 실험을 자동 시작하지 않는다.

현재 snapshot/L2/보드 스케일링 Full을 해석했고 [학습 게임 수별 비교](experiments/human-placement-game-count-learning-curve.md)의 Notebook/내부 검사를 준비했다. 기존 Train38/75/112/149게임과 같은1530업데이트의 Full-only 비교이며 실제 Full은 사용자 실행 전이다. 작은 조건은 Smoke가 아닌 정식 비교군이며3절 RUN_FULL을 켜기 전에는 실제 학습을 하지 않는다. 이전 문단의 코드 준비 상태는 최초 구현 이력이다.

후속 실험 명세가 정해지면 CURRENT_EXPERIMENT_FILE과 MODE를 지정한다. 기존 Full report를 다시 검토하려는 경우에만 다음처럼 호출한다.

2026-11-03 [정보 분리 실험](experiments/human-goal-information-ablation.md)은 사용자 Full-only 승인으로1회 실행/해석했다. 후속 [배치 snapshot 기준선](experiments/human-placement-snapshot-baseline.md)은 코드/내부 검사까지 준비했고 실제 Full fit은 사용자 실행 전이다. 정보 분리 실험은 별도 Smoke 학습 없이 내부 assert·전체 cohort·기존 조건 재현·필수 회귀를 유지했으며 이 기록을 후속 학습의 자동 승인으로 읽지 않는다.

```text
ai-harness/ml-experiments/experiments/human-timing-history-baseline.md를 MODE=analyze-result로 검토해.
FULL_REPORT=data/ml-experiments/human-timing-history-baseline/full-report-run1.json
```

모델명과 추론 수준은 실험 계약에 고정하지 않는다. 실행 환경의 현재 설정과 사용자 선택을 따른다.
