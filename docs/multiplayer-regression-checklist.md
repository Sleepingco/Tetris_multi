# Multiplayer Regression Checklist

## 목적
멀티플레이 MVP가 깨지지 않았는지 브라우저 2탭으로 확인한다.

## 준비
- 서버 실행: node src/app.js   
- 브라우저 탭 2개
- 탭 A: host
- 탭 B: guest

## 1. Room Flow
- [ ] A가 방을 생성한다.
- [ ] B가 roomId로 입장한다.
- [ ] 두 탭 모두 player 수 2로 보인다.
- [ ] host badge가 A에게만 보인다.

## 2. Game Start
- [ ] A가 게임 시작을 누른다.
- [ ] A/B 모두 tetrisMulti.html로 이동한다.
- [ ] A는 왼쪽, B는 오른쪽에 배치된다.
- [ ] 각자 자신의 보드가 정상 렌더링된다.

## 3. Input Relay
- [ ] A가 이동/회전/하드드롭하면 B의 상대 보드에 반영된다.
- [ ] B가 이동/회전/하드드롭하면 A의 상대 보드에 반영된다.
- [ ] 빠른 입력 연타 후에도 상대 보드가 크게 어긋나지 않는다.

## 4. Snapshot Correction
- [ ] 의도적으로 빠르게 조작해도 일정 시간 후 상대 보드가 보정된다.
- [ ] 보정 때문에 내 조작감이 끊기지 않는다.

## 5. Game Over
- [ ] 한쪽이 top-out 되면 승패 문구가 표시된다.
- [ ] 로비로 버튼은 내 보드 쪽에만 표시된다.
- [ ] 양쪽이 로비로 돌아갈 수 있다.

## 6. Leave / Home
- [ ] 게임 중 한쪽이 홈으로 가면 남은 쪽은 로비로 이동한다.
- [ ] room player 수가 1로 줄어든다.
- [ ] 남은 player가 host가 된다.
- [ ] 같은 roomId로 다시 입장할 수 있다.

## 7. JSONL Log
- [ ] 조각 lock 후 `data/logs/game-events.jsonl`에 한 줄이 추가된다.
- [ ] 한 줄은 하나의 JSON object다.
- [ ] 저장 실패가 발생해도 게임은 멈추지 않는다.

## 기록
## 2026-06-30 테스트 결과

### 환경
- 서버: 맥미니 개인컴퓨터
- 브라우저: chrome
- 탭 A:metal(host)
- 탭 B:wood(guest)

### 통과
- 1 ~ 6 번 항목에 문제점 발견안됨

### 실패/이상 동작
- log 기록 안됨.

### 다음 수정 후보
- ...