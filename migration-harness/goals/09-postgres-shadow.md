# Goal 9 — PostgreSQL Append-only Shadow Storage

## 목적

JSONL 분석 경로를 유지하면서 versioned game event를 PostgreSQL에 비차단 shadow write하는 최소 영속 계층을 추가한다.

## 선행조건

- Goal 8의 main 반영
- 현재 JSONL schema, exporter, lineage와 repository injection 경계 조사
- PostgreSQL, Drizzle, driver와 migration tool의 호환 버전 결정
- `TEST_DATABASE_URL`과 격리된 test DB 준비 방식 합의

## 범위

- versioned append-only `game_events` 중심 최소 schema
- 검색에 필요한 핵심 column과 versioned raw payload
- Drizzle schema, migration, repository adapter
- parameterized query, idempotency key와 unique constraint
- bounded async write queue, timeout, overflow와 shutdown flush
- DB 장애 시 gameplay 성공과 JSONL 경로 유지
- integration test용 최소 Compose/Testcontainers 허용

## 제외 범위

- room, active piece, ticker와 authoritative state의 DB 원천화
- JSONL 제거 또는 DB read cutover
- Redis와 다중 서버 coordination
- 조회 요구가 없는 파생 테이블 선행 설계

## 허용되는 기능·프로토콜 변화

없음. 영속 실패는 관찰·운영 지표에만 반영하고 gameplay protocol을 실패시키지 않는다.

## 완료 기준과 검증

- empty DB migration과 migration 재실행 정책이 검증된다.
- 동일 event 재시도에 중복 row가 생기지 않는다.
- DB down, timeout, queue overflow와 shutdown을 테스트한다.
- JSONL 결과와 gameplay latency가 baseline 범위에 유지된다.
- unit/integration/fast/full gate가 통과한다.

## 보안·데이터 검토

- DB URL과 credential을 repository, log, image에 포함하지 않는다.
- token/secret redaction과 least-privilege DB role을 적용한다.
- retention, payload 크기와 개인정보 포함 여부를 기록한다.

## Rollback과 Merge Gate

feature flag로 DB shadow write를 끄면 JSONL-only로 즉시 복귀해야 한다. 검증 전 DB를 canonical source로 사용하지 않는다.
