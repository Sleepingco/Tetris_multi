# Modern Tetris Handling Options and Lock Delay Plan

- 작성일: 2026-07-22
- 상태: 설계 완료, 구현 미시작
- 기준: `main@84f8659`
- 작업 브랜치: `codex/modern-tetris-handling-plan`
- 범위: 옵션 UI, DAS, ARR, SDF, IRS, IHS, Lock Delay와 최대 move reset

## 1. 목표

브라우저 키 반복에 의존하는 현재 입력을 게임 tick 기반 입력으로 바꾸고, 싱글과
server authoritative 멀티플레이가 같은 모던 테트리스 조작 규칙을 사용하게 한다.

완료 기준은 다음과 같다.

1. 같은 키 입력과 경과 시간은 OS 키 반복 설정과 무관하게 같은 action sequence를 만든다.
2. 싱글 local runtime과 멀티 서버가 Soft Drop과 Lock Delay를 같은 규칙으로 판정한다.
3. IRS/IHS가 placement action보다 먼저 서버에 전송되지 않는다.
4. 기본 15회 제한은 전체 조작 수가 아니라 착지 후 성공한 이동·회전의 Lock Delay reset 수로 계산한다.
5. 기존 `action → inputQueue → local prediction → game:input → authoritative apply` 경계를 유지한다.
6. 사용자는 옵션 버튼에서 조작값을 저장하고, 다음 Single 게임 또는 멀티 match를 그 값으로 플레이한다.

## 2. 이번 작업에서 하지 않는 것

- ARR 0의 즉시 벽 이동
- 무한 SDF 또는 sonic drop
- DCD, DAS preservation과 고급 양방향 동시 입력 정책
- 180도 회전, 반시계 회전 키 추가
- ARE 또는 line clear delay 변경
- Infinity, Classic Lock Down 같은 복수 ruleset 선택 UI
- AI action cadence와 placement policy 변경
- 새 dependency 또는 입력 manager/service 추가
- 진행 중인 match의 설정을 즉시 바꾸는 live reconfiguration

옵션은 게임 시작 전에 확정한다. Single은 새 게임 `init()` 시점, 멀티는 room/match
시작 시점의 값을 해당 게임이 끝날 때까지 유지한다.

## 3. 현재 코드 기준 사실

### 입력

- `src/client/game/runtime/input.ts`는 `keydown`만 구독한다.
- 좌우와 Soft Drop 반복은 브라우저가 만드는 `event.repeat`에 의존한다.
- 회전, Hold, Hard Drop은 반복 이벤트를 무시한다.
- `keyup`, 눌린 action 상태와 입력별 누적 시간이 없다.
- 싱글과 멀티는 모두 같은 `attachKeyboardInput()`을 사용한다.

### Spawn과 Hold

- `startNextTurn()`은 rotation 0 조각을 만들고 즉시 `renderBlocks("spawn")`을 호출한다.
- `holdPiece()`는 교체 조각을 spawn한 뒤 자체적으로 spawn render를 호출한다.
- 입력 큐는 `pieceIndex`가 다른 이전 조각 입력을 폐기한다. 이 보호는 유지해야 한다.

### Lock

- 싱글은 첫 blocked gravity에서 `automaticGroundedPieceIndex`를 기록하고 다음
  blocked gravity에서 고정한다.
- 서버도 `groundedPieceIndex`로 같은 2단계 grace를 사용한다.
- 실제 바닥 접촉부터 독립된 500ms timer를 재지 않는다.
- 수동 좌우 이동과 회전은 grace를 reset하지 않는다.
- blocked Soft Drop은 현재 즉시 고정된다.

## 4. 확정할 게임 규칙과 옵션 범위

| 규칙 | 기본값 | 허용 범위 | 적용 범위 | 프로젝트 동작 |
| --- | ---: | ---: | --- | --- |
| DAS | 167ms | 50~500ms | 사용자 개인 | 첫 좌우 이동 후 이 시간만큼 기다리고 반복을 시작한다. |
| ARR | 33ms | 33~200ms | 사용자 개인 | DAS가 끝난 뒤 활성 방향으로 한 칸씩 반복한다. |
| SDF | 10 | 1~10 | 사용자 개인 | 현재 500ms 중력을 기준으로 기본 50ms마다 한 칸 Soft Drop한다. |
| IRS | enabled | on/off | 사용자 개인 | spawn transaction에서 Hold 처리 후 회전 1회를 적용한다. |
| IHS | enabled | on/off | 사용자 개인 | spawn transaction에서 Hold가 눌려 있으면 Hold 1회를 먼저 적용한다. |
| Lock Delay | 500ms | 200~1000ms | Single 개인 / 멀티 room | grounded 상태가 이어진 시간으로 계산한다. |
| Move reset | 15회 | 0~30회 | Single 개인 / 멀티 room | grounded 상태의 성공한 좌우 이동·회전만 reset 예산을 소비한다. |

ARR 최솟값과 SDF 최댓값은 현재 서버 input limit 60/초 안에서 좌우+Soft Drop을
함께 유지할 수 있도록 제한한다. 더 빠른 범위는 batching이나 rate 정책을 별도
설계한 뒤 확장한다.

공개된 가이드라인 설명은 move reset을 최대 15회로 설명한다. 이 계획에서는
다음 세부 동작을 명시적으로 선택한다.

- 실패한 이동이나 회전은 reset 수를 소비하지 않는다.
- 15번째 성공 조작까지 timer를 reset한다.
- 예산 소진 뒤에도 남은 Lock Delay 동안 조작은 적용하지만 timer는 reset하지 않는다.
- 조각이 이전보다 낮은 새 row에 도달하면 reset 예산을 0으로 되돌린다.
- 위로 wall kick한 뒤 같은 row로 돌아오는 것만으로 예산을 회복하지 않는다.
- Hard Drop은 Lock Delay를 거치지 않고 즉시 고정한다.
- blocked Soft Drop은 고정하지 않고 grounded 상태만 시작하거나 유지한다.

참고: [Tetris Guideline Lock Down](https://tetris.wiki/Tetris_Guideline),
[Lock delay](https://tetris.wiki/Lock_delay)

## 5. 옵션 UI와 저장 설계

옵션 버튼은 게임이 진행되지 않는 `index`와 멀티 로비에 둔다. active Single/PVP
화면에 modal을 띄워 조작 중인 timer를 바꾸거나 멀티 경기 중 입력을 가로막지 않는다.

```text
index 옵션 버튼
  ├─ 개인 조작: DAS / ARR / SDF / IRS / IHS
  └─ Single 규칙: Lock Delay / Move reset

멀티 로비 옵션 버튼
  ├─ 개인 조작: DAS / ARR / SDF / IRS / IHS
  └─ 방 생성자 규칙: Lock Delay / Move reset
```

UI는 새 modal dependency 대신 native `<dialog>`와 form control을 사용한다.

- 숫자 항목은 단위와 허용 범위를 표시하는 `<input type="number">`를 사용한다.
- IRS/IHS는 checkbox를 사용한다.
- `저장`, `기본값 복원`, `취소` 버튼을 제공한다.
- 저장 실패나 범위 오류는 dialog 안의 `role="alert"`에 표시한다.
- Escape와 취소는 draft를 버리고 저장값을 바꾸지 않는다.
- 저장한 값은 다음 게임부터 적용된다는 안내를 표시한다.

index와 멀티 로비에서 같은 form을 실제로 사용하므로 이때만 공용 React component를
한 개 둔다. 페이지별 wrapper나 별도 options manager는 만들지 않는다.

### 개인 설정 저장

개인 조작과 선호 Lock 규칙은 브라우저 `localStorage`의 versioned JSON 하나로 저장한다.
선호 Lock 규칙은 Single에서 직접 사용하고, host가 새 멀티 room을 만들 때 초기값으로 사용한다.

```ts
type HandlingPreferencesV1 = {
    version: 1;
    dasMs: number;
    arrMs: number;
    softDropFactor: number;
    irsEnabled: boolean;
    ihsEnabled: boolean;
    preferredLockDelayMs: number;
    preferredMaxLockResets: number;
};
```

- key: `tetris:handling:v1`
- 저장값이 없거나 JSON/필드/범위가 잘못되면 전체 기본값을 사용한다.
- 알 수 없는 필드는 무시하고 현재 version만 읽는다.
- `JSON.parse`, `Number.isInteger`와 범위 검사만 사용한다.
- runtime은 `localStorage`를 직접 읽지 않고 page/session entry가 읽어 option으로 전달한다.

### 멀티플레이 규칙

DAS/ARR/SDF/IRS/IHS는 각 사용자의 입력 장치 처리이므로 개인값을 사용한다. 반면
Lock Delay와 Move reset은 승패에 직접 영향을 주므로 player별 값으로 허용하지 않는다.

- host가 방 생성 전에 옵션 dialog에서 room 규칙을 선택한다.
- create-room payload에 `lockDelayMs`, `maxLockResets`를 포함한다.
- 서버 schema가 범위를 검증하고 `roomService`가 room 규칙을 소유한다.
- `matchService`는 room 규칙을 양쪽 authoritative state에 동일하게 복사한다.
- guest는 참가한 room의 규칙을 읽기 전용으로 확인한다.
- match 시작 뒤에는 host도 값을 바꿀 수 없다.
- legacy room/payload에 값이 없으면 500ms/15회를 사용한다.

## 6. 책임 경계

```text
DOM keydown / keyup
        │
        ▼
runtime/input.ts
  key → InputAction 정규화
        │ setInputPressed(action, pressed)
        ▼
runtime/tetris.ts
  injected options + held state + DAS/ARR/SDF timer
        │ enqueueInput(existing action)
        ▼
기존 inputQueue / local prediction
        │
        ├─ single: local authoritative result
        │
        └─ multi: game:input → server mutation FIFO
                              │
                              ▼
                    authoritativeState + ticker
```

- `input.ts`는 DOM 이벤트 정규화와 listener 정리만 담당한다.
- `tetris.ts`는 눌린 action, 반복 시간, spawn buffering과 local prediction을 소유한다.
- `state/handlingSettings.ts`는 기본값, localStorage parse/save와 범위 검사만 담당한다.
- `core/lockDelay.ts`는 DOM과 timer 없이 Lock 상태 전이만 계산한다.
- 서버 `playerGameplayStep`은 authoritative 조각 이동과 Lock 상태를 함께 변경한다.
- `authoritativeTickerService`는 경과 시간을 공급하지만 Lock 규칙을 만들지 않는다.
- React option dialog는 저장 전 draft만 소유하며 gameplay state를 소유하지 않는다.

## 7. 입력 상태 설계

눌린 키 상태는 gameplay snapshot이 아니라 현재 장치의 일시적 입력 상태다. 따라서
serialize하지 않고 runtime에만 둔다.

```ts
type HeldInputState = {
    pressedActions: Set<InputAction>;
    activeHorizontalAction: "move_left" | "move_right" | null;
    dasElapsedMs: number;
    arrElapsedMs: number;
    softDropElapsedMs: number;
};
```

### Key transition

- 최초 `keydown`: action을 pressed로 바꾸고 즉시 action 1회를 enqueue한다.
- 반복 `keydown`: 모두 무시한다. 반복은 runtime tick만 만든다.
- `keyup`: 해당 action을 pressed에서 제거하고 관련 누적 시간을 정리한다.
- `blur`, `pagehide`, destroy: 모든 pressed state를 비운다.
- 좌우를 동시에 누르면 마지막으로 누른 방향을 활성 방향으로 사용한다.
- 활성 방향을 놓았는데 반대 방향이 아직 눌려 있으면 반대 방향을 새 입력처럼 시작한다.

### Repeat scheduling

`processTick(deltaMs)`는 입력 큐를 소비하기 전에 DAS/ARR/SDF 누적 시간을 갱신하고
이번 tick에 필요한 action을 enqueue한다.

- 탭 정지 후 돌아왔을 때 놓친 반복 입력을 한꺼번에 재생하지 않는다.
- 한 action 종류당 한 tick에서 반복 action을 최대 1개만 만든다.
- 초기 DAS/ARR/SDF 조합의 자동 반복은 정상 상태에서 초당 약 50 action 이하여야 한다.
- 현재 서버 input limit 60/초는 변경하지 않는다.
- 실제 single + horizontal + soft drop 통합 테스트가 rate limit에 닿으면 구현을 멈추고
  SDF batching 또는 별도 rate 정책을 설계한다. 보안 경계를 조용히 완화하지 않는다.

runtime은 생성 또는 `init()` 때 전달받은 immutable `HandlingPreferencesV1` 값을 사용한다.
게임 중 localStorage가 바뀌어도 현재 게임의 반복 간격은 변경하지 않는다.

## 8. IRS/IHS spawn transaction

IRS/IHS는 이전 조각 action보다 먼저 서버에 도착하면 `pieceIndex`가 어긋난다. 따라서
spawn 중 즉시 별도 Socket event를 보내지 않고 기존 input outcome 순서를 사용한다.

```text
현재 조각 placement 확정
    │
    ├─ 새 pieceIndex와 기본 spawn piece 준비
    ├─ held Hold가 있으면 IHS 1회 예약
    ├─ held Rotate가 있으면 IRS 1회 예약
    └─ placement outcome 기록/전송
            │
            ▼
       IHS → IRS 순서로 기존 action 처리
            │
            ▼
       최종 spawn collision 판정과 render
```

구현 규칙:

- IHS를 먼저 처리하고 최종 active piece에 IRS를 적용한다.
- spawn transaction당 IHS와 IRS는 각각 최대 한 번만 적용한다.
- IHS가 만든 교체 조각에 다시 IHS를 재귀 적용하지 않는다.
- initial action도 현재 `pieceIndex`, `tick`, `clientSequence`를 가진 정상 action으로 기록한다.
- placement input outcome을 먼저 publish한 뒤 initial action outcome을 publish한다.
- 최종 IHS/IRS 상태로 spawn collision을 판정해 기본 orientation의 중간 render를 노출하지 않는다.
- Hold/Rotate가 실제로 적용되지 않으면 기존 실패 결과를 유지하고 조작을 반복하지 않는다.

이를 위해 `startNextTurn()`은 initial action이 있을 때 spawn을 바로 확정하지 않고
`pendingInitialActions`를 남긴다. 외부 placement outcome 기록이 끝난 직후 같은 call
stack에서 initial action과 최종 spawn render를 완료한다. 별도 timer나 microtask는
추가하지 않는다.

IRS/IHS가 꺼진 경우 해당 initial action을 예약하지 않는다. 옵션을 꺼도 일반 tap
Rotate/Hold action은 기존처럼 동작한다.

## 9. Lock 상태 설계

싱글 예측과 서버 authoritative snapshot이 reconnect/correction 뒤에도 같은 결론을
내리도록 Lock 상태는 gameplay state에 포함한다.

```ts
type LockDelayState = {
    grounded: boolean;
    elapsedMs: number;
    resetCount: number;
    lowestRow: number;
};
```

상태 전이:

1. spawn/Hold: `grounded=false`, `elapsedMs=0`, `resetCount=0`, `lowestRow=row`.
2. 성공한 아래 이동:
   - `row > lowestRow`이면 `lowestRow=row`, `resetCount=0`.
   - 이동 후 바닥이면 grounded timer를 시작하고, 아니면 timer를 0으로 비운다.
3. 성공한 좌우 이동/회전:
   - 이동 후 공중이면 `grounded=false`, `elapsedMs=0`.
   - 이동 후 grounded이고 `resetCount < maxLockResets`면 count를 증가시키고 timer를 0으로 reset한다.
   - count가 설정된 최댓값이면 조각 위치만 반영하고 timer는 유지한다.
4. 실패한 조작: Lock 상태를 바꾸지 않는다.
5. grounded tick: `elapsedMs += deltaMs`; 설정된 `lockDelayMs` 이상이면 고정한다.
6. Hard Drop/game over/new piece: 이전 Lock 상태를 폐기한다.

`core/lockDelay.ts`에는 local/server가 실제로 함께 호출하는 두 순수 함수만 둔다.

- 이동 결과 뒤 grounded/reset 상태 갱신
- grounded 경과 시간 누적과 lock 도달 여부 계산

렌더 계층에서는 grounded나 reset 수를 판정하지 않는다.

## 10. 서버 authoritative 처리

현재 `groundedPieceIndex` 방식은 제거한다. Lock 상태의 단일 진실 원천은 player의
`authoritativeState.lockDelay`다.

서버 tick 순서는 다음으로 고정한다.

1. player mutation FIFO 안에서 authoritative state를 읽는다.
2. grounded player이면 매 100ms room tick에서 Lock 경과 시간을 누적한다.
3. room의 `lockDelayMs`에 도달하면 기존 lock/line clear/spawn 경로를 호출하고 gravity step을 건너뛴다.
4. Lock되지 않았고 gravity가 due이면 아래 이동을 한 번 적용한다.
5. 이동 후 shared Lock helper로 grounded 여부와 lowest row를 갱신한다.
6. placement 뒤 gravity accumulator와 Lock 상태를 새 조각 기준으로 초기화한다.

성공한 `move_left`, `move_right`, `rotate`, `soft_drop` 입력은 이미 같은 mutation FIFO를
지나므로 적용 직후 shared helper를 호출한다. ticker의 gravity accumulator를 조작
reset에 재사용하지 않는다. 조작으로 Lock Delay를 연장해도 낙하 주기는 바뀌지 않는다.

snapshot에는 `lockDelay`를 포함한다. client `applySnapshot()`은 해당 값을 복원하고,
누락된 legacy snapshot은 새 조각 기준 기본 상태로 정규화한다. trust boundary schema는
boolean, non-negative finite elapsed, room 범위 안의 reset count와 integer lowest row를 검증한다.

match DTO와 snapshot에는 확정된 room handling rule도 포함한다. 클라이언트는 서버가
내린 값을 local Lock prediction에 사용하며 자신의 Single 규칙으로 덮어쓰지 않는다.

## 11. 예상 파일 범위

### Client/core

- Modify: `src/client/game/state/config.ts`
- Add: `src/client/game/state/handlingSettings.ts`
- Modify: `src/client/game/runtime/input.ts`
- Modify: `src/client/game/runtime/tetris.ts`
- Modify: `src/client/game/state/stateFactory.ts`
- Modify: `src/client/game/state/stateSerialization.ts`
- Add: `src/client/game/core/lockDelay.ts`
- Modify: `src/client/pages/tetrisSingle.tsx`
- Modify: `src/client/pages/index.tsx`
- Modify: `src/client/pages/multiLobby.tsx`
- Add: `src/client/pages/components/HandlingOptionsDialog.tsx`
- Modify: `src/client/game/entry/multiplayerGameSession.ts`

### Server/shared contract

- Modify: `src/server/services/playerStateInput.ts`
- Modify: `src/server/services/playerGameplayStep.ts`
- Modify: `src/server/services/authoritativeTickerService.ts`
- Modify: `src/server/services/matchService.ts`
- Modify: `src/server/services/roomService.ts`
- Modify: `src/server/sockets/multiplayerHandlers.ts`
- Modify: `src/shared/socketContracts.mjs`
- Modify: `src/shared/socketContractTypes.d.ts`

파일 목록은 상한이 아니라 현재 호출 흐름 기준 예상치다. 실제 구현에서 변경 이유가
없는 파일은 건드리지 않는다.

## 12. 구현 계획

### Task 0. 기존 동작 characterization

- [ ] OS repeat keydown이 좌우/Soft Drop action을 만드는 현재 동작을 테스트로 고정한다.
- [ ] 자연 중력의 2단계 grace와 blocked Soft Drop 즉시 lock을 테스트로 확인한다.
- [ ] hard drop/hold 뒤 `pieceIndex`와 input outcome 순서를 확인한다.
- [ ] 기준선에서 `bash scripts/verify.sh`를 실행한다.

완료 조건: 바꿀 동작과 유지할 동작이 테스트 이름으로 구분된다.

### Task 1. 옵션 계약과 UI

- [ ] 기본값, 허용 범위와 `HandlingPreferencesV1` parse/save 함수를 추가한다.
- [ ] invalid/partial/wrong-version localStorage가 전체 기본값으로 복구되는지 테스트한다.
- [ ] native dialog 기반 공용 옵션 form을 추가한다.
- [ ] index와 멀티 로비에 옵션 버튼을 연결한다.
- [ ] 저장/취소/기본값 복원, keyboard focus와 오류 안내를 테스트한다.
- [ ] Single runtime과 multiplayer session 생성 시 저장된 개인값을 주입한다.
- [ ] room create/join/match DTO에 Lock rule을 추가하고 서버 범위 검증을 적용한다.

완료 조건: 저장 후 새로고침해도 값이 유지되고 새 게임/match가 저장값 또는 room 값을 받는다.

### Task 2. Held input과 DAS/ARR

- [ ] `input.ts`에 keyup/blur 정리와 browser repeat 무시를 추가한다.
- [ ] runtime에 pressed state와 마지막 좌우 방향 정책을 추가한다.
- [ ] 주입된 DAS/ARR 값을 기존 input queue action으로 생성한다.
- [ ] destroy/applySnapshot/game over에서 stuck input이 남지 않게 정리한다.
- [ ] tap, DAS 직전, DAS 도달, ARR 반복, keyup, 방향 전환 테스트를 추가한다.

완료 조건: OS 키 반복 속도를 바꿔도 생성 action sequence가 같다.

### Task 3. SDF와 non-locking Soft Drop

- [ ] 주입된 SDF 누적 시간을 runtime tick에 추가한다.
- [ ] blocked Soft Drop이 즉시 고정되지 않도록 client/server 판정을 함께 바꾼다.
- [ ] Soft Drop action과 자동 중력이 같은 tick에 있을 때 아래 이동 순서를 고정한다.
- [ ] 좌우+Soft Drop 유지 통합 테스트로 60/초 input limit 여유를 확인한다.
- [ ] 기존 Soft Drop 점수 정책은 변경하지 않는다.

완료 조건: 아래 키를 놓으면 즉시 정상 gravity로 돌아가고 바닥에서는 Lock Delay가 시작된다.

### Task 4. IRS/IHS

- [ ] placement 뒤 initial action을 보관하는 spawn transaction을 추가한다.
- [ ] IHS → IRS → final spawn validation 순서를 구현한다.
- [ ] IRS/IHS option이 꺼졌을 때 initial action만 생략되는지 확인한다.
- [ ] placement outcome 다음에 initial outcome이 기록·전송되는지 검증한다.
- [ ] Hold 빈 슬롯/찬 슬롯, Hold 사용 제한, 회전 wall kick과 block out을 테스트한다.
- [ ] 키를 계속 누른 여러 spawn에서 piece당 한 번만 적용되는지 확인한다.

완료 조건: 싱글과 멀티에서 최종 active piece와 `pieceIndex`가 수렴한다.

### Task 5. 설정형 Lock Delay와 move reset

- [ ] shared Lock helper와 `LockDelayState`를 추가한다.
- [ ] client의 `automaticGroundedPieceIndex` 경로를 새 상태로 교체한다.
- [ ] server의 `groundedPieceIndex` 경로를 제거한다.
- [ ] 성공/실패 조작, 설정된 reset 소진, 0/15/30 경계, 새 lowest row와 wall kick 상태 전이를 테스트한다.
- [ ] snapshot schema/serialization/correction/reconnect에 Lock 상태를 포함한다.
- [ ] Single 개인 규칙과 멀티 room 규칙이 각 mode에 맞게 주입되는지 확인한다.
- [ ] hard drop, line clear, garbage, game over 경로가 기존 결과를 유지하는지 확인한다.

완료 조건: 같은 fixture와 elapsed sequence에서 client/server가 같은 lock tick과 board를 만든다.

### Task 6. 회귀 검증

- [ ] `bash scripts/verify.sh`
- [ ] `npm run test:e2e -- e2e/singlePlayer.spec.js`
- [ ] `npm run test:e2e -- e2e/multiplayerRollback.spec.js --repeat-each=5`
- [ ] `npm run test:e2e -- e2e/multiplayerGameOver.spec.js e2e/multiplayerPve.spec.js`
- [ ] 수동 Single: tap, DAS/ARR, diagonal movement+Soft Drop, IRS/IHS, 15 reset 확인
- [ ] 수동 PVP: 양쪽 board 수렴, rate limit/rollback/console error 0 확인
- [ ] 수동 옵션: 저장/새로고침/기본값 복원과 Single/PVP 실제 적용 확인

완료 조건: 자동 gate가 모두 통과하고 Single/PVP 수동 확인에서 입력 stuck과 rollback이 없다.

## 13. 핵심 테스트 표

| 시나리오 | 기대 결과 |
| --- | --- |
| 좌우 keydown 후 166ms | 최초 한 칸 외 반복 없음 |
| 167ms 도달 | 첫 DAS 반복 발생 |
| 이후 33ms마다 유지 | ARR action 한 번씩 발생 |
| keyup | 추가 action 0 |
| 브라우저 repeat keydown | 추가 action 0 |
| 아래 키 500ms 유지 | 현재 기준 약 10칸 Soft Drop |
| 바닥에서 Soft Drop | 즉시 lock하지 않고 500ms timer 시작 |
| grounded 성공 이동 15회 | 각 성공마다 resetCount 증가, 최대 15 |
| 16번째 grounded 이동 | 위치는 바뀔 수 있지만 timer는 reset되지 않음 |
| 막힌 이동/회전 | resetCount와 timer 변화 없음 |
| 더 낮은 새 row 도달 | resetCount 0으로 회복 |
| Hard Drop | 즉시 lock |
| Hold+Rotate를 spawn 전에 유지 | IHS 뒤 최종 piece에 IRS 적용 |
| hard drop과 IRS/IHS 연속 | 서버에는 hard drop outcome이 먼저 도착 |
| authoritative correction | Lock 상태까지 server snapshot으로 복원 |
| 옵션 저장 후 새 Single 시작 | 저장된 DAS/ARR/SDF/IRS/IHS와 Single Lock 규칙 사용 |
| host가 custom Lock room 생성 | host/guest 모두 같은 room Lock 규칙 사용 |
| guest 개인 Lock 저장값이 다름 | 현재 PVP room 규칙을 덮어쓰지 않음 |
| invalid localStorage 또는 room rule | 안전 기본값 또는 schema rejection 적용 |

## 14. 중단 조건

다음 중 하나가 발생하면 범위를 임의로 넓히지 않고 구현을 멈춘다.

- 정상 DAS/ARR/SDF 조합이 현재 60/초 rate limit에 반복적으로 걸린다.
- snapshot에 Lock 상태를 넣지 않고는 reconnect parity를 유지할 수 없다.
- IRS/IHS의 정확한 outcome 순서를 위해 새 Socket event가 필요해진다.
- PVE AI cadence나 placement log schema 변경이 필수가 된다.
- 현재 main의 migration Goal 선행조건과 충돌한다.

이 경우 필요한 추가 선택지는 별도 변경으로 제안하며, 이 계획에 몰래 포함하지 않는다.
