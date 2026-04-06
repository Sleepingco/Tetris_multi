# Multiplayer Protocol Draft

## 1. 목적

이 문서는 멀티플레이 구현 전에 이벤트 이름과 payload shape를 먼저 고정하기 위한 초안이다.

현재 `src/net/chat.js`와 `src/app.js`는 채팅 수준의 Socket.IO 실험만 가지고 있다.

멀티플레이 단계에서는 다음 문제가 생기기 쉽다.

- 클라이언트와 서버가 서로 다른 payload를 가정함
- 어떤 이벤트가 authoritative인지 불명확함
- 입력, 상태, 결과 이벤트가 섞임

이 문서는 그 혼선을 줄이기 위한 기준점이다.

## 2. 기본 원칙

### 2.1 서버 authoritative

운영 경로에서는 서버가 진실의 원천이다.

클라이언트는:

- 입력을 보냄
- 서버 상태를 반영함
- 필요하면 임시 예측을 할 수 있음

서버는:

- room 상태를 관리함
- match 시작 조건을 확정함
- authoritative tick과 snapshot을 보냄
- 결과를 확정함

### 2.2 액션과 상태를 분리

서버에 보내는 것은 기본적으로 action이다.

예:

- `move_left`
- `move_right`
- `soft_drop`
- `rotate`
- `hard_drop`
- `hold`

클라이언트가 직접 board 전체를 진실처럼 보내지 않는다.

### 2.3 이벤트 이름은 범주 중심으로 설계

권장 형식:

```text
domain:action
```

예:

```text
room:create
room:join
match:start
game:input
game:snapshot
match:finish
```

## 3. 공통 메타 필드

거의 모든 이벤트는 아래 공통 필드를 가질 수 있다.

```json
{
  "roomId": "room_123",
  "playerId": "player_a",
  "timestamp": 1711111111111
}
```

설명:

- `roomId`: 어느 방의 이벤트인지
- `playerId`: 이벤트 주체
- `timestamp`: 클라이언트 또는 서버 생성 시각

추가로 게임 진행 이벤트에는 `tick`이 자주 포함된다.

## 4. Room/Matchmaking 이벤트

### `room:create`

목적:

- 새 room 생성 요청

client -> server

```json
{
  "nickname": "park",
  "mode": "versus",
  "isPrivate": false
}
```

server -> client ack 예시

```json
{
  "ok": true,
  "roomId": "room_123",
  "hostPlayerId": "player_a"
}
```

### `room:join`

목적:

- 기존 room 참여 요청

client -> server

```json
{
  "roomId": "room_123",
  "nickname": "guest"
}
```

server -> room broadcast 예시

```json
{
  "roomId": "room_123",
  "players": [
    { "playerId": "player_a", "nickname": "park", "ready": false },
    { "playerId": "player_b", "nickname": "guest", "ready": false }
  ]
}
```

### `room:leave`

목적:

- room 퇴장 또는 연결 종료 알림

### `room:state`

목적:

- 현재 room 상태 전체 전달

예시:

```json
{
  "roomId": "room_123",
  "status": "waiting",
  "players": [
    { "playerId": "player_a", "nickname": "park", "ready": true },
    { "playerId": "player_b", "nickname": "guest", "ready": false }
  ]
}
```

### `match:ready`

목적:

- ready 상태 토글

client -> server

```json
{
  "roomId": "room_123",
  "ready": true
}
```

### `match:start`

목적:

- 실제 경기 시작

server -> room broadcast

```json
{
  "roomId": "room_123",
  "matchId": "match_001",
  "seed": 123456,
  "startTick": 0,
  "tickRate": 30
}
```

설명:

- `seed`: 같은 piece sequence를 공유하기 위한 값
- `startTick`: authoritative 시작 tick
- `tickRate`: 서버 기준 ticks per second

## 5. In-match 이벤트

### `game:input`

목적:

- 플레이어 입력 전달

client -> server

```json
{
  "roomId": "room_123",
  "matchId": "match_001",
  "playerId": "player_a",
  "tick": 42,
  "action": "move_left"
}
```

현재 코드 기준 action 후보:

- `move_left`
- `move_right`
- `soft_drop`
- `rotate`
- `hard_drop`
- `hold`

참고:

- 이 값은 `src/game/input.js`의 action 이름과 맞춘다.
- 네트워크에서는 `moveCause`가 아니라 `action`을 보낸다.

### `game:input_batch`

목적:

- 네트워크 효율을 위해 여러 입력을 한 번에 보낼 때 사용

client -> server

```json
{
  "roomId": "room_123",
  "matchId": "match_001",
  "playerId": "player_a",
  "inputs": [
    { "tick": 42, "action": "move_left" },
    { "tick": 43, "action": "rotate" }
  ]
}
```

### `game:snapshot`

목적:

- authoritative 게임 상태 일부 또는 전체 전달

server -> room broadcast

```json
{
  "roomId": "room_123",
  "matchId": "match_001",
  "tick": 60,
  "players": [
    {
      "playerId": "player_a",
      "score": 1200,
      "board": [],
      "activePiece": {
        "pieceType": "tee",
        "rotation": 1,
        "row": 5,
        "col": 4
      },
      "holdPieceType": "bar",
      "nextQueue": ["square", "leftZee"],
      "phase": "playing",
      "pendingGarbage": 0
    },
    {
      "playerId": "player_b",
      "score": 900,
      "board": [],
      "activePiece": {
        "pieceType": "bar",
        "rotation": 0,
        "row": 3,
        "col": 4
      },
      "holdPieceType": null,
      "nextQueue": ["tee", "square"],
      "phase": "playing",
      "pendingGarbage": 2
    }
  ]
}
```

설명:

- 초반에는 full snapshot으로 시작해도 된다.
- 이후 필요하면 delta snapshot으로 줄일 수 있다.

### `game:garbage`

목적:

- 공격 라인 발생 알림

server -> target client 또는 room broadcast

```json
{
  "roomId": "room_123",
  "matchId": "match_001",
  "tick": 61,
  "fromPlayerId": "player_a",
  "toPlayerId": "player_b",
  "lines": 2
}
```

### `game:pause`

목적:

- 경기 일시정지 요청 또는 상태 알림

비고:

- MVP에서는 제외 가능

### `game:resync`

목적:

- desync 의심 시 강제 스냅샷 재전송

server -> client

```json
{
  "roomId": "room_123",
  "matchId": "match_001",
  "tick": 90,
  "reason": "checksum_mismatch"
}
```

## 6. Match result 이벤트

### `match:finish`

목적:

- 승패 확정

server -> room broadcast

```json
{
  "roomId": "room_123",
  "matchId": "match_001",
  "winnerPlayerId": "player_a",
  "reason": "top_out",
  "finalTick": 321
}
```

가능한 종료 이유 예시:

- `top_out`
- `disconnect`
- `forfeit`

## 7. 상태 모델 초안

서버가 room 기준으로 관리해야 하는 최소 상태:

```json
{
  "roomId": "room_123",
  "status": "waiting",
  "players": [
    {
      "playerId": "player_a",
      "nickname": "park",
      "ready": true,
      "connected": true
    }
  ],
  "match": {
    "matchId": "match_001",
    "seed": 123456,
    "tickRate": 30,
    "currentTick": 0,
    "phase": "playing"
  }
}
```

## 8. MVP 범위에서의 단순화

MVP에서는 아래 단순화를 허용한다.

- full snapshot 사용
- room size는 2명 고정
- reconnect는 제한 시간 내 재입장만 허용
- spectator 없음
- chat은 별도 이벤트로 분리

이 단순화는 구현 속도를 높이기 위한 것이다.

## 9. 구현 전 확인해야 할 질문

코드로 들어가기 전에 아래 질문의 답을 확정해야 한다.

- 입력을 클라이언트에서 tick 붙여 보내는가
- 서버가 자체 tick으로 재정렬하는가
- snapshot 주기는 몇 tick마다 보낼 것인가
- garbage는 즉시 적용하는가, queue로 누적하는가
- disconnect 시 몇 초까지 재입장을 허용할 것인가

## 10. 권장 다음 단계

이 문서 다음으로 바로 이어질 작업:

1. `src/net/chat.js`를 채팅 전용과 게임 전용으로 역할 분리
2. `src/app.js`에 room 상태와 match 상태 구조 추가
3. action enum을 프로토콜 문서와 1:1로 유지
4. `match:start`, `match:ready`, `game:input`부터 최소 구현 시작

이 순서가 가장 작은 단위로 멀티플레이 MVP에 접근하는 경로다.
