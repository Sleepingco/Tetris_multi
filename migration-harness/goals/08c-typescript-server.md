# Goal 8C — Production Server TypeScript and Artifact Boundary

## 목적

production server source를 TypeScript로 전환하고 server 실행·테스트가 compiled `dist/server` JavaScript만 사용하도록 경계를 고정한다.

## 왜 지금 필요한가

Goal 8A/8B의 typed client core와 AI를 server가 소비하는 마지막 production 경계다. 이 Goal이 완료되면 선택적인 test/tooling 전환과 무관하게 Goal 9의 storage 작업을 시작할 수 있다.

## 선행조건

- Goal 8B가 main 및 origin/main에 반영돼 있다.
- worktree가 clean하고 Node가 `.nvmrc`의 `24.18.0`과 정확히 일치한다.
- 아래 대표 compiled interop gate를 Goal 8B main에서 코드 변경 전에 통과한다.

### Pre-8C compiled interop gate

1. `npm run build:server`로 clean `dist/server`를 만든다.
2. 기존 `npm run test:artifact`로 `gameCoreLoader → client core/state`와 `pveAiPlayerService → placement V4 scorer/model`을 실제 compiled output에서 실행한다.
3. `node dist/server/app.js`를 local test 설정으로 기동하고 `/`와 `/socket.io/socket.io.js`의 HTTP 200을 확인한다. 이 기동은 `app → init → sockets → services` CommonJS dependency chain이 load되는지 검증한다.
4. `.ts`, `.tsx`, declaration, source map, test fixture와 secret이 artifact에 없는지 확인한다.

이 gate가 실패하면 server rename을 시작하지 않고 Goal 8A/8B output 또는 기존 interop 문제로 분리해 보고한다.

## 범위

- `src/server/**/*.js`를 `.ts`로 rename하고 Room, Match, authoritative state, session, DTO와 parsed Socket payload의 기존 경계를 타입화한다.
- `src/app.ts`, 미전환 test/script와 다른 consumer가 참조하는 server 경로를 함께 갱신한다.
- root CommonJS와 `module: NodeNext`를 유지한다. root `"type": "module"`은 추가하지 않는다.
- server source를 `node`, `tsx`, `ts-node` 또는 다른 runtime loader로 직접 실행하지 않는다.
- server 대상 unit/integration test는 먼저 build한 뒤 `dist/server/**/*.js`를 import/require한다. clean checkout의 test script와 `scripts/verify.sh`도 이 순서를 보장한다.
- production start와 development server는 계속 `dist/server/app.js`를 실행한다.
- `src/shared/socketContracts.mjs`는 Zod production runtime이므로 명시적인 `allowJs` 예외로 server build에 포함하고 `dist/server/shared/socketContracts.mjs`를 검증한다.
- `rewriteRelativeImportExtensions`가 client `.ts` dynamic import를 compiled `.js` 경로로 바꾸는지 검증한다.
- V4 model JSON과 `src/client/package.json` ESM marker의 기존 copy 경계를 유지한다.

## 제외 범위

- test/e2e/scripts 파일 자체의 TypeScript 전환
- server module format의 ESM 전환과 source runtime 실행
- Socket event/schema, session/reconnect, rate/queue와 gameplay 변경
- repository/storage 변경, 새 dependency, loader와 SPA 작업

## 허용되는 기능·프로토콜 변화

없음.

## 예상 영향 파일

- `src/server/**/*`
- `src/app.ts`
- server module을 참조하는 미전환 test/script 경로
- `package.json`, server/test/build `tsconfig`, `scripts/verify.sh`의 build-before-test 계약
- artifact test, 권위 문서와 Goal 8C 실행 기록

## 완료 기준

- production server source가 strict TypeScript 검사와 NodeNext build에 포함된다.
- source server TypeScript를 직접 실행하는 package script와 test가 없다.
- production, unit/integration과 dependency-only smoke가 compiled JavaScript만 실행한다.
- `socketContracts.mjs`가 유일한 production `allowJs` runtime 예외다. shared Socket contract boundary가 owner이며 browser/server Zod runtime 공유가 유지 이유다.
- clean artifact가 기존 server/client/shared/model whitelist와 source 비배포 경계를 유지한다.
- Goal 9 시작에 필요한 production TypeScript 경계가 완료된다. Goal 8D는 선행조건이 아니다.

## 자동 검증

```bash
test "$(node --version)" = "v$(tr -d '\n' < .nvmrc)"
npm run typecheck
npm run build
npm run test:artifact
node --test test/testGameCoreLoader.js test/testMultiplayerSocket.js test/testPlayerSessionSocket.js test/testAuthoritativeTickerService.js test/testPveAiPlayerService.js
bash scripts/verify.sh
npm run test:e2e
git diff --check <base>..HEAD
```

별도 임시 디렉터리에서 production dependency만 설치하고 미리 생성한 `dist`로 HTTP, Socket.IO, authoritative PVP/PVE와 V4 decision smoke를 실행한다.

## 수동 검증

- source tree를 제거한 release 형태에서도 server가 기동되는지 확인한다.
- stack trace가 source map 없이 compiled JavaScript 위치를 가리키는지 확인한다.

## 보안·데이터 검토

Zod validation → authorization → service 순서, token redaction, JSONL append와 Python parity를 변경하지 않는다. 타입은 인증이나 validation을 대체하지 않는다.

## Rollback

Goal 8C commit을 revert하면 server `.js` source, consumer 경로와 기존 compiled build 계약으로 함께 돌아간다. Goal 8A/8B client 타입 경계는 유지한다.

## Merge Gate

검증과 실행 기록을 완료한 뒤 멈춘다. push, main merge, Goal 9와 선택 Goal 8D는 각각 별도 승인 없이는 수행하지 않는다.
