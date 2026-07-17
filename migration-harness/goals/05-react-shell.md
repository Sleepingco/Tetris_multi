# Goal 5 — React Index and Lobby Shell

## 목적

Vite multi-page 구조를 유지하면서 index와 multiplayer lobby 화면만 React로 옮긴다.

## 선행조건

- Goal 4의 main 반영과 fast/full gate 통과
- React와 관련 type package의 Node/Vite 호환 버전 결정
- Goal 2의 session/reconnect 계약과 Goal 3의 Socket schema 사용 가능

## 범위

- index와 lobby에 독립 React entry/root 추가
- 기존 CSS, URL과 form 동작 보존
- create/join/leave/start 및 chat UI 연결
- Socket subscribe API가 정확한 unsubscribe를 반환하도록 통일
- StrictMode mount/unmount에서 listener와 side effect 중복 방지
- theme, sound, nickname과 session UI 동작 보존

## 제외 범위

- single/multiplayer Canvas gameplay와 runtime 변경
- React Router, Redux, Zustand, Tailwind
- Socket 프로토콜 및 서버 서비스 재설계

## 허용되는 기능·프로토콜 변화

없음. DOM 소유권과 화면 생명주기만 React로 이동한다.

## 완료 기준과 검증

- 새로고침과 재진입 후 listener가 중복되지 않는다.
- index → single, index → lobby navigation이 유지된다.
- lobby create/join/leave/start와 오류 표시가 기존과 동등하다.
- component lifecycle test와 관련 Playwright가 통과한다.
- `bash scripts/verify.sh`, full E2E와 browser console error 확인이 통과한다.

## 보안 검토

- token을 React state debug output, DOM, URL과 console에 노출하지 않는다.
- 사용자 문자열을 HTML로 직접 삽입하지 않는다.

## Rollback과 Merge Gate

React entry와 mount 지점을 revert하면 기존 페이지 entry로 복귀할 수 있어야 한다. 검증 보고 후 멈추며 React game 화면과 Goal 6을 선행하지 않는다.
