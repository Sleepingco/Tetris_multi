# PostgreSQL Event Storage 운영 Runbook

이 문서는 provider가 정해지기 전에도 적용할 수 있는 Goal 9D 운영 경계다. 실제 cloud 계정, VM 배치, database와 secret을 만들거나 production mode를 켜는 절차는 아니다. 구현 계약은 [PostgreSQL event storage blueprint](database-event-storage-blueprint.md), local rehearsal은 [production boundary script](../scripts/verify-postgres-production.sh)를 기준으로 한다.

## 역할과 credential

서로 다른 credential 세 개를 secret manager에서 주입한다. URL, password와 CA private key를 image, repository, CI artifact나 log에 넣지 않는다.

- migration role: `tetris_analytics` schema와 migration/event table owner다. release 단계에서만 `MIGRATION_DATABASE_URL`로 사용하고 application HTTP startup과 동시에 migration을 실행하지 않는다.
- runtime role: 제한된 schema `USAGE`, event column `INSERT`, idempotency와 migration version 확인에 필요한 column `SELECT`만 가진다. DDL, `UPDATE`, `DELETE`, `TRUNCATE`는 허용하지 않는다.
- maintenance role: retention 대상 조회와 승인된 `DELETE`만 수행한다. application에 이 credential을 주입하지 않는다.

database와 role의 `search_path`는 `tetris_analytics, pg_catalog`로 제한한다. application query와 운영 query는 계속 schema-qualified 이름을 사용한다. `public` schema의 `CREATE`와 불필요한 `PUBLIC` 권한은 제거한다.

## 연결과 활성화 전 점검

1. provider endpoint의 hostname과 CA chain을 독립 경로로 확인한다.
2. non-loopback 연결은 `sslmode=verify-full` 의미의 certificate chain과 hostname 검증을 모두 요구한다. private/provider CA가 필요한 경우 CA certificate만 read-only secret으로 mount한다.
3. migration role로 migration을 두 번 실행해 첫 실행의 적용과 두 번째 실행의 no-op을 확인한다.
4. runtime role로 schema version 조회와 synthetic event `INSERT`는 허용되고 DDL/`UPDATE`/`DELETE`는 거부되는지 확인한다.
5. application은 `GAME_EVENT_STORAGE=postgres`와 runtime credential만 받고 JSONL writable volume은 mount하지 않는다. health가 green이 된 뒤 synthetic PVP/PVE event chain을 확인한다.
6. pool 4, in-flight 16은 현재 검증값이다. provider latency를 측정한 뒤에만 별도 변경을 승인한다.

활성화 전에는 [Goal 9D](../migration-harness/goals/09d-postgres-ci-release.md)의 hosted 네 job과 cache-miss clean run, provider 환경의 TLS·backup·restore rehearsal이 모두 green이어야 한다.

## Backup과 restore rehearsal

- backup 책임자, 주기, 암호화, 보존 기간과 접근자를 provider 선택 시 기록한다.
- 최초 활성화 전에 synthetic row만 있는 별도 database/namespace로 backup을 만들고 다른 임시 database에 restore한다.
- restore 전후 row count와 ordered `event_id + event_sha256` digest를 비교한다. dump, URL, credential과 payload를 CI artifact로 업로드하지 않는다.
- rehearsal database와 backup 임시 파일만 확인 후 제거한다. production table/row는 rollback이나 rehearsal에서 삭제하지 않는다.

Goal 9D local gate는 disposable PostgreSQL 17.10에서 custom-format backup/restore와 count/hash 불변을 검증한다. 이는 provider backup 정책의 대체가 아니다.

## 용량과 보존

- raw event retention 목표: 90일.
- `pg_total_relation_size('tetris_analytics.game_events')`와 provider quota를 함께 관찰한다.
- quota 70%에서 warning, 85%에서 emergency로 알리고 신규 용량 계획 또는 수동 retention 승인을 요청한다.
- Goal 9D는 자동 삭제를 만들지 않는다. 실제 사용자 row 삭제 승인 주체는 프로젝트 운영자인 사용자다.

수동 retention은 다음 순서를 모두 지킨다.

1. maintenance role로 cutoff, `max_rows`, `max_bytes`를 parameter로 전달해 dry-run한다.
2. 대상 수, bytes, 최소/최대 `ingested_at`을 확인하고 한도를 초과하면 중단한다.
3. 운영자가 cutoff와 두 상한을 다시 확인한다.
4. 서로 분리된 두 번의 명시적 확인 뒤 같은 cutoff, row 상한과 byte 상한으로 삭제한다.
5. 반환된 row 수가 승인 수와 같은지 확인하고 relation size와 backup 상태를 기록한다.

runtime role로 같은 `DELETE`가 거부돼야 한다. Goal 9D rehearsal은 91일 전 synthetic row 한 건만 삭제하며 실제 사용자 row에는 이 절차를 실행하지 않는다.

## 장애와 관찰

PostgreSQL event 수집은 승인된 best-effort 경계다. write는 최대 3회·2.7초 안에서 종료하며 실패나 process crash에서는 개별 event가 유실될 수 있지만 gameplay는 계속 진행한다. failure counter와 redacted code를 관찰하고 lifecycle이 불완전한 game은 learning export에서 제외한다. URL, credential과 raw payload는 log에 남기지 않는다.

DB 장애 중 gameplay, retry 시간, in-flight 상한과 ticker cadence를 함께 확인한다. strict lossless가 필요해지면 현재 설정을 확대하지 않고 durable outbox를 별도 Goal로 설계한다.

## Rollback

1. 신규 DB write를 차단하고 event 생산자를 정지한 뒤 기존 in-flight write를 최대 3초 drain한다.
2. PostgreSQL pool을 닫고 Socket.IO/HTTP close를 완료한다. 전체 shutdown hard deadline은 8초다.
3. 검증된 이전 application image를 선택한다.
4. `GAME_EVENT_STORAGE=jsonl`을 명시하고 보존된 JSONL writable volume/path를 복구한다.
5. PostgreSQL row와 기존 JSONL은 삭제하지 않는다. migration down/drop도 자동 rollback에 포함하지 않는다.
6. JSONL health와 새 event append를 확인한 뒤 incident와 잠재 event loss 구간을 기록한다.

현재 production PostgreSQL은 활성화되지 않았다. 이 runbook 작성이나 Goal 9D local rehearsal은 production database provisioning, 실제 JSONL import 또는 배포 승인을 뜻하지 않는다.
