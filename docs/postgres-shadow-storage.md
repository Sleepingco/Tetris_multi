# PostgreSQL shadow storage 운영 계약

## 역할과 데이터 흐름

PostgreSQL은 분석 event의 **선택적 shadow copy**다. JSONL이 계속 canonical
write/export 경로이며 DB 장애나 지연은 gameplay와 JSONL 성공을 바꾸지 않는다.

```text
validated event (최대 256 KiB)
  └─ await JSONL append
       └─ bounded in-memory queue에 snapshot enqueue
            └─ PostgreSQL game_events INSERT ... ON CONFLICT DO NOTHING
```

- `POSTGRES_SHADOW_WRITE_ENABLED=true`일 때만 DB writer를 lazy 생성한다.
- queue는 in-flight event를 포함해 기본 256개까지 받으며 가득 차면 newest를 버린다.
- connection/query는 기본 1초, shutdown flush는 기본 5초로 제한한다.
- connection + query + queue 여유시간(250ms)이 shutdown deadline보다 길면
  잘못된 설정으로 보고 shadow writer를 활성화하지 않는다.
- DB error, timeout, overflow는 payload나 오류 원문 없이 정적인 warning만 남긴다.
- driver timeout을 넘긴 writer는 새 DB event 수락을 중단하고 대기 event를 버려
  해소되지 않은 write가 queue 밖에서 누적되지 않게 한다.
- server는 `SIGINT`/`SIGTERM`에서 새 event 수락을 멈추고 bounded flush 후 Pool을 닫는다.
  설정 가능한 flush 상한은 60초이며 전체 shutdown이 65초를 넘으면 fail-fast 종료한다.
- runtime은 DB를 읽지 않는다. 조회·export·cutover는 Goal 10 범위다.

## 고정 기술과 선택 이유

| 구성 | 버전 | 이유 |
| --- | --- | --- |
| Node.js | `24.18.0` | 저장소의 기존 runtime/build 기준을 유지한다. |
| PostgreSQL | `18.4` | 검증 기준일의 지원 중인 최신 minor이며 PostgreSQL은 현재 minor 사용을 권고한다. |
| `drizzle-orm` | `0.45.2` | typed schema와 검토된 SQL migration의 built-in migrator만 사용한다. |
| `pg` | `8.22.0` | 작은 Pool, connection/query/statement timeout과 명시적 shutdown API를 제공한다. |
| `@types/pg` | `8.20.0` | server TypeScript 경계를 strict 검사한다. |

버전은 재현성을 위해 exact pin한다. `drizzle-kit`은 runtime에 필요하지 않고 검토 중
dev dependency advisory chain이 확인돼 포함하지 않았다. migration은 커밋된 SQL을
`drizzle-orm` migrator로 적용한다. Production start에서 migration을 자동 실행하거나
`push` 방식으로 schema를 동기화하지 않는다.

- [PostgreSQL versioning policy](https://www.postgresql.org/support/versioning/)
- [Drizzle PostgreSQL guide](https://orm.drizzle.team/docs/get-started-postgresql)
- [node-postgres query](https://node-postgres.com/features/queries),
  [SSL](https://node-postgres.com/features/ssl),
  [pool](https://node-postgres.com/features/pooling)

## 환경변수

| 이름 | 소비자 | 기본값/계약 |
| --- | --- | --- |
| `MIGRATION_DATABASE_URL` | migration process | DDL 전용 credential, 필수 |
| `DATABASE_URL` | runtime writer | DML 전용 credential, flag가 켜지면 필수 |
| `TEST_DATABASE_URL` | integration test | 격리 schema 생성·삭제가 가능한 test credential, 필수 |
| `POSTGRES_SHADOW_WRITE_ENABLED` | runtime | exact `true`만 활성, 그 외 JSONL-only |
| `POSTGRES_SHADOW_SCHEMA` | migration/runtime | `tetris_analytics` |
| `POSTGRES_SHADOW_QUEUE_CAPACITY` | runtime | `256`, 허용 `1..10000` |
| `POSTGRES_SHADOW_CONNECTION_TIMEOUT_MS` | runtime | `1000`, 허용 `10..60000` |
| `POSTGRES_SHADOW_QUERY_TIMEOUT_MS` | runtime | `1000`, 허용 `10..60000` |
| `POSTGRES_SHADOW_SHUTDOWN_TIMEOUT_MS` | runtime | `5000`, 허용 `10..60000` |

URL은 Git, image, 문서 예시와 실행 기록에 실제 값으로 남기지 않는다. 원격 host는
`sslmode=verify-full`을 정확히 한 번 포함해야 한다. TLS 예외는 localhost,
`127.0.0.1`, `::1` integration DB뿐이다. `rejectUnauthorized:false`는 사용하지 않는다.

## Schema와 idempotency

`game_events` 한 테이블만 만든다. `idempotency_key` SHA-256을 primary key로 사용해
sequence 권한 없이 append-only insert를 수행한다.

| event | semantic identity |
| --- | --- |
| `game_start` | `[eventType, gameId]` |
| `game_over` | `[eventType, gameId]` |
| `placement_decision` | `[eventType, gameId, playerId, pieceIndex]` |

`schema_version`, 검색용 game/room/player/piece column, `occurred_at`, 원본 JSONB,
원래 `JSON.stringify()` bytes의 SHA-256과 `stored_at`을 저장한다. retry는 같은 identity의
row를 갱신하지 않고 무시한다. runtime role에는 UPDATE/DELETE 경로가 없다.

## Migration과 검증

빈 DB 또는 새 schema에서 먼저 migration credential로 실행한다.

```bash
MIGRATION_DATABASE_URL='<secret>' npm run db:migrate:shadow
TEST_DATABASE_URL='<secret>' npm run test:db
```

두 명령은 검토된 `scripts/`와 `drizzle/`가 있는 source checkout 또는 별도 CI
migration job에서 실행한다. source-less application release는 의도적으로 이 파일과
migration credential을 포함하지 않으며 pre-migrated DB에 runtime DML만 수행한다.

`test:db`는 URL이 없으면 skip하지 않고 실패한다. 매 실행마다 random 격리 schema를
만들어 empty migration, migration 재실행 no-op, duplicate retry 1-row 결과,
JSONB/hash/time column을 확인한다. 같은 test에서 임시 NOLOGIN runtime role을 만들어
허용된 INSERT/idempotency-key SELECT와 금지된 UPDATE/DELETE/TRUNCATE/schema CREATE를
확인한 뒤 schema와 role을 제거한다. 따라서 test credential에는 격리 schema와 임시
role을 생성·삭제할 권한이 필요하다.

배포 순서는 migration → `test:db`/smoke → runtime credential 배치 → feature flag
활성화다. application process에는 migration credential을 전달하지 않는다.

## 최소 권한 예시

role 생성과 password/SCRAM 설정은 운영 환경에서 secret manager를 통해 수행한다.
아래 `<...>`는 실제 identifier로 교체하되 credential을 SQL 파일에 쓰지 않는다.

```sql
GRANT CONNECT ON DATABASE <database> TO <runtime_role>;
GRANT USAGE ON SCHEMA tetris_analytics TO <runtime_role>;
GRANT INSERT (
    idempotency_key, event_type, schema_version, game_id, room_id,
    player_id, piece_index, occurred_at, payload, payload_sha256
) ON TABLE tetris_analytics.game_events TO <runtime_role>;
GRANT SELECT (idempotency_key)
    ON TABLE tetris_analytics.game_events TO <runtime_role>;
REVOKE CREATE ON SCHEMA tetris_analytics FROM <runtime_role>;
```

runtime role은 `NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS`로
만들고 table UPDATE/DELETE/TRUNCATE, schema CREATE와 migration history 권한을 주지
않는다. migration role과 test role은 runtime process에 사용하지 않는다.

## 개인정보·retention·rollback

- validator를 통과한 최대 256 KiB payload만 queue에 들어간다.
- 공통 log validator가 중첩된 token, credential, cookie, authorization, password,
  secret, reconnect/session 식별자 계열 private field를 JSONL 이전에 거부하고,
  repository도 같은 검사를 defense-in-depth로 반복한다.
- payload에는 player/room id, 공개 nickname과 플레이 행동이 포함될 수 있으므로
  개인정보성 telemetry로 취급한다.
- Goal 9는 자동 purge를 추가하지 않는다. 실제 사용자 환경의 보존 기간과 maintenance
  owner가 승인되기 전에는 feature flag를 활성화하지 않는다. 이후 삭제가 필요하면
  runtime writer가 아니라 별도 maintenance role/job이 수행한다.
- 즉시 rollback은 `POSTGRES_SHADOW_WRITE_ENABLED`를 `true`가 아닌 값으로 바꾸고
  server를 재시작하는 것이다. 기존 DB row는 자동 삭제하지 않으며 JSONL은 계속 남는다.
