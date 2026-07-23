# Goal 9B — Runtime PostgreSQL Event Storage

## 상태

구현 대기. Goal 9A가 main에서 실제 PostgreSQL schema/repository gate를 통과한 뒤 실행한다.

## 목적

server가 소유하거나 인증한 canonical game event를 환경별 단일 sink인 JSONL 또는 PostgreSQL에 저장한다. DB 실패는 gameplay를 rollback하지 않지만 오류와 잠재적 event loss를 숨기지 않는다.

## 왜 지금 필요한가

Goal 9A는 DB 자체의 저장 계약만 만든다. 실제 사용자 로그를 안전하게 수집하려면 client 제공 identity를 제거하고 개인정보 allowlist, storage 선택, bounded retry와 기존 8초 shutdown lifecycle을 server composition에 연결해야 한다.

## 선행조건

- Goal 9A commit이 main 및 origin/main에 포함돼 있다.
- main의 fast/full/browser/Docker 기준선이 green이다.
- worktree가 clean하고 Node가 `.nvmrc`와 정확히 일치한다.
- current `game_start`, human/AI placement와 `game_over` 생성·삭제 순서를 end-to-end로 조사했다.
- local/test `DATABASE_URL`과 격리 DB가 준비돼 있다. production provider가 미정이어도 URL/TLS, runtime/migration role과 secret 주입의 provider-neutral 계약은 고정한다.
- 사용자 고지, raw telemetry retention, 삭제 주체와 DB 용량 경고 기준의 초안을 기록한다. 실제 production enable 전에는 운영 주체의 최종 승인이 필요하다.
- bounded retry 뒤 DB 장애나 process crash에서 event가 유실될 수 있는 best-effort 수집 의미를 사용자가 명시적으로 승인한다. 무손실 요구라면 이 Goal을 시작하지 않고 durable outbox Goal을 먼저 설계한다.

## 범위

- `GAME_EVENT_STORAGE=jsonl|postgres`의 strict storage 선택
- JSONL local 기본과 명시적 PostgreSQL production mode
- server-owned canonical event projection과 trust level
- human placement의 game/room/player/commit identity 인증
- lifecycle schema의 저장 대상 event count/completeness metadata
- PostgreSQL repository composition과 startup schema/connectivity check
- transient DB 오류의 bounded retry와 structured failure 관찰
- 신규 write 차단, in-flight drain과 pool close를 기존 SIGTERM에 통합
- JSONL과 PostgreSQL 각각의 runtime integration test

## 제외 범위

- JSONL과 PostgreSQL 동시 write 또는 자동 fallback
- DB write를 input/ticker/game-over 성공 조건으로 사용
- room/match/session/reconnect 상태의 DB 저장
- durable outbox, Redis, Kafka와 custom background queue
- 기존 JSONL import와 DB 기반 dataset export
- GitHub Actions PostgreSQL service와 managed production deploy
- gameplay, score, garbage, AI 정책과 Socket event 의미 변경

## 허용되는 기능·schema 변화

- 저장 전용 lifecycle schema version을 올리고 완전성 metadata를 추가할 수 있다.
- human placement log의 client 제공 identity가 server canonical identity로 대체된다.
- 저장 결과 reason에 `IDEMPOTENCY_CONFLICT`, storage unavailable 같은 내부 결과를 추가할 수 있다. public response는 secret과 raw DB error를 노출하지 않는다.
- gameplay와 Socket 입력/결과 계약은 변경하지 않는다.

## Storage 선택 계약

```text
GAME_EVENT_STORAGE=jsonl
  → 기존 JSONL repository 하나만 사용

GAME_EVENT_STORAGE=postgres
  → PostgreSQL repository 하나만 사용
  → DATABASE_URL과 expected schema가 없으면 listen 전에 실패
  → JSONL repository를 만들거나 file을 open/append하지 않음
```

- local/test default만 `jsonl`로 기존 실행을 보존한다.
- `NODE_ENV=production` 또는 명시적 production profile에서는 storage mode 생략도 startup error다. PostgreSQL 활성화와 JSONL rollback 모두 env에서 mode를 명시한다.
- unknown mode, 잘못된 URL/TLS와 schema version mismatch는 fail closed한다.
- startup 이후 DB 장애는 gameplay를 계속하되 저장 실패를 반환·집계한다.
- 장애 시 JSONL로 몰래 전환하지 않는다. 두 sink 사이 원자성을 주장하지 않는다.
- mode 선택은 composition 시 한 번만 수행한다. postgres mode에서 `GAME_EVENTS_LOG_PATH`가 설정돼 있어도 JSONL writer는 비활성 상태여야 한다.

## Canonical Event 계약

### `game_start`

- canonical `gameId`는 match 생성 시 server가 한 번 만든다. `crypto.randomUUID()` 같은 충돌 안전한 표준 수단을 우선하고 start, human/AI placement, over와 recent receipt가 같은 stored value를 참조한다.
- emitter마다 `${roomId}-${createdAt}`를 다시 계산하거나 `roomId`만 fallback으로 쓰지 않는다.
- server match가 소유한 room mode, player type과 server time을 사용한다.
- player allowlist에는 pseudonymous `playerId`, role과 player type만 포함한다.
- nickname은 저장 projection에서 제거한다.

### human `placement_decision`

- client `gameId`, `roomId`, `playerId`는 저장하지 않는다.
- active match의 server `gameId`, authorized room/player와 accepted authoritative sequence/piece tuple로 대체한다.
- finished grace 동안 늦게 도착한 정상 log를 지원해야 한다면 기존 room state에 최소 log context를 보존하거나 bounded recent receipt를 사용한다.
- recent context는 `(gameId, playerId, authoritativeClientSequence, pieceIndex)` exact match만 인증하고 TTL·개수 상한과 disconnect/room cleanup을 갖는다.
- client board, metrics, evaluation은 계속 `client_reported`이며 authoritative truth로 표시하지 않는다.

### AI `placement_decision`

- server가 실제 저장 대상으로 생성한 event만 `server_authoritative`로 저장한다.
- 정책상 의도적으로 제외한 AI event를 완전성 누락으로 계산하지 않는다.

### `game_over`

- server winner/loser/reason과 server time을 사용한다.
- player별 `expectedPlacementEventCount` 또는 동등한 저장 대상 event count를 포함해 trailing 누락을 판정할 수 있게 한다.
- 단순 final active `pieceIndex`를 expected count로 사용하지 않는다. hold block-out, disconnect와 의도적으로 제외한 AI log를 구분한다.
- count는 client log 수신 횟수가 아니라 server authoritative placement commit 중 정책상 저장돼야 하는 event 수다. human은 expected `(gameId, playerId, authoritativeClientSequence, pieceIndex)` receipt마다, AI는 실제 저장 정책 대상 commit에만 증가한다.
- `occurred_at`은 표시·감사용 metadata일 뿐 ordering이나 완전성 근거로 사용하지 않는다. authoritative sequence와 piece identity를 사용한다.

## 개인정보 projection

event type별 allowlist를 사용한다. 다음 값은 validator를 통과했더라도 PostgreSQL payload에 포함하지 않는다.

- nickname과 자유형 사용자 문자열
- session/reconnect token과 digest
- socket ID, IP와 remote address
- Cookie, authorization header와 User-Agent
- DB URL, credential과 내부 session metadata

private-field denylist는 방어층으로 유지하지만 allowlist projection을 대체하지 않는다.

## Retry·원자성·실패 계약

- repository에 전달하기 전에 canonical event와 `event_id`를 한 번 고정한다.
- retry allowlist는 검토된 network timeout/reset·SQLSTATE class `08`, `40001` serialization failure와 `40P01` deadlock뿐이다. 같은 ID로 최초 시도 뒤 최대 2회 추가 재시도한다.
- canonical JSON 직렬화, validation, authorization, idempotency conflict와 DB constraint 오류는 재시도하지 않는다.
- connection/query/backoff를 포함한 정확한 총 write budget을 구현 승인 gate에서 수치로 고정하고 테스트한다. 반드시 `총 write budget < in-flight drain 약 3초 < server hard shutdown 8초`여야 한다.
- 예상 동시 room, DB connection 한도와 측정한 query latency를 근거로 `pg.Pool`의 `max`·connection/query timeout과 process-wide in-flight write 상한을 구현 승인 gate에서 정확한 수치로 고정한다.
- in-flight 상한을 넘은 write는 pool 내부 queue에 계속 쌓지 않고 즉시 구조화된 `LOG_WRITE_FAILED`로 집계한다. gameplay는 계속하며 raw payload를 log하지 않는다.
- event 한 행 insert만 원자적이다. gameplay mutation과 DB transaction은 분리한다.
- 최종 실패 후 gameplay는 계속되지만 해당 event가 유실될 수 있음을 실행 기록과 운영 지표에 남긴다.
- custom memory queue에서 성공을 먼저 반환하지 않는다. existing save boundary가 실제 저장 결과를 관찰한다.
- authoritative input mutation이나 room ticker critical section 안에서 DB promise를 await하지 않는다. gameplay commit 뒤 bounded write를 시작·관찰하고 in-flight promise Set만 shutdown용으로 추적한다.

## Startup·Shutdown 계약

- postgres mode는 HTTP/Socket listen 전에 connection과 expected migration version을 확인한다.
- SIGTERM이 시작되면 신규 event write를 거부한다.
- 이미 시작한 write promise만 추적하며 무제한 queue를 만들지 않는다.
- 기존 8초 server hard deadline 안에서 최대 약 3초 drain한 뒤 `pool.end()`를 호출한다.
- 두 번째 shutdown/close는 no-op이고 timer, Socket session, room ticker cleanup을 보존한다.
- deadline 초과를 성공으로 기록하거나 process를 65초까지 늘리지 않는다.

## 예상 영향 파일

- `src/server/services/logService.ts` 또는 현재 storage composition 경계
- JSONL/PostgreSQL repository composition
- `src/server/sockets/multiplayerHandlers.ts`
- authoritative placement/match finish와 room/match lifecycle의 최소 log context
- `src/server/init.ts`와 graceful shutdown 경계
- log validator, shared internal types와 관련 test
- `PLAN.md`, Goal 9B 실행 기록과 production environment 문서

실제 조사에서 한 군데 composition root로 해결할 수 있으면 별도 factory/manager를 만들지 않는다.

## 완료 기준

- JSONL mode의 기존 log와 gameplay가 기준 main과 동일하다.
- postgres mode가 실제 game start, human/AI 저장 대상 placement와 game over를 DB에 기록한다.
- postgres mode 실행 전후 JSONL path의 존재 여부·byte count·hash가 변하지 않는다.
- human event의 client identity와 nickname이 DB payload에 남지 않는다.
- duplicate는 성공, immutable event conflict는 실패하며 row를 덮어쓰지 않는다.
- DB down/timeout에도 gameplay와 match finish가 완료되고 저장 실패가 관찰된다.
- PostgreSQL 지연·재시도 중 authoritative input 처리와 room ticker cadence가 기준 허용치 안에 유지된다.
- DB down 부하에서도 in-flight 수와 pool 대기가 고정 상한을 넘지 않는다.
- startup misconfiguration은 listen 전에 실패한다.
- SIGTERM에서 in-flight write와 pool이 8초 contract 안에 정리된다.

## 자동 검증

```bash
test "$(node --version)" = "v$(tr -d '\n' < .nvmrc)"
npm run typecheck
npm run build
npm run test:db
bash scripts/verify.sh
npm run test:release
npm run test:e2e:vite-dev
npm run test:e2e
git diff --check <base>..HEAD
```

추가 필수 case:

- JSONL/postgres mode selection, unknown mode와 production missing-mode startup failure
- postgres mode의 JSONL repository 미생성·file byte/hash 불변
- postgres mode의 missing URL, bad TLS와 old schema startup failure
- server canonical game/room/player/sequence/piece identity
- finished grace의 정상 late log와 forged/stale receipt 거부
- nickname/token/socket/IP/cookie/UA 비저장
- same event retry의 same ID 유지
- conflict non-retry와 transient error bounded retry
- write budget 상한과 DB 지연 중 authoritative ticker cadence
- pool max/timeout, process-wide in-flight 상한과 초과 실패 관찰
- DB down 중 gameplay/finish 성공과 `LOG_WRITE_FAILED` 관찰
- first/second SIGTERM, in-flight drain timeout과 pool close 1회

## 수동 검증

- 실제 PVP와 PVE 한 경기씩 postgres mode로 실행하고 start → placement → over row를 query한다.
- human row의 trust level과 server identity, lifecycle payload의 개인정보 제거를 확인한다.
- DB를 잠시 중단해 gameplay가 계속되고 복구 후 새 event가 다시 저장되는지 확인한다.
- 종료 시간, exit code와 credential redaction을 확인한다.

## 보안·데이터 검토

- runtime role은 event INSERT, idempotency 확인 SELECT와 startup migration history/schema version SELECT만 사용한다.
- private event payload와 DB exception을 Socket response나 console에 그대로 노출하지 않는다.
- production enable 전에 retention, 사용자 고지와 `pg_total_relation_size` warning threshold를 기록한다.
- 현재 raw event 크기를 다시 측정해 free-tier/managed DB 용량 가정을 검증한다.

## 커밋 계획

1. `feat: canonicalize persisted game events`
2. `feat: add PostgreSQL runtime storage mode`
3. `fix: drain PostgreSQL writes on shutdown`
4. `test: verify PostgreSQL runtime boundaries`
5. `docs: record Goal 9B verification`

## Rollback과 data 호환성

- production 배포 env에 `GAME_EVENT_STORAGE=jsonl`을 명시하면 code revert 전에도 JSONL mode로 복귀한다. production에서 mode를 지우는 것은 rollback이 아니라 startup failure다.
- 이후 Goal 9B commit을 역순 revert한다.
- 이미 저장된 PostgreSQL row는 삭제하지 않는다.
- lifecycle schema를 되돌릴 때 새 필드를 무시할 수 있는 forward-compatible reader를 유지한다.

## 즉시 중단 조건

- server-owned game/placement identity를 current lifecycle에서 증명할 수 없다.
- 저장 성공이 gameplay 성공 조건이 된다.
- dual-write 또는 unbounded queue 없이는 진행할 수 없다고 판단된다.
- existing 8초 graceful shutdown을 늘려야 한다.
- pool 또는 in-flight 상한을 정하지 않고 driver 내부 대기열에 의존해야 한다.
- 개인정보 allowlist와 실제 payload가 일치하지 않는다.
- 사용자가 best-effort event loss를 승인하지 않았거나 strict lossless 수집을 요구한다.

## Merge Gate와 다음 Goal

검증과 실행 기록 후 멈춘다. production env 활성화, push와 main merge는 별도 승인 대상이다. Goal 9B가 main/origin/main에 반영된 뒤에만 [Goal 9C](09c-jsonl-backfill.md)를 시작한다.
