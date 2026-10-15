# Goal 9 — PostgreSQL Event Storage Split Index

이 문서는 구현 Goal이 아니다. 사용자 gameplay 로그를 실제 배포 환경에서 장기 보존하기 위해 기존 보류 Goal 9를 리뷰 가능한 네 단계로 분할한 인덱스다.

## 재개 이유

기존에는 단일 서버의 JSONL이 분석과 ML 실험에 충분했다. 이제 실제 사용자의 이벤트를 컨테이너 수명과 분리해 수집하고 SQL로 완전성·중복·용량을 점검해야 한다는 구체적인 요구가 생겼다.

실시간 room/match 상태는 계속 process memory가 원천이다. PostgreSQL은 `game_start`, 저장 대상 `placement_decision`, `game_over`의 장기 보존에만 사용한다.

## 실행 순서

| Goal | 결과 | 선행조건 | 권장 브랜치 |
| --- | --- | --- | --- |
| [11E](11e-ci-stabilization.md) | main의 PVE browser CI green 복구 | Goal 11D | `codex/stabilize-pve-ci-timing` |
| [9A](09a-postgres-schema-repository.md) | 실제 PostgreSQL schema, migration과 repository | 11E | `codex/add-postgres-event-schema` |
| [9B](09b-postgres-runtime-storage.md) | server canonical event를 PostgreSQL에 저장 | 9A | `codex/persist-game-events-postgres` |
| [9C](09c-jsonl-backfill.md) | 기존 JSONL의 멱등 streaming import와 완전성 판정 | 9B | `codex/import-jsonl-game-events` |
| [9D](09d-postgres-ci-release.md) | 실제 PostgreSQL CI, release와 Docker 운영 gate | 9C | `codex/verify-postgres-ci` |

각 하위 Goal은 선행 Goal이 main에 반영된 뒤 최신 main에서 별도 branch/worktree로 시작한다. 일정이 하루여도 merge gate를 생략하거나 여러 Goal을 한 branch에 쌓지 않는다.

## 하루 실행 예산

다음은 기준선이 green이고 실제 PostgreSQL/Docker 환경이 준비됐을 때의 빠른 목표치다. 사용자 검토와 hosted runner 대기 시간은 늘어날 수 있다.

| 작업 | 목표 시간 |
| --- | ---: |
| Goal 11E 재현·수정·local/hosted gate | 2~2.5시간 |
| Goal 9A schema/migration/repository | 2~2.5시간 |
| Goal 9B runtime canonical storage/shutdown | 2~2.5시간 |
| Goal 9C JSONL import/completeness | 1~1.5시간 |
| Goal 9D CI/release/Docker와 문서 | 1~1.5시간 |

총 9~10.5시간을 예상한다. 한 Goal의 필수 gate가 실패하면 시간표를 맞추기 위해 완료 처리하지 않는다.

## 권장 LLM 실행 수준

2026-07-23 기준 구현은 `GPT-5.6 Sol`의 `high` reasoning을 권장한다. Goal 9A/9B의 schema·멱등성·shutdown 최종 리뷰는 `xhigh`를 사용할 수 있다. 모델 선택은 검증·merge gate를 완화하는 근거가 아니다.

## 공통 저장 결정

- local/development 기본 sink는 기존 JSONL이다.
- 배포 환경의 장기 수집 sink는 PostgreSQL이다.
- 한 process는 `jsonl` 또는 `postgres` 중 하나만 사용한다. runtime dual-write와 조용한 fallback은 금지한다.
- Goal 9D gate와 별도 production 활성화 승인이 끝나면 배포 설정을 `GAME_EVENT_STORAGE=postgres`로 전환하고 JSONL writer를 끈다. 이 mode에서는 JSONL file을 생성·open·append하지 않는다.
- 기존 JSONL 파일과 JSONL repository code는 삭제하지 않는다. local/test와 명시적 production rollback에서만 `GAME_EVENT_STORAGE=jsonl`로 사용한다.
- local/test만 storage mode 생략 시 `jsonl`을 기본값으로 사용할 수 있다. production profile에서 mode 생략은 fail closed하며 JSONL rollback도 `GAME_EVENT_STORAGE=jsonl`을 명시한다.
- PostgreSQL은 gameplay 상태, room lifecycle, ticker, reconnect와 Socket.IO coordination의 원천이 아니다.
- 한 append-only `game_events` table과 실제 조회에 필요한 최소 index만 만든다.
- PostgreSQL driver는 Node 24와 호환되는 검증된 stable `pg`를 exact pin한다.
- 한 table을 위해 Drizzle, Prisma, Redis, Kafka, custom in-memory queue와 generic repository framework를 도입하지 않는다.
- 엄격한 무손실 요구가 생기기 전에는 durable outbox를 구현하지 않는다. 최종 DB 실패나 process crash에서 event가 유실될 수 있다는 한계를 숨기지 않는다.
- 이 best-effort 유실 의미를 사용자가 Goal 9B 구현 전에 명시적으로 승인해야 한다. 무손실 수집이 요구되면 9B를 시작하지 않고 durable outbox를 별도 Goal로 설계한다.

## 이벤트 identity와 멱등성

identity version은 문자열 `identity-v1`로 고정한다.

```text
game_start
  [identity-v1, game_start, gameId]

placement_decision
  [identity-v1, placement_decision, gameId, playerId, pieceIndex]

game_over
  [identity-v1, game_over, gameId]
```

- 위 tuple의 결정론적 SHA-256을 `event_id`로 사용한다.
- object key를 정렬하고 array 순서를 유지하는 canonical JSON 규칙을 하나만 사용한다.
- `event_sha256`은 identity tuple 필드, `event_type`, `schema_version`, `game_id`, `player_id`, `piece_index`, `trust_level`, `occurred_at`과 allowlist `payload`를 포함한 immutable persistence envelope 전체를 hash한다. DB가 만드는 `ingested_at`과 운영 metadata만 제외한다.
- 같은 `event_id`와 같은 `event_sha256`은 이미 처리된 성공이다.
- 같은 `event_id`와 다른 `event_sha256`은 `IDEMPOTENCY_CONFLICT`이며 기존 row를 덮어쓰지 않는다.
- `ON CONFLICT DO NOTHING`만 실행하고 모든 충돌을 성공으로 간주하지 않는다.
- 전달 의미는 `at-least-once attempt + unique constraint`다. network exactly-once를 주장하지 않는다.

## 원자성과 실패 계약

- 원자성 단위는 event 한 행의 insert다.
- 경기 전체, gameplay mutation과 DB write를 하나의 transaction으로 묶지 않는다.
- DB 실패 때문에 이미 처리한 input, gravity, 승패를 rollback하지 않는다.
- 재시도 allowlist는 검토된 network timeout/reset·SQLSTATE class `08`, `40001` serialization failure와 `40P01` deadlock뿐이다. canonical JSON 직렬화, validation, authorization, constraint와 idempotency conflict는 재시도하지 않는다.
- 같은 `event_id`로 최초 시도 뒤 최대 2회만 추가 시도한다. connection/query/backoff를 합친 정확한 총 write budget은 Goal 9B 설계 gate에서 고정하고 `write budget < 약 3초 drain < 8초 hard shutdown`을 지킨다.
- `pg.Pool`의 connection/query timeout, `max`와 process-wide in-flight write 상한도 Goal 9B 설계 gate에서 근거와 함께 정확히 고정한다. 상한 초과는 조용히 대기시키지 않고 `LOG_WRITE_FAILED`로 관찰하며 gameplay는 계속한다.
- 최종 실패는 구조화된 counter/log로 관찰하되 token, connection URL과 raw payload를 출력하지 않는다.
- DB가 down인 동안 DB 자체에 `INCOMPLETE` marker를 쓸 수 있다고 주장하지 않는다.
- SIGTERM에서는 신규 write를 중단하고 기존 8초 server shutdown budget 안에서 in-flight write를 최대 약 3초 기다린 뒤 pool을 닫는다.
- authoritative mutation queue와 room ticker의 critical section은 DB await를 포함하지 않는다. gameplay commit 뒤 시작한 bounded write promise만 별도로 추적하며 custom queue를 만들지 않는다.

## 신뢰·개인정보 계약

- lifecycle과 server AI event는 `server_authoritative`다.
- human placement의 board, metrics와 선택 설명은 `client_reported`다. validation을 통과해도 authoritative 학습 정답으로 승격하지 않는다.
- 새 경기의 canonical `gameId`는 match 생성 시 server가 한 번 만들고 start, human/AI placement, over와 recent receipt가 같은 값을 참조한다. 각 emitter의 재계산과 `roomId` fallback을 금지한다.
- human event의 `gameId`, `roomId`, `playerId`, authoritative sequence와 piece identity는 server-owned active/recent match context로 대체·대조한다.
- 저장 payload는 event별 allowlist projection으로 만든다. denylist만으로 개인정보를 막지 않는다.
- nickname, session token, socket ID, IP, Cookie, User-Agent와 credential은 저장하지 않는다.
- pseudonymous `playerId`도 telemetry이므로 production 활성화 전에 사용자 고지, retention 기간, 삭제 주체와 용량 경고 기준을 정한다.

## 기존 실험 브랜치 재사용 판정

`codex/add-postgres-event-shadow`는 설계 참고 자료로만 보존한다. 새 Goal 구현에 branch 전체 merge, rebase 또는 commit 전체 cherry-pick을 금지한다.

이유:

- 현재 CSP, dependency hardening, Docker, 8초 graceful shutdown과 GitHub Actions 이전 main에서 분기했다.
- Drizzle과 별도 in-memory shadow queue는 한 table 요구보다 복잡하다.
- queue overflow/timeout 시 event를 버리면서 JSONL 성공만 반환해 실제 사용자 데이터 수집 요구와 다르다.
- idempotency conflict에서 immutable event hash 차이를 검사하지 않고 `DO NOTHING`으로 숨긴다.
- 65초 hard shutdown은 현재 container의 8초 계약과 충돌한다.

참고 가능한 것은 semantic identity, parameterized query, TLS/least-privilege 검토와 실제 PostgreSQL integration test 시나리오다. 이를 사용하려면 최신 main에서 새 계약에 맞게 다시 작성하고 같은 검증을 통과해야 한다.

| 과거 자산 | 재사용 판정 | 새 Goal에서의 처리 |
| --- | --- | --- |
| old worktree/branch | 읽기 전용 참고 가능 | diff와 test idea만 조사 |
| identity·TLS·least-privilege 아이디어 | 조건부 가능 | 새 common contract와 official source로 재검증 |
| integration test scenario | 조건부 가능 | 현재 API/8초 shutdown 기준으로 다시 작성 |
| Drizzle schema/migration | 직접 재사용 불가 | `pg`와 새 raw SQL schema로 재작성 |
| repository implementation | 직접 재사용 불가 | immutable event conflict 확인과 privacy projection 포함해 재작성 |
| shadow queue/logService/init patch | 재사용 불가 | single sink와 current graceful shutdown에 맞게 재설계 |
| package manifest/lockfile | 재사용 불가 | 최신 main에서 exact dependency를 다시 설치 |
| branch commit | 전체 cherry-pick 금지 | 필요 논리를 작은 새 commit으로 구현 |

각 하위 Goal의 preflight는 `git merge-base`, `git rev-list --left-right --count`와 diff를 다시 확인한다. 브랜치 이름이 같거나 과거 테스트가 통과했다는 사실은 재사용 근거가 아니다.

## 공통 제외 범위

- PostgreSQL server를 application Docker image 안에 포함
- runtime room/match persistence와 multi-instance Socket.IO adapter
- 자동 production deploy, cloud account 생성과 secret 저장
- JSONL 즉시 삭제
- DB 기반 dataset read cutover와 자동 retention job; 이는 선택 Goal 10 범위다. production 활성화에 필요한 수동 retention dry-run·승인된 삭제 runbook은 Goal 9D에서 먼저 증명한다.

## 문서 분할 브랜치

`codex/define-postgres-event-storage-goals`는 이 Goal 명세와 공통 workflow만 소유한다. SQL, dependency, production code와 CI 구현을 이 branch에서 시작하지 않는다.

## Rollback과 Merge Gate

문서 분할 commit을 revert하면 기존 보류 Goal 9 문서로 돌아간다. 사용자 승인 전에는 이 문서 branch를 push하거나 main에 병합하지 않고, Goal 11E와 9A 구현도 시작하지 않는다.
