# Tetris Multi 프로젝트 구조 및 확장 의도 보고서

> 기준 시점: 2026-07-14. 이 문서는 현재 코드와 `change-log.md`의 변경 흐름을 함께 읽어, **현재 무엇이 동작하는지**와 **왜 이 경계로 나누었는지**를 설명한다.

## 1. 한눈에 보는 결론

이 프로젝트는 처음의 DOM 직접 조작형 테트리스에서 출발해, 현재는 다음 세 단계가 서로 침범하지 않도록 정리된 구조다.

```text
순수 게임 규칙                 실행·표현                         네트워크·권위
core / state              ->   runtime / render / ui       ->   Socket.IO / server services
DOM 없이 판정                   브라우저에서 조율                    서버가 최종 상태 결정

                                                     |
                                                     v
                              AI 후보 생성·시뮬레이션·평가 / 플레이 로그
```

- **테트리스 엔진**은 `board` 배열을 단일 진실 원천으로 삼고, 충돌·고정·줄 삭제·공격 같은 규칙을 DOM과 분리한다.
- **멀티플레이**는 서버가 각 플레이어의 authoritative state를 소유한다. 클라이언트는 자기 조작감 때문에 prediction을 유지하지만, 최종 보드·garbage·game over·승패는 서버 snapshot으로 수렴한다.
- **AI**는 게임 화면이나 Socket.IO를 직접 읽지 않는다. 같은 보드 상태에서 가능한 배치를 만들고, 가상으로 실행하고, 수치로 평가하는 순수 함수에서 시작한다.
- **변경 로그와 JSONL 로그**는 단순 기록이 아니라, 구조를 안전하게 진화시키고 이후 휴리스틱 AI·ML·코칭을 검증 가능한 순서로 연결하는 장치다.

즉, 이 프로젝트의 핵심 의도는 “테트리스를 보이게 만드는 코드”를 넘어, **같은 상태와 같은 규칙을 사람이 조작하는 클라이언트, 서버 권위 판정, AI 평가, 로그 분석이 함께 재사용할 수 있게 만드는 것**이다.

## 2. 왜 배열 기반 엔진부터 만들었는가

초기 DOM 중심 구현에서는 화면의 CSS 클래스가 사실상 게임 상태였다. 이 방식은 화면을 빠르게 만들기에는 편하지만, 네트워크로 상태를 보내거나 Node 테스트에서 판정하거나 AI가 보드를 평가하려면 DOM을 흉내 내야 한다.

현재는 `board[row][col]` 배열이 고정 블록의 원천 상태다. 활성 조각, 홀드, 다음 큐, 점수, 콤보 같은 상태도 `state` 계층에 모으고, 화면은 그 결과만 읽어 그린다.

```text
입력(action)
  -> runtime이 입력 큐에서 순서대로 소비
  -> core가 이동 가능 여부/고정/줄 삭제를 계산
  -> state의 board·piece·score 갱신
  -> render와 ui가 상태를 Canvas/DOM에 반영
```

이 전환은 다음 확장을 위한 전제다.

| 필요해진 기능 | DOM이 상태일 때의 문제 | 배열 상태일 때의 해결 |
| --- | --- | --- |
| Node 테스트 | 브라우저와 DOM 준비가 필요 | 보드 배열만 전달해 순수 함수 테스트 |
| 멀티플레이 | 화면 상태를 직렬화·검증하기 어려움 | snapshot DTO로 복사·전송 가능 |
| AI | 화면에서 블록을 다시 읽어야 함 | 동일한 board를 feature와 시뮬레이션에 사용 |
| 리플레이·로그 | 화면 변화만 남아 재현이 약함 | 입력·tick·pieceIndex·board를 기록 가능 |

### 2.1 현재 싱글플레이의 책임 분리

- `src/client/game/core/`
  - 순수 규칙 계층이다. `board.ts`는 보드 생성, 배치 가능 여부, 고정, 줄 삭제를 맡고, `step.ts`는 입력을 이동 시도로 바꾸고 결과를 판정한다.
  - `tSpin.ts`, `attackState.ts`, `garbage.ts`는 점수/공격처럼 게임 규칙에 속한 계산을 분리한다.
  - `boardMetrics.ts`는 보드 높이, 구멍, 울퉁불퉁함 등 AI와 분석에 쓸 수치를 DOM 없이 계산한다.
- `src/client/game/state/`
  - 조각 정의, 큐, 초기 상태, snapshot 직렬화를 담당한다. 여기의 데이터 형태가 런타임·서버·AI 사이의 공통 언어가 된다.
- `src/client/game/runtime/tetris.ts`
  - 게임을 실제로 진행시키는 조율자다. 입력 큐, gravity, spawn/hold/lock 순서, 타이머, snapshot 적용, server bag 소비를 연결한다.
  - 규칙을 새로 만들기보다 core 함수의 결과를 어떤 순서로 적용할지 결정하는 위치다.
- `src/client/game/render/`, `ui/`
  - `board`와 활성 조각을 Canvas에 그리고, 점수·다음 조각·홀드·garbage 표시를 갱신한다. 화면이 규칙을 결정하지 않는 것이 원칙이다.
- `src/client/game/entry/`, `pages/`
  - HTML 페이지별 DOM을 찾고 runtime을 생성하는 시작점이다. 싱글과 멀티의 화면 진입 책임을 엔진과 분리한다.

이 분리는 특히 `core`가 DOM 없이 실행된다는 점에서 중요하다. 같은 입력을 주면 같은 판정이 나오는 방향을 유지해야 서버 판정과 AI 시뮬레이션이 화면 구현에 흔들리지 않는다.

## 3. 멀티플레이: 서버 권위 구조로 바꾼 이유

### 3.1 이전 문제와 전환

초기 멀티 MVP는 클라이언트 입력 relay와 snapshot relay에 가까웠다. 이 방식은 빠르게 두 화면을 연결할 수 있지만, 누가 최종 보드·공격·패배를 결정하는지가 흐려진다. 네트워크 지연이나 클라이언트 차이로 서로 다른 보드를 볼 수 있고, 클라이언트가 공격량 또는 패배를 선언하는 구조는 신뢰성과 디버깅 모두에 약하다.

`change-log.md`의 2026-07-08~10 변경은 이 문제를 해결하기 위한 **server authoritative 전환**이다.

```text
키보드 입력
  -> client prediction: 내 화면을 즉시 반응시킴
  -> game:input
  -> 서버 authoritativeState에 같은 입력 적용
  -> server gravity ticker / lock / garbage / game over 처리
  -> game:authoritative:snapshot
  -> 상대 화면은 full apply, 내 화면은 필요한 경우만 correction
```

여기서 prediction은 최종 진실이 아니라 “조작감”을 위한 임시 상태다. 서버 authoritative state가 최종 진실이며, 클라이언트가 오래 어긋나면 snapshot으로 다시 맞춘다.

### 3.2 서버 측 계층

- `src/app.ts` → `src/server/init.ts`
  - Express 정적 서버, HTTP 서버, Socket.IO 서버를 조립하는 source 실행 계층이며 production은 compiled `dist/server/app.js`에서 시작한다.
- `src/server/sockets/`
  - Socket.IO 이벤트의 입구다. `multiplayerHandlers.ts`는 room/game 이벤트를 받아 서비스 호출과 room broadcast를 담당하고, `chatHandlers.ts`는 채팅 입력 검증과 rate limit을 맡는다.
  - 소켓 핸들러는 규칙을 직접 구현하지 않고, 메시지 경계와 권한 확인에 집중한다.
- `src/server/services/roomService.ts`
  - 방 생성·입장·퇴장·시작·종료·로비 복귀를 `Map` 기반 메모리 상태로 관리한다.
  - 현재 PVP와 PVE mode, human과 `heuristic_ai` player type을 구분한다. PVE 방은 인간 1명과 AI 1명을 자동 구성하고, 다른 인간의 입장은 막는다.
- `src/server/services/matchService.ts`
  - 실제 경기 단위 상태를 관리한다. 플레이어마다 `authoritativeState`, client sequence acknowledgment, server bag chunk를 보관한다.
  - authoritative state에는 board, active/pending piece, queue, hold, score, lines, combo, back-to-back, piece index, pending garbage가 들어간다.
- `src/server/services/playerGameplayStep.ts`
  - 서버 상태에 human과 AI 모두의 authoritative input을 적용한다. lock 이후 line clear, T-Spin, 공격 상쇄·적용, top-out, 다음 조각 spawn까지 같은 경로에서 처리한다.
- `src/server/services/authoritativeTickerService.ts`
  - room별 ticker가 중력 진행을 책임진다. 100ms 간격으로 깨어나고 500ms 누적 기준으로 gravity step을 최대 한 번 적용해 event loop 지연 중 과도한 진행을 피한다.
- `src/server/services/authoritativeMatchFinish.ts`
  - 입력 경로와 ticker 경로에 흩어질 수 있는 종료 부수 효과를 한 곳으로 모은다. room 종료, ticker 정지, `match:finish` emit, match 삭제, game-over 로그 저장 순서를 통일한다.

### 3.3 클라이언트의 멀티 역할

- `src/client/net/roomClient.ts`는 브라우저 Socket.IO 어댑터다. 방/게임 요청과 server event 구독을 제공하며, 게임 규칙을 담지 않는다.
- `src/client/game/entry/multiplayerGameSession.ts`는 local runtime, opponent runtime, local input 전송, snapshot listener, server bag 보충을 묶는다.
- 내 보드는 입력 지연을 줄이기 위해 local runtime에서 prediction한다. 반면 상대 보드는 독립 gravity나 input replay를 하지 않고 서버 snapshot을 그대로 적용한다.
- 내 snapshot도 무조건 덮어쓰지 않는다. line clear 효과 중이거나 빠른 조작 중인 임시 active piece 차이는 보존하고, game over·garbage 반영·settled board 불일치·지속적인 piece index 차이처럼 의미 있는 drift에서만 correction한다.

이는 “모든 화면을 매번 서버 값으로 덮어쓰기”와 “클라이언트를 완전히 믿기” 사이의 현실적인 MVP 선택이다. 서버 권위를 지키면서도 테트리스 입력이 끊겨 보이지 않게 한다.

## 4. AI: 추천 기능이 아니라 실제 PVE 상대에서 시작하는 이유

현재 AI 방향은 LLM이나 강화학습을 바로 붙이는 것이 아니다. 먼저 같은 게임 규칙을 사용하는 **휴리스틱 PVE 상대**를 만들고, 사람이 선택한 배치와 AI가 선택했을 배치를 비교할 수 있는 데이터를 쌓는다.

```text
authoritative game state
  -> reachablePlacementPlanner: 실제 입력으로 닿을 수 있는 후보와 최단 action 계획 생성
  -> simulatePlacement: 각 후보를 복제 보드에서 실행
  -> boardMetrics: 결과 보드 수치 추출
  -> heuristicEvaluator: 점수화·순위화
  -> pveAiPlayerService: 계획 action을 서버 input 경로로 한 개씩 적용
```

### 4.1 AI 모듈의 현재 역할

- `placementGenerator.ts`
  - 보드 위에서 가능한 기본 최종 배치를 계산하는 순수 기반 모듈이다.
- `reachablePlacementPlanner.ts`
  - 단순히 “이론적으로 놓을 수 있는 위치”가 아니라 현재 active piece에서 실제 입력으로 도달 가능한 후보만 BFS로 찾는다.
  - `move_left → move_right → rotate → soft_drop`의 고정 순서와 동일 배치의 최단 경로 규칙으로, 같은 상태에서는 항상 같은 계획을 만든다. wall kick과 장애물 아래 tuck도 기존 core 이동 판정을 재사용한다.
- `simulatePlacement.ts`
  - 입력 보드를 복제한 뒤 배치를 고정하고 줄 삭제를 적용한다. 후보들을 비교할 때 원본 보드가 변하지 않는 것이 핵심이다.
- `heuristicEvaluator.ts`
  - complete line은 보상하고, aggregate height·max height·holes·bumpiness는 위험도로 감점한다. 결과는 숫자뿐 아니라 이유와 후보 수를 제공해 설명·디버깅에 쓸 수 있다.
- `placementLogAnalysis.ts`
  - 사람의 실제 배치를 같은 상태에서 계산한 heuristic 최선안과 비교한다. “AI가 더 높은 점수를 준 정도”와 같은 배치인지 여부를 로그에 남긴다.
- `pveAiPlayerService.js`
  - server authoritative snapshot을 AI 판단 입력으로 사용한다. 선택한 계획을 `move_left`, `rotate`, `soft_drop`, `hard_drop` 같은 authoritative input으로 한 단계씩 실행하고, 실제 실행된 input만 placement log로 저장한다.
  - 조각 순번이 바뀌어 계획이 오래되었거나 실행 결과가 선택한 배치와 달라지면 계획을 버리고 다시 판단한다.
- `aiDifficulty.js`
  - AI의 판단 규칙은 그대로 두고, hard drop 직전의 terminal soft drop 수만 난이도별 실행 프로필로 분리한다. normal은 내려오는 모습이 보이고, hard는 즉시 hard drop한다.

초기에는 AI가 선택한 최종 placement를 서버에 직접 적용하는 임시 경로가 있었지만, 현재는 제거됐다. AI도 사람과 같은 authoritative input 경로를 지나므로, 별도 규칙으로 보드를 바꾸지 않는다. 이는 PVE의 공정성·가시성·리플레이 가능성을 함께 지키는 설계다.

### 4.2 의도적으로 뒤로 미룬 범위

- Python AI 서버와 강화학습
- ML 모델 학습·추론을 실제 경기 입력에 직접 연결하는 일
- LLM이 수를 판단하거나 AI를 조작하는 기능
- AI 구현과 멀티 authoritative loop를 한 변경에서 대규모로 결합하는 일

ML이 들어와도 placement generator는 규칙 기반으로 유지하고, 모델은 후보의 점수 또는 순위를 예측하는 역할부터 맡기는 계획이다. LLM은 더 나중에 누적된 feature·플레이 로그·AI 비교 결과를 자연어 코칭으로 설명하는 계층이다. 즉 LLM은 게임 판단의 원천이 아니다.

## 5. 로그와 change log가 구조에서 맡는 역할

### 5.1 개발 change log: 설계 결정의 이력

`change-log.md`는 기능 목록 이상의 역할을 한다. 예를 들어 server authoritative 전환에는 다음 의도가 남아 있다.

1. client snapshot relay를 축소하고 서버 state를 최종 기준으로 변경
2. ticker를 통해 중력도 서버가 진행
3. garbage와 game over를 서버 lock 결과에서만 확정
4. own prediction correction을 제한해 입력 반응성을 보존
5. 종료 공통 helper, match cleanup, room ID 재시도, client sequence acknowledgment로 장시간 운영 위험을 줄임

따라서 이후 변경을 할 때 “왜 snapshot을 바로 적용하지 않는가?”, “왜 AI도 placement 검증을 거치는가?” 같은 질문은 코드만이 아니라 이 결정 이력으로 답할 수 있다.

### 5.2 게임 로그: AI·데이터셋을 위한 사실 기록

`logService.js`, `gameLogValidator.js`, `jsonlLogRepository.js`는 JSONL 형태의 이벤트 로그를 관리한다. 주요 이벤트는 `game_start`, `placement_decision`, `game_over`다.

현재 feature-ready `placement_decision` v2는 다음을 남긴다.

- 누가 선택했는지: `source` (`human` / `heuristic_ai`), `modelType`
- 선택 전후 상태: `boardBefore`, `boardAfter`, active piece, next queue, hold
- 선택 내용: `selectedPlacement`, input sequence, tick, piece index
- 결과와 설명: line/score/game-over 결과, board metrics, evaluation score/reason/candidate count
- 사람 로그의 경우: 동일 보드에서 heuristic AI가 선택했을 배치와 점수 차이

로그 저장 실패가 게임 진행을 멈추게 하지는 않는다. 이는 게임 플레이의 가용성과 분석 데이터의 품질을 분리하려는 선택이다. 다만 ML 데이터셋을 만들 때는 schema version, 보드 크기, game start/over 연결, 정상 종료 여부를 기준으로 신뢰할 수 있는 행만 고른다.

## 6. Change log로 본 구조의 성장 과정

| 단계 | 변화 | 구조적 의도 |
| --- | --- | --- |
| DOM 중심 초기 버전 | CSS 클래스가 보드 상태와 렌더를 함께 담당 | 빠른 구현에는 유리하지만 테스트·네트워크·AI 확장 한계 확인 |
| 배열 기반 싱글 엔진 | `board`와 active piece를 데이터로 분리, Canvas/DOM은 결과를 그림 | 단일 진실 원천과 순수 판정 기반 확보 |
| 모듈 경계 정리 | core/state/runtime/render/ui/entry 분리 | 규칙·실행·표현의 책임을 나누고 작은 단위 테스트 가능화 |
| 로비·room·match 도입 | Socket.IO와 roomService/matchService 도입 | 화면 연결과 경기 상태의 수명 주기를 분리 |
| 초기 동기화 MVP | input relay, server bag, snapshot correction | 네트워크 게임의 최소 흐름을 먼저 경험하고 검증 |
| server authoritative 전환 | 서버 input/ticker/lock/garbage/game over/snapshot | 최종 진실 원천을 서버로 이동하고 불일치·신뢰 문제 축소 |
| prediction 안정화 | persistent drift, garbage correction, gravity 재개 | 권위를 유지하면서 빠른 조작의 체감 품질 보존 |
| PVE AI·로그 확장 작업 | 휴리스틱 배치 평가, AI player type, schema v2 | 실제 상대와 설명 가능한 데이터를 먼저 만들고 ML의 기반 확보 |
| 도달 가능 AI 실행 | BFS action plan, authoritative input executor, 난이도별 cadence | AI의 계산 결과와 실제 플레이·로그를 일치시킴 |

### 6.1 문제 → 해결 → 설계 이유

change log에 남은 핵심 결정은 다음과 같이 연결된다.

| 발견한 문제 | 해결한 변경 | 설계 선택 | 이 선택이 필요한 이유 |
| --- | --- | --- | --- |
| 화면 클래스가 게임 상태여서 테스트·네트워크·AI가 화면에 묶임 | DOM 상태를 2차원 `board` 배열로 전환 | board를 단일 진실 원천으로 두고 render는 소비자로 한정 | 같은 상태를 Node 테스트, snapshot, AI 시뮬레이션에서 그대로 재사용하기 위해 |
| 스폰·회전·하드드롭·타이머 코드가 서로 얽혀 수정 시 회귀 위험이 큼 | `core / state / runtime / render / ui / entry` 분리 | core는 순수 판정, runtime은 순서 조율, render는 표시 | 규칙을 브라우저 밖에서도 검증하고, UI 변경이 판정에 영향을 주지 않게 하기 위해 |
| 초기 snapshot relay에서는 양쪽 클라이언트가 서로 다른 보드·공격·패배를 판단할 수 있음 | server authoritative state, input 처리, gravity ticker, snapshot 도입 | 서버만 lock·garbage·game over·승패를 확정 | 멀티에서 최종 진실을 하나로 만들고, 클라이언트 신뢰 문제와 drift를 줄이기 위해 |
| 서버 snapshot을 매번 적용하면 빠른 조작이 되돌아가고, 무시하면 오래된 보드가 남음 | pending input 보호, tick 단조 증가, persistent drift correction | 내 보드는 prediction 우선, 상대 보드는 full authoritative apply | 입력 반응성과 최종 수렴을 동시에 얻기 위해 |
| 상대의 line clear가 최종 보드만 바뀌어 보이고, 효과를 재생하려고 state를 건드리면 동기화가 깨질 수 있음 | `presentationEffect`를 snapshot과 분리 | effect는 복제 board로만 재생하고 gameplay state는 변경 금지 | 표시용 시간 효과와 게임 규칙 상태를 분리해 화면 효과가 권위 상태를 오염시키지 않기 위해 |
| 페이지 이동·재입장 후 socket id가 바뀌면 권한 오류, 임의 payload는 이벤트 위조 위험 | room sync, socket 갱신, action/payload/player 권한 검증 | socket handler는 입구·검증, room/match service는 상태 전이 | 실제 브라우저 수명 주기와 권한 경계를 서버가 일관되게 관리하기 위해 |
| raw 입력 스트림은 조각별 판단의 전후 맥락과 결과가 부족함 | `placement_decision`, JSONL 저장, schema v2 validator | lock 단위를 장기 분석 이벤트로 저장 | AI 비교·리플레이·ML feature를 작은 의미 단위로 안정적으로 축적하기 위해 |
| 이론상 가능한 배치가 실제 키 입력으로는 닿지 않을 수 있음 | reachability planner와 BFS 최단 계획 | existing move/SRS core를 재사용하여 reachable 후보만 평가 | AI의 “선택”이 실제 플레이로 재현되고 로그의 선택과 실행이 일치하게 하기 위해 |
| AI가 최종 좌표를 직접 적용하면 사람과 다른 규칙 경로를 타고 실행 과정이 보이지 않음 | direct placement 제거, AI action executor 추가 | AI도 authoritative input을 하나씩 실행하고 placement log에 실행 `inputSequence`를 기록 | PVE의 공정성, AI 이동의 가시성, replay/학습 데이터의 신뢰성을 확보하기 위해 |
| AI 행동이 너무 즉시 끝나거나 난이도 차이가 판단 규칙 복제로 번질 수 있음 | normal/hard execution profile 도입 | 평가기는 공유하고 실행 cadence만 분리 | AI 지능과 연출·난이도를 독립적으로 조절하기 위해 |

## 7. 현재 상태와 다음 검증 기준

현재 `main`은 server authoritative 멀티 MVP 위에, authoritative input을 사용하는 휴리스틱 PVE AI와 feature-ready placement log를 올린 상태다. PVP와 PVE 모두 자동 테스트로 핵심 경로를 고정했지만, 실제 브라우저에서의 체감 회귀는 별도 확인 대상이다.

우선 확인할 흐름은 다음과 같다.

```text
PVP: create -> join -> start -> rapid input -> lock/garbage -> game over -> lobby
PVE: create(pve, difficulty) -> start -> AI plan -> authoritative inputs -> snapshot -> finish -> logs
```

- PVP에서는 두 브라우저 탭으로 빠른 좌우/회전/soft drop, lock 직후, garbage, top-out, lobby 복귀를 확인한다.
- PVE에서는 AI의 계획 action이 하나씩 보이고, 실제 authoritative input 결과가 line clear·garbage·game over·placement log에 일관되게 반영되는지 확인한다.
- 로그에서는 v2 placement row가 정상 게임의 `game_start`·`game_over`와 같은 `gameId`로 연결되고, human/AI source가 정확히 구분되는지 확인한다.
- 자동 검증은 런타임·room·match·socket·authoritative ticker·AI 순수 함수·로그 validator 테스트를 함께 실행하는 `bash scripts/verify.sh`가 기준이다.

## 8. 유지해야 할 설계 원칙

1. `board`와 authoritative state의 진실 원천을 중복으로 만들지 않는다.
2. core의 판정은 DOM·Socket.IO·timer에 의존하지 않는다.
3. runtime은 규칙을 복제하지 않고 실행 순서와 UI 연결을 담당한다.
4. socket handler는 이벤트 입구이고, room/match/game rule service를 대체하지 않는다.
5. AI는 화면을 읽거나 상태를 직접 수정하지 않고, snapshot → 후보 → 검증된 적용 경로를 따른다.
6. 로그 schema가 바뀌면 버전을 올리고, 과거 데이터와 새 데이터를 혼동하지 않는다.
7. 프레임워크나 ML/LLM은 현재 경계가 실제 복잡도를 줄일 때만 도입한다.

이 원칙을 지키면 기능이 늘어나도 “테트리스 규칙”, “화면 실행”, “서버 권위”, “AI 판단”, “분석 데이터”가 한 파일이나 한 상태에 뒤섞이지 않는다. 지금의 구조는 바로 그 확장 가능성을 학습 가능한 크기의 모듈로 유지하기 위한 선택이다.
