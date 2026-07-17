# Goal 11D — Migration CI Gate

## 목적

로컬 migration gate를 CI에서 재현해 잘못된 Node, build, DB와 browser 회귀가 main에 들어오는 것을 방지한다.

## 선행조건

- Goal 11C의 main 반영
- 로컬 fast/full gate와 production container 검증이 안정적임
- CI provider의 secret, cache와 artifact 정책 합의

## 범위

- Node 24와 `npm ci`
- typecheck, build, unit와 `scripts/verify.sh`
- Playwright browser install/cache와 PVP/PVE E2E
- isolated PostgreSQL service와 migration/integration test
- Docker build 및 production smoke
- concurrency cancellation, timeout와 최소 권한
- 실패 artifact, log redaction과 retention
- ML parity는 비용에 따라 required/optional workflow로 분리

## 제외 범위

- 자동 production deployment
- 장기 secret의 workflow 직접 삽입
- flaky test 무조건 retry로 은폐

## 완료 기준과 검증

- clean CI run에서 모든 required job이 통과한다.
- 의도적으로 type/build/unit/E2E/DB 실패를 만들었을 때 올바른 job이 실패한다.
- cache 없이도 재현 가능하고 cache key가 lockfile에 연결된다.
- branch protection에 연결할 required check 목록이 문서화된다.
- CI log와 artifact에 token/DB credential이 없다.

## Rollback과 Merge Gate

workflow 변경을 revert해 이전 required check로 복귀할 수 있어야 한다. branch protection과 deployment 변경은 별도 승인 후 적용한다.
