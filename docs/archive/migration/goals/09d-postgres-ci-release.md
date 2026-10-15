# Goal 9D — PostgreSQL CI and Release Gate

## 상태

구현 대기. Goal 9C까지 main에 반영된 뒤 실제 PostgreSQL 환경에서 전체 storage chain을 CI와 production-like Docker로 검증한다.

## 목적

clean GitHub-hosted runner와 source-less production image에서 migration → repository → runtime storage → JSONL import 경계를 실제 PostgreSQL로 재현하고, production PostgreSQL 활성화 전 마지막 운영 gate를 만든다.

## 왜 지금 필요한가

local DB 통과만으로는 clean install, service readiness, network/TLS 설정, compiled artifact와 container shutdown을 보장할 수 없다. DB mock이 아니라 실제 PostgreSQL service를 required candidate check로 고정해야 배포 전 회귀를 잡을 수 있다.

## 선행조건

- Goal 9A, 9B와 9C commit이 main 및 origin/main에 포함돼 있다.
- 기존 Goal 11E 이후 `Fast gate`, `Chromium PVP and PVE`, `Production container smoke`가 green이다.
- worktree가 clean하고 Node가 `.nvmrc`와 정확히 일치한다.
- local Docker에서 실제 PostgreSQL migration/runtime/import gate가 통과했다.
- GitHub Actions service용 PostgreSQL major/tag/digest와 license/provenance를 확인했다.
- production provider가 정해졌다면 managed DB의 secret 주입, TLS, backup, retention과 rollback 책임을 문서화한다. provider가 미정이면 provider-neutral runbook까지만 검증하고 실제 enable은 blocked로 남긴다.

## 범위

- GitHub Actions의 실제 PostgreSQL service integration job
- clean install, empty migration, migration rerun과 repository/runtime/import integration
- source-less production release의 migration/runtime artifact 검증
- application container와 외부 PostgreSQL container의 network/health/shutdown smoke
- PostgreSQL mode의 HTTP, Socket.IO와 최소 PVP/PVE log 흐름
- CI permission, timeout, concurrency, secret/redaction과 artifact 정책
- required check 후보 이름과 hosted run 증거
- production enable/rollback runbook 문서
- production enable 전 실행 가능한 retention dry-run·승인된 수동 삭제 runbook과 maintenance role 분리 검증

## 제외 범위

- PostgreSQL server를 application image에 설치
- cloud account, managed DB와 application을 자동 생성·배포
- long-lived production secret을 repository 또는 workflow에 저장
- production JSONL 전체를 CI로 import
- DB dump, user event와 실패 artifact 업로드
- branch protection 자동 변경
- DB exporter/read-source cutover, JSONL 삭제와 자동 recurring retention job
- multi-instance Socket.IO/room state persistence

## CI 구조 계약

기존 세 job 이름과 책임을 보존하고 fast 성공 뒤 병렬 PostgreSQL job을 추가하는 방식을 우선한다.

```text
Fast gate
├─ Chromium PVP and PVE
├─ Production container smoke
└─ PostgreSQL event storage
```

`PostgreSQL event storage` job은 최소한 다음을 수행한다.

1. clean checkout과 `.nvmrc` Node setup
2. `npm ci --ignore-scripts`
3. service health를 bounded wait로 확인
4. empty migration과 동일 migration 재실행
5. repository concurrency/idempotency/conflict integration
6. runtime mode, privacy와 DB-down fixture
7. synthetic JSONL import 두 번과 row/hash 불변
8. source-less release/artifact load

- PostgreSQL service credential은 job-local test 값만 사용한다.
- service image는 검증된 immutable reference를 사용한다.
- cache miss에서도 동작하며 DB volume/cache를 run 사이에 재사용하지 않는다.
- flake를 workflow retry, 긴 sleep 또는 `continue-on-error`로 숨기지 않는다.
- user event, database dump와 trace는 artifact로 올리지 않는다.

## Docker·Release 계약

- application image에는 PostgreSQL client runtime dependency만 포함하고 server binary/data directory는 넣지 않는다.
- DB는 별도 container 또는 managed service이며 `DATABASE_URL`은 runtime secret으로 주입한다.
- migration entry와 SQL/checksum artifact는 source-less image 또는 명시적 release artifact에서 실행 가능해야 한다.
- migration을 application HTTP listen과 암묵적으로 동시에 실행하지 않는다.
- postgres mode startup은 service/schema가 준비되지 않으면 health를 green으로 만들지 않는다.
- read-only root, non-root user, CSP/security header와 first-party source/map 404 계약을 유지한다.
- SIGTERM은 기존 8초 deadline, exit code 0과 PostgreSQL pool close를 확인한다.

## 운영 활성화 Gate

production PostgreSQL mode를 켜기 전에 다음을 문서와 실제 환경에서 확인한다.

- migration credential과 runtime least-privilege credential 분리
- TLS hostname/certificate 검증
- backup/restore 책임과 최소 1회 restore rehearsal 계획
- raw event retention, 삭제 주체와 사용자 고지
- parameterized cutoff, 대상 row/bytes 상한, dry-run과 이중 확인을 갖춘 수동 retention 절차
- `pg_total_relation_size` warning/stop threshold와 비용 한도
- DB outage 시 gameplay 지속과 event loss 허용 수준
- 이전 application image digest와 `GAME_EVENT_STORAGE=jsonl` rollback 절차
- 활성화 승인 후 production은 `GAME_EVENT_STORAGE=postgres` 단일 sink로 전환하고 JSONL writable volume을 mount하지 않는다. 기존 JSONL은 read-only backup으로 보존한다.

strict lossless가 요구되면 이 Goal을 완료로 처리하지 않고 durable outbox를 별도 Goal로 설계한다.

## 예상 영향 파일

- `.github/workflows/ci.yml`
- DB integration scripts/test fixture와 package script
- Docker/release artifact 검증
- production environment와 rollback 문서
- `PLAN.md`, `change-log.md`와 Goal 9D 실행 기록

production gameplay source 변경이 필요하면 Goal 9B 누락인지 먼저 조사한다.

## 완료 기준

- local과 GitHub-hosted clean runner에서 실제 PostgreSQL job이 통과한다.
- migration/repository/runtime/import가 mock 없이 하나의 service에서 검증된다.
- Browser와 Docker 기존 job이 계속 green이다.
- source-less image가 migration artifact와 postgres runtime을 load한다.
- postgres mode container가 JSONL writable volume 없이 기동하고 경기 후에도 JSONL file을 생성·변경하지 않는다.
- test/production log와 artifact에 URL, password와 user payload가 없다.
- required check 후보 이름, run URL, SHA, 시간과 cache 상태가 기록된다.
- production enable/rollback runbook이 실제 명령 경계와 일치한다.
- maintenance role로 retention dry-run을 실행하고 runtime role로는 같은 query가 거부된다. 실제 삭제 rehearsal은 synthetic row에만 수행한다.

## 자동 검증

```bash
test "$(node --version)" = "v$(tr -d '\n' < .nvmrc)"
bash scripts/verify.sh
npm run test:db
npm run test:release
npm run test:e2e:vite-dev
npm run test:e2e
docker build --pull --tag <local-goal9d-tag> .
git diff --check <base>..HEAD
```

추가 production-like smoke:

- external PostgreSQL health → migration → application startup
- `/`, 네 page, asset와 Socket.IO HTTP 200
- PVP/PVE synthetic event insert와 DB query
- JSONL volume 없는 postgres mode와 JSONL file 생성·append 0건
- first-party TS/TSX/declaration/source map 404
- no credential/source/test/dev tool in image
- DB 중단 시 gameplay failure semantics
- DB 중단 부하에서 pool/in-flight 상한과 ticker cadence
- SIGTERM 8초 안 exit 0과 pool close

## Hosted CI Gate

push/PR 승인 후 같은 commit SHA에서 다음 네 job이 모두 성공해야 한다.

- `Fast gate`
- `Chromium PVP and PVE`
- `Production container smoke`
- `PostgreSQL event storage`

cache miss clean run을 최소 1회 확인한다. 의도적 DB migration/integration 실패 routing은 안전한 임시 commit 또는 local workflow validation으로 확인하고 main에 병합하지 않는다. branch protection 연결은 별도 승인 대상이다.

## 수동 검증

- production-like Docker network에서 PVP/PVE 한 경기의 event chain을 query한다.
- duplicate/conflict, privacy, relation size와 shutdown 결과를 확인한다.
- application container를 재시작해 DB row가 보존되고 중복되지 않는지 확인한다.
- rollback runbook으로 JSONL mode 또는 이전 image를 controlled environment에서 rehearsal한다.

## 보안·데이터 검토

- workflow permission은 `contents: read`를 넘기지 않는다.
- GitHub secret 없이 job-local DB만 사용한다.
- production URL은 GitHub log, Docker inspect 예시와 artifact에 남기지 않는다.
- DB dump/user JSONL/Playwright trace는 redaction 정책 전까지 업로드하지 않는다.
- runtime role에 DDL/UPDATE/DELETE를 주지 않는다.
- runtime role에는 event INSERT, idempotency 확인 SELECT와 migration history/schema version SELECT만 허용한다. retention/delete는 별도 maintenance role과 승인 절차를 사용한다.

## 커밋 계획

1. `ci: verify PostgreSQL event storage`
2. `test: verify PostgreSQL production boundary`
3. `docs: record Goal 9D release gate`

## Rollback과 data 호환성

- workflow/document commit을 먼저 revert한다.
- production enable 전이면 code/data rollback은 없다.
- production enable 후에는 env를 JSONL mode 또는 이전 image digest로 되돌리되 PostgreSQL row를 삭제하지 않는다.
- JSONL rollback에는 `GAME_EVENT_STORAGE=jsonl`, 기존 보존 file과 writable volume을 모두 명시적으로 복구한다.
- migration down/drop은 자동 rollback에 포함하지 않는다.

## 즉시 중단 조건

- CI가 실제 PostgreSQL 대신 mock만 사용한다.
- service readiness를 unbounded sleep/retry로 기다린다.
- secret 또는 user payload가 log/artifact에 노출된다.
- current Browser/Docker gate가 DB 변경 때문에 실패한다.
- application image 안에 PostgreSQL server/data가 들어간다.
- retention, backup, size와 event-loss 정책 없이 production enable이 요구된다.
- retention이 선택 Goal 10이라는 이유로 production 수집 데이터를 무기한 보존해야 한다.

## Merge Gate와 다음 Goal

hosted 검증과 실행 기록 후 멈춘다. push, PR, main merge, branch protection, managed DB provisioning과 production enable은 각각 별도 승인 대상이다. Goal 9D 이후 DB 기반 dataset 조회가 실제로 필요할 때만 [Goal 10](10-storage-cutover.md)을 별도 승인으로 시작한다.
