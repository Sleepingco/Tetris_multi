# Goal 10 — DB/JSONL Compatible Export and Cutover

## 목적

PostgreSQL과 JSONL의 데이터 동등성을 증명하고 분석 read source를 feature flag로 점진 전환한다.

## 선행조건

- Goal 9의 shadow write가 main과 controlled environment에서 안정적임
- 충분한 비교 dataset과 기존 exporter baseline 확보
- backfill, lineage와 rollback 정책 합의

## 범위

- JSONL/DB 공통 canonical event reader 또는 source adapter
- 기존 JSONL의 idempotent backfill
- event count, ordered identity/hash와 schema version 비교
- placement feature, split, manifest와 model parity 비교
- bounded dual-write 관찰과 read-source feature flag
- cutover 전후 지표와 rollback runbook

## 제외 범위

- JSONL 즉시 삭제
- authoritative loop의 DB 의존
- parity 실패 상태의 DB-only 운영
- 실시간 room state persistence

## 허용되는 기능·프로토콜 변화

분석/관리 명령의 source 선택 옵션은 추가할 수 있다. gameplay Socket protocol은 변경하지 않는다.

## 완료 기준과 검증

- 동일 입력에서 JSONL/DB export의 event count와 identity가 일치한다.
- feature table, dataset manifest와 Python/JS evaluation 결과가 허용 오차 내에서 일치한다.
- backfill 재실행이 안전하고 실패 후 재개 가능하다.
- DB read 장애 시 JSONL fallback 또는 명시적 rollback이 동작한다.
- cutover와 rollback rehearsal 기록이 있다.

## 보안·데이터 검토

- export 권한과 runtime write 권한을 분리한다.
- dump와 artifact에서 credential/token을 제거한다.
- retention과 삭제 정책을 문서화한다.

## Rollback과 Merge Gate

feature flag를 JSONL source로 되돌리는 절차를 검증한다. JSONL 물리 삭제는 별도 승인과 retention 기간 이후에만 고려한다.
