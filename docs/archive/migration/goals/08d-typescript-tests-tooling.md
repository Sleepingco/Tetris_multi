# Goal 8D — Optional Test and Tooling TypeScript Cleanup

## 상태

보류한다. test/e2e/scripts의 JavaScript가 실제 오류나 유지보수 비용을 만들기 전에는
대량 rename과 추가 tooling을 시작하지 않는다. production hardening의 선행조건이 아니다.

## 목적

production TypeScript 완료와 분리해 유지보수 이득이 분명한 test/e2e/scripts만 선택적으로 TypeScript로 정리한다.

## 왜 지금 필요한가

test fake와 CLI script의 대량 rename은 production 안전성보다 diff와 runtime interop 비용이 크다. Goal 8C 이후 별도 판단하며 production hardening을 불필요하게 막지 않는다.

## 선행조건

- Goal 8C가 main 및 origin/main에 반영돼 있다.
- worktree가 clean하고 Node가 `.nvmrc`의 `24.18.0`과 정확히 일치한다.
- 실제 오류/유지보수 이득을 기준으로 전환 대상과 유지할 JavaScript allowlist를 다시 승인받는다.

## 범위

- `test`, `e2e`, `scripts`와 `test-artifact`에서 타입 검사가 실질적인 계약을 고정하는 파일만 `.ts`로 전환한다.
- rename된 test/helper/script를 참조하는 package script, shell, Python, notebook와 문서 경로를 같은 Goal에서 갱신한다.
- Node 24가 기본 지원하는 실행 방식과 Playwright의 기존 TypeScript 지원만 사용한다.
- CommonJS 도구 설정과 전환 이득이 없는 JavaScript는 이유와 owner가 있는 allowlist로 유지한다.
- server test는 Goal 8C 계약대로 compiled `dist/server/**/*.js`만 실행한다.

## 제외 범위

- production source 변경과 Goal 8C artifact 계약 재설계
- 모든 test fake를 타입화하기 위한 대량 assertion/`any`
- `tsx`, `ts-node`, schema generator, test framework와 새 runtime dependency
- protocol/schema/gameplay, DB와 SPA 변경

## 허용되는 기능·프로토콜 변화

없음.

## 예상 영향 파일

- 승인된 `test/**/*.js`, `e2e/**/*.js`, `scripts/*.js`, `test-artifact/*.js`
- 해당 파일을 실행·참조하는 `package.json`, shell, Python, notebook와 활성 문서
- test `tsconfig`, Goal 8D 실행 기록과 allowlist

## 완료 기준

- 선택된 파일이 strict 검사와 기존 실행 경로에 포함된다.
- 유지한 `.js`/`.cjs`/`.mjs`마다 이유와 owner가 기록된다.
- clean checkout에서 build-before-server-test, Node test discovery, Playwright와 ML parity 명령이 동작한다.
- Goal 8C production artifact와 dependency/lockfile이 변경되지 않는다.

## 자동 검증

```bash
test "$(node --version)" = "v$(tr -d '\n' < .nvmrc)"
npm run typecheck
bash scripts/verify.sh
npm run verify:ml
npm run test:e2e:vite-dev
npm run test:e2e
git diff --check <base>..HEAD
```

## 수동 검증

- 전환된 CLI의 help/error/output 경로를 기존 fixture와 비교한다.
- test discovery가 이전 suite 수를 빠뜨리지 않는지 확인한다.

## 보안·데이터 검토

production payload와 dataset을 변경하지 않는다. test fixture에 token, credential과 live JSONL 경로를 추가하지 않는다.

## Rollback

Goal 8D commit만 revert해도 Goal 8C production artifact와 production hardening 선행조건은 유지돼야 한다.

## Merge Gate

선택 범위의 검증과 실행 기록을 완료한 뒤 멈춘다. 다른 migration Goal과 병렬 수행하지 않으며 push, main merge와 다음 Goal은 별도 승인 없이는 수행하지 않는다.
