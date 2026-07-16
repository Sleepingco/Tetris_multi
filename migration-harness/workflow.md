# Migration Workflow

모든 마이그레이션 Goal은 `preflight → 구현 → 검증 → 로컬 커밋 → merge gate` 순서로 실행한다.

## 1. Goal 선택

- 한 번에 현재 Goal 하나만 선택한다.
- 활성 Goal이 없으면 현재 Goal의 목적만 `create_goal`로 등록한다.
- 전체 로드맵을 하나의 Goal로 만들거나 token budget을 임의로 지정하지 않는다.
- Goal과 별도로 작은 실행 계획을 만들고 한 단계만 `in_progress`로 유지한다.
- 상세 Goal 파일이 없으면 구현하지 않고 먼저 명세 작성과 사용자 검토를 요청한다.

## 2. Preflight

변경 전에 다음을 확인한다.

- `git status --short --branch`
- 현재 브랜치와 최신 local/main SHA
- 필요하면 origin/main과의 차이
- 최근 commit graph와 선행 Goal의 ancestry
- Goal과 무관한 staged, unstaged, untracked 변경
- 현재 Goal이 요구하는 Node와 npm 버전
- 변경 전 unit/E2E 기준선
- 같은 worktree를 사용하는 다른 작업의 존재

다음 명령으로 선행 Goal이 main에 포함됐는지 확인한다.

```bash
git merge-base --is-ancestor <previous-goal-commit> main
```

실패하면 다음 Goal을 시작하지 않는다.

## 3. 브랜치와 Worktree

- 최신 main에서 현재 Goal 전용 `codex/` 브랜치를 만든다.
- origin/main 최신성 확인이 필요하면 network 권한을 확인한 뒤 fetch하고 local/remote 차이를 보고한다.
- 기존 브랜치가 같은 이름으로 존재하면 강제로 이동하지 않고 base와 변경 상태를 보고한다.
- 의존 관계가 있는 migration Goal을 병렬 실행하지 않는다. 무관한 작업이 진행 중이면 현재 Goal 전용 브랜치를 별도 worktree에 checkout한다.
- 오래된 브랜치 전체 merge보다 필요한 고유 변경을 최신 main 위에 재적용하는 방식을 우선 검토한다.

## 4. 구현

- `AGENTS.md`, 현재 Goal 파일과 선택한 `ai-harness` 작업 모드를 따른다.
- 변경 전 이유, 영향 범위와 검증 방법을 짧게 보고한다.
- 플레이 가능한 작은 checkpoint를 유지한다.
- 대량 rename, 포맷 변경과 기능 변경을 동시에 수행하지 않는다.
- 새 패키지 설치 전 버전 선택 근거를 확인한다.
- 문서는 검증 이후 실제 상태만 기록한다.

## 5. 검증

`verification.md`와 현재 Goal의 자동·수동 검증을 적용한다.

- 필수 검증이 실패하거나 실행되지 않았으면 Goal을 완료로 표시하지 않는다.
- 환경 문제와 코드 실패를 구분한다.
- 통과한 명령, 테스트 수, Node/npm 버전과 미검증 범위를 기록한다.
- 문서-only 변경이라도 `git diff --check`와 링크·경로 검증을 수행한다.

## 6. 커밋과 실행 기록

- 검증된 변경만 목적별 로컬 커밋으로 만든다.
- 커밋 메시지는 변경 이유를 드러낸다.
- 실행 결과를 `runs/goal-<번호>-<날짜>.md`에 기록하고 문서-only 기록 커밋으로 분리한다.
- 실행 기록에는 base SHA, branch, 검증 대상 commit 목록, 환경, 검증, 위험과 rollback을 포함한다.
- 실행 기록 파일은 자기 자신의 commit SHA나 아직 존재하지 않는 main merge SHA를 요구하지 않는다. 최종 branch HEAD와 main 반영 SHA는 완료 보고와 다음 Goal preflight에서 Git으로 확인한다.
- `PLAN.md`는 현재 상태, `change-log.md`는 완료된 사실만 갱신한다.

## 7. Merge Gate

Goal 완료 보고에는 다음을 포함한다.

- Goal과 브랜치
- 기준 main과 생성한 commit
- 변경 파일과 구조 변화
- 의도된 기능·프로토콜 변화
- 보안 및 데이터 영향
- 선택한 패키지와 버전
- 실행한 검증과 결과
- 미검증 범위와 남은 위험
- rollback 방법
- 다음 Goal 선행조건

여기서 멈춘다. 사용자 승인 전에는 push, PR, main merge, 기존 브랜치 삭제와 다음 Goal 실행을 하지 않는다.

## 즉시 중단 조건

- dirty 변경이 현재 Goal 파일과 겹친다.
- 선행 Goal이 main의 조상이 아니다.
- 변경 전 기준선 테스트가 실패한다.
- Goal이 요구하는 Node 버전이 아니다.
- 포트 충돌 등으로 필수 검증을 재현할 수 없다.
- 예상하지 않은 기능 또는 프로토콜 변화가 필요하다.
- 비밀값이나 실제 인증정보가 발견된다.
- destructive Git 명령이나 main 직접 수정이 필요하다.
- 다른 작업이 같은 worktree 또는 파일을 변경 중이다.

중단 시에는 원인, 보존해야 할 변경, 안전한 선택지를 보고하고 사용자 결정을 기다린다.
