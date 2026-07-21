# Goal 8B — Production Client Runtime TypeScript

## 목적

production client의 runtime/render/net/AI 경계를 동작 변화 없이 TypeScript로 전환한다.

## 왜 지금 필요한가

Goal 8A의 core/state 타입을 Canvas runtime, Socket adapter와 PVE AI가 직접 소비하게 해 production client의 strict 검사 범위를 완성한다.

## 선행조건

- Goal 8A가 main 및 origin/main에 반영돼 있다.
- worktree가 clean하고 Node가 `.nvmrc`의 `24.18.0`과 정확히 일치한다.
- Goal 8A fast/full gate와 compiled shared core artifact가 green이다.

## 범위

- `src/client/game/ai`, `entry`, `render`, `runtime`, `ui`와 `src/client/net`의 production `.js`를 `.ts`로 rename한다.
- runtime handle/display snapshot, DOM adapter, multiplayer session, Socket subscription과 placement AI의 기존 public boundary를 타입화한다.
- page TSX, server PVE/core loader, test와 script 등 모든 consumer의 source import/dynamic import 경로를 실제 `.ts` 확장자로 함께 갱신한다.
- client ESM은 `.ts`/`.tsx` source specifier와 `rewriteRelativeImportExtensions`를 사용한다. Vite browser output과 `dist/server/client` output은 `.js`를 유지한다.
- shared Socket 타입은 기존 `socketContractTypes.d.ts`에서 가져오고 Zod runtime schema는 수정하지 않는다.
- 미전환 server/test/script JavaScript와 `socketContracts.mjs`를 위해 `allowJs`를 유지한다.

## 제외 범위

- server source와 test/e2e/script 자체의 TypeScript 전환
- React/Canvas 상태 소유권, Socket lifecycle와 UI 동작 변경
- AI feature/schema/model, gameplay policy와 JSONL 의미 변경
- 새 manager, type framework, dependency와 SPA routing

## 허용되는 기능·프로토콜 변화

없음.

## 예상 영향 파일

- `src/client/game/{ai,entry,render,runtime,ui}/*`
- `src/client/net/*`
- 위 모듈을 참조하는 page, server, test와 script의 source 경로
- 관련 `tsconfig`, 권위 문서와 Goal 8B 실행 기록

## 완료 기준

- production client runtime/render/net/AI가 strict TypeScript 검사에 포함된다.
- React는 표시와 lifecycle만, runtime/gameState는 gameplay 상태를 계속 소유한다.
- Socket event, session/reconnect와 placement AI 결과가 기준선과 같다.
- source `.ts` specifier가 emitted artifact에서 `.js`로 바뀌며 raw `.ts`/source map은 배포되지 않는다.

## 자동 검증

```bash
test "$(node --version)" = "v$(tr -d '\n' < .nvmrc)"
npm run typecheck
npm run build
npm run test:artifact
node --test test/testDisplayBridge.js test/testMultiplayerGameSession.js test/testRoomClient.js test/testTetrisRuntime.js test/testPlacementV4PveDecisionAdapter.js
npm run verify:ml
bash scripts/verify.sh
npm run test:e2e:vite-dev
npm run test:e2e
git diff --check <base>..HEAD
```

## 수동 검증

- single과 multiplayer의 keyboard, timer, preview, overlay와 reconnect를 확인한다.
- PVE heuristic/V4 선택, visible descent와 match finish를 확인한다.

## 보안·데이터 검토

token을 새 타입이나 UI 상태에 포함하지 않는다. Socket/Zod validation, placement log field와 V4 model checksum을 유지한다.

## Rollback

Goal 8B commit을 revert해 client `.js` source와 모든 consumer specifier를 함께 복구한다. Goal 8A 타입 경계는 유지할 수 있어야 한다.

## Merge Gate

검증과 실행 기록을 완료한 뒤 멈춘다. push, main merge, 8C와 SPA 작업은 별도 승인 없이는 수행하지 않는다.
