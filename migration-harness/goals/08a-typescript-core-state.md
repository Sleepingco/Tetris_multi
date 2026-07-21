# Goal 8A — Production Core/State TypeScript

## 목적

production gameplay의 순수 `core/state` 경계를 동작 변화 없이 TypeScript로 전환한다.

## 왜 지금 필요한가

runtime, AI와 server authoritative 경로가 같은 board/piece/state 계약을 사용한다. 가장 안쪽의 순수 모듈을 먼저 타입화해야 이후 client와 server 전환이 안정된 타입을 소비할 수 있다.

## 선행조건

- Goal 7과 Goal 8 분할 문서가 main 및 origin/main에 반영돼 있다.
- Goal 7A SPA 구현 commit은 main의 조상이 아니다.
- worktree가 clean하고 Node가 `.nvmrc`의 `24.18.0`과 정확히 일치한다.
- 현재 fast gate와 전체 production Playwright 기준선이 green이다.

## 범위

- `src/client/game/core/*.js`와 `src/client/game/state/*.js`를 `.ts`로 rename한다.
- board, piece, rotation, move outcome, mutable game state와 serialized snapshot의 public 타입을 각 값을 소유하는 기존 모듈에서 export한다.
- rename된 모듈을 참조하는 runtime, AI, server loader, test와 script가 아직 JavaScript여도 source import/dynamic import 경로를 실제 `.ts` 확장자로 함께 갱신한다.
- client ESM 상대 specifier는 `.ts`를 사용하고 build emit에는 `rewriteRelativeImportExtensions`를 적용해 output의 `.js` 경로를 유지한다.
- Node가 직접 읽는 renamed client source와 관련 test 경계는 `erasableSyntaxOnly`와 `verbatimModuleSyntax`를 검사한다. type-only import는 `import type`으로 쓰고 enum, namespace, parameter property는 사용하지 않는다.
- `src/client/package.json`의 `type: module`과 `dist/server/client/package.json` 복사 계약을 유지한다.
- 이 단계에서는 필요한 `.ts`와 기존 `.js` consumer가 공존하므로 `allowJs`를 유지한다.

## 제외 범위

- runtime/render/net/AI와 server 파일 자체의 TypeScript 전환
- gameplay 규칙, score/line/garbage/hold/bag 의미 변경
- 범용 type registry, 새 state abstraction과 대량 formatting
- dependency, lockfile, Socket schema와 SPA 변경

## 허용되는 기능·프로토콜 변화

없음.

## 예상 영향 파일

- `src/client/game/core/*`
- `src/client/game/state/*`
- 위 모듈을 import하는 `src/client`, `src/server`, `test`, `scripts`의 경로
- client/server build에 `rewriteRelativeImportExtensions`를 적용하는 관련 `tsconfig`
- 현재 경로를 설명하는 권위 문서와 Goal 8A 실행 기록

## 완료 기준

- core/state production source가 strict TypeScript 검사에 포함된다.
- client ESM source import는 `.ts`, emitted browser/server artifact import는 `.js`다.
- Node source execution 경계가 type-stripping 가능한 문법과 type-only import 규칙을 통과한다.
- board/state serialization fixture와 client/server shared core 결과가 기준선과 같다.
- 미전환 consumer에 존재하지 않는 `.js` source 경로가 남지 않는다.

## 자동 검증

```bash
test "$(node --version)" = "v$(tr -d '\n' < .nvmrc)"
npm run typecheck
npm run build
npm run test:artifact
node --test test/testAttackState.js test/testBoardMetrics.js test/testGarbageRules.js test/testMoveStep.js test/testPiece.js test/testTSpin.js test/testTopOut.js
bash scripts/verify.sh
npm run test:e2e
git diff --check <base>..HEAD
```

compiled `gameCoreLoader`로 BLOCKS와 대표 board/step fixture를 실행해 source와 output의 ESM 의미가 같은지 확인한다.

## 수동 검증

- single의 move/rotate/soft drop/hard drop/hold/line clear를 확인한다.
- PVP/PVE의 spawn, authoritative input과 garbage 결과를 확인한다.

## 보안·데이터 검토

외부 payload validation, session identity와 JSONL schema는 변경하지 않는다. 타입은 기존 runtime 계약을 설명하며 새로운 신뢰 근거가 아니다.

## Rollback

Goal 8A commit을 revert하면 기존 `.js` core/state와 consumer 경로로 함께 돌아가야 한다. output만 부분적으로 되돌리지 않는다.

## Merge Gate

검증과 실행 기록을 완료한 뒤 멈춘다. push, main merge, 8B와 SPA 작업은 별도 승인 없이는 수행하지 않는다.
