# Goal 3 — Typed Socket Contract and Zod Validation

## 목적

모든 Socket.IO 외부 payload에 단일 runtime schema와 client/server event type 계약을 만들고 서비스 호출 전에 검증한다.

## 선행조건

- Goal 2의 main 반영
- 인증/인가 error와 validation error 경계 확정
- 전체 inbound/outbound event, acknowledgment와 broadcast inventory
- Zod와 현재 CommonJS/browser build의 호환 버전 검토

## 범위

- event별 payload/result schema와 공통 error envelope
- string/array/number/enum/unknown-key와 payload 크기 정책
- chat, room, input, snapshot 요청의 event별 rate/queue 상한
- safe parse 이후에만 service/domain 호출
- client/server event map과 schema-derived type 또는 동등한 단일 계약
- malformed payload가 handler process를 종료하지 않는 오류 처리
- invalid/oversized/unknown/replayed event integration test

현재 server가 CommonJS이므로 runtime schema는 TS runtime 없이 server와 browser build가 함께 사용할 수 있어야 한다. 필요하면 JS schema + JSDoc/type declaration으로 시작하고 Goal 4에서 shared TypeScript output으로 정리한다.

## 제외 범위

- server 전체 TypeScript 변환
- service/domain 구조 전면 개편
- session token 의미 변경
- gameplay 규칙과 snapshot schema의 불필요한 재설계

## 허용되는 기능·프로토콜 변화

- 일관된 validation error code와 invalid payload 거부
- 문서화되지 않은 unknown field 제거 또는 거부

정상 payload 의미는 유지한다.

## 완료 기준과 검증

- 모든 외부 mutation/request event가 schema gate를 통과한다.
- authorization과 validation 실패가 구분된다.
- client emit/on과 server on/emit의 event 이름·payload type이 일치한다.
- oversized payload와 rate abuse가 bounded failure로 처리된다.
- schema unit test, socket integration, PVP/PVE E2E와 fast/full gate가 통과한다.

## 보안 검토

- schema 오류에 token, stack, raw payload 전체를 포함하지 않는다.
- rate limit key가 spoof 가능한 playerId에만 의존하지 않는다.

## Rollback과 Merge Gate

event group별 schema adapter를 revert할 수 있어야 한다. 정상 client가 거부되면 계약 차이를 해결한 뒤 완료하며 Goal 4를 선행하지 않는다.

