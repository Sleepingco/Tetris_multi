# PostgreSQL Game Event Storage Blueprint

## 1. 문서 목적과 현재 상태

이 문서는 게임 이벤트를 컨테이너 수명과 분리해 장기 보존하기 위한 PostgreSQL 저장 구조의 설계 설명이다. 공부하는 개발자, 포트폴리오 검토자와 운영 환경의 로그 저장 구조를 검토할 개발자를 독자로 둔다.

2026-10-15 문서 정리에서 아래 상태 설명을 기존 배포 기록과 맞췄다. 운영 근거는
[2026-07-24 OCI 배포 기록](../history/oci/oci-production-deployment-session-2026-07-24.md)과
[운영 runbook](../deployment/postgres-production-runbook.md)이며, 이번 문서 정리에서 실제 서버를 재검증한 것은 아니다.
이하 Goal별 역할·단계·도입 판단은 당시 설계 배경이다. 새로운 작업을 지시하는 절차로 사용하지 않는다.

- 상태: Goal 9A~9D main/origin 통합과 hosted PostgreSQL release gate 완료
- PostgreSQL 구현: schema, migration, canonical event/repository, strict runtime single-sink, JSONL importer와 production-like release gate 구현
- production DB: 2026-07-24 OCI 배포에서 PostgreSQL single-sink 활성화 완료
- local/test 기본 sink: JSONL. production은 명시적 PostgreSQL mode를 사용한다.
- 도입 당시 hosted 검증: `6775bfb`의 Fast/Browser/Docker/PostgreSQL 네 job green. 이후 상태는 [PLAN](../../../PLAN.md)과 배포 기록에서 확인한다.

JSONL은 local 분석과 ML export에 계속 사용한다. PostgreSQL은 room, match, gameplay 상태의 원천이 아니다. 실시간 상태는 process memory가 소유하고, PostgreSQL은 확정된 gameplay event의 장기 보존을 담당한다.

현재 구현의 원천은 `src/server/db/migrations/`의 SQL과 서버의 projection·repository·runtime storage 코드다. 실행·검증 기준은 [운영 runbook](../deployment/postgres-production-runbook.md), [package scripts](../../../package.json), [CI](../../../.github/workflows/ci.yml)를 따른다.
도입 당시 범위는 [Goal 9 공통 index](../../archive/migration/goals/09-postgres-event-storage.md)와 하위 Goal, 검증 증거는 [실행 기록](../../archive/migration/runs/README.md)에 보존한다. 이 Blueprint는 SQL을 복사하지 않고 왜 그 구조가 필요한지 설명한다.

## 2. Local/test JSONL 흐름

JSONL mode에서는 서버가 raw event를 검증한 뒤 JSONL 한 줄로 append한다.

```text
Socket/server AI event
  → gameLogValidator
  → logService
  → jsonlLogRepository
  → data/logs/game-events.jsonl
```

`gameLogValidator`는 event 종류별 필드, JSON 직렬화 가능성, 최대 256 KiB를 검사한다. `logService`는 검증 성공한 log만 주입 가능한 repository에 넘기고, 기록 실패가 이미 진행한 gameplay를 예외로 중단시키지 않도록 결과로 바꾼다. `jsonlLogRepository`는 대상 디렉터리를 만들고 JSON object 한 건을 한 줄씩 append한다.

현재 human placement는 client raw log를 그대로 신뢰하지 않는다.

```text
client raw placement log
  → active session과 room 권한 확인
  → authoritative placement receipt 확인
  → server gameId와 session roomId/playerId로 덮어씀
  → placement schema 재검증
  → 선택된 sink에 저장 (이 절에서는 JSONL)
```

즉, client가 보낸 `gameId`, `roomId`와 `playerId`는 저장 주체가 아니다. Socket handler가 30초 TTL·player당 최대 128개의 authoritative receipt에서 client sequence와 piece index를 확인해 receipt를 한 번 소비하고, server/session identity로 바꾼 뒤 `validatePlacementDecisionLog`를 다시 통과한 값만 선택된 sink에 전달한다.

Socket handler는 client human placement log를 인증·재검증하고 game start log를 만든다. authoritative match finish는 game over log를 만들고, PVE AI service는 실제로 확정된 heuristic placement를 schema v2 log로 만든다. 이 흐름의 현재 구현 위치는 다음과 같다.

- `src/server/validators/gameLogValidator.ts`
- `src/server/services/logService.ts`
- `src/server/repositories/jsonlLogRepository.ts`
- `src/server/sockets/multiplayerHandlers.ts`
- `src/server/services/pveAiPlayerService.ts`

JSONL의 장점은 단순하고, local 분석과 ML export에 충분하며, 별도 DB 운영이 필요 없다는 점이다. 반면 container 교체와 저장 경로 관리를 분리하기 어렵고, 여러 instance의 공용 저장소가 되기 어렵다. 중복, 누락, immutable event의 완전성을 SQL 제약으로 확인하기도 불편하다. 실제 사용자 event를 장기 보존하려면 이보다 분명한 운영 경계가 필요하다.

## 3. PostgreSQL 저장 구조

PostgreSQL 경로는 raw log를 그대로 저장하는 경로가 아니다. 인증되었거나 server가 소유한 event를 canonical projector가 투영한 뒤 PostgreSQL repository가 저장한다.

```text
server-owned or authenticated event
  → canonical projector
  → CanonicalGameEvent
  → PostgreSQL repository
  → tetris_analytics.game_events
```

환경별 runtime sink는 하나만 둔다.

```text
local/development
  → JSONL

approved production
  → PostgreSQL
  → JSONL writer 비활성화
```

runtime dual-write는 두 저장소의 성공 여부를 맞춰야 하고, 조용한 fallback은 운영자가 실제 저장 실패를 놓치게 한다. 따라서 한 process가 두 sink를 동시에 성공으로 주장하지 않는다. PostgreSQL 전환 전과 명시적 rollback에서는 JSONL 경로가 계속 남는다.

## 4. 도입 당시 Goal 9A~9D 역할

도입 작업을 다음 역할로 나눠 main에 반영했다. 각 Goal의 구현과 검증은 종료됐다.

| Goal | 역할 |
| --- | --- |
| 9A | schema, migration, canonical identity, PostgreSQL repository |
| 9B | server event를 canonical event로 변환하고 runtime에 연결 |
| 9C | 기존 JSONL streaming import와 완전성 검사 |
| 9D | GitHub Actions, Docker, production-like PostgreSQL gate |

Goal 9A~9D는 완료됐다. Goal 10과 DB 기반 dataset read cutover는 실제 요구가 생길 때까지 보류하며, production PostgreSQL 활성화와 실제 JSONL import는 별도 운영 승인 대상이다.

## 5. 저장 이벤트

최소 저장 대상은 세 종류다.

- `game_start`
- `placement_decision`
- `game_over`

모든 키 입력, gravity tick, snapshot을 저장하지 않는다. 이들은 실시간 동기화와 process memory 상태에 필요한 정보이지 장기 event table의 최소 단위는 아니다. placement는 최종 확정된 piece 단위 event가 핵심이며, room/match/gameplay 상태는 계속 현재 process memory가 담당한다.

## 6. CanonicalGameEvent

`CanonicalGameEvent`는 raw validator 결과와 DB row 사이의 immutable snapshot이다. TypeScript type만으로 신뢰하지 않고 runtime에서도 검증한다.

| 필드 | 의미 |
| --- | --- |
| `identityVersion` | 현재 identity 규칙인 `identity-v1` |
| `eventType` | 저장 event 종류 |
| `schemaVersion` | event payload schema version |
| `gameId` | server가 소유하는 game identity, UTF-8 최대 64 bytes |
| `playerId` | placement의 player identity, lifecycle은 null, UTF-8 최대 64 bytes |
| `pieceIndex` | placement의 0 이상 PostgreSQL integer, lifecycle은 null |
| `trustLevel` | `server_authoritative` 또는 `client_reported` |
| `occurredAt` | null 또는 exact UTC ISO 문자열 |
| `payload` | allowlist로 만든 plain JSON object |

### Canonical serialization

canonicalization은 JSON primitive, array, plain object만 허용한다. object key는 재귀적으로 `Object.keys(value).sort()`의 UTF-16 code-unit 순서로 정렬하고 array 순서는 보존한다. `localeCompare`와 Unicode normalization은 사용하지 않는다. array own key는 `length`와 실제 `0..length-1` index만 허용하며 `4294967295` 같은 배열 밖 key도 거부한다. own `__proto__`는 일반 key처럼 보존한다. `occurredAt`은 UTC millisecond ISO 문자열로 정규화한다.

number는 finite 값만 허용하고 JSON이 `0`으로 축약하는 `-0`도 거부한다. 문자열 값과 object key에는 PostgreSQL text/JSONB가 저장하지 못하는 U+0000 또는 unpaired surrogate를 허용하지 않는다. 그 밖에 BigInt, `undefined`, function, symbol, sparse array, custom prototype, `toJSON`, getter, 순환 참조를 거부한다.

`canonicalJson`은 정렬된 key와 value token을 직접 직렬화한다. 정렬한 값을 임시 일반 object에 할당한 뒤 `JSON.stringify`의 property enumeration에 의존하지 않는다. JSON string/key escaping에는 표준 `JSON.stringify`를 사용하며, 완성된 canonical JSON의 UTF-8 bytes가 hash 입력이다. identity preimage는 `event_id = SHA256(UTF8(canonicalJson(identityTuple)))`로 고정한다. `event_sha256`은 같은 `canonicalJson` 함수로 immutable envelope를 직렬화한 UTF-8 bytes의 SHA-256이다.

hash fixture는 primitive와 null, nested own `__proto__`, integer-like key의 code-unit 순서, 중첩 object key 순서가 달라도 같은 hash인지, 같은 identity에서 payload만 바꾸면 `event_id`는 같고 `event_sha256`은 달라지는지, 각 fixture의 exact expected digest가 일치하는지를 검증한다. 이를 위해 새 canonicalization dependency를 추가하지 않는다.

256 KiB 상한은 serialized canonical envelope 전체에 적용한다. 현재 JSONL validator의 raw log 전체 256 KiB 상한도 그대로 유지한다. 한 번 만든 immutable snapshot을 hash 계산과 INSERT 양쪽에서 그대로 사용해, 서로 다른 표현이 같은 event로 섞이지 않게 한다.

현재 production identity 생성 경로에서 room ID는 UUID 앞 8 ASCII, match별 game ID와 human player ID는 UUID 36 ASCII bytes, heuristic AI player ID는 `heuristic-ai-`와 room ID를 합쳐 21 ASCII bytes다. canonical 경계는 이 현재 최대값을 포함하면서 future projector가 무제한 identity를 만들지 못하도록 `gameId`와 `playerId`를 각각 UTF-8 64 bytes로 제한한다. SQL도 같은 `octet_length <= 64`를 검사한다.

## 7. Identity와 멱등성

identity tuple은 event 종류별로 작고 결정적이다.

```text
game_start
  [identity-v1, game_start, gameId]

placement_decision
  [identity-v1, placement_decision, gameId, playerId, pieceIndex]

game_over
  [identity-v1, game_over, gameId]
```

tuple의 canonical UTF-8 bytes를 SHA-256해 `event_id`를 만든다. immutable envelope 전체도 SHA-256해 `event_sha256`을 만든다. canonical JSON은 object key를 정렬하고 array 순서를 보존한다. DB가 생성하는 `ingested_at`은 envelope hash에서 제외하며, `event_id`와 `event_sha256` 자신도 다시 hash하지 않는다.

```text
same identity + same hash
  → duplicate success

same identity + different hash
  → IDEMPOTENCY_CONFLICT
  → 기존 row 유지
```

duplicate 성공은 조회 결과가 정확히 한 행이고 `event_id`, event type, game/player/piece semantic tuple, `event_sha256`가 모두 일치할 때만 허용한다. 0행, 2행, 또는 어느 하나의 불일치도 conflict다.

이 계약은 network exactly-once를 주장하지 않는다. 정확한 표현은 다음과 같다.

```text
at-least-once attempt + unique constraint
```

## 8. 테이블 개념

예정 table은 다음 하나다.

```text
tetris_analytics.game_events
```

| column | 의미 |
| --- | --- |
| `identity_version` | identity 규칙을 구분하는 version |
| `event_id` | identity tuple의 SHA-256 primary key |
| `event_type` | start, placement, over 구분 |
| `schema_version` | payload schema version |
| `game_id` | server game identity |
| `player_id` | placement player, lifecycle에서는 null |
| `piece_index` | placement piece identity, lifecycle에서는 null |
| `trust_level` | event 신뢰 수준 |
| `occurred_at` | event 발생 시각 |
| `payload` | allowlist JSON payload |
| `event_sha256` | immutable persistence envelope hash |
| `ingested_at` | DB가 생성하는 수집 시각 |

index는 primary event ID, lifecycle semantic identity, placement semantic identity, `gameId` 조회, `(eventType, ingestedAt)` 운영 조회를 위해서만 둔다. SQL은 `game_id`와 non-null `player_id`의 UTF-8 길이를 canonical 경계와 같은 64 bytes로 제한하고, non-null `occurred_at`에 PostgreSQL finite timestamp만 허용해 `infinity`와 `-infinity`를 거부한다. append-only event table에는 mutable status, UPDATE 기반 upsert, 미사용 파생 table을 만들지 않는다. 정확한 constraint와 index 정의는 `src/server/db/migrations/001_game_events.sql`의 책임이다.

현재 migration은 `identity-v1`만 CHECK로 허용한다. 미래 identity version은 기존 CHECK와 identity에 의존하는 index를 함께 바꾸는 새 migration으로만 도입한다.

## 9. Migration 구조

application startup은 schema를 자동 생성하지 않는다. 별도 migration CLI가 listen 또는 deploy 전에 실행된다.

```text
migration CLI
  → version/checksum history 확인
  → 고정 advisory lock 획득
  → migration 한 건씩 transaction 실행
  → history 기록
  → unlock 및 connection close
```

history는 version, checksum, 적용 시각을 보관한다. `CREATE ... IF NOT EXISTS` 직후 analytics schema와 history table의 owner가 모두 `current_user`인지 확인하고, 다른 role이 미리 만든 객체는 migration role에 권한을 grant했더라도 `MIGRATION_BOOTSTRAP_OWNER_MISMATCH`로 거부한다. checksum이 이미 적용된 version과 다르면 fail closed한다. empty DB와 동일 migration 재실행을 모두 지원한다. lock wait는 bounded이며, migration 실패 시 rollback, unlock, connection close를 순서대로 시도한다.

advisory lock은 PostgreSQL server 기능이다. 이 한 table을 위해 별도 migration framework를 도입하지 않는다.

## 10. DB 역할과 최소 권한

```text
tetris_migration
  → schema/table owner
  → migration과 DDL

tetris_runtime
  → 제한된 schema search_path와 schema USAGE
  → 허용 column INSERT
  → idempotency 확인용 제한 SELECT
  → startup migration-history/schema-version 제한 SELECT
```

runtime role에는 schema CREATE, UPDATE, DELETE, TRUNCATE, DDL, migration role membership, SUPERUSER, CREATEDB, CREATEROLE, REPLICATION, BYPASSRLS 권한을 주지 않는다. `ingested_at`은 runtime이 입력하는 값이 아니라 DB가 생성하는 값이다.

runtime connection의 `search_path`는 필요한 schema와 `pg_catalog`으로 제한하고, repository query는 `tetris_analytics.game_events`처럼 schema-qualified로 작성한다. admin provisioning은 `public` schema의 CREATE와 필요 없는 PUBLIC 권한을 제거하며, analytics schema와 table에도 PUBLIC 권한을 남기지 않는다.

application migration이 role을 자동 생성하지 않는다. role과 database 권한은 admin provisioning의 선행조건이며, integration test에서 최소 권한을 검증한다.

## 11. Connection과 TLS

구현된 `postgresConnection.ts`는 URL을 한 번만 parse하고 다음 일을 한 번만 담당한다.

- URL parsing
- protocol 검증
- loopback 판정
- unknown query option과 query override 거부
- 허용된 필드만으로 최종 pg `ClientConfig` 생성

local test의 loopback만 TLS 없이 허용한다. loopback은 `localhost`, `::1`, `node:net.isIP()`가 유효하다고 판정한 127/8 IPv4로만 한정하며 `127.999.999.999`, `127.256.0.1` 같은 hostname은 거부한다. non-loopback 연결은 DNS hostname, `sslmode=verify-full`, `rejectUnauthorized: true`, hostname 검증을 요구한다. `host`, `ssl`, `sslcert`, `sslkey`, `sslrootcert` 같은 query override는 거부한다.

user, database와 non-empty password는 모두 URL에 명시해야 하며 `PGPASSWORD`나 `.pgpass` fallback은 없다. 연결에 영향을 주는 ambient `PG*` 환경변수가 있으면 fail closed한다. 검증 뒤 원래 `connectionString`을 pg에 다시 넘기지 않고 host/user/database/password, UTF-8 encoding, non-replication, safe options, bounded timeout, application name과 TLS field를 명시한 `ClientConfig`를 만든다. 검증 직후 ambient 값이 생겨도 `new Client(config).connectionParameters`의 최종값이 바뀌지 않는지 sentinel fixture로 확인한다.

URL과 credential은 error, assertion, console, artifact, process argument에 출력하지 않는다. TLS 검증은 private CA 연결 성공, untrusted CA 실패, hostname mismatch 실패를 포함한다. 실제 provider CA와 managed DB 설정은 Goal 9D 또는 배포 환경에서 확정한다.

## 12. Trust와 개인정보

- lifecycle event는 server authoritative다.
- human placement는 client reported다.
- 현재 서버가 생성한 heuristic AI placement만 server authoritative다.
- Goal 9A DB CHECK는 `game_start`와 `game_over`에 `server_authoritative`만 허용하고, `placement_decision`에는 `client_reported` 또는 `server_authoritative`를 허용한다.
- Goal 9A DB는 `trust_level` enum과 event별 nullable 조합·row shape를 검증한다. schema에 없는 source column으로 provenance를 증명하거나 source/trust 조합을 CHECK한다고 주장하지 않는다.
- 실제 provenance와 server authoritative 부여는 Goal 9B 내부 projector가 담당한다.
- raw/client projector는 trust 값을 임의로 받지 않는다.

현재 JSONL의 `game_start`에는 nickname이 포함된다. 이 사실을 PostgreSQL 경로로 덮어쓰지 않는다. 구현된 PostgreSQL canonical projection에는 nickname, session token, socketId, IP, Cookie, User-Agent, DB URL, credential, 자유형 사용자 문자열을 저장하지 않는다. 기존 JSONL을 backfill할 때 nickname을 어떻게 제거할지는 Goal 9C의 책임이다.

pseudonymous `playerId`도 telemetry다. 승인된 운영값은 raw telemetry 90일 보존, 삭제 승인 주체는 프로젝트 운영자인 사용자, DB 할당량 70% 경고·85% 긴급 경고다. Goal 9B는 자동 삭제, alerting job과 production 활성화를 구현하지 않는다.

## 13. 원자성·실패·게임 진행

원자성 단위는 event 한 행 INSERT다. gameplay mutation과 DB INSERT를 하나의 transaction으로 묶지 않는다. 따라서 DB 실패가 이미 처리한 input, gravity, 승패를 rollback하지 않는다.

Goal 9A repository의 `append()`은 inserted, duplicate, conflict를 구분한다. invalid canonical event와 닫힌 repository는 성공으로 가장하지 않으며, `close()`는 여러 번 호출해도 안전해야 한다. 같은 identity와 다른 hash는 `IDEMPOTENCY_CONFLICT`이고 기존 row는 유지한다.

Goal 9B runtime은 pool 최대 4, direct in-flight 최대 16, connection/query timeout 각 200ms에서 별도 queue 없이 write를 추적한다. network timeout/reset, SQLSTATE `08*`, `40001`, `40P01`만 3회·총 2.7초 안에서 재시도하고 validation, constraint와 idempotency conflict는 재시도하지 않는다. 실패는 safe code·event type·attempt count와 counter로 관찰하며 gameplay는 계속한다.

종료는 신규 DB write 차단, Socket/ticker producer 정지, 최대 3초 in-flight drain, PostgreSQL pool close, Socket.IO/HTTP close 순서이고 전체 hard deadline은 8초다. 최종 DB 실패나 process crash에서는 개별 event가 유실될 수 있으며 durable outbox는 구현하지 않는다.

## 14. 검증 전략

Goal 9A local 구현에서 다음을 검증했다.

- empty migration과 재실행
- checksum mismatch와 concurrent migration runner
- hostile pre-existing schema/history owner 거부와 failure cleanup
- 세 event insert
- 반복·동시 duplicate와 immutable conflict
- identity UTF-8 byte, finite timestamp, event shape CHECK와 partial unique constraint
- runtime role의 허용/거부 권한
- secret과 payload 비노출
- `__proto__`, integer-like key, array own key와 canonical event ID/hash 재현성
- strict loopback, ambient `PG*`와 최종 `pg` connection parameter
- private CA 성공, untrusted CA와 hostname mismatch 실패
- compiled migration/SQL artifact
- source-less fixture에서 migration 두 번
- actual PostgreSQL Docker test

Goal 9B local 구현은 single-sink JSONL/PostgreSQL, PVP/PVE canonical projection, forged/stale/late receipt, lifecycle v1/v2, retry 분류, in-flight 상한, shutdown 순서, DB-down budget, source-less runtime과 production Docker/HTTP를 검증했다. 실제 명령, exact version, latency와 test count는 [Goal 9B 실행 기록](../../archive/migration/runs/goal-09b-2026-07-23.md)에 남긴다.

Goal 9C는 streaming JSONL importer의 dry-run, privacy projection, 멱등 재실행, partial failure 복구와 completeness 판정을 실제 PostgreSQL 17.10에서 검증했다. Goal 9D는 migration/runtime/import, source-less image, private-CA TLS, backup/restore, runtime 최소 권한, PVP/PVE, DB-down, restart와 shutdown을 local 및 GitHub-hosted PostgreSQL gate로 검증했다.

## 15. 기존 PostgreSQL 실험 브랜치

`codex/add-postgres-event-shadow@2245fef`는 읽기 전용 참고 자료다. branch 전체 merge/rebase와 commit 전체 cherry-pick은 금지한다.

과거 구현의 Drizzle, shadow queue, silent fallback, 65초 shutdown은 현재 계약과 맞지 않는다. identity, parameterized query, TLS, least-privilege, integration test 아이디어만 최신 계약으로 재검증한 뒤 참고할 수 있다.

## 16. Rollback과 데이터 보존

application commit은 역순 revert할 수 있다. 생성된 table과 row는 자동 삭제하지 않는다. down migration이나 DB 삭제는 별도 사용자 승인이 필요하다.

Goal 9A~9D가 main에 통합된 뒤에도 local/test 기본 runtime은 JSONL이고 production은 mode를 명시해야 한다. production PostgreSQL mode를 rollback할 때는 `GAME_EVENT_STORAGE=jsonl`을 명시적으로 선택하며, rollback 과정에서 PostgreSQL row를 삭제하지 않는다.

## 17. 아직 결정하지 않는 내용

Goal 9A는 production `pg@8.22.0`과 strict TypeScript compile에 필요한 devDependency `@types/pg@8.20.0`을 exact version으로 고정했다.

- managed PostgreSQL provider
- 실제 production credential과 CA
- 무손실 outbox
- multi-instance Socket.IO
- Kafka, Redis, queue
- DB 기반 dataset read cutover
- SPA와 Goal 8D

이 항목들은 구현된 것처럼 표현하지 않는다.
