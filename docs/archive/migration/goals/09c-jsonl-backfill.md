# Goal 9C — Idempotent JSONL Backfill and Completeness

## 상태

구현 대기. Goal 9B의 canonical projection과 PostgreSQL runtime 저장 계약이 main에 반영된 뒤 실행한다.

## 목적

현재 `game-events.jsonl`을 전체 메모리에 올리지 않고 검증·정제해 PostgreSQL로 멱등 import하고, lifecycle·placement 누락을 판정하는 재현 가능한 보고서를 만든다.

## 왜 지금 필요한가

새 event만 DB에 저장하면 기존 학습·분석 history가 분리된다. 기존 JSONL에는 nickname과 legacy schema가 포함되고 일부 경기에는 lifecycle 또는 placement gap이 있으므로, 단순 bulk copy가 아니라 runtime과 같은 identity/privacy 계약을 사용하는 import가 필요하다.

## 선행조건

- Goal 9B commit이 main 및 origin/main에 포함돼 있다.
- worktree가 clean하고 Node가 `.nvmrc`와 정확히 일치한다.
- 원본 JSONL을 변경하지 않는 read-only 경로와 별도 test DB가 준비돼 있다.
- import 전 파일 SHA-256, byte/line/type count, invalid JSON과 현재 exporter의 completeness 결과를 다시 측정한다.
- disk와 DB의 여유 용량, retention 기간과 import 대상 범위가 합의돼 있다.
- 실제 사용자 원본을 test artifact, PR과 console에 업로드하지 않는다.

## 현재 기준선에서 확인할 항목

문서 작성 시점의 read-only 감사에서는 약 82.7 MiB, 17,636 event가 관찰됐고 lifecycle이 끝나지 않은 경기와 player placement index gap이 존재했다. 이 숫자는 Goal에 고정된 완료값이 아니다. 구현 preflight에서 실제 파일을 다시 읽어 실행 기록에 남긴다.

legacy `game_start`에는 nickname이 포함될 수 있으며 기존 `game_over`는 저장 대상 placement tail count를 제공하지 않는다. v1 data에 새 v2 완전성을 소급해 과장하지 않는다.

## 범위

- Node standard library stream/readline 기반 JSONL importer
- runtime과 같은 validation, privacy projection, identity와 immutable event hash 재사용
- source file lineage와 import summary
- partial progress 후 전체 command 재실행의 멱등성
- malformed row, validation failure와 idempotency conflict의 명시적 실패
- lifecycle/placement completeness 검사와 reason code
- 기존 raw event 보존과 ML export 제외 후보 보고
- 작은 synthetic fixture와 실제 local file의 controlled dry-run/import

## 제외 범위

- 원본 JSONL 수정·삭제·rotation
- DB를 dataset exporter의 read source로 전환
- JSONL/DB feature table과 model parity cutover
- malformed row를 자동 수정하거나 임의로 버림
- 원본 payload, nickname과 credential을 error artifact로 저장
- Kafka, ETL framework, worker queue와 범용 batch platform
- production database에 실제 import; 별도 운영 승인 필요

## 허용되는 기능·schema 변화

- import CLI, dry-run/report option과 source lineage metadata를 추가할 수 있다.
- legacy v1 event를 canonical storage projection으로 정규화하되 원본 의미를 꾸미지 않는다.
- gameplay와 Socket protocol은 변경하지 않는다.

## Import 계약

```text
JSONL line
  → bounded line read
  → JSON parse
  → current/legacy schema validation
  → event-type allowlist privacy projection
  → canonical identity + immutable event hash
  → PostgreSQL append
  → count/hash summary
```

- `readFile()`로 전체 파일을 문자열에 올리지 않는다.
- source absolute path를 report에 쓰지 않고 file basename, SHA-256, bytes와 counts만 기록한다.
- import는 raw line 순서와 line number를 처리 문맥으로 사용하지만 DB identity에는 line number를 넣지 않는다.
- same event/same immutable event hash는 duplicate success로 집계한다.
- same identity/different immutable column 또는 payload는 conflict로 집계하고 non-zero 종료한다.
- malformed JSON, validation/privacy failure와 DB failure를 조용히 skip하지 않는다.
- 일부 row가 commit된 뒤 실패해도 동일 command 재실행으로 안전하게 이어진다.
- 초기 구현은 correctness 우선의 bounded batch 또는 순차 insert를 사용한다. 성능 측정 없이 custom concurrency pool을 만들지 않는다.
- report에 raw payload를 복사하지 않고 line number, reason code와 event identity digest만 남긴다.

## Legacy privacy 계약

- existing `players[].nickname`은 canonical DB payload에서 제거한다.
- token/socket/IP/cookie/UA/credential 계열 key가 발견되면 해당 row를 저장하지 않고 즉시 보고한다.
- client-provided legacy identity는 원본 lineage로만 취급한다. 현재 server match와 대조할 수 없는 과거 human payload를 `server_authoritative`로 승격하지 않는다.
- legacy human placement는 `client_reported`로 저장한다.

## Completeness 계약

DB raw table에는 valid event를 보존하고 completeness는 export eligibility로 계산한다.

새 lifecycle schema 경기의 complete 조건:

- `game_start`와 `game_over`가 각각 정확히 1개다.
- start/over의 player membership과 mode가 일치한다.
- semantic placement identity duplicate가 없다.
- 저장 대상 player별 piece/commit sequence에 내부 gap이 없다.
- `game_over.expectedPlacementEventCount` 또는 동등 metadata와 실제 저장 대상 row 수가 일치한다.
- expected count는 server authoritative placement commit에서 정책상 저장 대상으로 센 값이다. `occurred_at`이나 client log 수신 횟수로 추정하지 않는다.

legacy v1 경기:

- lifecycle과 내부 gap은 검사한다.
- tail expected count가 없으면 `legacy_unknown_tail`을 기록하며 완전한 v2와 같은 신뢰 수준으로 표시하지 않는다.
- incomplete/ambiguous/conflict 경기의 raw row는 유지하지만 ML export 후보에서 제외한다.

## 예상 영향 파일

- `scripts/`의 JSONL-to-PostgreSQL importer
- canonical event/projection helper의 필요한 export
- import/completeness unit·integration fixture
- package script와 운영 문서
- `PLAN.md`, Goal 9C 실행 기록

production gameplay source 변경이 필요하면 이유를 보고하고 Goal 9B 누락인지 먼저 판단한다.

## 완료 기준

- synthetic JSONL과 현재 local JSONL을 streaming 처리한다.
- dry-run은 DB를 바꾸지 않고 같은 count/hash report를 만든다.
- 첫 import와 두 번째 import 후 DB row count가 같다.
- partial failure 뒤 재실행해도 중복 row가 없다.
- nickname/private field가 DB payload에 없다.
- malformed/conflict는 non-zero 종료하며 valid raw row를 덮어쓰지 않는다.
- completeness reason이 fixture와 실제 baseline에 대해 재현 가능하다.
- 기존 JSONL exporter와 gameplay는 변경되지 않는다.

## 자동 검증

구현 시 실제 script 이름을 package manifest에 고정한다.

```bash
test "$(node --version)" = "v$(tr -d '\n' < .nvmrc)"
npm run typecheck
npm run build
npm run db:migrate
npm run db:import-jsonl -- --dry-run <fixture>
npm run db:import-jsonl -- <fixture>
npm run db:import-jsonl -- <fixture>
npm run test:db
bash scripts/verify.sh
npm run test:release
git diff --check <base>..HEAD
```

필수 fixture:

- valid start/placement/over
- same row 재실행
- same identity/different immutable column 또는 payload conflict
- malformed JSON과 oversized/private payload
- lifecycle duplicate/missing
- placement duplicate/internal gap/tail gap
- legacy no-tail metadata와 nickname redaction
- 중간 DB failure 뒤 재실행

## 수동 검증

- 사용자 승인된 local copy에서 dry-run count와 현재 JSONL line/type count를 비교한다.
- 실제 test DB import를 두 번 실행해 relation row count와 hash summary가 변하지 않는지 확인한다.
- completeness reason별 game count와 relation size를 query한다.
- import report와 console에 nickname, token, raw board payload와 DB URL이 없는지 확인한다.

## 보안·데이터 검토

- production import는 runtime INSERT role이 아니라 필요한 최소 read-file/insert 권한의 별도 운영 command로 수행한다.
- source file과 DB dump를 CI artifact나 repository에 추가하지 않는다.
- relation size를 측정하고 retention/비용 한도를 넘으면 production import 전에 중단한다.
- 삭제/retention job은 runtime role과 분리하며 이 Goal에서 자동 삭제를 실행하지 않는다.

## 커밋 계획

1. `feat: add idempotent JSONL event importer`
2. `test: verify event import completeness`
3. `docs: record Goal 9C backfill verification`

## Rollback과 data 호환성

code는 역순 revert할 수 있다. import된 append-only row를 rollback 과정에서 자동 삭제하지 않는다. 잘못된 import 삭제가 필요하면 source hash와 event ID 범위를 먼저 확인하고 별도 승인된 maintenance 절차를 사용한다. 원본 JSONL은 그대로 보존한다.

## 즉시 중단 조건

- source file hash/line count가 실행 중 바뀐다.
- private credential 또는 예상하지 못한 schema가 발견된다.
- importer가 전체 파일을 메모리에 올리거나 raw payload를 error log에 출력한다.
- same input 재실행에서 row count/hash가 달라진다.
- production database write 승인이 필요한 시점에 도달한다.

## Merge Gate와 다음 Goal

local/test DB 검증과 실행 기록 후 멈춘다. production import, push와 main merge는 각각 승인받는다. Goal 9C가 main/origin/main에 반영된 뒤에만 [Goal 9D](09d-postgres-ci-release.md)를 시작한다.
