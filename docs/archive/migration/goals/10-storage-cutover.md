# Goal 10 — Database Export, Read-source and Retention Automation

## 상태

선택·보류한다. Goal 9D가 main과 controlled environment에서 안정화되고 DB 기반 dataset 조회 또는 반복 retention 자동화 요구가 생기기 전에는 실행하지 않는다.

Goal 9C의 JSONL-to-PostgreSQL one-time import는 이 Goal의 선행조건이다. 같은 backfill importer를 다시 만들지 않는다.

## 목적

PostgreSQL과 기존 JSONL에서 만든 분석 결과의 동등성을 증명하고 dataset/export read source를 명시적 flag로 점진 전환한다. Goal 9D에서 증명한 수동 retention 경계를 필요할 때만 반복 job으로 자동화한다.

## 선행조건

- Goal 9D의 PostgreSQL write/import/CI/release gate가 main과 controlled environment에서 안정적이다.
- 동일 lineage의 JSONL과 DB event가 준비돼 있다.
- legacy completeness 등급과 DB export eligibility가 확정돼 있다.
- runtime write role과 export/maintenance role이 분리돼 있다.
- retention 기간, backup/restore와 삭제 승인 주체가 합의돼 있다.

## 범위

- JSONL/DB 공통 canonical event reader 또는 좁은 source adapter
- DB-backed placement dataset export
- event identity/count/hash, completeness와 ordering 비교
- feature table, dataset manifest와 split lineage 비교
- JS/Python placement 평가 parity
- 명시적 read-source flag와 controlled canary
- Goal 9D의 retention query를 사용하는 반복 job, dry-run과 rollback rehearsal

## 제외 범위

- JSONL-to-DB backfill 재구현
- JSONL 즉시 삭제
- gameplay runtime write, room/match persistence와 multi-instance coordination
- parity 실패 상태의 DB-only 분석
- export 요구가 없는 dashboard/ORM abstraction
- production data 삭제의 자동 승인

## 허용되는 기능·프로토콜 변화

분석/관리 command의 source 선택과 retention dry-run option은 추가할 수 있다. gameplay Socket protocol과 runtime storage identity는 변경하지 않는다.

## 완료 기준

- 같은 accepted event set에서 JSONL/DB export identity와 count가 일치한다.
- completeness reason과 legacy 등급이 source에 따라 달라지지 않는다.
- feature rows, manifest, split과 JS/Python evaluation 결과가 허용 오차 내에서 일치한다.
- read-source canary와 JSONL rollback이 동작한다.
- retention dry-run이 대상 identity/count/bytes를 보고하고 runtime role로 실행되지 않는다.
- 실제 삭제는 별도 승인과 backup/restore 확인 후에만 수행한다.

## 자동 검증

```bash
test "$(node --version)" = "v$(tr -d '\n' < .nvmrc)"
bash scripts/verify.sh
npm run test:db
npm run test:release
npm run test:e2e
git diff --check <base>..HEAD
```

실제 command 이름은 구현 시 package manifest에 고정하고 JSONL/DB export의 event identity, feature hash와 manifest를 machine-readable report로 비교한다.

## 보안·데이터 검토

- export/maintenance credential을 runtime application에 주입하지 않는다.
- dump, manifest와 CI artifact에서 credential, nickname과 private payload를 제거한다.
- retention/delete query는 parameterized cutoff, dry-run과 affected-row 상한을 갖는다.
- 사용자 고지·보존 계약보다 빠른 삭제나 무기한 보존을 허용하지 않는다.

## Rollback

read-source flag를 JSONL로 되돌리고 DB row는 보존한다. JSONL 물리 삭제는 이 Goal의 code rollback과 분리하며 별도 승인 없이는 실행하지 않는다.

## 즉시 중단 조건

- JSONL/DB identity 또는 feature parity가 맞지 않는다.
- legacy incomplete event를 complete training data로 승격해야만 결과가 맞는다.
- runtime write credential로 export/delete를 실행해야 한다.
- backup/restore 검증 없이 삭제가 요구된다.

## Merge Gate

검증과 실행 기록 후 멈춘다. production read cutover, retention 삭제, push와 main merge는 각각 별도 승인 대상이다.
