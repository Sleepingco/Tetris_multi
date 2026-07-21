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

Playwright, production runtime smoke와 DB 통합 검증은 별도 full gate로 실행할 수 있지만 관련 Goal 완료 전에는 반드시 실행한다.

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
- 8D는 선택한 test/e2e/scripts만 검증하며 Goal 8C production 완료나 Goal 9 시작을 막지 않는다.
- 새 TypeScript runtime loader나 runtime dependency 없이 기존 Node 24, TypeScript, Vite와 Playwright 경로로만 실행한다.

## 서버와 프로토콜 검증

- 외부 payload가 service 호출 전에 거부되는지 확인한다.
- authorization 실패와 validation 실패를 구분한다.
- client/server event 이름과 acknowledgment 결과를 함께 검증한다.
- authoritative input, ticker, garbage, game over와 lobby 복귀를 확인한다.

## DB와 데이터 검증

- migration empty bootstrap과 재실행 안전성을 확인한다.
- idempotency와 unique constraint를 검증한다.
- DB 장애가 gameplay loop를 막지 않는지 확인한다.
- JSONL과 DB export의 event count, hash, feature schema와 dataset 결과를 비교한다.
- backfill과 rollback을 테스트한다.

## 완료 판정

다음 중 하나라도 해당하면 완료가 아니다.

- 필수 명령 실패
- 목표 Node 버전이 아닌 환경에서만 통과
- 테스트 포트 충돌로 E2E 미실행
- 관련 수동 검증 미수행
- 문서의 완료 주장과 실제 검증 범위 불일치

실패한 검증을 숨기지 말고 통과·실패·미실행을 분리해 기록한다.
