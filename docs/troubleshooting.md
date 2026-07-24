# Troubleshooting Notes

## 2026-07-24 — 메인 화면과 온라인 로비 이동 시 흰색 번쩍임

### 왜

MPA/Vite multi-page 구조에서는 `index.html`에서 `multiLobby.html`로 이동할 때 새 HTML 문서를 다시 그린다.
이때 CSS와 React effect가 적용되기 전 아주 짧은 순간 브라우저 기본 배경색인 흰색이 먼저 보일 수 있다.

문제의 핵심은 게임 로직이 아니라 초기 paint 순서다.

```text
페이지 이동
→ 새 HTML 수신
→ 브라우저 기본 흰 배경으로 첫 paint 가능
→ CSS 로드
→ React mount
→ applySavedTheme()
```

### 무엇

증상:

- 메인 화면 ↔ 온라인 로비 이동 중 화면 일부가 하얗게 깜빡인다.
- 특히 dark theme 또는 어두운 게임 화면에서 더 잘 보인다.

원인:

- 최종 theme 적용은 `applySavedTheme()`가 담당한다.
- 하지만 이 함수는 module script와 React mount 이후 실행된다.
- 따라서 첫 paint 전에 `data-theme`와 배경색이 확정되지 않을 수 있다.

### 어떻게 처리했는가

각 page HTML의 `<head>`에서 CSS보다 먼저 최소한의 pre-paint 처리를 한다.

- `localStorage.theme` 또는 `prefers-color-scheme`을 읽는다.
- `<html data-theme="...">`를 즉시 설정한다.
- inline critical style로 초기 배경색을 먼저 깐다.
- 이후 React와 `applySavedTheme()`는 기존처럼 버튼 상태와 최종 theme을 동기화한다.

현재 적용 기준:

- `src/client/pages/index.html`
- `src/client/pages/multiLobby.html`
- `src/client/pages/tetrisSingle.html`
- `src/client/pages/tetrisMulti.html`

### 확인 포인트

수동 확인:

1. 브라우저에서 dark theme으로 전환한다.
2. 메인 화면과 온라인 로비를 여러 번 왕복한다.
3. 흰 배경이 먼저 보이지 않는지 확인한다.
4. 새로고침 후에도 저장된 theme이 유지되는지 확인한다.

코드 확인:

- HTML `<head>` 안의 theme pre-paint script가 stylesheet link보다 먼저 있어야 한다.
- 초기 배경 inline style은 실제 CSS의 배경색과 크게 다르면 안 된다.
- React 쪽 `applySavedTheme()`는 제거하지 않는다. 버튼 text와 `aria-pressed` 동기화가 필요하다.

### 다음에 같은 문제가 나면

먼저 아래 순서를 확인한다.

```text
1. 첫 paint 전에 배경색이 지정되는가?
2. 첫 paint 전에 data-theme이 지정되는가?
3. CSS 로드 후 배경값이 pre-paint 값과 크게 달라지지 않는가?
4. React mount 이후 theme toggle 상태가 다시 동기화되는가?
```

이 문제는 transition animation으로 숨기는 것보다, 첫 paint 색을 맞추는 쪽이 더 작고 안정적인 해결이다.

---

## 2026-07-24 — BGM이 꺼져 있는데 버튼은 `사운드 끄기`로 표시됨

### 재현 절차

1. 저장된 사운드 설정이 켜진 상태에서 페이지를 새로 연다.
2. 브라우저가 사용자 상호작용 전 BGM 자동재생을 차단한다.
3. 버튼은 `사운드 끄기`로 표시되지만 실제 음악은 들리지 않는다.
4. 사운드 버튼을 한 번 누르면 `사운드 켜기`로만 바뀐다.
5. 버튼을 다시 누르면 음악이 재생된다.

### 기대 동작과 실제 동작

```text
기대
자동재생 차단
→ 사운드 켜기 표시
→ 버튼 한 번 클릭
→ BGM 재생
→ 사운드 끄기 표시

기존 실제 동작
자동재생 차단
→ 사운드 끄기 표시
→ 첫 클릭에서 설정 true → false
→ document 재시도도 sound=false라 실행하지 않음
→ 두 번째 클릭에서 false → true
→ BGM 재생
```

### 왜 이전 수정 뒤에도 남았는가

이전 수정은 자동재생 실패 뒤 첫 trusted interaction에서 BGM을 다시 시도했다.
그러나 회귀 테스트가 다음 경로만 확인했다.

- index의 닉네임 입력창 클릭
- single game의 키보드 입력
- 사운드 버튼은 `aria-pressed` 값이 반전되는지만 확인

사운드 버튼을 처음 누르면 button handler가 document의 autoplay 재시도 listener보다 먼저 실행된다. 따라서 첫 클릭이 재생 기회로 사용되지 않고 사운드 설정을 끄는 데 사용됐다.

즉, 이전 코드가 되돌아간 것이 아니라 사운드 버튼 경로와 실제 재생 상태 표시가 빠진 불완전한 수정이었다.

### 근본 원인

[sound runtime](../src/client/game/runtime/sound.ts)은 다음 두 상태를 하나의 `soundEnabled` 값으로 취급했다.

- 사용자가 저장한 사운드 허용 설정
- 현재 BGM이 실제로 재생 중인지 여부

자동재생이 거부돼도 저장 설정은 `true`이므로 UI만 켜진 것처럼 표시됐다.

### 어떻게 수정했는가

- 저장 설정 `soundEnabled`와 실제 재생 상태 `musicPlaying`을 분리했다.
- `play()`가 성공한 뒤에만 버튼을 `사운드 끄기`, `aria-pressed="true"`로 표시한다.
- 자동재생이 차단된 상태의 첫 사운드 버튼 클릭은 설정을 끄지 않고 BGM 재생을 시도한다.
- 실제 재생 중인 상태에서 다음 클릭을 해야 설정을 끄고 음악을 정지한다.
- 오래된 `play()` Promise가 늦게 실패해 최신 성공 상태를 덮지 못하게 했다.
- 이미 설정을 끄거나 다른 음악으로 전환한 뒤 오래된 재생이 성공하면 해당 음악을 즉시 정지한다.

### 검증

[React shell E2E](../e2e/reactShellLifecycle.spec.js)에 다음 계약을 추가했다.

1. 초기 자동재생은 `NotAllowedError`로 차단한다.
2. 버튼이 `사운드 켜기`, `aria-pressed="false"`인지 확인한다.
3. 버튼을 한 번만 클릭한다.
4. trusted interaction 안에서 `play()`가 한 번 호출되는지 확인한다.
5. 성공 뒤 `사운드 끄기`, `aria-pressed="true"`인지 확인한다.
6. 늦게 도착한 이전 자동재생 실패가 성공 상태를 덮지 않는지 확인한다.
7. 다음 클릭은 설정과 localStorage를 `false`로 바꾸는지 확인한다.

검증 결과:

- 사운드 회귀: 2/2
- Vite-dev: 11 pass, production-only 2 skip
- production 관련 lifecycle: 10/10
- 전체 production Playwright: 37/37
- 전체 Node gate: 643 pass, 기존 조건부 1 skip

### 재발 방지 원칙

- 저장된 사용자 설정과 실제 media 재생 상태를 같은 값으로 표시하지 않는다.
- autoplay 검증은 일반 click과 keyboard뿐 아니라 사운드 버튼 자체를 첫 interaction으로 사용하는 경로도 포함한다.
- 버튼 text와 `aria-pressed`는 `play()` 요청 여부가 아니라 성공 결과를 기준으로 갱신한다.
- async media Promise는 현재 음악과 최신 설정에 여전히 유효한지 확인한 뒤 상태를 반영한다.

---

## 2026-07-17~24 — 기술 마이그레이션 트러블슈팅

### 문서 범위

이 절은 Goal 0~11의 마이그레이션 실행 기록에서 실제로 발생한 실패와 리뷰에서 확인된 결함을 정리한다.

다음 항목은 제외했다.

- 정상적으로 끝난 구현 과정
- WebKit, 외부 TLS, 장시간 soak처럼 아직 실행하지 않은 검증
- 원인을 확인하지 못한 일회성 실패
- 마이그레이션 이후 OCI 운영 중 발생한 배포 문제

문제를 다음 세 종류로 구분하는 것이 중요했다.

| 종류 | 의미 | 대응 원칙 |
|---|---|---|
| 제품·계약 결함 | 실제 사용자 동작, 보안, 데이터 계약이 잘못됨 | 공통 경계에서 최소 수정하고 회귀 테스트 추가 |
| 테스트·검증 결함 | 제품은 정상인데 fixture, 관찰 위치, 실행 순서가 잘못됨 | 제품 코드를 바꾸지 않고 테스트가 실제 계약을 관찰하게 수정 |
| 환경·Git 문제 | Node 버전, sandbox, 포트, worktree, merge 때문에 실행이 막힘 | 사용자 프로세스와 코드를 건드리기 전에 실행 환경을 바로잡음 |

### 1. 기준선·worktree·빌드 환경

| 단계 | 증상 | 확인된 원인 | 해결 | 재발 방지 |
|---|---|---|---|---|
| Goal 0 | 새 worktree에서 Playwright를 실행할 수 없음 | dev dependency가 설치되지 않아 local Playwright binary가 없었음 | 기존 lockfile로 `npm ci` 후 같은 검증을 다시 실행 | 새 worktree preflight에 dependency 설치 여부 확인 |
| Goal 0 | `/`가 404이고 Playwright readiness가 timeout | 절대 경로에 포함된 `.codex`를 Express `send`가 dotfile 구간으로 판정 | `sendFile()`에 상대 경로와 `root` 옵션 사용 | `dotfiles: "allow"`로 보안을 완화하지 않고 managed worktree에서도 HTTP smoke 실행 |
| Goal 0 | HTTP smoke가 `EADDRINUSE`로 실패 | 다른 세션이 기본 포트 5500을 사용 중 | 기존 listener를 종료하지 않고 임시 포트 5517 사용 | 병렬 worktree 검증은 고유 포트를 사용하고 종료할 때 자신이 만든 프로세스만 정리 |
| Goal 0 | single E2E가 네 입력의 개별 성공을 증명하지 못함 | 키 네 개를 누른 뒤 마지막 점수와 board만 확인 | 결정론적 T 조각과 정지된 clock을 사용해 move, rotate, soft drop, hard drop을 Canvas 좌표로 각각 확인 | “키 호출됨”이 아니라 사용자에게 보이는 결과를 assertion으로 사용 |
| Goal 0 | 최신 main 동기화 중 `PLAN.md` 충돌 | main의 최신 상태 문장과 Goal branch의 baseline 섹션이 같은 파일을 수정 | main의 최신 상태와 Goal의 검증 섹션을 모두 보존해 수동 해결 | 문서 충돌은 한쪽을 통째로 선택하지 말고 의미 단위로 합친 뒤 conflict marker 검사 |
| Goal 1 | TypeScript가 `TS18002`로 실패 | 공통 설정 파일이 입력 없는 실행 project로 취급됨 | 공통 옵션을 `tsconfig.base.json`에 두고 client/server/test config가 상속 | base config는 직접 실행하지 않고 실제 build target만 project로 유지 |
| Goal 4·5 | engine warning, compiled server 기동 실패, lockfile metadata churn | shell이 `.nvmrc`의 Node 24가 아닌 기본 Node 22를 사용 | Node 24.18.0/npm 11.16.0에서 같은 명령을 다시 실행하고 무관한 lockfile 변경 제거 | preflight에서 `node -v`, `npm -v`, `.nvmrc`, package/lock checksum을 먼저 확인 |
| 여러 Goal | localhost bind가 `EPERM` | application 결함이 아니라 Codex sandbox의 listen 제한 | 승인된 local 실행 경계에서 동일 명령을 재실행 | bind 실패를 제품 회귀로 간주해 코드를 우회 수정하지 않음 |
| Goal 8B | E2E 재호출 시 5510 포트 충돌 | 이전 명령이 tool wait를 넘겼지만 server process는 계속 실행 중이었음 | 해당 실행이 만든 server만 종료하고 clean 상태에서 전체 명령 재실행 | timeout 뒤 바로 재실행하지 말고 process와 port listener 상태부터 확인 |
| Goal 8C | `build:server` 뒤 artifact test가 `dist/client` 부재로 실패 | server-only build와 배포 가능한 전체 artifact 검증 계약이 섞임 | gate를 `npm run build` → artifact test → compiled HTTP smoke로 정정 | server-only artifact와 deployable client/server artifact를 다른 의미로 취급 |

상세 근거:

- [Goal 0 실행 기록](../migration-harness/runs/goal-00-2026-07-17.md)
- [Goal 1 실행 기록](../migration-harness/runs/goal-01-2026-07-20.md)
- [Goal 4 실행 기록](../migration-harness/runs/goal-04-2026-07-21.md)
- [Goal 5 실행 기록](../migration-harness/runs/goal-05-2026-07-21.md)
- [Goal 8B 실행 기록](../migration-harness/runs/goal-08b-2026-07-21.md)
- [Goal 8C 실행 기록](../migration-harness/runs/goal-08c-2026-07-22.md)

### 2. Socket.IO·React·브라우저 경계

| 단계 | 증상 | 확인된 원인 | 해결 | 재발 방지 |
|---|---|---|---|---|
| Goal 2 | 전체 E2E가 session rate limit에 걸림 | 여러 browser context가 같은 loopback IP의 production limit을 공유 | production `20/10/2`는 유지하고 E2E 전용 profile만 `120/100/20`으로 분리 | 테스트 편의를 위해 운영 보안값을 높이지 않음 |
| Goal 2 | 리뷰 수정 뒤 PVE와 rollback 입력 3건 실패 | 연결 중 정상 입력까지 `volatile` emit으로 보내 빠른 입력이 유실 | 연결 중에는 일반 emit을 사용하고 disconnect 때 이전 generation의 `sendBuffer`만 폐기 | “재연결 후 stale 입력 차단”과 “현재 연결의 정상 입력 보존”을 별도 계약으로 검사 |
| Goal 2 | Origin 거부 E2E가 403 대신 400을 받음 | Engine.IO `allowRequest` 거부의 실제 transport status가 400 | 제품 코드는 건드리지 않고 테스트 기대값을 실제 계약에 맞춤 | HTTP 계층의 일반적인 예상보다 사용 중인 transport의 실제 응답을 먼저 확인 |
| Goal 2 | 중복 연결로 밀려난 이전 탭이 일반 재연결처럼 보임 | `io server disconnect`와 일시적인 `transport close`를 같은 상태로 처리 | server disconnect는 terminal, transport close만 reconnecting으로 분리 | terminal 안내 1회, mutation 차단, credential 보존을 함께 검증 |
| Goal 3 | 미존재 room 테스트가 `ROOM_NOT_FOUND` 대신 `INVALID_PAYLOAD` | fixture `UNKNOWN`이 8자리 uppercase hex 계약부터 위반 | 형식은 유효하지만 존재하지 않는 `DEADBEEF` 사용 | 검사하려는 business error보다 앞선 schema validation을 fixture가 통과하는지 먼저 확인 |
| Goal 3 | 정상 PVE garbage snapshot을 browser가 거부 | board cell enum에 서버가 만드는 `garbage`가 빠짐 | board cell에만 `garbage` 허용 | active piece, hold, queue의 tetromino enum까지 불필요하게 넓히지 않음 |
| Goal 3 | terminal protocol 오류 알림이 누락되거나 중복될 수 있음 | 이미 disconnected인 경로도 다시 disconnect event를 기다림 | 연결 중에는 실제 disconnect를 기다리고 이미 끊긴 malformed error는 즉시 1회 알림 | 두 경로 모두 알림 배열이 정확히 하나 증가하는지 검사 |
| Goal 5 | Vite-dev에서 초기 `room:sync`가 0건으로 집계 | monitor가 WebSocket frame만 보고 upgrade 전 polling POST를 놓침 | polling POST와 WebSocket을 모두 관찰 | transport 구현이 아니라 Socket event 단위로 assertion |
| Goal 5 | StrictMode 재마운트에서 session listener나 예약 replay가 중복될 수 있음 | 같은 callback을 `Set`에 직접 저장하고 구독 직후 microtask replay를 예약하면 한 disposer가 다른 구독에 영향을 주거나 cleanup 뒤 오래된 session을 전달할 수 있음 | 구독마다 고유 wrapper를 저장하고 disposer는 자기 wrapper만 제거하며, replay 직전에 Set membership과 현재 `activeSession` identity를 함께 확인 | duplicate callback 독립 해제, cleanup-before-microtask, session rotation과 `room:sync` 1회를 unit/Vite-dev lifecycle test로 고정 |
| Goal 5 | BFCache 복귀 후 index sound toggle이 복원되지 않음 | `pagehide` cleanup 뒤 `pageshow.persisted` 복구 경로가 없었음 | persisted 복귀 시 reload하고 native listener도 cleanup | `pagehide` → `pageshow.persisted` 순서와 listener 재등록을 E2E로 고정 |
| Goal 6 | hold 뒤 이동 검증이 다른 조각의 색을 읽음 | hold가 active piece를 바꾼 뒤 이전 조각 기준으로 movement를 검사 | 이동 검증을 hold보다 먼저 실행 | 테스트 동작 순서가 game state를 어떻게 바꾸는지 명시 |
| Goal 6 | restart 뒤 portal identity와 score text 소유권이 불안정 | 여러 portal에 stable key가 없고 score가 명시적 문자열이 아니었음 | portal key를 부여하고 score를 문자열로 렌더 | StrictMode와 반복 restart에서 warning·중복 DOM·stale UI 검사 |
| Goal 7 | React state가 runtime 전체 객체를 보관 | 화면에 필요한 display API보다 넓은 mutable 객체를 state에 저장 | `getDisplaySnapshot`과 `subscribeDisplay`만 가진 page-local handle로 축소 | React는 표시 경계만, runtime은 Canvas와 game lifecycle만 소유 |
| Goal 7 | cleanup과 reconnect 검증 범위가 부족 | 일부 handler만 해제를 확인하고 상대 HUD와 양쪽 overlay를 보지 않음 | 네 Socket handler의 `1 → 0`, 상대 hold, offline HUD, 양쪽 overlay 해제를 추가 검증 | destroy 이후 callback이 React/runtime을 바꾸지 않는지 함께 확인 |
| Goal 7 | 접근성 review fix가 기존 live-region 알림을 제거 | 중복 낭독 방지를 incoming garbage와 PVE role badge까지 과하게 적용 | 기존 incoming/badge 알림을 복원하고 game overlay만 사용자 소유 column으로 제한 | 접근성 수정도 이전 aria 계약을 회귀 테스트로 보존 |

상세 근거:

- [Goal 2 실행 기록](../migration-harness/runs/goal-02-2026-07-20.md)
- [Goal 3 실행 기록](../migration-harness/runs/goal-03-2026-07-20.md)
- [Goal 5 실행 기록](../migration-harness/runs/goal-05-2026-07-21.md)
- [Goal 6 실행 기록](../migration-harness/runs/goal-06-2026-07-21.md)
- [Goal 7 실행 기록](../migration-harness/runs/goal-07-2026-07-21.md)

### 3. TypeScript 전환 중 parity 문제

| 단계 | 증상 | 확인된 원인 | 해결 | 재발 방지 |
|---|---|---|---|---|
| Goal 8A | 빈 piece와 실제 piece가 같은 타입으로 취급됨 | 기존 runtime sentinel을 TypeScript type이 표현하지 못함 | `EmptyPieceState`와 `PlaceablePieceState`를 분리 | compile-time negative case와 runtime queue guard를 함께 유지 |
| Goal 8A | 빈 `pieceTypes`에서 `undefined`가 숨겨지고 B2B 동작이 바뀔 수 있음 | non-null assertion과 새 숫자 type guard가 기존 JS 동작을 가림 | invalid queue는 명시적 오류 처리하고 기존 숫자 coercion parity 복원 | 타입을 맞추는 과정에서 runtime 의미를 바꾸지 않았는지 fixture 비교 |
| Goal 8A | rename 후 문서가 제거된 `.js` 경로와 모순된 test 수를 표시 | source rename과 문서 갱신이 분리되고 total/pass 표현이 섞임 | 실제 `.ts` 경로로 고치고 `pass`와 `skip`을 분리 표기 | rename 뒤 stale extension 검색, 검증 수치는 한 형식으로 기록 |
| Goal 8B | malformed ranker 입력이 기존 오류 계약과 다르게 처리 | `null` 등의 shape를 검증하기 전에 field 접근과 canonicalize 수행 | 입력을 `unknown`으로 받고 record/array shape부터 좁힌 뒤 canonicalize | malformed fixture와 기존 failure reason을 회귀 테스트로 고정 |
| Goal 8B | `InputAction`과 Socket/session 타입이 실제 wire 계약보다 넓음 | 수동 string type, stored credential, active session의 책임이 섞임 | closed literal union, Zod wire input 재사용, credential/session 타입 분리 | non-hold transform 필수, projection mutation 격리 등 compile-time negative case 유지 |
| Goal 8B | state가 runtime의 `InputAction`을 역참조 | 타입 소유권을 상위 state가 아니라 하위 runtime에 둠 | `stateFactory`가 타입을 소유하고 runtime은 import/re-export | core/state → runtime 역방향 의존을 정적 검사 |
| Goal 8C | TTL disconnect 종료에서 기본 `game_over` logger가 호출되지 않을 수 있음 | optional override가 기존 기본 logger를 `undefined`로 덮음 | override가 없으면 `saveGameEventLog` fallback 사용 | 실제 임시 JSONL에 `disconnect_timeout` event가 1줄 저장되는 integration 유지 |
| Goal 8C | secret-redaction artifact test가 실제 인자를 검사하지 않음 | sentinel이 room/player argument가 아닌 다른 위치에 배선됨 | 두 sentinel을 실제 room/player 인자로 전달 | error와 compiled stack을 만들면서 두 sentinel 모두 stdout/stderr에 없는지 확인 |

상세 근거:

- [Goal 8A 실행 기록](../migration-harness/runs/goal-08a-2026-07-21.md)
- [Goal 8B 실행 기록](../migration-harness/runs/goal-08b-2026-07-21.md)
- [Goal 8C 실행 기록](../migration-harness/runs/goal-08c-2026-07-22.md)

### 4. PostgreSQL 저장·import·CI 경계

| 단계 | 증상 | 확인된 원인 | 해결 | 재발 방지 |
|---|---|---|---|---|
| Goal 9A | 공백 문자만 있는 identity가 raw INSERT를 통과 | PostgreSQL `btrim()`과 application의 Unicode 공백 판정 범위가 다름 | DB CHECK에 거부할 Unicode 공백 집합을 명시 | tab, newline, Unicode whitespace를 실제 PostgreSQL integration에서 검사 |
| Goal 9A | PostgreSQL fixture가 준비됐다고 판단한 뒤 중간 test가 실패 | image entrypoint의 임시 bootstrap server를 최종 server로 오인 | PID 1이 실제 `postgres`일 때만 ready 처리 | timeout을 무작정 늘리지 않고 readiness 조건을 정확히 만들고 실패 자원은 `finally` 정리 |
| Goal 9B | 인증된 human placement receipt를 replay할 수 있음 | 검증 성공 후 receipt를 소비하지 않음 | 인증과 동시에 receipt를 한 번 소비 | replay가 JSONL duplicate나 PostgreSQL conflict까지 도달하지 않는 Socket 회귀 유지 |
| Goal 9B | retry 최악 경로가 2.7초 budget을 넘을 수 있음 | 250ms connection/query timeout에 conflict SELECT와 backoff를 합치면 약 3.15초 | 두 timeout을 200ms로 줄여 계산상 최악을 2.55초로 제한 | retry 횟수뿐 아니라 모든 query, conflict 확인, backoff를 포함해 budget 계산 |
| Goal 9C | malformed `eventType`이 report key로 노출될 수 있음 | 검증 전 외부 문자열을 그대로 집계 key에 사용 | allowlist 밖 값은 `unknown`으로만 집계 | raw payload, identity, credential을 issue와 stdout에 쓰지 않음 |
| Goal 9C | idempotency conflict가 난 game도 ML export 대상이 될 수 있음 | source completeness만 보고 DB conflict를 completeness에 반영하지 않음 | `idempotency_conflict`를 incomplete reason으로 추가 | conflict fixture는 `mlExportEligible=false`를 확인 |
| Goal 9C | import 성공 뒤 관리용 `count(*)`만 권한 거부 | 최소 권한 import role로 관리 검증 query까지 실행 | import role 권한을 넓히지 않고 fixture owner connection으로 최종 row/privacy/size 확인 | runtime, importer, maintenance 역할을 구분 |
| Goal 9D | production-like smoke의 SQL이 `COALESCE` 오류로 실패 | PostgreSQL built-in 함수를 잘못 schema-qualified | 표준 built-in 표기로 정정 | application query와 maintenance query를 실제 PostgreSQL image에서 실행 |
| Goal 9D | retention `DELETE ... USING`의 `RETURNING`이 모호함 | 두 relation에 같은 열 이름이 존재 | 반환 열을 table-qualified로 지정 | dry-run과 실제 delete에 같은 row/byte 상한 적용 |
| Goal 9D | hosted DB 인증이 거부됨 | host authentication을 쓰면서 test role에 password를 지정하지 않음 | URL에서 검증한 job-local password를 role에도 설정 | credential 값은 assertion과 log에 출력하지 않음 |
| Goal 9D | shutdown 뒤 snapshot row 수가 증가해 equality 검사 실패 | producer가 살아 있을 때 snapshot을 만들고 shutdown drain에서 정상 late commit이 추가 | PVP/PVE 직후 producer 정지·write drain을 끝낸 다음 event count, privacy, duplicate, snapshot과 backup/restore를 검증 | 비동기 저장에서는 “검사 시점”을 데이터 계약의 일부로 취급 |
| Goal 9D | hosted shutdown이 약 8초에서 deadline 초과로 오탐 | application 8초 hard deadline과 `docker stop --time 8`의 daemon 통신 포함 CLI 경과 시간을 같은 값으로 비교 | application의 8초 제한은 유지하고 Docker 관측 여유만 10초로 분리한 뒤 exit code, `OOMKilled`, pool connection으로 판정 | 정상 exit `0`, application failure `1`, Docker kill `137`을 구분하고 CLI 시간만으로 판정하지 않음 |

상세 근거:

- [Goal 9A 실행 기록](../migration-harness/runs/goal-09a-2026-07-23.md)
- [Goal 9B 실행 기록](../migration-harness/runs/goal-09b-2026-07-23.md)
- [Goal 9C 실행 기록](../migration-harness/runs/goal-09c-2026-07-24.md)
- [Goal 9D 실행 기록](../migration-harness/runs/goal-09d-2026-07-24.md)

Goal 9D 최종 [Migration CI run 30041556298](https://github.com/Sleepingco/Tetris_multi/actions/runs/30041556298)에서는
Fast, Chromium PVP/PVE, Production container smoke와 PostgreSQL event storage가 모두
통과했다. PostgreSQL production boundary의 두 shutdown은 각각 CLI 관측
`209ms`, `192ms`, exit code `0`, `OOMKilled=false`, runtime pool connection `0`이었다.

### 5. 보안·Docker·hosted CI

| 단계 | 증상 | 확인된 원인 | 해결 | 재발 방지 |
|---|---|---|---|---|
| Goal 11A | CSP report-only에서 lobby 2건, multiplayer 4건 위반 | shared Zod runtime의 eval probe | 공식 `z.config({ jitless: true })` 적용 | CSP에 `unsafe-eval`을 추가하지 않고 report-only와 enforce를 모두 실행 |
| Goal 11A | `/pages`, 4xx, 5xx에서 CSP header mode가 달라질 수 있음 | Express static redirect와 error middleware가 정상 응답과 다른 경로를 사용 | `/pages` redirect를 끄고 error 경계에서 CSP 두 header를 정리한 뒤 선택된 mode 하나만 재적용 | 404, 416, 304, Socket.IO 200/400의 header를 exact 비교 |
| Goal 11B | fresh audit가 `body-parser` low advisory를 보고 | 기존 transitive version의 body-size limit 우회 취약점 | direct dependency나 Express를 바꾸지 않고 patched transitive version만 lockfile에 반영 | production/full audit와 전체 runtime gate를 같이 실행 |
| Goal 11D | local Docker 재현 뒤 container가 남아 다음 실행에서 포트 충돌 | zsh 특수 변수 `path`를 loop 변수로 덮어 `PATH`가 사라지고 EXIT trap도 `docker`를 찾지 못함 | 해당 Goal 자원만 제거하고 workflow와 동일한 bash로 재실행 | CI shell을 명시하고 run별 label/name과 EXIT trap 유지 |
| Goal 11D | assertion 실패 로그에 session token 원문이 노출될 수 있음 | token 문자열 자체를 matcher의 actual/expected로 전달 | equality와 비노출 결과를 boolean으로만 assertion | secret 원문 matcher 정적 검사와 관련 browser test 유지 |
| Goal 11E | hosted T-Spin E2E가 같은 SHA에서도 성공과 실패를 반복 | 7-bag 조립과 row 16 도달이 natural gravity와 runner scheduling에 의존했고 과거 snapshot 검색은 최신 상태를 보장하지 못함 | timing-dependent T-Spin E2E와 전용 helper 제거 | T-Spin은 결정론적 core, authoritative, runtime test가 담당하며 sleep, retry, timeout으로 숨기지 않음 |
| Goal 11E | pending garbage가 예상 0 대신 1이라 반복 19/20 | 첫 garbage 적용 뒤 새로운 정상 AI attack이 도착할 수 있는데 고정 숫자 0을 주장 | sequence, piece index, board fingerprint, garbage cell로 적용을 확인하고 같은 snapshot의 UI 값과 비교 | 계속 변하는 authoritative state는 임의의 순간값이 아니라 전이와 동일 sequence의 일관성을 검증 |

Goal 11C는 컨테이너 수명주기와 shutdown 경계를 구현했지만 실행 기록에 명시적인 실패 run은 없었다. 따라서 구현 내용을 억지로 장애 사례로 분류하지 않았다.

상세 근거:

- [Goal 11A 실행 기록](../migration-harness/runs/goal-11a-2026-07-22.md)
- [Goal 11B 실행 기록](../migration-harness/runs/goal-11b-2026-07-22.md)
- [Goal 11D 실행 기록](../migration-harness/runs/goal-11d-2026-07-23.md)
- [Goal 11E 실행 기록](../migration-harness/runs/goal-11e-2026-07-23.md)

### 공통 문제 해결 순서

마이그레이션 과정에서 가장 효과적이었던 순서는 다음과 같다.

```text
1. 기대 동작과 실제 실패를 한 문장으로 분리한다.
2. 제품, 테스트, 실행 환경 중 어느 경계의 문제인지 먼저 판별한다.
3. 동일한 Node 버전과 clean dependency 상태에서 최소 재현한다.
4. 실패한 좁은 테스트로 원인을 확인한다.
5. 공통 경계에 가장 작은 수정을 적용한다.
6. 좁은 회귀 테스트를 통과시킨다.
7. fast gate, build/artifact, 전체 browser 또는 DB gate 순서로 넓혀 재검증한다.
8. 남은 미검증 범위와 rollback 경계를 실행 기록에 남긴다.
```

### 가장 중요한 교훈

1. **불안정한 테스트를 제품 버그로 오해하지 않는다.**
   timing-dependent T-Spin처럼 테스트가 실제 인과관계를 증명하지 못하면 제품에 sleep이나 timeout을 추가하지 않고 결정론적 하위 계층으로 책임을 옮긴다.

2. **보안값을 테스트 편의 때문에 완화하지 않는다.**
   rate limit은 test profile로 분리했고 CSP는 `unsafe-eval` 대신 Zod의 jitless mode로 해결했다.

3. **비동기 시스템에서는 값뿐 아니라 관찰 시점도 계약이다.**
   PostgreSQL snapshot은 producer와 drain이 끝난 뒤 만들고 Socket assertion은 동일 authoritative sequence를 비교한다.

4. **TypeScript 통과가 동작 parity를 보장하지 않는다.**
   non-null assertion, 넓은 string type, 검증 전 canonicalization이 기존 JavaScript 의미를 바꾸지 않는지 runtime fixture와 함께 확인한다.

5. **환경 실패를 코드 수정으로 우회하지 않는다.**
   Node 버전, sandbox bind, 남은 port, shell 차이를 먼저 바로잡아야 불필요한 production 변경을 피할 수 있다.

---

## 2026-07-02~24 — Server authoritative 멀티플레이·PVE 트러블슈팅

### 문서 범위

이 절은 server authoritative 멀티플레이 전환, PVE action executor, placement 로그와 dataset 기반을 만드는 과정에서 실제로 재현한 문제를 정리한다.

### 1. 마지막 이동 후 Hard Drop Rollback

증상:

- client에서는 마지막 이동·회전 위치에 조각이 보였다.
- hard drop 뒤 authoritative snapshot을 적용하면 조각이 이전 위치에 고정되거나 이전 조각 상태로 돌아갔다.

확인된 원인:

- socket input과 gravity mutation이 같은 player 상태를 서로 다른 순서로 변경할 수 있었다.
- local prediction과 server input 적용 결과가 달라도 terminal input이 계속 처리될 수 있었다.
- 오래된 deferred snapshot이 더 최신 acknowledgment 뒤에 적용될 수 있었다.
- `PREVIOUS_POSITION_INPUT_FAILED` 차단은 정상적인 벽 충돌과 실제 prediction divergence를 구분하지 못했다.

해결:

- player별 mutation queue로 input과 gravity를 enqueue 순서대로 실행했다.
- client가 보낸 최종 좌표를 신뢰하지 않고 server가 core 규칙으로 다시 계산했다.
- `expectedTransform`은 server 계산 결과 검증에만 사용했다.
- deferred snapshot은 해당 sequence가 마지막 acknowledgment 이상일 때만 적용했다.
- 정상 충돌까지 hard drop을 막던 일괄 차단 정책은 제거했다.
- 빠른 `move/rotate → hard_drop`을 응답 대기 없이 보내도 최종 board cell과 `pieceIndex`가 정확한지 socket 테스트로 고정했다.

핵심 교훈:

> Authoritative 시스템에서는 상태 값뿐 아니라 mutation 순서도 게임 규칙이다.

### 2. 실패한 Local Input까지 Server로 전송

기존 흐름:

```text
keyboard input
→ runtime queue 등록
→ 성공 여부를 모른 채 server 전송
→ local runtime에서 충돌로 실패할 수 있음
```

벽이나 board 충돌로 local 이동이 실패해도 server에는 입력이 전달됐다. 이 입력은 불필요한 divergence와 correction을 만들었다.

수정한 흐름:

```text
keyboard input
→ runtime tick에서 실제 action 판정
→ local input outcome 생성
→ applied === true인 입력만 clientSequence 부여
→ server 전송
```

적용한 계약:

- 성공한 move, rotate, hold, soft drop, hard drop만 전송한다.
- 실패한 입력은 `pendingServerInputs`에 넣지 않는다.
- 실패 입력 때문에 `clientSequence`에 gap이 생기지 않는다.
- stale `pieceIndex`와 거부된 두 번째 hold는 `applied: false`다.
- placement log의 `inputSequence` 의미는 별도 변경하지 않았다.

### 3. Client와 Server의 Automatic Gravity Lock 의미 불일치

기존 차이:

```text
client: 첫 blocked automatic gravity → 즉시 lock/spawn
server: 첫 blocked automatic gravity → grounded
        두 번째 blocked gravity → lock/spawn
```

client가 다음 조각으로 먼저 넘어가면서 server가 다음 입력을 `PIECE_INDEX_MISMATCH`로 거부할 수 있었다.

해결:

- 양쪽 모두 첫 blocked automatic gravity에서는 grounded 상태만 기록한다.
- 같은 조각의 두 번째 blocked automatic gravity에서 lock한다.
- automatic gravity로 한 칸 이동하면 grounded marker를 해제한다.
- spawn, hold, snapshot correction, reset, game over에서 marker를 정리한다.
- keyboard `soft_drop`과 `hard_drop`은 기존처럼 즉시 lock한다.
- player별 gravity timer를 분리하고 실제 새 game socket join에서만 해당 player timer를 초기화한다.
- 좌우 이동과 회전만으로 gravity accumulator를 reset하지 않는다.

검증:

- 첫 blocked에서 board와 `pieceIndex` 불변
- 두 번째 blocked에서 정확히 한 번 lock
- 턱에서 벗어난 뒤 새 바닥에서 grace 재적용
- line clear presentation 350ms와 새 조각 gravity 500ms 유지
- PVE cadence와 다른 player의 timer 독립성 유지

### 4. Authoritative Acknowledgment와 Sequence 처리

발견한 문제:

- authoritative 처리 중 예외가 발생하면 result가 없어 pending input이 남을 수 있었다.
- 역순 sequence가 검증되기 전에 input log와 opponent relay에 들어갈 수 있었다.
- 낮은 acknowledgment의 snapshot이 최신 input 이후 상태를 덮을 수 있었다.

정리한 원칙:

1. sequence 검증은 input 기록과 relay보다 먼저 수행한다.
2. 내부 실패도 명시적인 실패 result와 최신 authoritative snapshot을 반환한다.
3. duplicate와 stale result는 상태나 로그를 다시 변경하지 않는다.
4. correction은 끄지 않고 최신 sequence를 증명한 snapshot만 적용한다.

### 5. 상대 화면 Line Clear Animation 누락

원인:

- 내 runtime은 local prediction으로 line clear callback과 효과음을 실행했다.
- 상대 runtime은 `autoStart: false`이며 authoritative snapshot만 적용하므로 같은 callback이 실행되지 않았다.

해결:

- authoritative state와 presentation을 분리했다.
- 기존 snapshot payload에 transient `presentationEffect`를 선택적으로 추가했다.
- client는 snapshot을 먼저 적용한 뒤 presentation-only API를 호출했다.
- effect ID 또는 `pieceIndex`로 중복·오래된 effect를 차단했다.
- 상대 presentation은 board, active piece, phase, score, input queue, gravity를 변경하지 않는다.
- 상대 화면에서는 line clear 효과음을 재생하지 않는다.
- garbage target의 추가 snapshot에는 공격자의 effect를 붙이지 않았다.

### 6. PVE AI가 순간이동처럼 보이는 문제

원인:

- planner 계획의 마지막 action이 항상 `hard_drop`이었다.
- action executor를 사용해도 마지막 낙하가 한 번에 끝나 사용자는 direct placement처럼 느꼈다.

해결:

- planner의 terminal hard drop은 유지했다.
- `normal`은 terminal hard drop 전에 authoritative soft drop을 최대 5회 실행한다.
- `hard`는 terminal soft drop 없이 hard drop을 실행한다.
- 두 난이도 모두 callback당 action을 최대 하나만 실행한다.
- 실제 성공 action만 `inputSequence`에 기록한다.
- hard-drop 점수는 soft drop 이후 실제 남은 거리로 기존 core가 계산한다.
- direct placement production API를 제거하고 authoritative input을 유일한 실행 입구로 유지했다.

### 7. Phantom Placement Log

기존 문제:

```text
local runtime lock
→ placement log 즉시 전송
→ server가 terminal input 거부
→ authoritative board에 없는 placement가 JSONL에 저장
```

해결:

- input result에 `placementCommitted`를 추가했다.
- local placement log와 terminal input result를 `pieceIndex` 기준으로 잠시 보관했다.
- 두 정보가 어느 순서로 도착해도 authoritative commit 성공 뒤 정확히 한 번만 전송했다.
- `PREDICTION_DIVERGED`, `PIECE_INDEX_MISMATCH`, authoritative failure에서는 보류 로그를 폐기했다.
- 전송 로그에 `authoritativeClientSequence`와 `authoritativePieceIndex`를 기록했다.
- PVE의 server-side placement log 경로는 변경하지 않았다.

핵심 교훈:

> 학습 데이터는 local event가 아니라 authoritative commit을 기준으로 저장해야 한다.

### 8. 자동 테스트가 Production JSONL을 오염

원인:

- 일부 socket 통합 테스트가 log dependency를 주입하지 않았다.
- 해당 테스트가 production 기본 repository를 사용해 `data/logs/game-events.jsonl`에 테스트 로그를 추가했다.

해결:

- 중앙 socket test harness에 in-memory/no-op logger를 주입했다.
- 개별 테스트가 제공한 log spy가 기본 logger보다 우선하도록 dependency 순서를 유지했다.
- repository 저장 자체를 검증하는 테스트는 임시 디렉터리를 계속 사용했다.
- 테스트 실행 전후 production JSONL의 checksum과 line count를 비교했다.

### 9. Dataset 입력 검증과 Leakage

발견한 문제:

- `inputSequence`가 배열인지 여부만 확인해 `[null]`, `{ action: 123 }` 같은 malformed 항목이 dataset에 포함될 수 있었다.
- 후보 feature에 미래 결과를 섞으면 실제 학습 시 data leakage가 발생할 수 있었다.

해결:

- 각 input의 `action`, `tick`, `pieceIndex`, `sequence`, `createdAt`을 검증했다.
- 잘못된 sequence는 `INVALID_INPUT_SEQUENCE`로 reject했다.
- candidate feature에서 원본 `boardAfter`, placement 결과, winner를 제외했다.
- heuristic score는 feature가 아니라 baseline label·metadata로 구분했다.
- game 단위 deterministic split으로 같은 `gameId`가 train과 validation에 동시에 들어가지 않게 했다.
- schema version은 저장 위치가 아니라 JSON 계약 버전으로 관리했다.

### 10. Room Lifecycle Race

정상 종료 경로에서 발견한 문제:

- game page에서 lobby로 이동하며 old socket이 먼저 disconnect되면 finished room player가 제거될 수 있었다.

해결:

- finished room disconnect는 player를 자동 제거하지 않는다.
- 새 lobby socket의 `room:sync`가 player의 최신 `socketId`를 등록한다.
- PVP는 두 player가 모두 돌아왔을 때, PVE는 human이 돌아왔을 때 waiting으로 전환한다.
- 명시적 `room:leave`와 Home 퇴장은 실제 player 제거 의미를 유지한다.

게임 중 Home 퇴장 경로에서 추가로 재현한 race:

```text
Guest game:leave
→ room이 Host만 남은 waiting 상태로 변경
→ Host old game socket disconnect
→ waiting disconnect 정책이 Host까지 제거
→ 새 lobby room:sync가 NOT_AUTHORIZED
```

Playwright에서는 Host의 player count가 예상 `1`이 아니라 `0`으로 재현됐다. 당시 service/socket RED 테스트로 원인을 고정하고 남은 player의 old game socket ownership을 해제한 뒤 lobby sync가 새 socket을 등록하도록 최소 수정했으며, 단위 테스트까지 통과했다. 해당 시점의 Playwright 재실행과 전체 검증은 작업 중단으로 완료되지 않았으므로 이후 현재 코드 기준으로 다시 확인해야 한다.

### 11. Gravity Wrapper 추가 중 반환 Shape 혼선

증상:

- `applyGravityStepToMatchPlayerState()` 테스트에서 처음에는 함수가 없어서 실패했다.
- wrapper 구현 뒤에는 `result.gravityResult.kind`가 `undefined`였다.

확인된 원인:

- `matchService`에서 새 wrapper를 export하지 않은 상태로 테스트를 먼저 추가했다.
- wrapper가 하위 `applyAuthoritativeGravityStep()` 결과 전체를 `gravityResult`에 넣어 반환 구조가 한 단계 더 감싸졌다.

```text
기대: result.gravityResult.kind
실제: result.gravityResult.gravityResult.kind
```

해결:

- `matchService`에 `applyGravityStepToMatchPlayerState(roomId, playerId, gameCore)`를 추가하고 export했다.
- `gravityResult`는 바로 읽을 수 있게 펴서 반환했다.
- 하위 함수의 전체 결과는 `gravityStepResult`로 보존했다.
- `recordInput`, `inputLog`, socket, timer, snapshot emit은 변경하지 않았다.

검증:

- wrapper 호출 후 `authoritativeState.currentTick`이 증가한다.
- `getAuthoritativePlayerSnapshotDto()`의 `snapshot.tick`도 증가한 값을 반환한다.
- wrapper만 호출해도 `inputLog`는 증가하지 않는다.
- `node --test test/testMatchService.js`, `node --test test/testPlayerGameplayStep.js`, `npm test -- --test-reporter=dot`, `git diff --check`를 통과했다.

### 12. 성공 입력마다 Full Authoritative Snapshot 전송

확인 계기:

- 성능 조사에서 성공한 `game:input`마다 board 전체를 포함한 snapshot을 room에
  broadcast하는 경로가 확인됐다.
- 일반 snapshot은 약 1.5~2KB, line-clear presentation을 포함하면 약
  2.7~3.6KB였지만 현재 소수 room 환경에서 병목으로 측정되지는 않았다.

현재 흐름:

```text
local input 적용 성공
→ game:input 전송
→ server authoritative state 적용
→ 최신 snapshot DTO 생성
→ room 전체에 game:authoritative:snapshot broadcast
→ game:input:result 반환
```

이 구조를 선택한 이유:

1. 상대 runtime이 자체 input prediction이나 gravity를 실행하지 않고 server snapshot만
   적용하므로 이동·회전 결과도 바로 전달해야 했다.
2. 내 runtime의 local prediction과 server state가 달라질 때 최신 원본으로 보정해야 했다.
3. snapshot의 `lastProcessedClientSequence`로 pending server input을 정리하고 오래된
   snapshot이 최신 입력을 되돌리지 않게 해야 했다.
4. lock, garbage, line clear, game over와 presentation effect를 같은 authoritative
   채널에서 전달하는 것이 MVP 단계에서 가장 단순했다.

Git 이력상 최초 경로는 `26c9526 feat: add server authoritative snapshot path`에서
추가됐다. 이후 `e68177c`에서 prediction correction, `b5bb27d`에서 input sequence와
stale snapshot 방지가 보강되면서 snapshot이 acknowledgment와 correction 근거까지
담당하게 됐다.

판단:

- 입력 acknowledgment 자체에 full snapshot이 반드시 필요한 것은 아니다.
- 현재 방식은 정확성과 구현 속도를 우선한 correctness-first 선택이다.
- 보드 복사와 Zod 검증은 현재 병목으로 측정되지 않았으며, 동시 room 부하가 확인되기
  전에 전송 구조를 먼저 복잡하게 만들 필요는 없다.

확장 시 전환 기준:

```text
매 입력
→ 작은 game:input:result acknowledgment

50~100ms 주기
→ 같은 player의 최신 snapshot 한 개로 coalescing

즉시 snapshot
→ lock / line clear / garbage / game over / prediction divergence
```

최적화 전에는 `snapshot count/bytes`, input acknowledgment latency, event-loop delay와
room 수별 전송량을 먼저 측정한다. 상대 active piece 표시가 끊기지 않는지도 함께
검증해야 하며, 단순히 snapshot 횟수만 줄여서는 안 된다.

### 공통 실행 흐름

최종적으로 정리한 multiplayer 입력 흐름은 다음과 같다.

```text
keyboard input
→ local runtime outcome
→ applied input만 clientSequence 부여
→ player mutation queue
→ authoritative core 적용
→ acknowledgment + snapshot
→ 최신 sequence 기준 correction
→ authoritative placement commit 뒤 log 저장
```

### 핵심 교훈

1. **Authoritative 시스템에서 mutation 순서는 상태 값만큼 중요하다.**
2. **입력 발생과 입력 적용 성공을 구분해야 한다.**
3. **Snapshot은 최신 sequence를 증명할 때만 적용한다.**
4. **게임 상태와 animation presentation을 분리한다.**
5. **학습 로그는 local prediction이 아니라 authoritative commit을 기준으로 저장한다.**
6. **Socket ID는 player identity가 아니라 현재 연결 ownership이다.**
7. **단위 테스트와 실제 2탭 lifecycle 검증은 서로 대체할 수 없다.**
