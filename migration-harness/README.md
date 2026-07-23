# Migration Harness

이 폴더는 Tetris Multi의 기술 마이그레이션을 작은 Goal과 검증 가능한 병합 게이트로 실행하기 위한 저장소 전용 하네스다.

## 역할 분리

| 문서 | 책임 |
| --- | --- |
| `AGENTS.md` | 프로젝트 전체의 오래가는 규칙과 책임 경계 |
| `migration-harness/` | 승인된 마이그레이션 Goal의 범위, 선행조건, Git 계보, 완료 게이트 |
| `ai-harness/` | 구현, 리팩토링, 리뷰, 설명 방식 |
| `PLAN.md` | 현재 구현 상태와 바로 다음 실행 항목 |
| `change-log.md` | 완료된 변경 사실과 검증 결과 |

사용자 작업 지시와 merge 운영 문구는 `operations.md`에서 관리한다.

`migration-harness`는 `ai-harness`를 대체하지 않는다. 마이그레이션 범위는 이 폴더에서 제한하고, 실제 작업 방식은 요청에 맞는 `ai-harness/tasks/*.md`를 함께 사용한다.

## 적용 조건

다음 조건을 모두 만족할 때만 적용한다.

- 사용자가 기술 마이그레이션을 명시적으로 요청했다.
- 실행할 현재 Goal이 지정돼 있다.
- 해당 Goal의 범위와 Git 변경 권한이 확인됐다.

브랜치 이름에 `migrate`가 들어 있다는 이유만으로 자동 적용하지 않는다. 같은 브랜치에서 단순 설명이나 버그 분석을 요청받았다면 그 요청 범위만 처리한다.

## 읽기 순서

1. `AGENTS.md`
2. 이 `README.md`
3. `constraints.md`
4. `workflow.md`
5. `verification.md`
6. `roadmap.md`
7. 현재 Goal이 분할 Goal이면 공통 index 하나
8. 현재 Goal 상세 파일 하나
9. 요청에 맞는 `ai-harness/tasks/*.md`
10. 학습 중심이면 `ai-harness/guides/teaching-style.md`

모든 Goal은 범위 계약 파일을 갖는다. Goal 8A~8D는 `08-typescript-completion.md`, Goal 9A~9D는 `09-postgres-event-storage.md` 공통 index와 승인된 현재 상세 파일만 읽는다. 다른 미래 Goal 상세 파일은 읽거나 미리 구현하지 않는다. 현재 Goal을 시작하기 직전에 실제 코드와 main 상태를 기준으로 계약을 재검토한다.

## 규칙 우선순위

저장소 내부 규칙의 우선순위는 다음과 같다.

```text
AGENTS.md
    ↓
migration-harness의 현재 Goal 범위와 게이트
    ↓
선택한 ai-harness 작업 모드와 설명 스타일
```

- `migration-harness`는 `AGENTS.md`의 게임 규칙, 상태 소유권, 보안 원칙을 완화할 수 없다.
- `ai-harness`는 현재 Goal의 범위를 확장할 수 없다.
- 사용자가 승인한 Goal에 명시된 Vite, React 등의 도입만 프레임워크 임의 추가 금지 규칙의 제한적 예외다.
- 규칙이 충돌하면 임의로 해석하지 않고 작업을 멈춘 뒤 충돌 지점과 선택지를 보고한다.

## 상태의 단일 진실 원천

현재 브랜치, 커밋, 통과한 테스트와 구현 상태는 Git, 실제 코드와 `PLAN.md`에서 확인한다. 이 폴더에는 오래 유지할 제약과 Goal 명세만 둔다.

- 특정 실행 결과는 `runs/`에 기록한다.
- 완료된 변경 사실은 `change-log.md`에 기록한다.
- 현재 상태를 `constraints.md`나 실행 프롬프트에 복사하지 않는다.

## 실행 프롬프트

`prompts/run-goal.md`는 Goal 번호와 권한만 전달하는 짧은 부트스트랩이다. 제약과 완료 조건을 프롬프트에 다시 복사하지 않고 이 폴더의 문서를 읽게 한다.

사용자가 Goal을 지시하고 merge 시점을 판단하는 방법은 `operations.md`를 따른다.

이 하네스 자체는 Goal 0의 선행 bootstrap 문서다. `AGENTS.md`와 `migration-harness/` 변경을 별도 docs 브랜치에서 검토·병합한 뒤 Goal 0을 시작한다.
