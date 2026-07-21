# Goal 7 — Multiplayer and PVE React

## 목적

Goal 6의 runtime bridge를 재사용해 multiplayer/PVE game 화면을 React lifecycle로 옮기면서 server authoritative 흐름을 보존한다.

## 선행조건

- Goal 6의 main 반영
- session/reconnect 보안과 typed Socket contract가 main에서 검증됨
- PVP/PVE baseline과 rollback/correction test green

## 범위

- local/remote runtime store와 Canvas mount lifecycle
- authoritative snapshot, own correction와 pending garbage 표시
- PVP opponent, result와 lobby return UI
- PVE AI board와 visible descent UI
- reconnect와 stale socket 처리의 React lifecycle 연결
- 모든 Socket/timer/keyboard subscription cleanup

## 제외 범위

- AI 알고리즘과 difficulty balance 변경
- server authoritative protocol 재설계
- game core와 renderer 재작성

## 허용되는 기능·프로토콜 변화

없음. UI mount 순서 때문에 contract 보완이 필요하면 구현을 멈추고 별도 Goal을 제안한다.

## 완료 기준과 검증

- 두 독립 browser context에서 create → join → start → play → finish → lobby가 통과한다.
- rapid input, lock 직전 입력, garbage, rollback/correction과 reconnect가 유지된다.
- PVE AI spawn, descent, placement와 game over가 유지된다.
- 화면 재진입 후 duplicate listener/ticker가 없다.
- multiplayer/PVE unit·integration·Playwright와 fast/full gate가 통과한다.

## 보안 검토

- React UI가 playerId만으로 mutation event를 만들지 않고 보안 adapter를 사용한다.
- token, socketId와 private authoritative metadata를 렌더하거나 로그하지 않는다.

## Rollback과 Merge Gate

multiplayer React entry를 revert해 기존 game page로 복귀할 수 있어야 한다. AI/프로토콜 개선과 Goal 8을 선행하지 않는다. Goal 7A는 선택 실험으로 보류한다.
