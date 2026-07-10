# AI Harness

이 폴더는 `AGENTS.md` 위에 얹는 작업별 하네스 레이어다.

- `AGENTS.md`: 프로젝트 전체 공통 규칙
- `tasks/`: 이번 요청이 어떤 작업인지에 따라 고르는 작업 모드
- `guides/`: 여러 작업에 공통으로 덧붙이는 설명 스타일 가이드
- `runs/`: 필요하면 작업 기록을 남기는 폴더

## 언제 쓰는가

아래처럼 요청이 조금 더 구조적일 때 쓴다.

- 특정 함수 흐름을 학습용으로 설명받고 싶을 때
- 버그를 재현 절차부터 원인 가설까지 정리하고 싶을 때
- 큰 파일을 작은 책임 단위로 나누는 제안을 받고 싶을 때
- 멀티플레이 구조를 단계적으로 설계하고 싶을 때
- 규칙 기반 AI, feature, 데이터셋, ML 평가 기준을 정리하고 싶을 때
- 코드 변경 후 회귀 위험을 검토하고 싶을 때

## 기본 원칙

- 기본값은 항상 `AGENTS.md`다.
- 필요할 때만 `tasks/*.md`를 추가로 호출한다.
- 학습 목적이 강하면 `guides/teaching-style.md`를 함께 적용한다.
- 한 번에 큰 구조 변경보다 작은 diff와 검증 가능한 단계를 우선한다.

## 실행 하네스

코드 변경 후에는 아래 명령으로 공백 오류와 전체 테스트를 한 번에 확인한다.

```bash
bash scripts/verify.sh
```

이 스크립트는 다음 순서로 실행된다.

1. `git diff --check`
2. `npm test`

문서만 변경한 경우에는 전체 테스트를 생략할 수 있다. 검증이 실패하면 실패 원인을 확인한 뒤 작업을 완료한다.

## 추천 작업 모드

- `tasks/documentation.md`
  - 문서 정리, 개념 요약, 변경 의도 정리
- `tasks/implementation.md`
  - 기능 구현, 작은 코드 추가, 보조 로직 작성
- `tasks/refactor.md`
  - 책임 분리, 경계 정리, 점진 리팩토링
- `tasks/bug-analysis.md`
  - 재현, 기대/실제 비교, 원인 추적, 수정 방향
- `tasks/review.md`
  - 회귀 위험, 설계 위반, 테스트 누락 검토
- `tasks/ai-analysis.md`
  - AI 목표, state/data 계약, baseline, 평가 지표, 재현성 검토

## 공통 가이드

- `guides/teaching-style.md`
  - 왜 -> 무엇 -> 어떻게 순서
  - 쉬운 언어
  - 작은 예제
  - 직접 해볼 포인트 남기기

## Codex 앱에서 쓰는 예시

```text
ai-harness/tasks/bug-analysis.md 방식으로 이 버그를 봐줘

ai-harness/tasks/refactor.md + ai-harness/guides/teaching-style.md 기준으로
src/client/game/runtime/tetris.js 분리 방향을 제안해줘

ai-harness/tasks/review.md 방식으로 이번 변경의 회귀 위험을 확인해줘

ai-harness/tasks/ai-analysis.md + ai-harness/guides/teaching-style.md 기준으로
placementGenerator를 내가 직접 구현할 수 있게 입력/출력 계약과 테스트 기준을 알려줘
```

## 현재 프로젝트에 맞는 추천 조합

- 함수 흐름 이해
  - `documentation.md + teaching-style.md`
- 버그 분석
  - `bug-analysis.md + teaching-style.md`
- 구조 개선
  - `refactor.md + teaching-style.md`
- 멀티플레이 설계 검토
  - `documentation.md + refactor.md + teaching-style.md`
- AI 분석과 heuristic 구현
  - `documentation.md + ai-analysis.md + implementation.md + teaching-style.md`
- AI 변경 후 확인
  - `ai-analysis.md + review.md`
- 코드 변경 후 확인
  - `review.md`
