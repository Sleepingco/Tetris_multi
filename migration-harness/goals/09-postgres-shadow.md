# Goal 9 — PostgreSQL Append-only Shadow Storage

## 상태

보류한다. 현재 단일 서버의 분석·ML 경로는 JSONL로 충분하며, 검증된 실험 구현은
`codex/add-postgres-event-shadow` 브랜치에만 보존하고 main에 병합하지 않는다.

다음 중 실제 요구가 생긴 뒤 별도 문서 승인으로 재개한다.

- 여러 서버의 event를 중앙에서 조회해야 한다.
- 사용자 기록이나 운영 분석 대시보드가 SQL 조회를 요구한다.
- 관리형 PostgreSQL, credential, backup과 retention 운영 주체가 정해진다.

재개 시에는 실시간 dual-write보다 JSONL batch import가 요구를 충족하는지 먼저 판단한다.

## 목적

JSONL 분석 경로를 유지하면서 versioned game event를 PostgreSQL에 비차단 shadow write하는 최소 영속 계층을 추가한다.

## 선행조건

- Goal 8C의 main 반영. 선택 Goal 8D는 선행조건이 아니다.
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
