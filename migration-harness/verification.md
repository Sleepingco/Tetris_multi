# Migration Verification

검증은 기존 동작이 유지됐다는 증거이며, 문서의 완료 체크를 정당화하는 조건이다.

## 공통 검증

현재 Goal에 존재하는 명령만 실행하되, 생략한 항목은 이유를 기록한다.

```bash
test "$(node --version)" = "v$(tr -d '\n' < .nvmrc)"
npm --version
git diff --check
bash scripts/verify.sh
```

Node 검사는 출력 기록이 아니라 실행 전 필수 gate다. 현재 migration 기준은 `.nvmrc`의 `24.18.0`이며, 다른 Node에서만 통과한 결과는 유효하지 않다.

Goal 1에서 Vite/TypeScript 기반이 추가된 이후의 최소 자동 검증은 다음과 같다.

`scripts/verify.sh`는 Goal 1에서 `typecheck`, `build`, unit test를 포함하는 canonical fast gate로 강화한다. 개별 명령은 실패 원인 분석에 사용하고 같은 검증을 불필요하게 두 번 실행하지 않는다.

Playwright와 production runtime smoke는 별도 full gate로 실행할 수 있지만 관련 Goal 완료 전에는 반드시 실행한다. DB 통합 검증은 승인된 Goal 9A~9D 또는 10에서 실제 PostgreSQL을 대상으로 적용한다.

## 브라우저 검증

- `/`에서 싱글·멀티 링크를 실제 클릭한다.
- 이동, 회전, soft drop, hard drop을 각각 독립된 관찰값으로 검증한다.
- PVP는 두 개의 독립 browser context로 검증한다.
- PVE는 AI spawn, visible descent, authoritative snapshot과 종료 흐름을 검증한다.
- 재접속 Goal에서는 정상 token, 위조 token, stale socket과 다른 playerId를 검증한다.

href 문자열, 키 입력 호출 또는 HTTP 200만으로 gameplay 동등성을 주장하지 않는다.

Goal 1에서는 build environment에서 산출물을 만든 뒤 devDependencies가 없는 runtime 조건에서도 server가 기동되는지 확인한다. `/`, 네 page, 정적 asset과 `/socket.io/socket.io.js`를 production HTTP smoke로 검증한다.

## Goal 8 TypeScript 검증

- 8A/8B client ESM은 실제 `.ts`/`.tsx` source specifier를 사용하고 `rewriteRelativeImportExtensions`가 browser 및 `dist/server/client` output의 상대 경로를 `.js`로 바꾸는지 확인한다.
- Node가 source TypeScript를 읽는 client/test 경계는 `erasableSyntaxOnly`와 `verbatimModuleSyntax`를 검사한다. type-only import는 `import type`으로 제한하고 enum, namespace, parameter property처럼 type stripping 변환이 필요한 문법은 금지한다. compiled-only server CommonJS에는 이 정책을 전역 적용하지 않는다.
- rename된 파일을 참조하는 미전환 JavaScript consumer도 같은 Goal에서 경로를 갱신했는지 검색과 runtime fixture로 확인한다.
- 8C server CommonJS TypeScript는 source를 직접 실행하지 않는다. clean build 뒤 unit/integration, artifact, development와 production smoke가 모두 `dist/server/**/*.js`를 실행해야 한다.
- 8C는 raw `require()`/`module.exports` rename으로 `any`가 된 module boundary, 광범위한 `any`, `@ts-ignore`, 오류를 숨기는 assertion을 완료로 인정하지 않는다. representative service/socket chain의 compile-time argument, return과 exported boundary 검증을 artifact interop gate와 함께 실행한다.
- 8C 시작 전 8B main에서 `npm run build`, `npm run test:artifact`와 compiled server HTTP smoke를 실행한다. full build는 기존 `dist`를 제거하고 clean `dist/client`와 `dist/server`를 함께 만들어 artifact test와 HTTP smoke가 server-only output이나 이전 client artifact에 의존하지 않게 한다. artifact test는 `gameCoreLoader → core/state`와 `pveAiPlayerService → V4 scorer/model`, HTTP smoke는 `app → init → sockets → services` load chain을 담당한다.
- `src/shared/socketContracts.mjs`와 인접 type projection은 명시적인 `allowJs` runtime 예외다. `allowJs: false` 자체를 완료 증거로 사용하지 않는다.
- 보류된 8D를 다시 승인하면 선택한 test/e2e/scripts만 검증하며 Goal 8C production 완료나 production hardening을 막지 않는다.
- 새 TypeScript runtime loader나 runtime dependency 없이 기존 Node 24, TypeScript, Vite와 Playwright 경로로만 실행한다.

## 서버와 프로토콜 검증

- 외부 payload가 service 호출 전에 거부되는지 확인한다.
- authorization 실패와 validation 실패를 구분한다.
- client/server event 이름과 acknowledgment 결과를 함께 검증한다.
- authoritative input, ticker, garbage, game over와 lobby 복귀를 확인한다.

## Goal 11E CI 안정화 검증

- hosted failure의 trace와 authoritative snapshot 흐름을 먼저 확인한다.
- timeout, retry, worker 수와 고정 sleep을 늘려 flake를 숨기지 않는다.
- T-Spin과 pending garbage targeted scenario를 각각 10회 반복해 합계 20회 모두 통과한다.
- 전체 PVE spec을 3회 반복하고 Vite-dev, production E2E와 release gate를 실행한다.
- 제품 source, workflow, dependency와 lockfile이 기준 main과 같은지 확인한다.
- 동일 commit의 hosted Browser job이 연속 두 번 성공하고 main push의 기존 세 job이 모두 green이어야 Goal 9A를 시작한다.

## DB와 데이터 검증

이 절은 Goal 9A~9D 또는 10을 별도 승인으로 실행할 때 적용한다. mock-only 검증은 완료 증거가 아니다.

- empty PostgreSQL migration, migration 재실행, checksum mismatch와 concurrent runner를 확인한다.
- same ID/same immutable event hash는 duplicate success와 row count 1, same ID/different immutable column 또는 payload는 conflict와 기존 hash 불변인지 확인한다.
- concurrent insert와 DB partial unique/check constraint를 검증한다.
- human event의 game/room/player/sequence identity가 server context로 대체되고 forged/stale identity가 거부되는지 확인한다.
- nickname, token, socket ID, IP, Cookie, User-Agent와 DB credential이 row, log와 artifact에 없는지 확인한다.
- missing URL, bad TLS와 old schema는 listen 전 실패하고 startup 이후 DB down/timeout은 gameplay를 rollback하지 않는지 확인한다.
- transient retry가 같은 event ID와 bounded total budget을 사용하고 conflict/validation 오류를 재시도하지 않는지 확인한다.
- DB await가 authoritative mutation/ticker critical section을 막지 않고, 수치로 고정한 총 write budget이 in-flight drain 약 3초와 기존 8초 server budget보다 작은지 확인한다.
- DB down·동시 room 부하에서 `pg.Pool` max/timeout과 process-wide in-flight write 상한이 지켜지고 초과가 gameplay 중단이나 silent drop이 아닌 구조화된 실패로 관찰되는지 확인한다.
- SIGTERM이 신규 write를 막고 기존 8초 server budget 안에서 in-flight write와 pool을 정리하는지 확인한다.
- production storage mode 생략이 fail closed하고 runtime role이 event INSERT·idempotency/migration-history SELECT 외 DDL/UPDATE/DELETE를 수행하지 못하는지 확인한다.
- postgres mode가 JSONL repository/file을 만들거나 append하지 않고, production container가 JSONL writable volume 없이 동작하는지 확인한다.
- same identity에서 payload뿐 아니라 trust/time 등 immutable column이 달라져도 event hash conflict가 드러나는지 확인한다.
- JSONL importer가 streaming으로 동작하고 두 번째 실행에서 row count/hash가 바뀌지 않는지 확인한다.
- malformed/private/conflict row는 non-zero이며 raw payload를 출력하지 않는지 확인한다.
- lifecycle duplicate/missing, placement duplicate/internal gap/tail count와 legacy unknown-tail을 구분한다.
- Goal 9D는 GitHub-hosted 실제 PostgreSQL service, source-less release와 외부 DB container smoke를 통과해야 한다.
- Goal 10을 실행할 때만 JSONL/DB export의 event identity, feature schema, manifest와 dataset 결과를 비교한다.

## 완료 판정

다음 중 하나라도 해당하면 완료가 아니다.

- 필수 명령 실패
- 목표 Node 버전이 아닌 환경에서만 통과
- 테스트 포트 충돌로 E2E 미실행
- 관련 수동 검증 미수행
- 문서의 완료 주장과 실제 검증 범위 불일치

실패한 검증을 숨기지 말고 통과·실패·미실행을 분리해 기록한다.
