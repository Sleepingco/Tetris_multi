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

현재 실험 파일과 MODE만 전달한다.

```text
ai-harness/ml-experiments/experiments/human-action-data-readiness.md를
MODE=implement-smoke로 실행해. 사용자 full-run gate에서 멈춰.
```

세부 읽기 순서와 MODE 책임은 ML 안내를 따른다. 전체 실험 명세와 과거 실행 기록을 한꺼번에 읽지 않는다.

조작 데이터 적합성 명세는 구현·사용자 full 감사·결과 해석을 완료했다. 위 호출 예시는
해당 MODE를 실제로 요청받았을 때만 실행하며 후속 정제·학습을 자동 시작하지 않는다.
완료 실험을 학습 순서대로 읽으려면 [AI/ML 역사 목차](../docs/archive/ai-ml/README.md)를 본다.
