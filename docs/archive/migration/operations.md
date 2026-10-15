# Migration Harness Operations

> 아래는 종료된 마이그레이션의 당시 운영 절차다. 현재 실행 지침이 아니며,
> 명령과 권한 예시는 과거 기록으로 보존한다. [보관 안내](README.md)를 참고한다.

이 문서는 사용자가 Goal 작업을 지시하고 merge 시점을 판단하는 방법을 설명한다.

## 0. Harness Bootstrap

`AGENTS.md`와 `migration-harness/`는 모든 Goal보다 먼저 main에 있어야 한다.

현재 `codex/add-migration-harness` 변경을 검토한 뒤 다음처럼 요청한다.

```text
현재 migration harness 문서 변경을 검토하고 목적별로 로컬 커밋해줘.
push와 main merge는 하지 말고 검증 결과와 merge 준비 상태를 보고해줘.
```

보고를 확인한 뒤 merge를 명시적으로 요청한다.

```text
codex/add-migration-harness 브랜치를 main에 merge해줘.
merge 후 문서 검증과 git status를 확인하고 push는 하지 마.
```

Bootstrap이 main에 반영되기 전에는 Goal 0을 실행하지 않는다.

## 1. Goal 작업 지시

`prompts/run-goal.md`의 프롬프트에서 두 값만 현재 Goal로 바꿔 전달한다.

Goal 0 예시:

```text
CURRENT_GOAL = 00-baseline
CURRENT_GOAL_FILE = migration-harness/goals/00-baseline.md
```

간단히 요청하려면 다음 문장을 사용할 수 있다.

```text
migration-harness/prompts/run-goal.md를 사용해서
CURRENT_GOAL 00-baseline만 실행해줘.
검증과 로컬 커밋까지 수행하고 merge gate에서 멈춰.
```

에이전트는 현재 Goal만 구현하고 다음 Goal을 시작하지 않아야 한다.

## 1.1 CI와 PostgreSQL Goal 실행 순서

[Goal 9 index](goals/09-postgres-event-storage.md)는 공통 계약 문서이며 직접 실행하지 않는다. 다음 순서에서 현재 파일 하나만 `run-goal.md`에 지정한다.

```text
11E CI 안정화
  → 9A PostgreSQL schema/repository
  → 9B runtime PostgreSQL 저장
  → 9C 기존 JSONL import
  → 9D PostgreSQL CI/release gate
```

첫 요청 예시:

```text
migration-harness/prompts/run-goal.md를 사용해서
CURRENT_GOAL 11e-ci-stabilization만 실행해줘.
CURRENT_GOAL_FILE은 migration-harness/goals/11e-ci-stabilization.md야.
검증과 로컬 커밋까지 수행하고 merge gate에서 멈춰.
```

11E가 main과 hosted CI에 반영된 뒤 9A를 요청한다.

```text
migration-harness/prompts/run-goal.md를 사용해서
CURRENT_GOAL 09a-postgres-schema-repository만 실행해줘.
CURRENT_GOAL_FILE은 migration-harness/goals/09a-postgres-schema-repository.md야.
실제 PostgreSQL 검증과 로컬 커밋까지 수행하고 merge gate에서 멈춰.
```

- 일정이 하루여도 여러 Goal을 한 프롬프트나 branch로 묶지 않는다.
- 다음 Goal 준비는 이전 Goal의 main merge와 main/hosted gate가 끝난 뒤 새 worktree에서 시작한다.
- 과거 `codex/add-postgres-event-shadow`는 조사 자료일 뿐 실행 branch가 아니다. branch 전체 merge/rebase나 commit 전체 cherry-pick을 지시하지 않는다.
- 9D 전 production DB enable, managed DB provisioning과 실제 사용자 JSONL import를 승인한 것으로 해석하지 않는다.

## 2. Merge 가능한 시점

다음 조건을 모두 만족한 뒤 merge한다.

- 현재 Goal의 선행 commit이 main에 포함돼 있다.
- Goal 전용 브랜치에 현재 Goal 범위의 변경만 있다.
- Goal 파일의 완료 기준을 모두 충족했다.
- canonical fast gate와 관련 full gate가 통과했다.
- 수동 검증이 필요한 Goal은 결과가 기록됐다.
- 실행 기록에 환경, 검증 대상 commit, 실패·미실행 범위와 rollback이 있다.
- 예상하지 않은 기능·프로토콜 변화가 없다.
- 남은 위험을 사용자가 수용했다.
- worktree가 clean하고 로컬 commit이 준비됐다.

하나라도 충족하지 못하면 merge하지 않는다.

## 3. Merge 요청 문구

로컬 main에만 병합:

```text
Goal <번호> 검증 보고를 확인했어.
<Goal 브랜치>를 최신 main에 merge해줘.
merge 후 fast gate를 다시 실행하고 push는 하지 마.
```

PR로 검토:

```text
Goal <번호> 브랜치를 push하고 draft PR을 만들어줘.
자동 merge는 하지 말고 검증 결과와 rollback을 PR 본문에 포함해줘.
```

push, PR 생성과 merge는 서로 다른 권한이다. 원하는 작업만 명시한다.

## 4. Merge 후 다음 Goal

merge 후에는 다음을 확인한다.

1. main이 clean하다.
2. main에서 fast gate가 통과한다.
3. merge/squash 결과 commit SHA를 기록한다.
4. 다음 Goal이 그 main commit을 선행조건으로 확인한다.
5. 이전 브랜치 삭제는 main 검증 이후 별도로 승인한다.

그다음 `run-goal.md`의 `CURRENT_GOAL`과 `CURRENT_GOAL_FILE`을 다음 값으로 바꾼다.

```text
CURRENT_GOAL = 01-vite-typescript-foundation
CURRENT_GOAL_FILE = migration-harness/goals/01-vite-typescript-foundation.md
```

## 권장 주기

```text
Goal 명세 재확인
    → Goal branch 작업
    → 자동·수동 검증
    → 로컬 commit과 실행 기록
    → 사용자 검토
    → main merge
    → main 재검증
    → 다음 Goal
```

Goal branch를 서로 쌓아서 마지막에 한꺼번에 merge하지 않는다. 회귀 원인과 rollback 지점을 Goal 단위로 유지한다.
