# Goal 0 — Stabilize Migration Baseline

## 목적

최신 main 위에 고유한 baseline 안정화 변경만 다시 적용하고, 이후 마이그레이션이 비교할 수 있는 검증 가능한 기준점을 만든다.

## 왜 지금 필요한가

기존 stabilize 브랜치는 baseline 이후 Python parity와 AGENTS 변경까지 포함해 책임이 섞였다. 마이그레이션은 그 브랜치 전체가 아니라 안정화 패치만 최신 main 계보에 올린 뒤 시작해야 한다.

## 선행조건

- 실제 main, origin/main과 worktree 상태를 다시 확인한다.
- 하네스 bootstrap 변경이 main에 반영된 최신 SHA를 기준으로 사용한다. 과거 main SHA를 기준점으로 고정하지 않는다.
- 기존 `fe8dabf`, `bf04a4e`, `cbfc882`의 patch 관계를 확인한다.
- 사용자 변경이 없는 clean worktree에서 시작한다.

## 범위

- 최신 main에서 `codex/stabilize-migration-baseline-v2` 브랜치를 준비한다.
- `fe8dabf test: stabilize migration baseline`의 고유 변경만 적용한다.
- single gameplay E2E를 baseline에 포함한다.
- multiplayer rollback helper와 관련 E2E의 관찰값을 강화한다.
- `PLAN.md`와 `change-log.md`에는 실제 baseline 사실만 기록한다.
- `AGENTS.md`의 동적 프로젝트 현황이 실제 authoritative/PVE/AI 코드와 다르면 사실 부분만 교정한다.
- 기준선 변경과 AGENTS 사실 교정은 목적별 커밋으로 분리한다.

## 제외 범위

- `cbfc882` Python parity 재적용
- 기존 stabilize 브랜치 전체 merge
- `1e19b06`의 `.vscode` 변경 동반 적용
- Vite, TypeScript, React, Zod, PostgreSQL 도입
- gameplay와 Socket 프로토콜 변경
- 기존 브랜치 삭제와 force-push

## 허용되는 기능·프로토콜 변화

없음. 테스트 관찰력과 문서 정확도만 바꾼다.

## 예상 영향 파일

- `e2e/singlePlayer.spec.js`
- `e2e/helpers/multiplayer.js`
- `e2e/multiplayerRollback.spec.js`
- `PLAN.md`
- `change-log.md`
- 필요 시 `AGENTS.md`

적용 전 `fe8dabf`의 실제 diff를 확인하고 이 목록과 다르면 보고한다.

## 완료 기준

- 최신 main을 base로 하는 새 baseline branch가 있다.
- main의 Python parity 결과와 관련 파일이 바뀌지 않았다.
- 동일 패치인 `cbfc882`가 새 계보에 추가되지 않았다.
- single/PVP/PVE/rollback 기준선이 재현 가능하다.
- 문서의 완료 주장이 실제 실행 결과와 일치한다.
- 실행 기록과 rollback 지점이 남아 있다.

## 자동 검증

```bash
git diff --check
bash scripts/verify.sh
npm run test:e2e
```

Node와 npm 버전, 전체 테스트 수와 실행 시간을 기록한다. Goal 0에서는 Node 24 전환을 수행하지 않고 현재 기준선 환경을 기록한다.

## 수동 검증

- 필요하면 기존 multiplayer regression checklist의 2탭 흐름을 확인한다.
- 자동 테스트가 링크, 입력 또는 rollback을 간접 assertion만으로 통과하지 않는지 검토한다.

## 보안·데이터 검토

- 보안 프로토콜과 로그 schema를 변경하지 않는다.
- baseline 테스트가 실제 token, secret 또는 개인 데이터를 fixture에 추가하지 않는지 확인한다.

## Rollback

새 baseline branch의 목적별 commit을 revert하면 최신 main 기준으로 돌아갈 수 있어야 한다. 기존 stabilize 브랜치는 새 기준선이 검증되고 사용자가 승인할 때까지 삭제하지 않는다.

## Merge Gate

검증 결과를 보고하고 멈춘다. 사용자 승인 전에는 push, main merge, 기존 stabilize/migration 브랜치 삭제와 Goal 1을 수행하지 않는다.
