# Goal 6 — Runtime Display Bridge and Single React

## 목적

기존 runtime을 단일 상태 원천으로 유지하면서 React가 single game의 HUD와 생명주기를 구독하는 안정적인 bridge를 만든다.

## 선행조건

- Goal 5의 main 반영
- index/lobby React lifecycle과 Socket cleanup 검증 완료
- single runtime의 현재 DOM side effect와 snapshot 계약 조사

## 범위

- 변경 시에만 참조가 바뀌는 cached display snapshot
- `subscribe()`와 정확한 unsubscribe
- runtime `destroy()`와 keyboard/timer/listener cleanup
- StrictMode 이중 mount에 안전한 lifecycle
- score, lines, hold, next와 phase를 작은 단위로 React HUD에 이전
- 기존 Canvas renderer와 input runtime 재사용

## 제외 범위

- core 판정과 게임 상태를 React reducer로 재작성
- multiplayer/PVE 화면
- 서버 프로토콜과 AI 변경

## 허용되는 기능·프로토콜 변화

없음. 표시 상태 계약은 추가할 수 있지만 gameplay state 의미는 유지한다.

## 완료 기준과 검증

- snapshot을 연속 호출해도 상태가 바뀌지 않으면 동일 참조를 반환한다.
- 변경 알림 1회당 필요한 React update만 발생한다.
- mount/unmount/restart 후 timer, keyboard와 listener가 남지 않는다.
- 이동, 회전, drop, hold, next, 점수, line clear와 game over가 동등하다.
- store/lifecycle unit test, single Playwright, fast/full gate가 통과한다.

## 보안·성능 검토

- snapshot에 token, socketId와 내부 callback을 포함하지 않는다.
- 매 render마다 board 전체를 불필요하게 복사하지 않는다.

## Rollback과 Merge Gate

React HUD와 bridge commit을 revert해 기존 single entry로 복귀할 수 있어야 한다. Goal 7 multiplayer 전환은 merge 이후에만 시작한다.

