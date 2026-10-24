# 버퍼 존 적용 후 게임·멀티 로비 배치 개선 계획

- 조사일: 2026-10-24
- 상태: 조사·계획 작성 완료, 구현 미착수
- 기준: `main` / `bbf26b7` 위 현재 작업 트리. 기존 사용자 변경을 보존한다.
- 요구: 색상은 유지하고 싱글·멀티 게임의 떠 보이는 배치와 로비의 정보 순서를 개선한다.
- 원칙: Ponytail full. 기존 CSS와 JSX의 작은 변경으로 해결하고 새 패키지·공통 UI 계층·크기 측정 hook을 추가하지 않는다.

## 1. 조사 결과

### 확인한 코드와 연결 경계

| 대상 | 실제 경로·역할 | 계획에 주는 제약 |
| --- | --- | --- |
| 게임 배치 | [tetris.css](../../src/client/styles/tetris.css) | 싱글·멀티 공용. 300×720 표시, 여러 겹 padding과 breakpoint를 함께 확인해야 한다. |
| 싱글 shell | [tetrisSingle.tsx](../../src/client/pages/tetrisSingle.tsx) | NEXT 왼쪽, HOLD·조작법 오른쪽. HUD portal의 ref와 runtime lifecycle을 유지한다. |
| 멀티 shell·연출 | [tetrisMulti.tsx](../../src/client/pages/tetrisMulti.tsx) | HOLD·NEXT는 바깥쪽, 공격 대기 바도 보드 바깥쪽. 성과 문구와 공격 궤적이 DOM 크기를 읽는다. |
| 로비 배치 | [style.css](../../src/client/styles/style.css) | 홈과 공유한다. 로비 수정은 `#multiLobbyRoot` 안으로 한정한다. |
| 로비 상태·조작 | [multiLobby.tsx](../../src/client/pages/multiLobby.tsx) | `join/create/pve/room`, 연결·요청 중·재동기화와 방장/참가자 상태를 보존한다. |
| 표시 좌표 | [tetrisRender.ts](../../src/client/game/render/tetrisRender.ts), [config.ts](../../src/client/game/state/config.ts) | 내부 40행, 가시 20행, 상단 노출 4행. 이번에는 변경하지 않는다. |
| 실행·빌드 | [Vite 설정](../../vite.config.mjs), [Playwright 설정](../../playwright.config.cjs), [검증 스크립트](../../scripts/verify.sh) | 기존 독립 page와 production 검증 경로를 사용한다. 설정·export 변경은 필요 없다. |

- Canvas 내부 크기는 300×720이며 가시 필드는 300×600이다. CSS의 `--board-visible-top: 100% / 6`이 상단 4행을 분리한다.
- 싱글의 NEXT와 오른쪽 패널은 Canvas의 열린 상단보다도 16px 위에서 시작한다. 300px 보드 기준 가시 필드 윗선과 약 136px 차이가 난다.
- 멀티는 페이지 헤더·플레이어 헤더·40px 성과 알림 공간·여백이 쌓인다. CSS의 80~96px grid gap은 실제 보드 사이 거리 전체가 아니다.
- 멀티 공격 대기 바는 현재 Canvas 전체 높이를 따라 늘어난다. 가시 20행의 위·아래 기준과 일치하지 않는다.
- 로비는 DOM상 채팅이 먼저이며 `1fr 340px`의 넓은 왼쪽을 차지한다. `height: 520px`인 채팅은 content-box의 padding·border까지 포함하면 실제 높이가 562px다.
- 시안의 NEXT 5개와 싱글 좌우 위치는 구현 요구로 채택하지 않는다. 실제 NEXT 4개와 기존 좌우 배치를 유지하면 queue·preview·여러 테스트를 불필요하게 바꾸지 않아도 된다.

### 로컬 브라우저 실측

Node 24.18.0·설치된 Chromium으로 현재 client source를 Vite에서 열었다. 별도 로컬 compiled backend와 임시 JSONL을 사용해 로비 진입·PVE 생성·대전 화면까지 확인했다. 운영 DB에는 접속하지 않았다. 아래 좌표는 해당 측정 시점의 CSS pixel이며 소수점은 반올림했다.

| 화면·viewport | 확인한 현재 값 | 의미 |
| --- | --- | --- |
| 싱글 1600×900 | Canvas y=136, 300×720, 하단 y=856 | 높은 화면에서는 보드가 들어가지만 주변 패널 기준선이 다르다. |
| 싱글 1280×720 | Canvas 하단 y=856, 문서 높이 872 | 하단을 보려면 세로 스크롤이 필요하다. |
| 멀티 1600×900 | Canvas 약 302×725, 하단 y=1028, 보드 사이 262px | 너비 중심 크기 결정과 상단 누적 공간 때문에 큰 화면에서도 넘친다. |
| 멀티 1280×720 | Canvas 약 282×677, 하단 y=980, 보드 사이 162px | 간격 축소만으로 세로 넘침을 해결할 수 없다. |
| 멀티 1100×800 | 두 보드가 위아래, 문서 높이 2017 | 기존 1100px 이하 세로 전환을 이번에 억지로 없애지 않는다. |
| 로비 390×844 | 채팅 y=225~787, 방 조작 y=811부터 | 주요 조작이 채팅 뒤로 밀린다. |
| 로비 1280×720 | 방 조작 하단 y=738, 문서 높이 782 | 프로필·행동 카드의 간격·padding을 줄일 여지가 있다. |

추가로 390×844 싱글과 PVE 선택을 펼친 로비를 측정했다. 싱글 보드는 보이지만 조작법이 문서 높이를 늘리고, PVE 펼침은 로비 문서 높이를 1706px까지 늘린다. 펼친 설정까지 무조건 한 화면에 압축하지 않는다. PVE 스크린샷은 클릭 후 자동 스크롤 상태여서 viewport y를 정적 배치 근거로 사용하지 않는다.

## 2. 최소 변경안

### A. 게임: 보드 크기와 가시 필드 기준선을 맞춘다

1. `tetris.css`에서 페이지 padding·헤더 간격·플레이어 카드 안쪽 여백을 줄인다. 효과가 있는 기존 선언을 수정하고 파일 끝에 중복 override를 쌓지 않는다.
2. 보드 표시 너비를 가로 공간과 화면 높이 양쪽으로 제한한다. 내부 Canvas는 300×720 그대로 두고 CSS 표시만 5:12 비율로 축소한다. 기본 상한은 300px로 유지한다.
3. 기존 Grid column과 Canvas가 같은 표시 너비를 사용하게 한다. 보드 너비와 상단 높이(너비의 4/10)가 필요한 곳에만 CSS 변수를 두며, JS resize listener나 ResizeObserver는 추가하지 않는다.
4. 데스크톱의 NEXT·HOLD 패널 윗선과 공격 meter 본체의 위·아래를 가시 20행에 맞춘다. 상단 4행과 공격량 label 공간을 구분하며 meter는 20칸·실제 수신량·초과량·ARIA를 그대로 유지한다.
5. 싱글 조작법은 기존 목록을 네이티브 `details/summary`로 접어 초기 높이를 줄인다. NEXT 왼쪽·HOLD 오른쪽을 유지하고 좁은 화면에서 기존 오른쪽 패널이 아래로 내려가는 흐름을 보존한다. 아래로 내려간 패널에는 상단 4행 보정 여백을 적용하지 않는다.
6. 멀티는 카드·보드 padding과 grid gap을 함께 줄인다. 성과 알림 공간은 중복 높이를 줄이되 `role=status`와 기존 `.combat-feedback` 연결은 유지한다.

1280×720에서는 보드 표시 너비 약 200~220px, 1600×900에서는 약 260~280px를 시작값으로 검토한다. 이는 확정 상수가 아니라 실측 후 조정할 범위다. 최종값은 패널 내용·헤더 높이와 함께 검증하며, 보드만 줄이고 preview가 더 길게 남는 결과를 허용하지 않는다. 필요하면 기존 preview 간격과 padding도 줄인다.

멀티의 `showAchievement()`는 보드가 나란한지 판단한 후 `gap - 16`으로 문구 폭을 정한다. 따라서 **간격 숫자만 먼저 줄이지 않는다.** 기존 연출로 읽을 수 있고 두 문구·보드·meter가 겹치지 않는 간격을 선택한다. 이 조건을 만족하면 연출 JS는 수정하지 않는다. 목표 간격에서 불가능한 경우에만 기존 상단 표시 분기를 재사용하는 최소 보완과 해당 회귀 검사를 함께 한다. 새 연출 체계는 만들지 않는다.

### B. 로비: 기존 방 조작을 먼저 배치한다

1. `multiLobby.tsx`에서 기존 `.action-panel`을 `.chat-panel`보다 먼저 둔다. CSS order만 바꾸지 않아 화면 순서와 Tab·읽기 순서가 같게 한다.
2. 데스크톱은 방 조작을 넓은 왼쪽, 채팅을 좁은 오른쪽에 둔다. 현재 컨테이너 폭과 768px 단일 열 전환을 우선 재사용한다.
3. 프로필은 기존 action panel 첫 항목을 유지하고 크기·간격만 줄인다. 헤더로 옮기기 위한 추가 wrapper는 만들지 않는다.
4. 기존 시작 버튼·설명과 참가/생성/방 상태 영역을 유지한다. 코드 복사·퇴장·재동기화·PVE 정책/난이도·fallback 안내·disabled/hidden 조건·event handler·ID/ref는 그대로다.
5. 채팅은 화면 높이에 맞는 제한 높이와 메시지 내부 스크롤을 사용한다. 부모와 flex 자식의 `min-height`를 확인해 입력줄이 밀리지 않게 한다. 모바일에서는 방 조작 아래에 충분한 높이로 제공한다.
6. 공용 `.container/.header/.btn/.input-box` 전역 규칙이나 색상 토큰을 수정하지 않는다. 필요한 로비 크기·간격 규칙만 root 아래로 제한한다.

시안의 플레이어 두 슬롯, 채팅 탭 전환, 설정 메뉴 통합, 입장 후 카드 전체 재구성은 이번 최소안에서 제외한다. 현재의 인원 수·방장·대기 상태 표현을 보존한다.

## 3. 영향 파일과 검증 연결

| 구분 | 변경 또는 확인할 파일 | 필요한 작업 |
| --- | --- | --- |
| 구현 | `src/client/styles/tetris.css` | 게임 크기·간격·반응형·기준선 수정 |
| 구현 | `src/client/pages/tetrisSingle.tsx` | 기존 조작법을 `details/summary`로 감싸기 |
| 구현 | `src/client/styles/style.css` | root로 한정한 로비 배치·높이 수정 |
| 구현 | `src/client/pages/multiLobby.tsx` | 기존 두 영역의 DOM 순서 변경 |
| 조건부 | `src/client/pages/tetrisMulti.tsx` | CSS로 연출 안전 간격을 확보하지 못할 때만 기존 분기 보완 |
| 검사 | [bufferZone.spec.js](../../e2e/bufferZone.spec.js) | intrinsic 300×720·열린 천장 보존, 표시 비율과 낮은 화면 하단 검사 |
| 검사 | [singleReactLifecycle.spec.js](../../e2e/singleReactLifecycle.spec.js) | NEXT 4개·왼쪽·preview 비겹침 계약 유지, 조작법 keyboard 열기 확인 |
| 검사 | [multiplayerReactLifecycle.spec.js](../../e2e/multiplayerReactLifecycle.spec.js) | 기존 gap >240/>160의 옛 디자인 상수 기대를 새 기준으로 변경, meter·preview·양쪽 보드 하단 확인 |
| 검사 | [multiplayerLobby.spec.js](../../e2e/multiplayerLobby.spec.js) | 모바일 주요 조작 우선·DOM 순서·채팅 입력 도달성과 기존 방 상태 검사 |
| 검사 | [combatAchievements.spec.js](../../e2e/combatAchievements.spec.js) | 기존 연출 fixture로 양쪽 성과 비겹침·모바일 표시·cleanup 유지, 낮은 데스크톱 확인 추가 |
| 재사용 | [PVE 도우미](../../e2e/helpers/pve.js), [멀티 도우미](../../e2e/helpers/multiplayer.js) | 기존 방 생성·경기 시작 경로를 재사용하며 새 helper 계층을 만들지 않음 |
| 기록 | [PLAN.md](../../PLAN.md), [change-log.md](../../change-log.md) | 구현 후 실제 결과·검증·한계 갱신 |

검사는 기존 spec에 필요한 geometry·행동 assertion만 보완한다. 새 대형 screenshot baseline, 별도 layout framework, 규칙 fixture 변경은 필요 없다. `test/testTetrisRender.js`, `test/testTopOutBufferContract.js`와 기존 fixture의 내부 좌표 계약은 그대로 유지한다.

## 4. 실행 순서와 완료 기준

1. 게임 CSS와 싱글 조작법을 작은 변경으로 수정한다. 1600×900·1280×720·390×844에서 중간 확인한다.
2. 멀티 간격을 조정하면서 기존 성과 fixture로 겹침을 확인한다. 1100px 경계의 세로 전환을 함께 확인한다.
3. 로비 DOM 순서와 scoped CSS를 수정한다. 입장 전·PVP 방장/참가자·PVE 선택 펼침·방 입장 후를 확인한다.
4. 관련 기존 spec의 배치 기대를 갱신하고 필수 검증을 실행한다.

완료 조건:

- 라이트·다크의 기존 색상 토큰·블록 색·테마 저장 동작이 유지된다. 두 테마에서 배치만 확인한다.
- 기본 배율 1600×900·1280×720에서 싱글과 가로 멀티의 보드 전체·점수·HOLD·NEXT가 보이고 가로 스크롤이 없다.
- 열린 상단은 보존하며 프레임 시작점은 표시 Canvas 높이의 4/24 위치다. 내부 40행·표시 24행·NEXT 4개는 그대로다.
- 데스크톱 preview 패널 윗선과 meter 본체를 가시 필드에 정렬한다. 좁은 화면의 패널 이동·긴 label은 별도로 확인한다.
- 두 성과 문구, 보드, incoming meter가 겹치지 않는다. resize·모바일·종료·로비 복귀에서도 연출과 overlay가 대상을 따라간다.
- 390×844 로비는 방 조작이 채팅보다 먼저 나오고, 채팅 입력·PVE 설정·코드 복사·퇴장에 스크롤로 도달할 수 있다.
- 390px 게임과 1100px 이하 멀티의 세로 스크롤은 허용한다. 확대·긴 닉네임·fallback 안내·조작법 펼침도 강제 축소나 잘림 대신 자연스러운 줄바꿈과 스크롤을 허용한다.
- `details/summary`, 로비 입력과 버튼의 Tab·Enter·Space 조작 및 포커스 표시를 확인한다.

구현 후 검증 명령은 Node 기준 버전에서 실행한다:

```bash
bash scripts/verify.sh
npm run test:e2e -- e2e/bufferZone.spec.js e2e/singleReactLifecycle.spec.js e2e/multiplayerReactLifecycle.spec.js e2e/multiplayerLobby.spec.js e2e/combatAchievements.spec.js e2e/multiplayerPve.spec.js e2e/multiplayerGameOver.spec.js
```

공용 CSS 영향을 확인하려고 홈도 1600px·390px에서 열어 본다. 목표 viewport의 전후 화면과 geometry를 확인하되, 통과한 검사를 이유 없이 반복하거나 DB/ML full 평가를 추가하지 않는다.

## 5. 범위·위험·복구

- 이번 요청은 조사와 계획 작성까지다. 위 구현 단계는 아직 실행하지 않았다.
- 게임 core/runtime/state/net/server, 40행 규칙·좌표 변환·스폰·protocol·DB·로그·AI·학습 데이터는 변경 대상이 아니다.
- 작은 화면에서 보드가 축소돼 셀이 작아질 수 있다. 모바일 두 보드를 강제로 나란히 두거나 화면 전체를 transform으로 줄이지 않는다.
- 주요 위험은 멀티 성과 연출의 폭·위치, incoming label/overflow가 만드는 높이, 로비 DOM 이동에 따른 포커스 순서, 긴 HUD 문구와 확대 시 높이 변화다. 각각 기존 E2E와 브라우저 확인으로 다룬다.
- 구현 rollback은 이번 CSS·JSX·대응 배치 assertion만 함께 되돌린다. 기존 사용자 변경은 보존하며 DB rollback·운영 row 삭제·배포 변경은 필요 없다.
- 조사에서는 로컬 라이트 화면을 측정했다. 다크 배치·실기기·200% 확대·실제 네트워크 단절·완주 회귀 검사는 구현 검증으로 남아 있다. 기존 전체 suite 통과를 이번 조사에서 새로 주장하지 않는다.
