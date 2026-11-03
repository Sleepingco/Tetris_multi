# AI Harness

이 폴더는 [AGENTS.md](../AGENTS.md)의 공통 규칙에 현재 작업의 진행 방식만 더한다.

- `tasks/`: 이번 요청이 어떤 작업인지에 따라 고르는 작업 모드
- `guides/`: 여러 작업에 공통으로 덧붙이는 설명 스타일 가이드
- `runs/`: 과거 실행 증거. 관련 결과를 확인할 때 필요한 기록만 읽는다.
- `ml-experiments/`: 반복 ML 실험의 공통 계약, 실행 단계와 현재 실험 명세

## 작업 선택

아래 표에서 현재 요청의 모드 하나를 고른다. AI 분석과 구현처럼 책임이 함께 필요한 경우에만 모드를 추가한다.
단순 설명은 관련 코드와 설명 지침만 읽는다. 모든 작업 모드·실험·과거 기록을 한꺼번에 읽지 않는다.
이번 작업에서 이미 확인했고 변경되지 않은 공통 규칙은 반복해서 읽지 않고, 작업 전환에 필요한 문서·절만 추가한다.

| 요청 | 선택할 문서 |
| --- | --- |
| 코드 설명·문서화 | [documentation](tasks/documentation.md) |
| 기능 구현 | [implementation](tasks/implementation.md) |
| 책임 분리·점진적 구조 정리 | [refactor](tasks/refactor.md) |
| 버그 재현·원인 추적 | [bug-analysis](tasks/bug-analysis.md) |
| 변경의 회귀 위험 검토 | [review](tasks/review.md) |
| 규칙 기반 AI·feature·데이터 평가 | [ai-analysis](tasks/ai-analysis.md) |
| 반복 placement ML 실험 | [ML 안내](ml-experiments/README.md)의 MODE별 읽기 경로 |

학습 중심 요청에는 [teaching guide](guides/teaching-style.md)를 추가한다.
사용자가 직접 구현하겠다고 하면 코드 수정 대신 개념·힌트·검증 기준을 제공한다.
구현 요청은 허용된 범위에서 진행하며, 완료한 뒤 별도 기능·실험을 자동 시작하지 않는다.

## 실행 검증

런타임·테스트·빌드/실행 동작 변경 후에는 기존 [검증 스크립트](../scripts/verify.sh)를 실행한다.

```bash
bash scripts/verify.sh
```

현재 순서는 공백 검사 → typecheck → build → artifact 검증 → compiled test다. 정확한 명령은 스크립트를 기준으로 한다.
브라우저·DB·ML 검증은 관련 변경에 추가한다. 필수 검증이 실패하거나 실행되지 않았으면 완료로 보고하지 않는다.
문서만 바꾸면 공백·링크·경로·코드 블록을 확인하고 전체 테스트 생략 이유를 보고한다. 테스트가 직접 읽는 문서 계약도 보존한다.

## 반복 ML 실험 호출

반복 실험은 실험 파일과 MODE만 전달한다. 현재는 B3 Full 해석까지 마쳤으며,
[기존 로그 활용 조사](../docs/ai-ml/experiments/human-action-observation-link-audit.md#6-기존-로그만으로-완성할-경로-조사-2026-10-28)를 마쳤다. 신규 수집 계획/문서는 삭제했고 기존 pair의 다음 행동·간격 공동 예측, 기존 raw Hold 시도 확장, A/B 비교를 제안한다. Git 저장 source의 ML 검증은 통과했고 로컬 사용자 Notebook 실행 출력은 보존한다.

```text
ai-harness/ml-experiments/experiments/human-action-timing-joint-baseline.md를 MODE=implement-smoke로 진행해.
Notebook 하나와 내부 assert·가상 smoke만 구현하고 사용자 실행본·기존 dataset은 보존해.
신규 수집·실제 Full·Hold raw 확장·신경망·runtime 통합·commit은 하지 마.
```

세부 읽기 순서와 MODE 책임은 ML 안내를 따른다. 전체 실험 명세와 과거 실행 기록을 한꺼번에 읽지 않는다.

위 호출은 공동 예측 최초 구현 당시의 재현 예시이며 현재 다음 작업 지시가 아니다. 후속 배치·조작 view, 신경망 비교와 진단까지 완료한 현재 상태는 [AI 계획](../docs/ai-ml/strategy/ai-plan.md)과 [ML 안내](ml-experiments/README.md)를 따른다. 후속 구조는 미채택 상태다.

조작 데이터 적합성·timing baseline·고정 B2 Test·B3 Full 결과 검토를 완료했다.
B0~B3는 상태를 보지 않는 비교 기준으로 남기며 현재 구조는 상황 조건부 Human 행동 모방을 목표로 한다.
후속 실험 명세가 정해진 뒤에만 해당 MODE로 구현하며 새 후보를 기존 Test에서 자동 평가하지 않는다.
완료 실험을 학습 순서대로 읽으려면 [AI/ML 역사 목차](../docs/archive/ai-ml/README.md)를 본다.
