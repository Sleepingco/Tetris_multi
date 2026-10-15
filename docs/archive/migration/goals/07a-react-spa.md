# Goal 7A — React SPA Shell

> 상태: **보류된 선택 실험**. 이 Goal은 Goal 8의 선행조건이 아니며, 아래 재개 조건을 충족하기 전에는 기존 구현 브랜치를 main에 병합하지 않는다.

## 목적

기존 네 React 페이지를 단일 React root와 명시적인 client-side route 경계로 통합하면서 gameplay, Socket session과 기존 URL 호환성을 보존한다.

## 왜 보류했는가

Goal 7까지 index, lobby, single과 multiplayer/PVE 화면은 독립 React page entry에서 이미 동작한다. 현재 화면은 네 개의 큰 page이고 route 사이에 game state를 보존하지 않으므로, SPA가 해결하는 사용자 문제가 아직 명확하지 않다. 반면 단일 document에서 Socket transport를 유지하면서 room/game membership을 정리하려면 MPA에는 없던 route leave와 reconnect 경합을 소유해야 한다.

구현 브랜치는 dependency 없이 exact route allowlist, lazy multiplayer loading과 cleanup 경계를 만들었지만, review에서 merge를 막는 lifecycle 문제와 검증 공백이 확인됐다. 우선순위는 검증된 MPA 위에서 Goal 8 TypeScript 전환을 진행하는 것이다.

## 보류 검토에서 발견된 문제

- **P1 — start/leave 경합과 ghost match:** lobby 이탈 intent가 대기 중일 때 `room:start` 결과가 먼저 오면 같은 `room:result` channel 때문에 intent가 조기에 제거될 수 있다. 서버가 이미 `playing`으로 전환된 뒤 `room:leave`를 `GAME_IN_PROGRESS`로 거절해도 off-route Socket membership과 match가 남을 수 있다.
- **P2 — stale history에서 ghost waiting room:** lobby가 목적지 pathname만 보고 game 이동의 membership을 보존하면, 오래된 Forward entry로 새 waiting room에서 game URL로 이동할 때 room을 leave하지 못하고 client storage만 잃을 수 있다.
- **P2 — hash-only history 오판:** pathname이 같은 hash Back/Forward도 route exit와 remount로 처리하면 single runtime이 재시작되거나 active multiplayer가 불필요한 `game:leave`를 보낼 수 있다.
- **P3 — 기본 anchor 의미 훼손:** 일부 page-local click handler가 modifier key를 확인하지 않아 Cmd/Ctrl-click의 새 탭 동작을 현재 탭 SPA 이동으로 바꿀 수 있다.

## 검증 공백

- leave event 송신 횟수뿐 아니라 ack의 `ok`, `roomId`와 최종 server room/match 제거 상태를 확인해야 한다.
- lobby와 PVP/PVE game 이동이 같은 document, React root, Socket과 credential을 유지하는지 직접 관찰해야 한다.
- 여러 route를 왕복한 뒤 keyboard, timer, animation, runtime과 Socket subscription이 각각 한 세트인지 검증해야 한다.
- multiplayer URL의 direct load·refresh·title·style·focus와 실제 browser 두 context PVP/PVE 수동 흐름을 완료하거나 명시적으로 waiver해야 한다.

## 재개 조건

- full-document navigation으로 해결할 수 없는 구체적인 사용자 요구나 측정된 UX 문제가 먼저 존재한다.
- pending leave는 event 종류와 `roomId`가 일치하는 결과만 처리하고, 실패를 성공처럼 폐기하지 않는다. start/leave 경합은 최종 server membership 제거까지 증명한다.
- membership 보존은 pathname 추측이 아니라 현재 room과 server가 확인한 lobby→playing 전환에만 적용한다.
- hash-only 이동과 modifier/new-tab anchor 의미를 보존한다.
- 위 문제를 재현하는 server-state E2E와 반복 route lifecycle 검증을 추가한 뒤 fast/full/manual gate를 다시 실행한다.
- Goal 8 이후 재개한다면 오래된 브랜치 전체를 바로 merge하지 않고 최신 main의 TypeScript 경계 위에 필요한 변경만 재적용한다.

## 선행조건

- Goal 7의 main 및 origin/main 반영
- index/lobby/single/multiplayer React lifecycle과 전체 gameplay E2E green
- session/reconnect 보안, typed Socket contract와 production artifact gate green
- main과 Goal 전용 worktree가 clean함

## 범위

- 하나의 HTML shell과 React root에서 index, lobby, single과 multiplayer/PVE route를 렌더링한다.
- 기존 네 `.html` URL과 multiplayer `roomId` query 형식을 direct load, refresh와 deep link에서 유지한다.
- 고정 route allowlist와 browser History API로 내부 이동, 뒤로 가기와 앞으로 가기를 처리한다.
- Vite의 four-entry MPA build를 single-entry SPA build로 전환한다.
- Express와 Vite development server가 승인된 기존 page URL만 SPA shell로 전달하게 한다.
- 각 route가 기존 title, theme pre-paint, stylesheet와 focus/announcement 의미를 유지하게 한다.
- route unmount에서 runtime, timer, animation, keyboard, sound와 Socket subscription을 idempotent하게 정리한다.
- lobby/game route 전환에서 `game:join`, `room:leave`와 `game:leave`가 각각 필요한 경계에 정확히 한 번만 발생하게 한다.
- disconnect 중 route 이탈은 Socket.IO send buffer에 의존하지 않고, public `roomId`와 leave 종류만 가진 bounded in-memory intent를 다음 유효한 `session:ready`에서 기존 leave/result 계약으로 한 번 처리한다.
- `roomClient`의 단일 Socket 소유권을 유지하고 SPA 내부 이동을 reconnect나 새 인증 세션으로 취급하지 않는다.
- index/single 최초 진입은 multiplayer adapter를 초기화하거나 Socket 연결을 열지 않는다.

## 제외 범위

- React Router 또는 다른 routing dependency 추가
- clean URL, nested route, route loader와 server-side rendering 도입
- MPA와 SPA를 함께 유지하는 dual-router 또는 feature flag
- route 이동 시 진행 중인 single/multiplayer game 상태 보존
- gameplay, scoring, AI, authoritative state와 Socket payload/schema 변경
- session token 발급·회전·만료·replay 정책 변경
- CSS framework 도입이나 기존 stylesheet의 대량 재작성
- 남은 first-party JavaScript의 TypeScript 전환

## 허용되는 기능·프로토콜 변화

- 승인된 기존 page URL 사이의 사용자 이동은 full document navigation 대신 History API navigation을 사용한다.
- multiplayer route를 한 번 사용한 뒤 같은 document 안에서 이동할 때 Socket transport는 유지할 수 있다. 이 경우 room/game membership은 명시적인 leave event로 정리하고 off-route handler는 mutation을 만들지 않아야 한다.
- disconnect 중 생성된 leave intent는 token, session과 private room state를 저장하지 않고 reconnect의 join/sync보다 먼저 처리한다. terminal disconnect나 document 종료에서는 intent를 폐기하고 기존 server disconnect grace cleanup을 유지한다.
- event 이름, payload, authorization과 reconnect credential 계약은 변경하지 않는다.

## URL·fallback 계약

다음 경로만 SPA page route로 인정한다.

- `/`
- `/pages/index.html`
- `/pages/multiLobby.html`
- `/pages/tetrisSingle.html`
- `/pages/tetrisMulti.html`

서버 allowlist는 query가 아닌 pathname으로 판정한다. 기존 multiplayer `roomId` query 형식은 보존하지만 shell 응답 조건으로 사용하지 않는다. query가 없거나 malformed·stale·저장된 room과 불일치해도 권한을 부여하지 않으며, 기존 public room/session 검증 뒤 lobby로 이동하는 동작을 유지한다.

`roomId`는 route context일 뿐 인증이나 room membership의 근거가 아니다. token, socketId, full session, room snapshot과 private metadata를 URL 또는 `history.state`에 넣지 않는다.

서버 fallback은 위 allowlist에만 적용한다. `/socket.io`, 정적 asset, `.tsx`, source map과 알 수 없는 경로는 SPA HTML로 대체하지 않고 기존 성공 또는 404 의미를 유지한다.

## Lifecycle·스타일 계약

- single과 multiplayer Canvas runtime은 route mount가 생성하고 route unmount가 정확히 한 번 destroy한다.
- route 이탈 뒤 예약된 timer, animation, reconnect replay와 Socket callback이 Canvas, React state 또는 server state를 바꾸지 않는다.
- lobby에서 game으로 이동할 때 room membership을 유지하고, lobby/home 또는 game/home 이탈에서는 현재 room/match 상태에 맞는 leave를 한 번 보낸다.
- 연결된 이탈은 기존 leave result로 완료를 확인한다. disconnect 중 이탈은 in-memory intent를 1개로 제한하고 reconnect 시 leave를 먼저 처리해 off-route 재가입과 ghost room/match를 만들지 않는다.
- `style.css`와 `tetris.css`의 전역 `body` 규칙을 동시에 활성화하지 않는다. 현재 route에 필요한 기존 stylesheet만 활성화하고 전환 중 잘못된 layout이나 theme flash가 없어야 한다.
- Goal 7의 incoming garbage, PVE badge와 사용자 소유 overlay live-region 계약을 유지한다.

## 예상 영향 파일

- `vite.config.mjs`
- `src/server/init.js`
- `src/client/pages/index.html`
- `src/client/pages/index.tsx`
- `src/client/pages/multiLobby.tsx`
- `src/client/pages/tetrisSingle.tsx`
- `src/client/pages/tetrisMulti.tsx`
- `src/client/net/roomClient.js`
- 신규 page-local SPA entry 또는 navigation module
- SPA route/lifecycle 관련 E2E와 기존 navigation helper
- `package.json`의 관련 test script
- `AGENTS.md`, `PLAN.md`와 Goal 7A 실행 기록

구현 전 실제 import graph를 확인하고 이 목록 밖 변경이 필요하면 범위를 임의로 확장하지 않고 보고한다.

## 완료 기준

- production build에 하나의 HTML application entry와 하나의 React root만 존재한다.
- root alias와 승인된 네 기존 page URL의 direct load, refresh와 internal navigation이 같은 화면을 연다.
- 뒤로 가기와 앞으로 가기가 document reload 없이 올바른 route를 mount하고 이전 route를 완전히 정리한다.
- index와 single을 최초 진입했을 때 Socket 연결을 만들지 않는다.
- lobby → PVP/PVE game → lobby/home 흐름에서 join/leave와 handler가 중복되지 않는다.
- disconnect 중 lobby/game 이탈 뒤 reconnect해도 pending leave가 한 번만 처리되고 off-route join/sync가 재생되지 않는다.
- single/multiplayer 재진입 뒤 keyboard, timer, animation과 display subscription이 한 세트만 존재한다.
- PVP 두 context, PVE, reconnect, rollback/correction, game over와 lobby restart가 유지된다.
- route별 CSS, title, theme, sound와 accessibility 계약이 유지된다.
- token과 private session 정보가 URL, history state, DOM, console과 public payload에 노출되지 않는다.
- 알 수 없는 경로, TypeScript source와 production source map 요청은 404를 유지한다.
- dependency와 lockfile 변경 없이 fast/full gate가 통과한다.

## 자동 검증

- `git diff --check`
- `bash scripts/verify.sh`
- Vite development React/SPA lifecycle Playwright
- production 전체 `npm run test:e2e`
- root alias와 기존 네 page URL의 direct load·refresh 및 History API back/forward E2E
- index↔single 반복 진입의 runtime·keyboard·timer 단일성 E2E
- lobby↔PVP/PVE game의 join/input/leave 단일성 E2E
- disconnect 중 route 이탈의 bounded leave replay, result와 ghost room/match 방지 E2E
- reconnect, duplicate token, stale callback과 BFCache 회귀 E2E
- production HTTP smoke에서 page allowlist는 HTML, unknown asset·`.tsx`·`.map`은 404

## 수동 검증

- 주소창에서 `/`와 기존 네 page URL을 직접 열고 새로고침한다.
- home, lobby, single과 multiplayer 사이에서 브라우저 뒤로/앞으로 이동한다.
- 두 독립 browser context에서 PVP create → join → start → play → finish → lobby를 확인한다.
- PVE 시작, AI descent, game over와 lobby 복귀를 확인한다.
- route 전환 중 theme flash, 잘못된 stylesheet, 중복 BGM과 console/page error가 없는지 확인한다.

## 보안·데이터 검토

- SPA route와 `history.state`를 인증·인가 근거로 신뢰하지 않는다.
- 기존 Zod boundary validation과 server-side player/socket ownership 검사를 유지한다.
- 내부 navigation이 token rotation, replay protection과 disconnect grace 정책을 우회하지 않게 한다.
- gameplay, placement log, JSONL dataset, model artifact와 PostgreSQL 계획에는 데이터 변화가 없다.

## Rollback

SPA shell, page component/navigation, server/build fallback과 test/document commit을 목적별로 분리한다. 역순 revert로 Goal 7의 four-entry MPA와 full document navigation으로 복귀할 수 있어야 하며 protocol 또는 데이터 rollback은 만들지 않는다.

## Merge Gate

Goal 7A는 보류 상태이며 Goal 8을 막지 않는다. 재개 조건과 route/lifecycle/full gameplay gate가 모두 통과하고 사용자가 다시 승인하기 전에는 push, PR, main merge와 기존 SPA 브랜치 삭제를 수행하지 않는다.
