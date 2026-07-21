# Goal 8 — First-party TypeScript Split Index

이 문서는 구현 Goal이 아니다. 기존 단일 Goal 8의 범위를 리뷰 가능한 production 책임 경계와 선택적 tooling 정리로 분할한 인덱스다.

## 분할 Goal

| Goal | 결과 | 선행조건 | 다음 단계에 필수 |
| --- | --- | --- | --- |
| [8A](08a-typescript-core-state.md) | production `core/state` TypeScript | Goal 7 | 8B |
| [8B](08b-typescript-client-runtime.md) | production client runtime/render/net/AI TypeScript | 8A | 8C |
| [8C](08c-typescript-server.md) | production server TypeScript와 compiled artifact 경계 | 8B | Goal 9 |
| [8D](08d-typescript-tests-tooling.md) | test/e2e/scripts 선택적 TypeScript 정리 | 8C | 선택, Goal 9에는 불필요 |

8A~8C는 각각 최신 main에서 독립 브랜치로 시작하고 검증·merge gate를 통과한 뒤 다음 production Goal을 시작한다. 8D는 8C 이후 별도로 판단하며 Goal 9를 막지 않는다.

## 공통 전환 계약

- rename 대상 파일뿐 아니라 그 파일을 참조하는 미전환 JavaScript consumer의 source import/require 경로도 같은 Goal에서 갱신한다.
- client ESM의 상대 source specifier는 실제 `.ts`/`.tsx` 확장자를 사용한다. TypeScript emit은 `rewriteRelativeImportExtensions`로 production `.js` 경로를 만든다.
- Node가 source TypeScript를 직접 읽는 client/test 경계는 `erasableSyntaxOnly`와 `verbatimModuleSyntax` 검사를 통과한다. type-only import는 반드시 `import type`을 사용하며 enum, namespace, parameter property처럼 Node type stripping에 변환을 요구하는 문법은 사용하지 않는다.
- 이 Node source 실행 정책은 client/test 경계에만 적용한다. compiled-only server CommonJS에는 무조건 전역 적용하지 않고 Goal 8C의 build/type boundary로 검증한다.
- server CommonJS TypeScript source는 직접 실행하지 않는다. clean build 뒤 `dist/server/**/*.js`만 unit/integration/artifact/production 검증에 사용한다.
- root `"type": "module"`, TypeScript runtime loader, 새 runtime dependency를 추가하지 않는다.
- `src/shared/socketContracts.mjs`는 browser ESM과 server CommonJS가 공유하는 Zod runtime 계약이므로 명시적인 `allowJs` 예외로 유지한다. 인접한 `socketContractTypes.d.ts`가 타입 projection을 소유한다.
- `allowJs: false`는 Goal 8 완료 조건이 아니다. 남는 JavaScript는 production runtime 예외와 선택 Goal 8D의 allowlist로 관리한다.
- 각 Goal은 `.nvmrc`와 일치하는 Node `24.18.0`을 검증 시작 전에 명시적으로 확인한다.

## 기능·보안·데이터 불변조건

- Socket.IO event와 Zod schema, session/reconnect 보안, rate/queue 제한을 변경하지 않는다.
- gameplay 규칙, React/Canvas 상태 소유권과 server authoritative state를 변경하지 않는다.
- placement JSONL, dataset schema, V4 model과 Python parity 경로를 변경하지 않는다.
- Goal 7A SPA shell, client-side routing과 route lifecycle을 포함하지 않는다.
- dependency와 lockfile을 변경하지 않는다.

## 문서 분할 브랜치

`codex/complete-typescript-migration`은 이 분할 명세만 소유한다. production 구현은 이 브랜치에서 시작하지 않으며 각 하위 Goal의 main 선행조건이 충족된 뒤 별도 브랜치에서 수행한다.

## Rollback과 Merge Gate

이 브랜치의 문서 커밋들을 역순으로 revert하면 기존 단일 Goal 문서로 돌아간다. 사용자 승인 전에는 이 문서 브랜치를 push하거나 main에 병합하지 않고, 8A 구현도 시작하지 않는다.
