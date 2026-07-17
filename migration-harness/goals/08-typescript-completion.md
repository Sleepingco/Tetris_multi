# Goal 8 — First-party TypeScript Completion

## 목적

동작 변화 없이 남은 first-party JavaScript를 책임 경계별로 TypeScript로 전환하고 실제 strict 검사 범위를 완성한다.

## 선행조건

- Goal 7의 main 반영과 모든 gameplay E2E green
- client/server/shared build 경계가 안정적임
- 변환 대상과 유지할 JS 예외 allowlist 작성

## Checkpoint

1. `core/state`
2. `runtime/render/net/AI`
3. `server`
4. `test/e2e/scripts`

각 checkpoint는 별도 목적 commit과 fast/full gate를 갖는다. 예상 diff가 리뷰 가능한 범위를 넘으면 구현 전에 Goal 8A~8D로 분할하고 roadmap을 갱신한다.

## 범위

- `.ts`/`.tsx`가 모든 관련 tsconfig include에 포함되도록 수정
- public boundary와 직렬화 상태의 명시적 타입
- CommonJS/ESM interop 제거 또는 문서화
- 남은 JS allowlist와 제거 계획
- `allowJs`, `checkJs`와 declaration 정책의 최종 결정

## 제외 범위

- 기능 추가, 프로토콜/schema 변경
- 광범위한 `any`, `@ts-ignore`, type assertion으로 오류 숨기기
- 대량 formatting과 파일 구조 개편 동시 수행

## 완료 기준과 검증

- first-party source가 합의된 strict TypeScript 범위에 포함된다.
- server/test `.ts`와 client `.tsx`가 실제 typecheck된다.
- 남은 JS 예외마다 이유와 owner가 있다.
- 각 checkpoint의 typecheck/build/unit/E2E가 통과한다.
- 직렬화 fixture와 client/server parity가 유지된다.

## Rollback과 Merge Gate

checkpoint별 revert가 가능해야 한다. 일부 checkpoint가 실패하면 전체 Goal을 완료 처리하지 않고 범위 분할을 제안한다.
