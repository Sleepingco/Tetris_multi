# 제품 사용성 검토 대응 패치 계획

- 작성일: 2026-10-25
- 상태: 첫 묶음 B01~B04 로컬 구현·자동 검증 완료, B05/B06 미착수. 실기기·운영 적용은 별도
- 원 조사: 대화에서 사용자가 오전 5:47 수정사항으로 지칭한 제품 관점 검토. 모바일 입력·DAS/ARR·라벨·초대·재경기·결과 요약을 뜻한다.
- 재확인 기준: `main` / `08e8c5a` 위 현재 작업 트리. 원 제품 평가는 `3ac6045` 기준이었으며 앞선 검토에서 `bbf26b7`까지 대조했다.
- 범위: 접속한 사용자가 조작하고 친구와 다음 판까지 이어가는 동선
- 제외: 패키지·표준 라이브러리 대체 조사, 공개 방 목록·자동 매칭·회원/순위 시스템, 새 ML 모델·학습·운영 배포
- 연계: [저장소 감사 계획](../maintenance/repository-audit-patch-plan.md), [기존 화면 배치 계획](buffer-layout-plan.md)

## 1. 현재 사실과 평가의 경계

| 원 지적 | 코드로 확인한 사실 | 계획에 반영하는 방식 |
| --- | --- | --- |
| 모바일에서 플레이 불가 | 입력 adapter는 keydown만 받으며 터치 조작 UI가 없음 | 모바일을 지원하는 서비스의 P1 사용성 결함으로 취급 |
| 이동 중 회전하면 키가 멈춤 | 자체 held state·DAS/ARR가 없고 OS 반복에 의존 | 환경별 정지 현상은 미재현. 일정한 반복 입력을 제품 요구로 고정 |
| Quick Match가 게임 시작 버튼 | 방 밖 카드 제목은 Quick Match, 입장 후에는 Game Start | 자동 매칭 오해를 없애는 문구 수정 |
| 친구 초대가 번거로움 | 코드 복사와 직접 입력만 있음 | 한 번의 링크 진입으로 참가 요청 연결 |
| 재경기 불가능 | 양쪽이 로비로 돌아오면 같은 방에서 다시 시작 가능 | 재경기까지의 페이지 이동 제거 |
| 성취감 부족 | 최종 요약·싱글 최고 기록이 없음 | 먼저 로컬 최고 기록, 이후 서버 기준 경기 요약 |

게임 feel A급·복구 A급·3초 진입·10배 개선·이탈 감소는 이번 계획의 측정된 결론으로 쓰지 않는다. 실기기 플레이와 운영 지표가 필요하다. 40행 규칙에서 기존 V4는 호환되지 않아 명시적 휴리스틱 fallback이 있으므로 언제나 모방 AI가 실행된다고 안내하지 않는다.

## 2. 패치 대응표와 순서

| 패치 | 제품 항목 | 우선순위 | 선행·분리 조건 |
| --- | --- | --- | --- |
| B01 | 모바일 터치 컨트롤 | P1, 모바일 지원 기준 | B02의 반복 처리 재사용, 기존 배치 계획과 함께 화면 검증 |
| B02 | 키보드 DAS/ARR | P2 | 서버 입력 한도·queue 계약 유지 |
| B03 | Quick Match 문구 | P2, 작은 독립 수정 | 없음 |
| B04 | 초대 링크 | P2 | 세션 준비·방 상태·기존 room 복구 우선순위 고정 |
| B05 | 인게임 재경기 | P2 | 감사 A03·A02, 마지막 로그와 A06 실패 처리 확인 |
| B06 | 최고 기록·경기 요약 | P3 | B06a 싱글 먼저, B06b authoritative 통계는 별도 패치 |

B03은 독립적으로 먼저 할 수 있다. 입력 변경은 B02 → B01 순서로 적용해 키보드·터치에 반복 timer를 각각 만들지 않는다. B04도 독립 가능하다. B05는 마지막 로그·중복 종료·새 gameId를 검증한 뒤, B06은 실제 결과 원천이 준비된 범위부터 진행한다.

## 3. 패치별 변경·완료 기준

### B01. 모바일에서 실제 플레이 가능한 컨트롤

- 영향: [input adapter](../../src/client/game/runtime/input.ts), [싱글](../../src/client/pages/tetrisSingle.tsx), [멀티](../../src/client/pages/tetrisMulti.tsx), [게임 CSS](../../src/client/styles/tetris.css), 작은 공용 컨트롤 component. 두 실제 caller가 있으므로 표시 component만 공유한다.
- 동작: 좌·우·내리기·시계 회전·반시계 회전·하드드롭·홀드의 **7개** 버튼을 제공한다. 모든 입력은 기존 `enqueueInput`으로 보내고 서버 판정·prediction을 우회하지 않는다. 멀티에서는 내 보드만 조작한다.
- 표시: viewport 폭만으로 기기를 판단하지 않는다. 사용자 피드백에 따라 주 입력이 터치인 `(pointer: coarse)` 환경에서만 조작 UI를 렌더링한다. PC에는 수동 표시 버튼도 만들지 않는다. 주 입력 장치가 바뀌면 표시 조건을 갱신하고 기존 held 상태를 해제한다.
- 입력: 좌·우·내리기는 B02 반복기를 사용하고 나머지는 한 번씩 실행한다. Pointer ID와 capture로 다중 터치를 구분한다. `pointerup/cancel/lostpointercapture`, blur·hidden·pagehide·unmount 때 held state를 해제한다. 방향키 유지와 회전을 동시에 누를 수 있어야 한다.
- 화면·접근성: 버튼 이름·focus·누름 상태, safe-area와 충분한 터치 영역을 제공한다. touch-action 제한은 컨트롤 영역에 한정한다. [기존 배치 계획](buffer-layout-plan.md)의 300×720 Canvas·40행 판정·NEXT 4개·색상·연출 간격을 보존한다.
- 검증: 새 작은 입력 경계 테스트와 touch context E2E를 추가한다. 390×844 세로와 가로 화면에서 버튼 7개, 보드·종료 UI 접근, 좌 이동+회전, 취소 뒤 정지, 싱글/PVP/PVE를 확인한다. 터치에 따른 음향 unlock도 기존 사용자 상호작용 경로로 연결한다.
- 완료: 물리 키보드 없이 시작→이동·회전·홀드→하드드롭→종료→재시작이 가능하다. Chromium touch 에뮬레이션과 실제 Android Chrome/iOS Safari 확인 결과를 구분하며 실기기 미검증은 남긴다.
- 복구: 컨트롤 component·page 연결·CSS만 되돌리고, 이미 검증된 B02 키보드 동작은 별도 유지 가능하게 한다.

### B02. OS 설정과 독립된 반복 입력

- 영향: `input.ts`, 두 page의 attach/cleanup, [멀티 session](../../src/client/game/entry/multiplayerGameSession.ts)의 입력 연결, [runtime queue](../../src/client/game/runtime/tetris.ts), [제한 서비스](../../src/server/services/socketRateLimitService.ts). queue·제한은 먼저 읽고 변경이 꼭 필요한 때만 수정한다.
- 동작: keydown 즉시 한 번 이동하고 held state로 반복한다. 좌우 이동은 초기 DAS 130ms·ARR 30ms에서 사용자 조작감 피드백 후 DAS 180ms·ARR 60ms로 조정한다. 아래 이동은 별도 cadence를 정해 동시 유지 때도 서버의 player당 60 input/초를 정상적으로 넘기지 않게 한다. OS `event.repeat`는 새 반복 입력의 원천으로 쓰지 않는다.
- 정책: 마지막에 누른 좌우 방향을 우선하고, 해제하면 아직 눌린 반대 방향으로 전환한다. 회전·홀드·하드드롭은 한 번씩 실행한다. 입력창에 쓰는 키를 가로채지 않고 blur/hidden/unmount/경기 종료에 반복을 멈춘다. timer 지연 뒤 과거 반복을 한꺼번에 재생하지 않는다.
- 최소 구조: 작은 held/repeat 로직을 기존 입력 경계에 두고 B01이 같은 press/release를 사용한다. 새 입력 framework·설정 화면·사용자별 DAS 저장은 추가하지 않는다. React가 gameplay 상태를 소유하지 않는다.
- 검증: fake clock으로 즉시 1회·대기 전 무반복·ARR 반복·회전 중 좌우 유지·반대 키 해제·blur·숨김·cleanup을 확인한다. 재부착·StrictMode에서 timer가 늘지 않고 runtime의 tick당 queue 상한과 서버 입력 제한을 넘기는 backlog가 없어야 한다.
- 완료: 입력 단위 테스트와 싱글·멀티 브라우저 회귀를 통과한다. Windows/macOS의 실제 조작 확인은 별도로 기록하고 OS별 키 씹힘을 확인 없이 해결했다고 쓰지 않는다.
- 복구: adapter 변경을 되돌린다. B01이 이미 적용됐다면 공통 press/release 계약을 함께 맞춰 독립 timer가 남지 않게 한다.

### B03. 자동 매칭으로 오해하는 라벨 수정

- 영향: [multiLobby.tsx](../../src/client/pages/multiLobby.tsx)의 기본 카드 제목·설명과 [로비 E2E](../../e2e/multiplayerLobby.spec.js)의 관련 기대값.
- 변경: 방 밖 기본 제목을 `친구와 대전`처럼 실제 기능으로 바꾸고 `방을 만들거나 초대 코드로 참가하세요`로 안내한다. 입장 후의 시작·방장 대기·상대 복귀·서버 연결 상태는 기존 상태 분기에서 표현한다.
- 검증: 방 없음·연결 중·방장·참가자·finished·재동기화·요청 중 상태에서 문구와 enabled 상태가 기존 권한을 정확히 설명한다.
- 완료·복구: 자동 매칭이 있는 것처럼 안내하지 않는다. 문구와 기대값 변경만 독립적으로 되돌릴 수 있다.

### B04. 한 번의 링크 진입으로 친구 방 참가

- 영향: 로비의 copy·session ready·saved room 복구·join 경로, [roomClient](../../src/client/net/roomClient.ts)의 기존 요청 함수, [공유 roomId 계약](../../src/shared/socketContracts.mjs), [로비/session 테스트](../../test/testRoomClient.js), 로비 E2E. 새 server join 권한은 만들지 않는다.
- URL: 현재 origin과 실제 로비 경로로 `?join=방코드`를 만든다. 운영 주소를 코드에 고정하지 않는다. 현재 운영 설정은 `tetra-arena.duckdns.org`이며 원 평가의 하이픈 없는 주소를 복사하지 않는다. 기존 코드 표시·수동 참가는 유지하고 복사 버튼의 목적을 `초대 링크 복사`로 명시한다.
- 순서: query 값을 기존 roomId schema로 확인 → `session:ready` 대기 → 현재 membership 확인 → 기존 `requestJoinRoom` 호출 → 성공 시 실제 room 상태 표시다. PVE/게임 시작은 자동 실행하지 않는다.
- 상태 충돌: 이미 같은 방이면 sync만 한다. 다른 방 membership이 있으면 자동 퇴장시키지 않고 사용자가 기존 방 복귀 또는 나간 뒤 초대 참가를 선택하게 한다. 요청 중·재연결·StrictMode에서 같은 초대를 중복 전송하지 않는다.
- 실패: 존재하지 않음·정원 초과·진행 중·연결 실패·clipboard 실패를 현재 로비에 설명한다. 닉네임·playerId·token은 URL에 넣지 않는다. 처리 완료 시 query를 정리해 새로고침의 반복 참가를 막는다.
- 검증: 두 독립 browser context의 생성→링크 복사→초대 참가, invalid/missing/duplicate query, 늦은 세션 준비, 같은/다른 방 membership, 실패 뒤 수동 재시도·새로고침을 확인한다.
- 완료·복구: 첫 방문자는 방 코드를 다시 입력하지 않고 대기 방에 들어온다. 기존 수동 코드 경로로 돌아갈 수 있으며 URL 파라미터를 쓰지 않는 이전 client와 기존 server는 계속 호환된다.

### B05. 결과 화면에서 양쪽 동의 후 재경기

- 영향: [roomService](../../src/server/services/roomService.ts), [matchService](../../src/server/services/matchService.ts), [Socket handler](../../src/server/sockets/multiplayerHandlers.ts), [ticker](../../src/server/services/authoritativeTickerService.ts), [종료 조립](../../src/server/services/authoritativeMatchFinish.ts), 공유 contract·타입, roomClient, 멀티 page/session.
- 상태: finished room에 한정해 server가 player별 재경기 동의를 가진다. 요청은 인증된 socket 소유권과 끝난 gameId를 확인한다. PVP는 두 사람 동의, PVE는 Human 동의로 시작하며 AI가 별도 UI 요청을 보내는 것으로 만들지 않는다.
- 재사용: 현재 로비 복귀의 waiting 전환과 기존 start/countdown/join 조립을 재사용한다. 두 start 흐름이 생기면 실제로 같은 시작 절차만 작은 공통 함수로 추출한다. 클라이언트가 finished를 임의로 playing으로 바꾸지 않는다.
- 수명: 새 gameId와 새 match/bag/score/combo/B2B/input sequence·pending 로그·effect ID·timer를 준비한다. 최종 로그 flush/실패 보고를 종료 계약에 맞춰 마친 뒤 이전 session을 정리한다. 과거 match receipt는 기존 TTL·한도로 late log를 처리하되 새 경기 로그와 섞이지 않게 한다.
- 예외: 상대가 나가거나 로비로 복귀하면 동의를 정리하고 현재 대기 상태를 안내한다. disconnect/reconnect에서 기존 session grace와 snapshot을 사용하며 자동 재경기는 하지 않는다. 오래된 결과 화면·중복 요청은 새 경기를 두 번 만들 수 없어야 한다.
- 검증: [방 테스트](../../test/testRoomService.js), [멀티 Socket 테스트](../../test/testMultiplayerSocket.js), session·ticker·contract 테스트와 작은 재경기 E2E를 연결한다. PVP 동의 1/2명·PVE 1명·중복·stale gameId·상대 퇴장·재연결·마지막 로그 지연·다음 경기 초기값을 확인한다.
- 완료: 페이지를 떠나지 않고 결과→동의→countdown→새 게임이 이어진다. 이전 game_over/game_start가 각각 한 번이며 상태와 저장 event가 섞이지 않는다.
- 위험·복구: 버튼만 추가하는 작업으로 취급하지 않는다. 공유 계약은 server/client 배포 조합을 검증한다. 이전 client의 로비 복귀 경로를 유지하고 rollback 시 양쪽을 호환되는 artifact로 되돌린다.

### B06. 최종 결과와 개인 기록

이 항목은 실제 리텐션 개선이 입증된 버그 수정이 아니라 성취감 개선이다. 아래 두 패치로 나눈다.

**B06a — 싱글 최고 점수**

- 영향: 싱글 page와 기존 display bridge의 gameOver·score, [싱글 lifecycle E2E](../../e2e/singleReactLifecycle.spec.js).
- 변경: 경기 종료 시 유효한 점수로 최고 기록만 갱신하고 결과에 이번 점수·최고 기록을 표시한다. localStorage 형식 오류·차단·용량 오류는 게임을 중단시키지 않는다. runtime에 두 번째 score 원천을 만들지 않는다.
- 검증·완료: 낮은 점수는 최고값을 낮추지 않고 재방문·재시작에서도 유지된다. 이것은 해당 브라우저의 개인 기록이며 서버 검증 순위로 표시하지 않는다.

**B06b — 멀티 경기 요약**

- 영향: authoritative match의 작은 통계, placement commit·종료 payload와 schema, 멀티 결과 화면·재연결 경로.
- 변경: 처음에는 보낸 공격 줄 수·최대 콤보·T-Spin 횟수만 표시한다. 취소 전 공격인지 실제 전송량인지 정의하고 실제 전송량을 합산한다. T-Spin은 mini/full 구분과 합산 기준을 명시한다.
- 원천: server commit 결과에서 pieceIndex별 한 번만 집계한다. client animation·전달된 event 개수·DB await·전체 placement history를 원천으로 쓰지 않는다. gameId에 속한 제한된 scalar를 보관해 결과 화면 재연결에서도 같은 요약을 제공한다.
- 검증·완료: input/gravity/AI 경로의 같은 결과, 공격 상쇄, 중복·late snapshot, 종료 중복, 결과 재접속에서 합계가 같다. 서버가 확정한 종료 결과와 함께 보여야 하며 통계 저장용 새 테이블은 만들지 않는다.

복구는 최고 기록 표시와 멀티 요약을 별도로 되돌린다. 이미 저장한 개인 기록·DB event는 삭제하지 않는다.

## 4. 구현 검증·수락 기준

```bash
nvm use
bash scripts/verify.sh
npm run test:e2e -- e2e/multiplayerLobby.spec.js e2e/singleReactLifecycle.spec.js e2e/multiplayerReactLifecycle.spec.js e2e/multiplayerRollback.spec.js e2e/multiplayerSession.spec.js e2e/multiplayerPve.spec.js
```

- 위 명령은 구현 단계의 계획이며 이번 문서 작성에서 실행한 결과가 아니다. B01·B02·B05에는 새 동작을 검증하는 작은 테스트를 해당 경계에 추가한다.
- [현재 Playwright 설정](../../playwright.config.cjs)은 Desktop Chromium 한 project다. B01은 명시적 touch context를 추가하고, 실제 모바일 확인을 에뮬레이션 통과로 대체하지 않는다.
- [배치 계획](buffer-layout-plan.md)과 CSS·JSX가 겹치면 같은 파일의 후속 기준을 재측정한다. 모바일의 게임 화면·하단 컨트롤·성과 배너·종료 버튼이 겹치거나 잘리지 않아야 한다.
- 입력을 바꾸면 처리 시도 간격·반복 입력의 분포가 달라진다. 적용 commit/build·날짜와 수집 조건 변경을 [Human 계약](../ai-ml/contracts/human-action-dataset.md)에 기록하고 이전 데이터와 무표식으로 섞지 않는다. 새 수집·dataset 생성·재학습은 자동 시작하지 않는다.
- 제품 결과는 모바일 조작 가능, 초대 성공, 한 번의 재경기 성공 같은 관찰 가능한 기준으로 보고한다. A급·N배 개선·이탈률 감소는 측정 전 완료 주장으로 사용하지 않는다.

## 5. 변경·복구 단위와 현재 한계

B03 → B02 → B01 → B04 → B05 → B06a → B06b를 권장 기본 순서로 삼되 독립 패치는 먼저 적용할 수 있다. 각 단위에서 관련 테스트와 필수 verify를 통과하고 PLAN·change-log에 실제 결과를 기록한다. 배포가 필요한 계약 변경은 운영 runbook을 따른다.

원 계획 작성 시점에는 파일·caller·기존 테스트만 확인했고 기능 구현·브라우저/DB 테스트는 실행하지 않았다. 이후 첫 묶음의 구현·검증 결과는 아래 6절에서 구분한다. 실기기·운영 배포·full ML 실행은 별도다.

## 6. 첫 묶음 실행 결과 (2026-11-03)

기준 parent `f1c71ef9`의 사용자 변경을 보존하고 Coder·QA·Reviewer의 별도 작업 사본에서 구현·리뷰·검증했다. 각 사본은 파일 작업을 분리한 것이며 OS 보안 샌드박스를 별도로 구성한 것은 아니다. 검증한 파일만 SHA256 일치를 확인해 main 작업 공간에 반영했다.

- [x] B03: 방 밖 `친구와 대전` 안내, 실제 수동 방 생성/참가 설명.
- [x] B02: 공통 held 입력기, DAS130/ARR30·soft60ms·합산55회/초, 마지막 좌우 우선, focus/blur/hidden/종료/cleanup 해제.
- [x] B01: 7개 버튼·native 다중 터치·capture 취소·수동 표시·safe area·키보드 접근. 싱글·PVE·PVP guest 세로/가로 보드/버튼 좌표와 기존 HUD·재시작 검증.
- [x] B04: 현재 origin 초대 링크, 단일 roomId 검증, 늦은 session·membership sync·중복/오류·명시적 다른 방 선택·query 정리·clipboard 실패 안내.
- [x] Reviewer의 구조·예외·모바일 배치 리뷰 승인.
- [x] [Todo 검증 스크립트](../../scripts/verify-product-first-batch.sh) 실행: 타입/빌드/artifact 통과, Node 801 pass·0 fail·기존 조건부 1 skip, Chromium 전체 78/78 pass. 새 입력 unit7개·보드 수렴 회귀unit1개와 제품 E2E13개 포함.

초기 HTTP 검사의 localhost EPERM은 환경 권한 문제로 구분해 허용된 실행으로 검증했다. 새 window listener의 기존 Node fixture 보완, landscape 배치, guest 반전 grid, NEXT/HOLD sidebar 상단 여백을 실패 로그·좌표 측정으로 수정했다. 기존 assertion을 제거하거나 사용자 Notebook 출력을 지우지 않았다.

2026-11-04 최종 재검증에서 기존 reconnect E2E helper의 관찰 경쟁을 확인했다. 양쪽 RGB 수렴 확인 뒤 소스 Canvas를 다시 읽어 하드드롭 합성의 RGB 반올림 차이를 기준값으로 저장할 수 있었다. 검증된 pair 값을 그대로 반환하도록 수정하고 회귀 unit 1개·실제 reconnect 3회 반복을 통과했다. 엄격한 RGB 비교·수렴 조건·timeout은 유지했다. 후속 main E2E의 로비·홈404는 동시 dist 재빌드 시각과 일치했다. main의 빌드/테스트 입력217개와 SHA256이 같은 독립 사본에서 같은 Todo 스크립트를 직렬 실행해 Exit0으로 완료했다. 검증 후 원본 main217개도 hash 일치를 재확인했다.

자동 검사 성공은 Android/iOS 하드웨어 검증을 대신하지 않는다. 실기기·Windows/macOS 실제 조작·운영 배포·DB/ML 별도 전체 gate는 미검증이며 B05/B06은 이 묶음에 포함하지 않는다. 모바일 portrait는 내 보드→컨트롤→상대 보드 순으로 표시하고 상대 정보는 스크롤로 접근한다. 복구는 입력기와 연결된 page/session/컨트롤/CSS를 함께 되돌리며 초대 변경은 독립 복구할 수 있다. 데이터 삭제·수집·재학습은 수행하지 않는다.

## 7. 조작감·PC 터치 UI 피드백 (2026-11-04)

- 키 해제 뒤 미끄러지는 체감에 대한 완화로 DAS180ms·ARR60ms를 적용했다. 초기130/30ms 설정은 너무 빠른 반복으로 체감될 수 있었다. Queue에 들어간 입력은 다음16ms 단위 runtime tick에서 처리하며 첫 탭을 잃지 않도록 queue 전체를 삭제하지 않는다. 지속 이동 자체는 정상 싱글·멀티 테스트에서 미재현이므로 사용자 환경에서의 원인 해결로 단정하지 않는다.
- 사용자 요청에 따라 PC 수동 표시 fallback을 제거한다. 주 입력이 터치인 `(pointer: coarse)` 환경에만 조작 UI가 존재한다. PC의 창을 좁혀도 조작 버튼이나 표시 토글을 만들지 않는다.
- 필수 verify: Node802 pass·0 fail·기존1 skip, 타입/빌드/artifact 통과. Chromium 전체81/81 pass. 짧은 누름·keyup 후 반복 생성 중단, 싱글/멀티에서 잔여 tick 이후 가로 위치 유지, PC 일반/좁은 창 미표시와 모바일7개 버튼을 확인했다.
- 실제 키보드/모바일 하드웨어·운영 배포·사용자 체감 개선은 별도 확인이다. 로컬 조정으로 남기고 새 수집·dataset 생성·재학습은 하지 않는다.

## 8. 모바일 게임 헤더 아이콘 (2026-11-04)

사용자 요청에 따라 primary coarse pointer에서만 사운드·테마·홈을 우측 한 줄의44px 버튼으로 표시한다. CSS의22px SVG mask가 상태에 따라 변하고 기존 DOM 문구는 접근성 이름으로 남긴다. PC 텍스트·사운드 정책·게임 종료/퇴장 계약은 유지한다. 새 component/state/package는 만들지 않는다.

기본 verify는 Node802 pass·기존1 skip·0 fail과 타입/빌드/artifact 통과다. 모바일 싱글/PVE44px 좌표·접근성 이름·사운드/테마 실제 토글·CSP·기존 lifecycle을 포함한 Chromium22/22와 최종 헤더 캡처2/2를 통과했다. 실제 iOS Safari/Android Chrome 기기는 미검증이며 운영 배포는 하지 않았다.

## 9. 모바일 UI 피드백 5종 실행 (2026-11-04)

- [x] 엄지 배치: `← ↓ → HOLD / DROP(2칸) ↺ ↻`. 회전 버튼을 인접시키고 DROP을 강조한다. 기존 pointer별 capture/해제와 입력 연결은 유지한다.
- [x] 상대 시야: 멀티 세로 터치 화면 상단의 요약은 기존 상대 display handle을 구독한다. 닉네임·점수·줄·상대가 받을 대기 공격·게임 상태를 표시하고 별도의 경기 상태나 DOM clone을 만들지 않는다. 전체 상대 보드는 스크롤 영역에 유지한다.
- [x] 입력창: 터치 홈/로비의 두 입력 스타일 모두 `max(16px, 1rem)`으로 지정한다. PC·사용자 확대 기능은 유지한다.
- [x] 길게 누르기/시인성: 컨트롤/버튼에 WebKit 선택·콜아웃 방지, 기호1.2rem·DROP 강조색을 적용한다. 채팅 등 다른 영역의 텍스트 선택은 막지 않는다.
- [x] 안내/채팅: 터치 싱글의 키보드 안내를 숨기고768px 이하 로비 채팅의 바깥 높이를 dvh 기준 최대260px로 제한한다. content-box302px 문제를 border-box로 수정했다.
- [x] 검증: 필수 verify 타입/빌드/artifact·Node802 pass·0 fail·기존1 skip, 최종 타입 검사, 전체 Chromium84/84 pass, Reviewer 승인.390×844/844×390 native touch와 PVP host/guest의 상대 요약 대상·실제 점수 갱신, 제어부 배치·폰트/채팅 기능을 확인했다.

실제 iOS Safari의 자동 줌/콜아웃 및 Android의 주소창·가상 키보드 동작은 Chromium emulation으로 입증하지 않는다. dvh만으로 가상 키보드 가림이 모두 해결됐다고 주장하지 않는다. 실기기 파지감과 배포는 미검증이며 새 수집/dataset 생성/학습은 수행하지 않았다. 이전 SVG 헤더·DAS180/ARR60 조정과 PC 터치 UI 숨김은 보존했다.

## 10. 네 화면 로고·모바일 헤더 통일 (2026-11-04)

메인·로비·싱글·멀티 header는 BrandLogo에서 같은 기존 골드T/favicon SVG와 Tetra Arena 표기를 읽는다. 작은 모드 문구만 다르고 로고에 페이지 이동은 추가하지 않는다. 네 HTML은 공통 page-header.css를 연결하며 사운드→테마→홈의 모바일44px SVG 버튼과 상태 표현을 공유한다. PC 텍스트 버튼·기존 접근성 이름·room leave 흐름은 유지한다.

필수 verify는 타입/빌드/artifact·Node802 pass·0 fail·기존1 skip이다. Chromium86/86 pass와 Reviewer 승인을 확인했다. PC/모바일 네 화면의 실제 동일 로고 로딩·크기·버튼 정렬/숨긴 문구·실제 토글과 기존 전체 회귀를 검증했다. 실제 모바일 기기·운영 배포는 미검증이다.
