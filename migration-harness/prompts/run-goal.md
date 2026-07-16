# Run Migration Goal Prompt

아래 프롬프트는 Goal 번호와 권한만 전달한다. 제약과 완료 조건은 `migration-harness`의 문서를 단일 원천으로 사용한다.

`CURRENT_GOAL`과 `CURRENT_GOAL_FILE`만 현재 단계에 맞게 바꾼다.

```text
Tetris Multi의 기술 마이그레이션을 진행해줘.

CURRENT_GOAL = 00-baseline
CURRENT_GOAL_FILE = migration-harness/goals/00-baseline.md

먼저 다음 파일을 순서대로 읽고 적용해.

1. AGENTS.md
2. migration-harness/README.md
3. migration-harness/constraints.md
4. migration-harness/workflow.md
5. migration-harness/verification.md
6. migration-harness/roadmap.md
7. CURRENT_GOAL_FILE에 지정된 Goal 파일
8. ai-harness/tasks/implementation.md
9. ai-harness/tasks/review.md
10. 학습 설명이 필요하면 ai-harness/guides/teaching-style.md

문서를 읽은 뒤 실제 Git, 코드, 테스트 상태를 먼저 확인해.
문서와 실제 상태가 다르면 실제 상태를 우선하되 바로 구현하지 말고 차이와 안전한 선택지를 보고해.

활성 Goal이 없다면 CURRENT_GOAL의 목적만 create_goal로 등록해.
전체 roadmap을 하나의 Goal로 만들거나 token budget을 임의로 설정하지 마.
별도의 작은 실행 계획을 만들고 preflight부터 진행해.

이번 요청이 승인하는 작업:

- CURRENT_GOAL 전용 codex/ 브랜치 생성 또는 전환
- origin/main 최신성 확인에 필요한 read-only fetch 요청
- CURRENT_GOAL 범위의 파일 수정
- Goal에 명시된 의존성 설치
- 자동·수동 검증
- 검증 통과 후 목적별 로컬 커밋
- migration-harness/runs/ 실행 기록 작성

이번 요청이 승인하지 않는 작업:

- main 직접 수정
- push, PR 또는 main merge
- force-push와 destructive reset
- 기존 브랜치 삭제
- 사용자 변경의 reset, stash, checkout 또는 삭제
- 다음 Goal의 선행 구현
- CURRENT_GOAL 완료 후 다음 Goal 자동 시작

필수 검증이 실패하거나 선행조건을 충족하지 못하면 Goal을 완료 처리하지 마.
통과, 실패, 미실행 범위와 보존해야 할 변경을 구분해서 보고해.

모든 완료 조건을 충족하면 실행 기록을 남기고 CURRENT_GOAL만 완료 처리해.
마지막에는 변경, 검증, 남은 위험, rollback과 다음 Goal 선행조건을 보고하고 merge gate에서 멈춰.
```

## 다음 Goal로 변경하는 방법

이전 Goal이 main에 병합된 것을 확인한 뒤 두 값만 바꾼다.

```text
CURRENT_GOAL = 01-vite-typescript-foundation
CURRENT_GOAL_FILE = migration-harness/goals/01-vite-typescript-foundation.md
```

상세 Goal 파일이 아직 없다면 구현 프롬프트를 실행하지 않고 `_template.md`로 명세를 먼저 작성해 검토받는다.
