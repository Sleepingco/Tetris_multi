# Goal 9A — PostgreSQL Schema, Migration and Repository

## 상태

구현 대기. [Goal 9 분할 인덱스](09-postgres-event-storage.md)와 Goal 11E가 main에 반영된 뒤 실행한다.

## 목적

실제 PostgreSQL에서 append-only game event를 생성·검증·저장할 수 있는 최소 schema, 명시적 migration runner와 `pg` repository를 만든다. 이 단계에서는 production gameplay의 기본 저장 sink를 바꾸지 않는다.

## 왜 지금 필요한가

runtime 연결 전에 DB가 자체적으로 event identity, 형태와 append-only 제약을 지키는지 검증해야 한다. schema와 repository를 독립 Goal로 고정하면 Socket/gameplay 회귀 없이 멱등성·원자성부터 증명할 수 있다.

## 선행조건

- Goal 11E commit과 Goal 9 분할 문서가 main 및 origin/main에 반영돼 있다.
- main hosted `Fast gate`, `Chromium PVP and PVE`, `Production container smoke`가 green이다.
- worktree가 clean하고 Node가 `.nvmrc`의 `24.18.0`과 정확히 일치한다.
- Docker로 격리된 PostgreSQL을 실행하거나 별도 `TEST_DATABASE_URL`을 제공할 방법이 있다.
- 기존 JSONL validator, repository injection, compiled server artifact와 source-less release 경계를 조사했다.
- `codex/add-postgres-event-shadow`의 merge-base와 diff를 다시 확인하고 전체 재사용 금지를 기록했다.

## 의존성 선택 계약

- Node 24를 지원하는 stable `pg`와 필요한 type package만 후보로 조사한다.
- official release/changelog, Node engine, open security advisory와 package provenance를 확인한다.
- prerelease와 근거 없는 `latest`를 사용하지 않고 exact version을 `package.json`과 lockfile에 기록한다.
- 버전 선택 이유와 제외한 대안을 실행 기록에 남긴다.
- Drizzle, Prisma, migration framework와 Testcontainers를 추가하지 않는다. 기존 Docker와 Node script로 충분한지 먼저 사용한다.

## 범위

- 검토 가능한 raw SQL migration
- migration version/checksum history와 transaction/advisory lock을 사용하는 명시적 runner
- compiled/source-less release에서 실행 가능한 migration artifact
- `game_events` append-only table, check/unique constraint와 최소 index
- canonical JSON, event identity와 SHA-256 helper
- parameterized query만 사용하는 PostgreSQL event repository
- same-ID duplicate와 immutable event conflict 구분
- repository `append()`와 idempotent `close()`
- 실제 PostgreSQL integration test와 local 실행 안내

## 제외 범위

- production request/runtime의 storage mode 선택과 PostgreSQL 활성화
- human log identity canonicalization과 lifecycle schema 변경
- JSONL import, DB exporter와 dataset source 전환
- runtime retry loop, in-flight shutdown drain과 gameplay failure policy
- GitHub Actions PostgreSQL service와 managed database 배포
- runtime dual-write, in-memory queue, outbox와 파생 table

## 허용되는 기능·schema 변화

- exact `pg` production dependency와 필요한 exact type dependency를 추가할 수 있다.
- DB schema와 migration command를 추가한다.
- gameplay, Socket protocol, JSONL 파일과 dataset 결과는 변경하지 않는다.

## SQL Schema 계약

`game_events`는 최소한 다음 의미를 갖는다.

| column | 계약 |
| --- | --- |
| `identity_version` | 현재 `identity-v1`; identity 변경을 명시적으로 구분 |
| `event_id` | `identity-v1` tuple의 SHA-256 primary key |
| `event_type` | `game_start`, `placement_decision`, `game_over` check |
| `schema_version` | 양의 정수 |
| `game_id` | 비어 있지 않은 server game identity |
| `player_id` | placement에 필수, lifecycle에는 nullable |
| `piece_index` | placement에 필수인 0 이상의 정수 |
| `trust_level` | `server_authoritative` 또는 `client_reported` |
| `occurred_at` | event payload의 server/client occurrence time |
| `payload` | object 형태 JSONB |
| `event_sha256` | identity tuple 필드와 모든 immutable column·payload의 canonical SHA-256 |
| `ingested_at` | DB가 생성하는 timestamp |

필수 DB 제약:

- placement와 lifecycle의 nullable 조합을 event type별 `CHECK`로 제한한다.
- start/over는 `(event_type, game_id)`, placement는 `(event_type, game_id, player_id, piece_index)` partial unique index로 semantic identity를 한 번 더 보호한다.
- `event_id`와 hash는 64자리 lowercase hex를 검사한다.
- `game_id` 조회와 `(event_type, ingested_at)` 운영 조회에 필요한 index만 둔다.
- UPDATE/DELETE를 전제로 한 mutable status column과 미사용 파생 table을 만들지 않는다.

## Migration 계약

- application startup에서 schema를 자동 생성하지 않는다.
- 별도 migration entry가 listen/deploy 전에 명시적으로 실행된다.
- migration history는 version, checksum과 applied time을 저장한다.
- advisory lock으로 동시 runner를 직렬화한다.
- migration 하나는 transaction 안에서 전부 성공하거나 전부 rollback한다.
- 이미 적용한 version의 checksum이 다르면 fail closed한다.
- empty DB와 동일 migration 재실행을 모두 지원한다.
- runtime role에는 DDL, UPDATE와 DELETE 권한을 주지 않는다. event INSERT, idempotency 확인 SELECT와 startup migration history/schema version SELECT만 허용하고 migration/maintenance 권한과 분리하는 SQL 또는 운영 절차를 기록한다.

## Repository 멱등성 계약

1. validated canonical event에서 identity tuple의 `event_id`와 immutable persistence envelope 전체의 `event_sha256`을 계산한다. envelope에는 identity tuple 필드, event/schema/trust/occurrence column과 allowlist payload가 포함되며 DB `ingested_at`과 운영 metadata만 제외한다.
2. parameterized `INSERT ... ON CONFLICT DO NOTHING RETURNING`을 실행한다.
3. insert되지 않았으면 별도 query에서 기존 row의 `event_sha256`을 읽는다.
4. 같은 hash면 duplicate success, 다른 hash면 `IDEMPOTENCY_CONFLICT`를 반환한다.
5. 기존 row를 update하지 않는다.

한 statement snapshot에서 concurrent row를 못 보는 race를 만들지 않도록 conflict 후 hash 확인은 별도 DB command로 수행한다. 실제 동시 insert test로 최종 계약을 증명한다.

## 예상 영향 파일

- `package.json`, `package-lock.json`
- `src/server/repositories/`의 PostgreSQL event repository
- server migration source와 build entry
- SQL migration과 migration history helper
- `scripts/build.js` 또는 현재 artifact manifest의 최소 변경
- DB unit/integration test와 production release test
- Goal 9A 실행 기록과 현재 문서

실제 구조 조사 후 기존 build helper를 재사용하고 새로운 범용 framework를 만들지 않는다.

## 완료 기준

- clean empty PostgreSQL에 migration이 적용되고 재실행 결과가 동일하다.
- 실제 repository가 세 event type을 insert한다.
- 같은 event를 반복·동시 insert해도 한 행만 존재한다.
- 같은 identity의 다른 immutable column 또는 payload가 conflict로 드러나고 기존 row는 변하지 않는다.
- constraint 위반이 DB에서 거부된다.
- migration/repository artifact가 source-less production dependency 환경에서 load된다.
- JSONL runtime과 gameplay 결과는 기준 main과 같다.

## 자동 검증

구현 시 실제 script 이름을 package manifest와 실행 기록에 고정한다. 최소 gate는 다음 의미를 가져야 한다.

```bash
test "$(node --version)" = "v$(tr -d '\n' < .nvmrc)"
npm ci --ignore-scripts
npm run typecheck
npm run build
npm run db:migrate
npm run db:migrate
npm run test:db
bash scripts/verify.sh
npm run test:release
git diff --check <base>..HEAD
```

DB integration에는 다음 case가 필수다.

- empty bootstrap과 migration rerun
- checksum mismatch fail closed
- same ID/same event hash duplicate success와 row count 1
- concurrent duplicate와 row count 1
- same ID/different immutable column 또는 payload conflict와 원본 hash 불변
- type별 check/partial unique constraint
- invalid/closed repository와 idempotent close
- connection URL과 payload가 오류 log에 노출되지 않음

## 수동 검증

- PostgreSQL CLI 또는 parameterized Node query로 schema version, table/index와 event type별 row를 확인한다.
- migration 실행 전후 application Docker image에 PostgreSQL server나 credential이 포함되지 않았음을 확인한다.

## 보안·데이터 검토

- production connection은 TLS hostname/certificate 검증 정책을 provider 계약과 함께 fail closed한다.
- `DATABASE_URL`을 exception, console, test artifact, process listing 예시에 출력하지 않는다.
- test credential은 격리 DB에만 사용하고 repository에 commit하지 않는다.
- DB runtime role은 최소한의 event INSERT, idempotency 확인 SELECT와 migration history/schema version SELECT만 허용한다.

## 커밋 계획

1. `build: add PostgreSQL event migration`
2. `feat: add idempotent PostgreSQL event repository`
3. `test: verify PostgreSQL schema and repository`
4. `docs: record Goal 9A verification`

## Rollback과 data 호환성

application commit은 역순 revert할 수 있다. 이미 생성된 table과 row는 자동 drop하지 않는다. DB data 삭제와 down migration은 별도 사용자 승인으로만 수행한다. code rollback 후 JSONL runtime은 계속 동작해야 한다.

## 즉시 중단 조건

- 실제 PostgreSQL integration 환경을 준비할 수 없다.
- `pg` 외 ORM/migration framework가 필수라고 판단된다.
- current build가 migration SQL/source-less artifact를 안전하게 포함할 수 없다.
- schema가 gameplay state나 credential 저장을 요구한다.
- 기존 DB branch code를 통째로 가져와야만 진행할 수 있다.

## Merge Gate와 다음 Goal

검증과 실행 기록을 완료한 뒤 멈춘다. push, main merge와 runtime PostgreSQL 활성화는 별도 승인 없이는 수행하지 않는다. Goal 9A가 main과 origin/main에 반영된 뒤에만 [Goal 9B](09b-postgres-runtime-storage.md)를 시작한다.
