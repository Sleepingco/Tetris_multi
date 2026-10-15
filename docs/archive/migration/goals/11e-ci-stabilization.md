# Goal 11E — PVE CI Timing Stabilization

## 상태

구현 대기. Goal 11D workflow는 main에 있지만 main push의 browser job에서 서로 다른 PVE timing failure가 관찰됐다. 이 Goal은 PostgreSQL 작업보다 먼저 main CI를 다시 green으로 만든다.

## 목적

server-authoritative PVE 테스트가 gameplay 결함이 아니라 관찰·입력 시점 경쟁으로 실패하는 문제를 제거하고 GitHub-hosted main CI의 기존 세 job을 안정화한다.

## 왜 지금 필요한가

DB 변경을 시작한 뒤 기존 browser flake가 섞이면 새 회귀와 기준선 실패를 구분할 수 없다. PostgreSQL Goal은 CI 기준선이 green인 main에서 시작해야 한다.

## 선행조건

- Goal 11D workflow와 hosted PR 성공 기록이 main에 포함돼 있다.
- local main과 origin/main의 SHA, branch와 dirty 상태를 확인한다.
- 별도 worktree를 사용해 사용자 소유 문서와 다른 작업을 보존한다.
- Node가 `.nvmrc`의 `24.18.0`과 정확히 일치한다.
- 최근 main push의 `Fast gate`, `Chromium PVP and PVE`, `Production container smoke` 결과와 실패 log를 다시 읽는다.
- 변경 전 `bash scripts/verify.sh`, Vite-dev와 production browser 기준선을 기록한다.

## 알려진 실패 형태

### T-Spin 입력 경계

grounded 경계까지 manual soft drop하는 동안 server gravity가 먼저 같은 조각을 내릴 수 있다. 이후 blocked soft drop은 정상 규칙에 따라 lock할 수 있으므로 키 입력 호출이나 정확한 polling 순간을 성공 증거로 사용하지 않는다.

### Pending garbage 관찰 경계

기존 pending garbage가 lock에 적용된 직후 hard AI가 새 공격을 보낼 수 있다. 특정 lock 뒤 UI가 계속 `0`이고 `is-danger`가 없어야 한다는 조건은 첫 garbage 적용 여부의 안정적인 증거가 아니다.

두 실패 모두 production 결함이라는 증거는 아직 없다. 구현 전 trace와 authoritative snapshot 흐름으로 이 가설을 다시 확인한다.

## 범위

- `e2e/multiplayerPve.spec.js`의 timing-sensitive T-Spin과 pending garbage 시나리오
- 필요한 최소 page-local test helper
- `PLAN.md` 현재 상태와 Goal 11E 실행 기록
- 사용자 승인 후 동일 commit의 GitHub-hosted PR/main 검증

## 제외 범위

- production gameplay, gravity, lock delay, ticker와 AI 규칙 변경
- Socket contract, server protocol과 client runtime 변경
- Playwright timeout 증가, retry 추가, 고정 sleep 추가
- test skip, assertion 전체 삭제와 worker/concurrency 변경으로 green 만들기
- production debug global, test-only API와 deterministic server 우회
- dependency, lockfile와 workflow job 구조 변경
- 실패 trace/artifact 업로드와 token/session/raw payload 출력
- PostgreSQL 코드·문서 선행 구현

## 구현 계약

- T-Spin manual input은 grounded 위치보다 충분히 위에서 끝낸다.
- 이후 같은 `pieceIndex`의 authoritative gravity snapshot으로 필요한 row에 도달했음을 확인한다.
- T-Spin 성공은 최종 piece index 증가, score delta와 board cell로 검증한다.
- pending garbage 적용은 기준 snapshot 이후의 sequence, piece index, pending 값과 board fingerprint 변화로 추적한다.
- 새 AI 공격이 도착할 수 있으므로 post-lock UI의 지속적인 0 상태를 요구하지 않는다.
- UI는 같은 관찰 시점에서 표시 숫자와 `is-danger` class가 일치하는지만 검증한다.
- 제품 동작 결함이 관찰되면 E2E 수정에서 멈추고 production bugfix를 별도 승인받는다.

## 예상 영향 파일

- `e2e/multiplayerPve.spec.js`
- `PLAN.md`
- `migration-harness/runs/goal-11e-<date>.md`

예상 밖 production source, `.github/workflows/ci.yml`, package manifest 변경이 필요하면 구현을 중단한다.

## 완료 기준

- 두 실패 경로가 authoritative 결과를 검증하며 timing 우연에 의존하지 않는다.
- timeout, retry, worker 수와 production code는 기준 main과 동일하다.
- local fast, release, Vite-dev와 전체 production browser gate가 모두 통과한다.
- 동일 commit의 hosted Browser job이 연속 두 번 통과한다.
- main 반영 후 세 hosted job이 모두 green이다.

## 자동 검증

```bash
test "$(node --version)" = "v$(tr -d '\n' < .nvmrc)"
npm run test:e2e -- e2e/multiplayerPve.spec.js --grep "T-Spin|pending 표시" --repeat-each=10
npm run test:e2e -- e2e/multiplayerPve.spec.js --repeat-each=3
bash scripts/verify.sh
npm run test:release
npm run test:e2e:vite-dev
npm run test:e2e
git diff --check <base>..HEAD
```

- targeted 두 scenario는 합계 `20/20`이어야 한다.
- 전체 PVE spec 3회 반복은 현재 spec 수에 맞는 모든 case가 통과해야 한다.
- `workers: 1`, `retries: 0`을 유지한다.
- package, lockfile, workflow와 production source checksum이 기준과 같아야 한다.

## Hosted CI Gate

push와 PR은 별도 사용자 승인 후 수행한다.

- 같은 commit SHA에서 `Fast gate`, `Chromium PVP and PVE`, `Production container smoke`가 모두 성공한다.
- 같은 SHA의 Browser job을 한 번 더 실행해 연속 성공을 확인한다.
- rerun 실패를 retry 성공으로 덮지 않고 원인을 다시 조사한다.
- main merge 후 main push run의 세 job이 모두 성공해야 Goal 9A를 시작한다.
- run URL, SHA, test count, 시간과 cache 상태는 실행 기록에 남긴다.

## 보안·데이터 검토

이 Goal은 사용자 데이터와 protocol을 변경하지 않는다. trace, screenshot과 console에 token, nickname 원문 또는 placement payload를 추가로 기록하지 않는다.

## 커밋 계획

1. `test: stabilize PVE authoritative timing`
2. `docs: record Goal 11E CI stabilization`

## Rollback

문서 commit 뒤 test commit 순서로 역순 revert한다. production, protocol과 data rollback은 없다. rollback하면 기존 CI flake가 다시 나타날 수 있음을 기록한다.

## 즉시 중단 조건

- 같은 실패가 실제 production gameplay state 오류로 재현된다.
- 예상 파일 밖 production 변경이 필요하다.
- targeted 반복이 한 번이라도 실패한다.
- GitHub-hosted 실패 원인이 테스트가 아니라 runner/service 장애인지 구분할 수 없다.
- 사용자 소유 dirty 파일과 변경 범위가 겹친다.

## Merge Gate와 다음 Goal

검증과 실행 기록 후 멈춘다. push, PR, main merge는 각각 승인받는다. main hosted CI green을 확인한 뒤에만 [Goal 9A](09a-postgres-schema-repository.md)를 별도 branch에서 시작한다.
