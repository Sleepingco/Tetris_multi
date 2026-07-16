# Goal 4 — Server TypeScript Build and Shared Core Output

## 목적

production에서 TS runtime loader 없이 실행 가능한 server build와 client/server가 공유하는 game core의 안정적인 output 경로를 만든다.

## 선행조건

- Goal 3의 main 반영
- 현재 CommonJS entry, dynamic import와 client core dependency graph 조사
- production artifact와 start/development 명령 계약 합의

## 범위

- emit 가능한 server tsconfig와 `dist/server` output
- 선택한 CommonJS/ESM interop 정책과 명시적 file extension
- shared core를 hashed Vite client bundle과 분리해 server가 import 가능한 build/copy 경로 제공
- build, dev와 production start 분리
- production start는 미리 생성된 artifact만 실행
- source map과 stack trace 정책
- 대표 server entry/leaf를 변환해 compiled runtime을 end-to-end 검증

## 제외 범위

- server 전체 파일의 일괄 TypeScript 변환
- Socket event 또는 gameplay protocol 변경
- React와 DB 도입
- production에서 `tsx`, `ts-node` 같은 runtime transpiler 사용

## 허용되는 기능·프로토콜 변화

없음. 파일 경로와 실행 명령만 바뀌며 외부 behavior는 유지한다.

## 완료 기준과 검증

- clean build가 server와 shared core artifact를 생성한다.
- `dist/server`가 source `.ts`와 Vite hashed bundle 없이 기동한다.
- server authoritative input/ticker가 compiled shared core를 사용한다.
- dev와 production의 event/gameplay 결과가 fixture 기준으로 일치한다.
- devDependencies 없는 runtime smoke, socket integration, PVP/PVE E2E와 fast/full gate가 통과한다.

## 보안 검토

- source map과 source file이 production에 불필요하게 공개되지 않는다.
- build output에 `.env`, token과 test fixture secret이 포함되지 않는다.

## Rollback과 Merge Gate

server build/entry commit을 revert하면 기존 CommonJS source runtime으로 복귀할 수 있어야 한다. 전체 server TS 전환은 Goal 8로 남긴다.

