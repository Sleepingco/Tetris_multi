# Goal 2 — Player Session and Reconnect Security

## 목적

클라이언트가 보낸 `playerId`를 신원 증명으로 사용하지 않고, 서버가 발급한 capability로 player/socket/room 소유권을 검증한다.

## 선행조건

- Goal 1의 main 반영과 production/local gate 통과
- 기존 create/join/leave/start/game/reconnect 이벤트와 public room payload inventory
- Goal 2 완료 전 public Internet deployment 금지
- 위협 모델과 의도된 프로토콜 변화 검토

## 범위

- CSPRNG 기반 opaque session/reconnect token과 충분한 entropy
- server-side token 저장·비교, 만료, 회전과 폐기 정책
- Socket.IO handshake 또는 명시적 auth channel의 전달 계약
- disconnect grace, replay, 동시 reconnect와 stale socket 정책
- 상태를 바꾸는 모든 Socket event의 player/socket/room 소유권 검사
- 타인의 `room:leave`, `game:join`, room sync와 input 위조 차단
- public room DTO에서 socketId, token과 private metadata 제거
- 로그, dataset, error와 debug output redaction

## 제외 범위

- OAuth, 계정/비밀번호와 PostgreSQL 사용자 테이블
- Zod 전체 payload schema와 typed event map
- React와 server TypeScript 전환

## 허용되는 기능·프로토콜 변화

- server-issued player identity와 reconnect token 필드
- 인증 실패 error code와 reconnect acknowledgment
- 기존 playerId-only 재접속의 거부

변경 전후 event 계약, 기존 sessionStorage 영향과 호환성 전략을 문서화한다.

## 완료 기준과 검증

- 정상 create/join/start/reconnect가 유지된다.
- 다른 playerId, 잘못된/만료/replayed token과 다른 room 접근이 거부된다.
- stale socket이 새 연결의 권한을 탈취하지 못한다.
- 모든 mutation event에 ownership test가 있다.
- public payload와 log/artifact에 token/socketId가 없다.
- security integration test, PVP/PVE Playwright와 fast/full gate가 통과한다.

## 보안 검토

- token을 평문으로 장기 저장해야 한다면 이유와 메모리 수명·비교 방식을 기록한다.
- allowed origin과 production transport 정책을 명시한다.
- timing, brute-force와 rate abuse에 대한 상한을 둔다.

## Rollback과 Merge Gate

controlled environment에서만 legacy 경로로 되돌릴 수 있는 명시적 rollback을 준비한다. 보안 우회를 기본값으로 남기지 않으며 Goal 3을 선행하지 않는다.

