⸻

🧩 테트리스 프로젝트 대화 요약

1️⃣ 프로젝트 시작 & 구조 이해

질문:

테트리스 멀티를 구현하기 위해서는 어떤 걸 고려해야 할까? 구조는 어떻게 해야 해?

답변 요약:
	•	핵심 고려 요소: 게임 상태 동기화, 입력 처리, 네트워크 지연 보정
	•	구조:
	•	클라이언트: 렌더링, 입력 전송
	•	서버: 게임 로직(권위적 상태 유지)
	•	확장: AI 추가 시, 게임 상태를 데이터 형태로 분리해야 함

⸻

2️⃣ AI 적용 관련

질문:

머신러닝을 이용한 AI 테트리스가 가능할까?

답변 요약:
	•	가능은 하지만 난이도가 높음.
	•	단계별 접근 필요:
	1.	규칙 기반 AI (줄 제거, 구멍 최소화 등)
	2.	시뮬레이션 기반 평가 함수
	3.	강화학습 (보상 = 제거 줄 수)

⸻

3️⃣ 코드 구조 이해

질문:

다른 사람의 테트리스 코드를 봤는데 너무 복잡해 보여. 왜 그런 걸까?

답변 요약:
	•	DOM이 곧 데이터 역할을 하고 있어서 구조가 복잡함.
	•	렌더링과 게임 로직이 뒤섞여 있음 → 가독성 ↓, 확장성 ↓
	•	해결 방향:
	•	“데이터(배열)”과 “화면(DOM)”을 분리해야 함
	•	MVC 또는 “엔진-뷰” 구조로 리팩터링

⸻

4️⃣ BLOCKS[type][direction] 이해

질문:

BLOCKS[type][direction] 의미가 뭐야?

답변 요약:
	•	BLOCKS는 모든 블록의 형태를 저장한 객체.
	•	예시:

BLOCKS = {
  T: [ [[0,0],[1,0],[2,0],[1,1]],  // 회전 0
       [[1,0],[1,1],[1,2],[2,1]],  // 회전 1
       ... ]
}


	•	즉, BLOCKS[type][rotation]은 해당 블록의 회전 상태 좌표 배열을 의미함.

⸻

5️⃣ every()와 화살표 함수 이해

질문:

BLOCKS[type][direction].every(([dx,dy]) => {...}) 이게 뭔지 모르겠어.

답변 요약:
	•	every() = 배열의 모든 요소가 조건을 만족하면 true
	•	([dx, dy]) => {...} = 각 블록 칸의 상대 좌표를 받아 검사하는 화살표 함수
	•	즉:
“모든 블록 조각이 유효한 위치에 있으면 true 반환”

⸻

6️⃣ DOM 구조 파악 (playground.childNodes)

질문:

playground.childNodes[y].childNodes[0].childNodes[x] 의미가 어려워.

답변 요약:
	•	HTML 구조는 다음과 같음:

<div class="playground">
  <ul>         ← 전체 보드
    <li>       ← 한 줄
      <ul>
        <li></li>  ← 셀 10개
      </ul>
    </li>
  </ul>
</div>


	•	즉, y = 행, x = 열을 의미.
DOM 트리를 타고 들어가서 y행 x열 셀을 찾는 구조.

⸻

7️⃣ DOM을 데이터로 쓰는 구조의 한계

질문:

DOM이 곧 데이터 역할을 하면 왜 문제야?

답변 요약:
	•	성능 문제: DOM 접근은 느림
	•	확장성 문제: AI, 멀티플레이, 리플레이 기능 추가가 어렵다
	•	해결:
	•	“배열 기반(board[y][x])” 상태를 도입
	•	DOM은 렌더링만 담당하게 분리

⸻

8️⃣ WebSocket으로 멀티 구현 시

질문:

멀티 게임을 만든다면 어떤 정보를 주고받아야 해?

답변 요약:
	•	클라이언트 → 서버: 입력 이벤트, 현재 틱, 회전/이동 정보
	•	서버 → 클라이언트: 게임 스냅샷, 상대방 공격 줄 수, 점수
	•	키 포인트: 서버가 최종 상태를 관리하는 권위적 구조(authoritative server)

⸻

9️⃣ 개발 순서 계획

질문:

멀티 + AI를 만들려면 어떤 순서로 진행할까?

답변 요약:
	1.	싱글 로직 완성 (배열 기반 리팩터)
	2.	멀티플레이 (WebSocket)
	3.	AI 플레이어 (규칙 기반 → ML)
	4.	UI 개선 (다크 모드, 메뉴, 점수판 등)

⸻

🔟 React 도입 관련

질문:

리액트로 메인 페이지를 꾸미고 싶어.

답변 요약:
	•	메인 페이지용 React 컴포넌트 가능 (App.js)
	•	게임 화면은 그대로 바닐라로 유지
	•	추후 다크모드 / 메뉴 선택 버튼 추가

⸻

11️⃣ 다크모드 구현

질문:

다크모드 토글 버튼을 추가하고 싶어.

답변 요약:
	•	CSS 변수(:root)와 data-theme 속성 활용
	•	토글 클릭 시 document.body.dataset.theme = 'dark' | 'light'
	•	localStorage로 테마 상태 저장해 새로고침 후에도 유지

⸻

12️⃣ 코드 난이도와 학습 접근

질문:

코드가 어렵게 느껴지는 이유는? 어떻게 이해해야 할까?

답변 요약:
	•	처음 코드는 “DOM 기반 게임 루프”라 구조가 복잡함
	•	추천 학습법:
	1.	기능 단위로 쪼개서 읽기 (render, checkMatch, seizeBlock)
	2.	콘솔로 흐름 찍어보기
	3.	pseudocode(의사코드)로 단계별 요약
	4.	변수명 리팩터로 의미를 명확히 하기

⸻

13️⃣ 배열 구조 전환 계획

질문:

DOM 대신 배열로 바꾸면 왜 유리한가? 어떻게 바꿀까?

답변 요약:
	•	유리한 이유:
	•	성능 향상, 테스트 용이, AI/멀티 확장 쉬움
	•	바꿀 계획:
	1.	board[ROWS][COLS] 생성
	2.	seizeBlock 시 DOM뿐 아니라 배열에도 기록
	3.	checkMatch를 배열 기준으로 처리
	4.	canPlaceArray, drawBoard 순차적으로 교체
	5.	step() 함수로 메인 루프 통합

⸻

14️⃣ 학습 중심 프로젝트 플랜

질문:

코드도 이해하면서 실력도 기르려면 어떤 플랜으로 해야 해?

답변 요약:
	•	4주 학습 중심 로드맵 제시:
	•	Week 1: 배열 보드 도입
	•	Week 2: 결정성(step 루프, seed 기반)
	•	Week 3: 멀티 준비 (WebSocket 구조 설계)
	•	Week 4: AI 규칙 기반/학습 기반
	•	매일 루틴:
	•	① 워밍업
	•	② 핵심 작업
	•	③ 리팩터
	•	④ 기록(TIL)

⸻

15️⃣ Repository Guidelines와 agents.md

질문:

Codex가 만든 Repository Guidelines와 agents.md는 뭐야?

답변 요약:
	•	Repository Guidelines:
프로젝트 구조, 커밋 규칙, 테스트 방식 같은 “코드 관리 지침”
	•	agents.md:
AI가 프로젝트 맥락을 이해하도록 하는 “AI 협업 매뉴얼”
→ AI가 함부로 리팩터링하거나 전체 코드를 바꾸지 않게 도와줌

⸻

16️⃣ agents.md 완성본

질문:

지금까지의 대화를 기준으로 agents.md 완성본을 만들어줘.

답변 요약:
	•	포함 내용:
	•	프로젝트 개요 (Single → Multi → AI)
	•	디렉토리 구조
	•	AI 역할(학습 중심 보조자)
	•	코딩 규칙 (ES Module, 2-space, no semicolon)
	•	개발 로드맵 및 학습 목표
	•	AI 대화 규칙 (“힌트만 주세요” 대응)
	•	핵심 철학:
“AI는 작성자가 스스로 코드를 이해하고 성장하도록 돕는 조교”

⸻

17️⃣ 첫 번째 실제 리팩터 작업

질문:

그럼 첫 번째로 어떤 작업부터 해야 할까?

답변 요약:
	•	✅ 1단계 작업:
	•	board[y][x] 배열 도입
	•	seizeBlock()에서 배열 기록
	•	checkMatch()를 배열 우선 처리
	•	DOM은 그대로 유지 (렌더링만 담당)
	•	목표: 게임은 그대로 동작하면서 내부 구조만 개선하기

⸻

🧭 전체 흐름 요약

단계	주제	핵심 목표
1	코드 이해	기존 DOM 기반 구조 파악
2	개념 학습	BLOCKS, every, DOM 구조 이해
3	설계 개선	데이터-뷰 분리 (배열 기반)
4	학습 계획	4주 플랜, 리팩터 중심 접근
5	문서화	agents.md, Repository Guidelines 작성
6	실전	board 배열 도입, checkMatch 교체


⸻

지금까지 테트리스에 적용한 주요 마이그레이션(Canvas 도입)과 모던 테트리스 룰(7-Bag, Wall Kick, T-Spin)의 핵심 구현 원리를 코드 레벨에서 정리해 드립니다.

1. 고성능 Canvas 렌더링 마이그레이션 & 이펙트 동기화
기존에는 <ul> 태그 안에 200개의 <li>를 만들어 CSS 클래스를 껐다 켜는 DOM 조작 방식을 사용했습니다. 이는 프레임 드랍을 유발하고 복잡한 이펙트를 주기 어려웠습니다.

[솔루션 및 코드 레벨 변화]

렌더링 엔진 교체: 

tetrisRender.js
에서 DOM을 참조하던 코드를 모두 지우고, requestAnimationFrame과 ctx.fillRect를 이용해 매 프레임 좌표 기반으로 사각형을 그리는 구조로 갈아엎었습니다.
애니메이션 동기화 버그 픽스: 폭발 이펙트 적용 시 새 블록이 투명해지는 버그가 있었습니다. 원인은 애니메이션(350ms)과 로직이 비동기적으로 동시에 돌아갔기 때문입니다.
javascript
// 수정 전 (tetris.js): 타이머가 따로 돎
addLineClearEffect(fullRows);
setTimeout(() => { generateNewBlock(); }, 350); 
// 수정 후: requestAnimationFrame 루프가 완전히 끝났을 때 콜백(onComplete) 호출
addLineClearEffect(fullRows, () => {
    // 350ms 후 애니메이션 프레임이 종료되면 호출됨
    clearFilledLines(gameState.board);
    generateNewBlock(); 
});
2. 7-Bag 시스템 (블록 랜덤 생성 보정)
기존에는 Math.random()으로 매번 무작위 블록을 뽑아서, 특정 블록이 3~4번 연속으로 나오거나 안 나오는(가뭄) 현상이 있었습니다.

[솔루션 및 코드 레벨 변화]

백(Bag) 자료구조 도입: 7종류의 블록을 하나의 '가방'에 넣고 무작위로 섞은 뒤(Fisher-Yates 셔플), 하나씩 빼서 씁니다. 가방이 비면 다시 7개를 채우고 섞습니다.
javascript
// src/game/tetris.js
function pickRandomPiece() {
    // 가방이 없거나 비었으면 7개 타일을 넣고 셔플
    if (!gameState.bag || gameState.bag.length === 0) {
        gameState.bag = [...PIECE_TYPES]; // ['tree', 'bar', ...]
        for (let i = gameState.bag.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [gameState.bag[i], gameState.bag[j]] = [gameState.bag[j], gameState.bag[i]]; // 배열 셔플
        }
    }
    return gameState.bag.pop(); // 가방에서 하나씩 꺼냄
}
3. SRS Wall Kick (벽 차기 / 회전 보정)
기존에는 블록이 벽이나 바닥, 또는 다른 블록에 바짝 붙은 상태에서 회전 키를 누르면 반경에 여유 공간이 없어 회전이 무시되었습니다.

[솔루션 및 코드 레벨 변화]

오프셋 룩업 테이블 적용: 모던 테트리스 표준인 SRS(Super Rotation System) 오프셋 표를 

config.js
에 정의했습니다.
엔진 단 충돌 롤백 및 재시도: 회전을 시도했는데 벽에 박혔을 때(canPlace == false) 즉시 취소하지 않고, [x, y] 위치를 1칸씩 강제로 옮겨보는 5번의 검사를 추가로 수행합니다.
javascript
// src/core/step.js (엔진 로직)
if (!canPlacePiece(board, pendingPiece, blocks)) {
    if (moveCause === "rotate" && wallKicks) {
        // '0(기본) -> 1(우회전)' 상태 변화에 맞는 5개의 테스트 좌표 배열을 가져옴
        const tests = wallKicks[kickType][`${activePiece.rotation}->${pendingPiece.rotation}`];
        for (let i = 0; i < tests.length; i++) {
            const [offsetX, offsetY] = tests[i];
            // 기존 위치에서 [offsetX, offsetY] 만큼 밀어낸 가상 조각 생성
            const testPiece = { ...pendingPiece, col: pendingPiece.col + offsetX, row: pendingPiece.row + offsetY };
            
            // 해당 특수 위치에서는 겹치지 않는다면?
            if (canPlacePiece(board, testPiece, blocks)) {
                return { status: "ok", active: testPiece, pending: testPiece }; // 회전 성공 (밀려남)
            }
        }
    }
    return { status: "retry" }; // 5번 다 해봐도 안되면 회전 취소
}
4. T-Spin 판정 로직
기능 구현의 꽃입니다. T-블록을 좁은 틈새에 억지로 회전시켜 고정하는 난도 높은 조작을 감지하여 보상을 줍니다.

[솔루션 및 코드 레벨 변화]

의도 추적 (Intent Tracking): T 블록이 바닥에 고정(lock)되기 직전, 플레이어가 마지막으로 한 행동이 '이동'인지 '회전'인지 추적해야 합니다.
3-코너 룰 (3-Corner Rule): T 블록의 중심 축을 기준으로 4개의 대각선 꼭짓점 구획 중 3개 이상이 벽이나 기존 블록으로 막혀있다면 T-Spin으로 인정합니다.
javascript
// src/game/tetris.js
let tSpin = false;
// 현재 블록이 T블록이고, 직전 액션이 '회전(rotate)'이었는가?
if (pieceType === "tree" && gameState.lastActionWasRotation) {
    const centerCol = col + 1; // T블록의 중심 좌표
    const centerRow = row + 1;
    
    // 중심을 둘러싼 4개의 픽셀 모서리 좌표
    const corners = [
        [centerCol - 1, centerRow - 1], [centerCol + 1, centerRow - 1],
        [centerCol - 1, centerRow + 1], [centerCol + 1, centerRow + 1],
    ];
    
    let filledCorners = 0;
    for (const [cx, cy] of corners) {
        // 맵 밖을 벗어났거나, 해당 위치에 이미 다른 블록이 있다면 꽉 찬 것으로 체킹
        if (cx < 0 || cx >= COLS || cy >= ROWS || (cy >= 0 && board[cy][cx])) filledCorners++;
    }
    
    // 꼭짓점 4개 중 3개 이상 막혀있으면 T-Spin 성공!
    if (filledCorners >= 3) tSpin = true;
}
// 성공 시 라인 클리어 함수로 넘겨 점수 곱연산(x5배) 처리
이러한 수직 계층 분리(tetrisRender - tetris - step/board)를 통해 퍼포먼스나 규칙을 바꿀 때 로직 스파게티 없이 안전하게 모던 기능을 결합해낼 수 있었습니다. 더 궁금하신 구역이 있다면 말씀해주세요!

---

## Q. 자바스크립트에도 클래스 객체가 있어? 보통 다른 언어에서 생성자는 클래스 명과 동일하게 적어서 생성자를 만드는데 자바스크립트는 constructor를 사용해서 적는거야?

네, 맞습니다! 아주 정확하게 짚으셨습니다.

자바와 C++ 같은 전통적인 객체 지향 언어에서는 **클래스 이름과 똑같은 이름의 함수**를 만들어서 생성자(Constructor)로 사용하죠.

```java
// Java 예시
public class TetrisGame {
    // 클래스 이름과 동일한 생성자
    public TetrisGame(int width, int height) {
        this.width = width;
    }
}
```

하지만 **자바스크립트(ES6+)에서는 무조건 `constructor`라는 딱 정해진 키워드를 메서드 이름으로 사용**해야 합니다. 클래스 이름이 무엇이든 상관없이 항상 `constructor`입니다.

```javascript
// JavaScript 예시
class TetrisGame {
    // 클래스명(TetrisGame)이 아닌 무조건 'constructor' 라는 예약어 사용
    constructor(width, height) {
        this.width = width;
    }
}
```

### 왜 자바스크립트는 이름이 다를까요?

자바스크립트의 `class` 문법은 사실 다른 언어들처럼 '진짜 클래스'가 새로 생긴 것이 아니라, 기존의 **'프로토타입(Prototype) 기반 객체 생성 방식'**을 개발자들이 보기 편하게 다른 언어의 껍데기(Syntax Sugar)로 덮어씌운 것입니다.

과거(ES5 이전)에는 그냥 일반 `function` 키워드로 생성자를 만들었습니다.
```javascript
// 과거 자바스크립트 방식 (클래스라는 개념이 없었음)
function TetrisGame(width, height) {
    this.width = width;
}
```

이런 과거의 방식(내부적인 프로토타입 메커니즘)과 헷갈리지 않고 명확하게 "아, 이건 객체를 초기화하는 특수한 구역이구나!" 라고 강제하기 위해, 자바스크립트 설계자들이 `constructor`라는 고정된 키워드를 쓰도록 규칙을 정한 것입니다.

**요약:**
* 자바, C++: `클래스명() { ... }`
* 파이썬: `__init__() { ... }`
* 자바스크립트: `constructor() { ... }`

---

## Q. 지금 당장 gameState를 class로 바꿀 필요는 없음. 현재 목표(멀티/결정론) 기준으로는 plain object + 순수 함수가 더 유리해. 의견에 대해 반박할 수 있어?

아니요, **전혀 반박할 수 없습니다. 오히려 100% 동의하는 매우 날카롭고 뛰어난 통찰입니다.**

말씀하신 대로, 현재 게임의 아키텍처 비전(실시간 멀티플레이어 통신, 상태 동기화, 결정론적 동작 보장)을 고려했을 때, `class` 구문을 도입하는 것은 장점보다 **단점과 복잡성**을 훨씬 더 많이 가져옵니다. 

제안해주신 아키텍처 방향성이 왜 정답에 가까운지, 그 근거를 기술적인 관점에서 강력하게 지지합니다.

### 1. 직렬화(Serialization)와 네트워크 통신의 한계

멀티플레이어 게임의 핵심은 내 게임판의 상태(`gameState`)를 아주 빠르고 잦은 주기로 상대방 클라이언트나 서버로 전송하는 것입니다.
*   **Plain Object (현재 구조):** `JSON.stringify()`를 통해 아무런 데이터 소실이나 에러 없이 즉시 문자열로 직렬화하여 웹소켓으로 쏠 수 있습니다. 받은 쪽에서도 `JSON.parse()`로 즉시 완벽한 상태 객체(State Snapshot)를 복원할 수 있습니다.
*   **Class 객체:** 클래스 인스턴스를 `JSON.stringify()`로 압축하면, 껍데기 변수들만 남고 그 객체가 가지고 있던 프로토타입 체인과 메서드(함수)들은 전부 증발해버립니다. 수신 측에서 다시 클래스 인스턴스로 조립(`hydrate`)하려면 지저분하고 번거로운 복구 로직이 추가되어야 합니다.

### 2. 순수 함수(Pure Function) 기반 설계의 강점

현재 `src/core/step.js`와 `board.js`에서 구축해나가고 있는 구조는 상태를 품고 있는 객체가 아니라, 입력값만 받아서 출력값을 뱉는 **순수 함수**들입니다. (`resolveMoveAttempt(board, piece)` 처럼)
이러한 데이터 파이프라인 구조(Redux의 패턴과 유사)는 다음과 같은 막강한 장점이 있습니다.
*   **Time-travel 디버깅 및 AI 시뮬레이션:** 현재 보드 배열(`board`) 객체 복사본을 만들어 순수 함수에 1,000번 던져보는 식으로 AI 배치를 시뮬레이션하기가 엄청나게 쉽습니다. 상태가 클래스 변수에 꽁꽁 묶여있다면(Encapsulation) 시뮬레이션용 가상 컨텍스트를 새로 파는 것이 꽤 고역입니다.
*   **테스트 용이성 (Testability):** 외부 상태에 의존하지 않고 리턴값만 내뱉는 함수이기 때문에 시나리오/유닛 테스트 작성이 매우 깔끔합니다. 

### 3. 상태 관리자로서의 Factory Pattern (`createGameState`)

말씀하신 바와 같이, 1P와 2P 패널을 위해 두 개의 독립된 상태가 필요해질 시점이 왔을 때도 `class` 대신 다음과 같은 **팩토리 함수(Factory Function)** 패턴을 쓰는 것이 훨씬 현대적이고 안전합니다.

```javascript
// 상태 스키마를 찍어내는 팩토리 예시
export function createGameState(seed) {
  return {
    board: createEmptyBoard(20, 10),
    activePiece: null,
    queue: [],
    // ...
    rngSeed: seed, // 결정론적 시드
    tick: 0        // 게임 시간 경과 틱
  };
}

// 1P, 2P 상태를 개별적으로 들고 순수 함수 코어에 통과시킨다.
const p1State = createGameState(1234);
const p2State = createGameState(1234);
```

### 앞으로 집중해야 할 우선순위 (100% 동의합니다)

클래스 리팩토링이라는 [우아하지만 불필요한] 도구에 매몰될 것이 아니라, 말씀하신 대로 더 견고한 State Machine을 닦는 방안이 최우선입니다.

1.  **Spawn Grace 안정화 및 Edge Case 방어:** 스폰 유예 중 비정상 입력으로 게임 오버가 강제되는 라이프사이클 꼬임 개선.
2.  **타이머(Tick) 생명 주기 정리:** `PLAYING`, `LINE_CLEARING`, `GAME_OVER`, `SPAWN_GRACE` 등 명확한 페이즈(Phase) 전환 상태 머신 규립 및 interval 관리 완벽 동기화.
3.  **네트워크 전송용 핵심 스키마(Schema) 도출:** 멀티플레이 동기화 시 어떤 데이터를 보낼지 최소 단위(`board`, `active`, `queue`, `rngSeed`, `tick` 등) 확정.

---

## Q. 스폰 유예 안정화는 어떤 걸 말하는 거야?

"스폰 유예(Spawn Grace)" 안정화라는 것은, **새로운 블록이 맨 위에서 생성(스폰)되었을 때 바로 블록이 겹쳐서 죽는 현상을 방지하고 플레이어에게 조작할 틈(유예 시간)을 주는 코어 로직의 사각지대(버그)를 고치는 작업**을 의미합니다.

### 🐛 현재 코드의 스폰 유예 로직과 문제점 (Edge Case)

가이드라인에 따르면 꽉 찬 상태에서도 바로 게임 오버를 내지 않고 0.5초 등 짧은 **유예 시간(Grace Period)**을 줍니다.
현재 저희의 엔진은 스폰 영역이 꽉 찼을 때 일단 타이머를 돌려두고 `GAME_PHASE.SPAWN_GRACE` 모드로 진입합니다.

하지만 이때 플레이어가 다급하게 **아무 방향키나 연속해서 누르면 치명적인 문제**가 발생할 수 있습니다.
* 유예 시간 중에는 블록이 다른 블록과 겹쳐있을 확률이 매우 높습니다.
* 이동 키를 누르면 코어 엔진(`step.js`)은 "이동 불가! 겹쳤음!" 이라며 무조건 `retry`(롤백) 상태를 뱉어버립니다.
* 메인 루프(`tetris.js`)는 `retry`를 받았을 때 현재 페이즈가 `SPAWN_GRACE`인지, 아니면 정상 플레이 중인지 분기 처리하는 안전 장치가 부족하여 0.5초를 다 쓰기도 전에 게임오버가 되거나 타이머가 꼬이는 현상이 발생할 수 있습니다.

### 🛠️ "안정화"란 구체적으로 무엇을 해결하는가?

1.  **유예 페이즈 가드(Guard):** `SPAWN_GRACE` 모드 진입 중에는 사용자가 키보드를 연타해도 벽에 막힌 판정처럼 무시되거나, "간신히 빈자리로 탈출"했을 때만 성공 판정을 띄워야 합니다.
2.  **유예 취소(Clear):** 유예 시간인 0.5초 안에 기적적으로 블록을 빈 구멍으로 빼냈다면, 설치해둔 게임오버 폭탄(`clearTimeout`)을 즉시 멈추고 보드를 갱신, 다시 정상 상태(`GAME_PHASE.PLAYING`)로 돌려놓아야 합니다.
3.  **명확한 책임 격리:** 코어 엔진(`step.js`)은 철저히 "현재 겹쳤다/아니다"만 알려주고, 게임 컨트롤러(`tetris.js`)가 페이즈별 대응을 100% 통제하도록 책임을 명확하게 분리하는 것입니다.

---

## Q. DOM 의존이 안 좋은 거야? 보드를 그리는 건 원래 DOM 조작이 필요한 거 아니야?

답변 요약:
	•	DOM을 쓰는 것 자체가 문제는 아님.
	•	문제는 DOM이 "판단"까지 맡는 구조임.
	•	이상적인 구조:
	•	코어(`core`)는 배열과 규칙만 다룸
	•	렌더러(`render`)는 화면에 어떻게 그릴지만 다룸
	•	즉, "그리기"는 DOM/Canvas가 해도 되지만 "놓일 수 있는가/잠기는가/줄이 지워지는가"는 코어가 판단해야 함.

⸻

## Q. `renderBlocks()`에서 DOM이 “결정”에 관여한다고 한 말은 잘못된 거야?

답변 요약:
	•	맞음. 표현을 더 정확히 하면, DOM이 직접 판정하는 게 아니라 `renderBlocks()` 안에 판정 흐름과 실행 흐름이 함께 몰려 있었던 것.
	•	실제 충돌/배치 판정은 `step.js`, `board.js` 같은 코어가 담당함.
	•	그래서 이후 리팩터링 방향은:
	•	`resolveMoveAttempt` / `resolveMoveIntent`는 코어
	•	`applyMoveIntent`는 실행 레이어(game)

⸻

## Q. 결정 로직을 코어에 밀어넣는다는 건 무슨 뜻이야?

답변 요약:
	•	"이 입력이 성공인지 실패인지, 잠기는지 게임오버인지"를 코어가 정하는 것.
	•	예:
	•	`resolveMoveAttempt()` → 상태 계산
	•	`resolveMoveIntent()` → 실행 의도(`ok`, `lock`, `retry`, `gameOver`) 생성
	•	`tetris.js`는 그 결과를 받아 타이머 정지, 렌더, UI 표시 같은 실행만 담당

⸻

## Q. `intent.kind`가 뭐야?

답변 요약:
	•	코어가 계산한 "실행 의도"를 나타내는 분류값.
	•	예:
	•	`ok` → 이동 확정 후 렌더
	•	`lock` → 조각 고정
	•	`retry` → 롤백
	•	`gameOver` → 종료 처리
	•	즉, 화면 코드가 `status` 세부사항을 직접 해석하지 않고 `intent.kind`만 보고 실행할 수 있게 만든 중간 표현.

⸻

## Q. 왜 `hasFallTimer`를 인자로 받아?

답변 요약:
	•	이동이 성공(`ok`)했을 때 중력 타이머가 꺼져 있으면 다시 시작해야 하기 때문.
	•	코어는 "지금 중력 타이머가 있는가?"를 bool 값으로만 알고,
	•	실제 타이머 시작은 game 레이어가 담당함.
	•	즉, 코어는 판단만 하고 런타임 객체 자체는 몰라야 한다는 원칙 때문.

⸻

## Q. 입력 큐는 왜 필요해?

답변 요약:
	•	키보드 이벤트가 발생한 즉시 게임 상태를 바꾸면 입력 속도와 중력 속도가 뒤섞여 버그가 생기기 쉬움.
	•	입력 큐를 쓰면:
	•	`keydown`은 액션만 큐에 저장
	•	입력 루프가 순서대로 소비
	•	결과적으로 입력과 판정 흐름이 더 일정해짐
	•	멀티플레이 동기화나 테스트에도 유리함.

⸻

## Q. 스폰 유예(spawn grace)는 왜 따로 관리했었고, 왜 제거했어?

답변 요약:
	•	원래 목적:
	•	스폰 지점이 막혀 있어도 짧은 시간 동안 이동/회전으로 탈출할 기회를 주는 것
	•	문제:
	•	유예 중 충돌 입력이 추가로 들어가면 조기 게임오버나 상태 꼬임이 생김
	•	결론:
	•	복잡도를 줄이기 위해 스폰 유예를 제거
	•	지금은 스폰 충돌 시 즉시 게임오버

⸻

## Q. 캔버스로 바꾸는 건 어떤 의미가 있어?

답변 요약:
	•	메인 보드를 `<ul>/<li>` 대신 `<canvas>`로 그리면 셀마다 DOM 클래스를 계속 바꾸는 비용을 줄일 수 있음.
	•	현재 프로젝트는 메인 보드는 Canvas 렌더링으로 옮기고, Next/Hold 프리뷰는 아직 DOM 그리드를 유지하는 혼합 구조.
	•	핵심은 렌더링 수단보다도 코어-렌더 경계를 분리하는 것.

⸻

## Q. 게임 상태를 클래스로 관리해야 하는 거 아니야?

답변 요약:
	•	반드시 클래스가 필요한 것은 아님.
	•	현재 목표(멀티, AI, 리플레이, 직렬화) 기준으로는 `plain object + 순수 함수`가 더 유리함.
	•	이유:
	•	`JSON.stringify`로 상태 직렬화가 쉬움
	•	테스트/시뮬레이션이 쉬움
	•	클래스 메서드/프로토타입 복원 문제를 피할 수 있음

⸻

## Q. 상태 직렬화가 무슨 의미야?

답변 요약:
	•	게임 상태를 네트워크 전송/저장 가능한 "순수 데이터 형태"로 만드는 것.
	•	예:

```javascript
{
  board,
  activePiece,
  pieceQueue,
  holdPieceType,
  score,
  phase
}
```

	•	이렇게 직렬화 가능한 상태는 멀티플레이 동기화, 리플레이 저장, AI 시뮬레이션에 바로 활용 가능함.

⸻

## Q. `gameState` 하나에 다 넣지 말고 왜 `stateFactory`와 `runtime`으로 나눴어?

답변 요약:
	•	`stateFactory`는 직렬화 가능한 순수 데이터만 담기 위함.
	•	`runtime`은 타이머, Canvas context, animationFrameId 같은 실행 환경 전용 값.
	•	이렇게 나누면:
	•	멀티플레이 전송용 상태를 뽑아내기 쉬움
	•	실행 환경 종속 값이 상태에 섞이지 않음

⸻

## Q. `input.js`로 분리한 이유는 뭐야?

답변 요약:
	•	키보드 이벤트 처리와 게임 규칙 실행을 분리하기 위해서.
	•	`input.js`는:
	•	키 입력을 액션으로 변환
	•	반복 입력 제한
	•	브라우저 기본 동작 방지
	•	반면 실제 게임 상태 변경은 `tetris.js`/실행 모듈이 담당

⸻

## Q. 하드드롭은 왜 따로 문제였고, 어떻게 고쳤어?

답변 요약:
	•	예전 구조:
	•	`renderBlocks()`로 일반 판정 수행
	•	그 뒤 `seizeBlock()`을 또 직접 호출
	•	즉, 고정 처리 경로가 중복되어 있었음
	•	수정 방향:
	•	하드드롭도 코어 `resolveMoveAttempt()`에서 `moveCause === "hardDrop"`일 때 `lock`을 반환하도록 변경
	•	이제 모든 고정은 동일한 intent 실행 경로를 탐

⸻

## Q. 렌더 파생값을 state에서 분리한다는 건 무슨 뜻이야?

답변 요약:
	•	`ghostRow` 같은 값은 게임의 "진짜 상태"가 아니라 렌더링을 위해 순간적으로 계산하는 값.
	•	예전에는 `activePiece.ghostRow = ...`처럼 상태에 직접 섞여 있었음.
	•	수정 후:
	•	렌더 직전에 `getRenderableActivePiece()`가 복사 객체를 만들어 `ghostRow`를 붙임
	•	즉, authoritative state는 그대로 유지하고 렌더용 파생값은 분리함

⸻

## Q. `game` 폴더와 `core` 폴더 차이는 뭐야?

답변 요약:
	•	`core`
	•	배열 기반 규칙
	•	순수 함수
	•	DOM, Canvas, Timer를 몰라야 함
	•	`game`
	•	입력, 타이머, 렌더, UI, 사운드 같은 실제 실행 담당
	•	즉:
	•	`core`는 심판
	•	`game`은 경기 진행 요원

⸻

## Q. 최근 리팩터링의 큰 흐름은 뭐였어?

답변 요약:
	•	메인 보드를 Canvas 렌더링으로 전환
	•	입력(`input.js`) 분리
	•	상태 팩토리(`stateFactory.js`) 도입
	•	runtime 분리
	•	`applyMoveIntent` → `moveExecution.js`로 이동
	•	스폰/홀드/큐 실행 → `pieceExecution.js`로 이동
	•	점수/UI → `ui.js`
	•	라인 클리어 실행 → `lineExecution.js`
	•	액션 실행 → `actionExecution.js`
	•	즉, `tetris.js`를 엔트리/조립 파일에 가깝게 줄이는 방향으로 진행 중

⸻

## Q. 입력 타이머와 중력 타이머가 따로 있는 게 왜 문제야?

답변 요약:
	•	싱글에서는 크게 티가 안 날 수 있지만, 멀티에서는 입력 처리와 중력 처리 순서가 클라이언트마다 달라질 수 있음.
	•	같은 입력이라도 어떤 환경에서는 `rotate -> fall`, 다른 환경에서는 `fall -> rotate`처럼 실행 순서가 달라질 수 있음.
	•	그래서 상태를 바꾸는 시간축을 하나로 모아야 하고, 그 첫 단계가 `processTick()` 도입이었음.

⸻

## Q. `tick + action` 형태로 입력을 큐에 넣는 게 왜 멀티 친화적이야?

답변 요약:
	•	문자열 배열(`["left", "rotate"]`)만 있으면 "무슨 입력이 있었는지"만 알 수 있고, "언제 처리해야 하는지"는 알 수 없음.
	•	반면 `{ tick: 101, action: "left" }` 형태는:
	•	몇 번째 tick에
	•	어떤 입력이
	•	어떤 순서로 들어왔는지
	•	기록할 수 있음.
	•	이 구조는 네트워크 전송, 상대 재생, 리플레이, 디버깅에 모두 유리함.

⸻

## Q. 지금 인터벌 문제는 해결된 거야?

답변 요약:
	•	싱글플레이 기준으로는 거의 해결 방향으로 갔다고 볼 수 있음.
	•	입력과 중력이 이제 같은 `processTick()` 안에서 처리되기 때문.
	•	다만 멀티 기준으로는 아직 반쯤 해결된 상태임.
	•	이유:
	•	메인 루프 시계는 아직 로컬 `setInterval`
	•	네트워크와 공유하는 공통 tick 규약은 아직 없음
	•	즉, "단일 로컬 시계"까지 왔지만 "멀티 동기화 가능한 공통 시계"까지는 아직 아님.

⸻

## Q. RNG는 어떤 방식으로 공급하는 게 좋아?

답변 요약:
	•	현재 단계에서는 서버가 `bag`를 직접 공급하는 방식이 가장 현실적임.
	•	이유:
	•	seed 기반 PRNG보다 구현과 디버깅이 단순함
	•	랜덤 관련 desync 가능성을 줄일 수 있음
	•	학습/구조 이해에도 유리함
	•	현재는 `pieceExecution.js`가 외부 RNG를 받을 수 있게 열어 두었고, 임시로 `Math.random`을 주입하는 상태.
	•	즉, 다음 단계에서 server bag 또는 seed PRNG로 쉽게 교체할 수 있는 구조를 마련한 것.

⸻

## Q. 현재 구조는 싱글 엔진으로는 좋은데, 왜 멀티 구조로는 아직 부족하다고 해?

답변 요약:
	•	`core` 계층(`board.js`, `step.js`)과 실행 모듈(`actionExecution.js`, `pieceExecution.js`, `moveExecution.js`, `lineExecution.js`)은 많이 정리됨.
	•	하지만 실제 조립과 운영의 중심이 아직 `tetris.js`에 많이 모여 있음.
	•	즉, 지금 구조는 "멀티를 고려한 싱글 구조"에 가깝고, "플레이어별 인스턴스를 여러 개 만들 수 있는 멀티 구조"까지는 아직 아님.
	•	핵심 병목은:
	•	전역 1판 기준의 조립점이 컸던 것
	•	페이지 DOM 연결과 게임 런타임 생성이 분리되지 않았던 것

⸻

## Q. `createTetrisRuntime(...)`로 바꾸는 이유는 뭐야?

답변 요약:
	•	게임 한 판을 전역으로 한 번만 만드는 대신, 필요할 때마다 새로 만들 수 있게 하기 위함.
	•	이렇게 해야:
	•	`localGame`
	•	`remoteGame`
	•	처럼 플레이어별 runtime을 따로 만들 수 있음.
	•	핵심은 클래스 사용 여부가 아니라, "게임 한 판을 독립적으로 생성할 수 있는가"임.

⸻

## Q. 최근에 `createTetrisRuntime(...)` 기준으로 무엇이 바뀌었어?

답변 요약:
	•	`src/game/tetris.js`는 이제 페이지에 직접 붙는 파일이 아니라, 게임 한 판을 만드는 런타임 팩토리를 export함.
	•	싱글 페이지 부트스트랩은 `src/game/singleGamePage.js`로 분리됨.
	•	멀티 페이지용으로 `src/game/multiGamePage.js`를 추가해:
	•	`localGame`
	•	`remoteGame`
	•	두 runtime을 생성하는 최소 구조를 마련함.
	•	현재는 로컬 게임만 키보드를 받고, 원격 게임은 빈 보드/UI만 준비하는 단계.

⸻

## Q. 지금부터가 본격적인 멀티 구현이야?

답변 요약:
	•	그렇다고 봐도 됨.
	•	이전까지는 멀티를 위한 기반 공사(엔진 분리, tick 구조, RNG 주입, runtime 팩토리화)였다면,
	•	이제부터는 실제로:
	•	local/remote runtime 운용
	•	네트워크 메시지 연결
	•	snapshot/action 반영
	•	server bag 공급
	•	같은 멀티 요소를 붙이기 시작하는 단계임.

⸻

## Q. 현재 그럼 app.js, roomService.js와 같은 파일이 어떤 식으로 동작하는지 설명해줘. (2026-05-20)

답변 요약:

현재 서버 구조는 크게 세 단계로 나뉜다.

```txt
브라우저
  ↓ Socket.IO 이벤트 전송
src/client/net/roomClient.js
  ↓
src/server/sockets/multiplayerSocket.js
  ↓
src/server/services/roomService.js
  ↓
서버 메모리 Map에 방 상태 저장
```

### 1. `src/app.js`

`src/app.js`는 실제 서버 로직을 직접 가지고 있는 파일이 아니라, 서버를 실행하기 위한 얇은 진입점이다.

```js
require("./server/init.js")
```

즉 `node src/app.js`로 실행하면 내부적으로는 `src/server/init.js`를 실행한다.

직접 실행할 때는 보통 `node src/app.js`를 사용하고, 서버 조립 코드는 `src/server/init.js`에 둔다.

```txt
src/app.js
  ↓
src/server/init.js
```

### 2. `src/server/init.js`

이 파일은 서버 전체의 시작점이다.

주요 책임은 다음과 같다.

```txt
1. Express 앱 생성
2. HTTP 서버 생성
3. Socket.IO 서버 생성
4. 정적 파일 제공 경로 설정
5. 멀티플레이 Socket.IO 이벤트 등록
6. PORT 5500에서 서버 실행
```

핵심 코드는 다음 흐름이다.

```js
const app = express()
const server = http.createServer(app)
const socketServer = socketIO(server)
```

여기서 역할을 나누면 다음과 같다.

```txt
express app
  = HTML, CSS, JS 같은 파일을 브라우저에 보내는 역할

http server
  = 실제로 포트를 열고 요청을 받는 서버

socket.io server
  = 브라우저와 실시간 이벤트를 주고받는 서버
```

Socket.IO는 `express app`에 직접 붙는 것이 아니라, `http.createServer(app)`로 만든 `server`에 붙는다.

```txt
HTTP server
├── Express 정적 파일 제공
└── Socket.IO 실시간 통신
```

정적 파일 루트는 이 코드로 정해진다.

```js
const STATIC_ROOT = path.join(__dirname, "..", "client")
app.use(express.static(STATIC_ROOT))
```

`src/server/init.js`에서 `__dirname`은 `src/server`를 의미한다.

따라서 현재 구조에서는 `path.join(__dirname, "..", "client")`가 `src/client` 폴더를 가리킨다.

```txt
프로젝트 루트
└── src
    └── client           ← 정적 파일 루트
        └── pages
            └── tetrisSingle.html
```

그래서 브라우저 URL에서는 `src`를 붙이지 않는다.

```txt
실제 파일:
src/client/pages/tetrisSingle.html

올바른 URL:
http://127.0.0.1:5500/pages/tetrisSingle.html

잘못된 URL:
http://127.0.0.1:5500/src/client/pages/tetrisSingle.html
```

잘못된 URL이 실패하는 이유는 서버가 이미 `src` 안을 기준으로 보고 있기 때문이다.

즉 `/src/client/pages/tetrisSingle.html`로 요청하면 서버는 실제로 다음 경로를 찾게 된다.

```txt
src/client/src/client/pages/tetrisSingle.html
```

마지막으로 이 줄이 멀티플레이 이벤트 처리를 연결한다.

```js
registerMultiplayerSocket(io)
```

이 말은 `app.js`가 직접 방 생성, 참가, 퇴장 로직을 처리하지 않고, Socket.IO 관련 처리는 `multiplayerSocket.js`에 맡긴다는 뜻이다.

### 3. `src/server/sockets/multiplayerSocket.js`

이 파일은 네트워크 이벤트 라우터 역할을 한다.

즉 클라이언트가 어떤 이벤트를 보내면, 서버에서 어떤 함수를 실행할지 연결한다.

```js
function registerMultiplayerSocket(io) {
  io.on("connection", (socket) => {
    console.log("a user connected")
  })
}
```

여기서 `io`와 `socket`의 차이가 중요하다.

```txt
io
  = Socket.IO 서버 전체
  = 모든 접속자에게 메시지를 보낼 때 사용 가능

socket
  = 지금 연결된 특정 브라우저 1명
  = 이 사용자에게만 응답할 때 사용
```

예를 들어 채팅 코드는 다음과 같다.

```js
socket.on("chatting", (data) => {
  const { name, msg } = data

  io.emit("chatting", {
    name,
    msg,
  })
})
```

여기서는 `io.emit()`을 사용한다.

의미는 다음과 같다.

```txt
어떤 클라이언트가 chatting 이벤트를 보냄
  ↓
서버가 받음
  ↓
서버가 모든 클라이언트에게 chatting 이벤트를 다시 보냄
```

반면 방 생성 코드는 `socket.emit()`을 사용한다.

```js
socket.on("room:create", (player) => {
  const hostPlayer = player
    ? { ...player, socketId: socket.id }
    : null

  const result = createRoom(hostPlayer)

  socket.emit("room:result", result)
})
```

이 흐름은 다음과 같다.

```txt
브라우저가 "room:create" 이벤트 보냄
  ↓
서버가 player 정보를 받음
  ↓
서버가 player 정보에 socket.id 추가
  ↓
roomService.createRoom(hostPlayer) 호출
  ↓
결과를 "room:result" 이벤트로 해당 브라우저에게만 돌려줌
```

여기서 `socket.id`는 Socket.IO가 연결마다 자동으로 만들어 주는 고유 ID다.

예를 들면 player 정보가 처음에는 다음처럼 들어온다.

```js
{
  playerId: "client-random-id",
  nickname: "Guest"
}
```

서버에서는 여기에 `socket.id`를 붙인다.

```js
{
  playerId: "client-random-id",
  nickname: "Guest",
  socketId: "abc123..."
}
```

`playerId`와 `socketId`는 의미가 다르다.

```txt
playerId
  = 게임 안에서 플레이어를 구분하기 위한 ID
  = 클라이언트가 생성해서 보냄

socketId
  = 현재 네트워크 연결을 구분하기 위한 ID
  = Socket.IO 서버가 자동 부여
```

나중에 disconnect 처리를 할 때는 `socketId`가 중요해진다.

예를 들어 브라우저가 꺼지면 `playerId`를 직접 보내지 못할 수 있지만, 서버는 끊어진 `socket.id`를 알 수 있다.

### 4. `src/server/services/roomService.js`

`roomService.js`는 실제 방 상태를 관리하는 로직 계층이다.

이 파일의 가장 중요한 특징은 Socket.IO를 모른다는 점이다.

```txt
roomService.js가 모르는 것
  • socket
  • io
  • DOM
  • HTML
  • 브라우저 이벤트

roomService.js가 아는 것
  • roomId
  • players
  • status
  • createdAt
```

현재 방 목록은 서버 메모리에 `Map`으로 저장된다.

```js
const rooms = new Map()
```

방 하나는 대략 이런 형태다.

```js
{
  roomId: "A1B2C3D4",
  players: [
    {
      playerId: "client-random-id",
      nickname: "Guest",
      socketId: "socket-id"
    }
  ],
  status: "waiting",
  createdAt: 1710000000000
}
```

`createRoom(hostPlayer)`는 방을 만든다.

흐름은 다음과 같다.

```txt
1. hostPlayer가 없으면 실패
2. 8자리 roomId 생성
3. players 배열에 hostPlayer를 넣음
4. status를 "waiting"으로 설정
5. rooms Map에 저장
6. 성공 결과 반환
```

성공 결과는 항상 이런 형태다.

```js
{
  ok: true,
  room,
  reason: null
}
```

실패 결과는 이런 형태다.

```js
{
  ok: false,
  room: null,
  reason: "HOST_PLAYER_REQUIRED"
}
```

이렇게 성공과 실패 응답 모양을 맞춰두면 클라이언트에서 처리하기 쉽다.

```js
if (result.ok) {
  // 방 생성 성공
} else {
  // result.reason 보고 실패 처리
}
```

`joinRoom(roomId, guestPlayer)`는 기존 방에 참가한다.

흐름은 다음과 같다.

```txt
1. roomId로 방을 찾음
2. 방이 없으면 ROOM_NOT_FOUND
3. 이미 플레이어가 2명이면 ROOM_FULL
4. 같은 playerId가 이미 있으면 PLAYER_ALREADY_JOINED
5. players 배열에 guestPlayer 추가
6. status를 "playing"으로 변경
7. 성공 결과 반환
```

여기서 현재 구조는 2인용 멀티플레이를 전제로 한다.

```js
if (roomState.players.length >= 2) {
  return failure("ROOM_FULL")
}
```

`removePlayer(roomId, playerId)`는 방에서 플레이어를 제거한다.

흐름은 다음과 같다.

```txt
1. roomId로 방을 찾음
2. playerId로 플레이어 위치를 찾음
3. players 배열에서 제거
4. 아무도 안 남으면 방 자체를 삭제
5. 한 명 남으면 status를 "waiting"으로 변경
6. 결과 반환
```

아무도 남지 않았을 때는 `rooms.delete(roomId)`로 방을 제거한다.

```txt
players.length === 0
  ↓
rooms.delete(roomId)
```

이 구조는 메모리 누수를 줄이기 위해 필요하다.

만약 빈 방을 계속 남겨두면 서버가 오래 켜져 있을수록 사용하지 않는 방 데이터가 쌓인다.

### 5. `src/client/net/roomClient.js`

이 파일은 브라우저 쪽 Socket.IO 어댑터다.

로비 페이지가 직접 `socket.emit(...)`을 많이 쓰지 않도록, 의미 있는 함수로 감싼다.

```js
const socket = io()
```

이 줄에서 현재 서버에 Socket.IO로 연결한다.

```js
export function createRoom(player) {
  socket.emit("room:create", player)
}
```

즉 로비 페이지에서는 네트워크 이벤트 이름을 몰라도 된다.

```js
createRoom({
  playerId: crypto.randomUUID(),
  nickname: "Guest",
})
```

그리고 서버 결과는 다음 함수로 받는다.

```js
export function onRoomResult(handler) {
  socket.on("room:result", handler)
}
```

현재 `multiLobby.html`에서는 결과를 콘솔에만 출력하고 있다.

```js
onRoomResult((result) => {
  console.log(result)
})
```

즉 지금 단계에서는 "방 생성 결과가 서버에서 돌아오는지 확인하는 단계"에 가깝다.

### 6. 방 생성 전체 흐름

방 생성 버튼을 눌렀을 때 실제 흐름은 다음과 같다.

```txt
[사용자]
  ↓
방 생성 버튼 클릭
  ↓
multiLobby.html
  ↓
createRoom({ playerId, nickname })
  ↓
roomClient.js
  ↓
socket.emit("room:create", player)
  ↓
multiplayerSocket.js
  ↓
player 정보에 socket.id 추가
  ↓
roomService.createRoom(hostPlayer)
  ↓
rooms Map에 방 저장
  ↓
{ ok: true, room, reason: null } 반환
  ↓
socket.emit("room:result", result)
  ↓
브라우저의 onRoomResult 콜백 실행
  ↓
console.log(result)
```

이 흐름에서 책임을 나누면 다음과 같다.

```txt
multiLobby.html
  = 버튼 클릭, 화면 이벤트 처리

roomClient.js
  = 클라이언트에서 서버로 Socket.IO 이벤트 전송

multiplayerSocket.js
  = 네트워크 이벤트를 받아 적절한 서버 로직 호출

roomService.js
  = 실제 방 상태 생성/수정/삭제
```

### 7. 왜 이렇게 나누는가?

가장 큰 이유는 "통신"과 "상태 변경 로직"을 분리하기 위해서다.

좋지 않은 구조는 다음과 같다.

```txt
socket.on("room:create", () => {
  // 여기서 방 ID 만들고
  // 여기서 players 배열 수정하고
  // 여기서 상태 바꾸고
  // 여기서 응답까지 처리
})
```

이렇게 하면 처음에는 빨라 보이지만, 나중에 문제가 생긴다.

```txt
문제점
  • 방 생성 로직을 테스트하기 어려움
  • Socket.IO 없이 room 로직을 재사용하기 어려움
  • 참가, 퇴장, 재접속, disconnect 처리가 섞이기 쉬움
  • 멀티 게임 상태 동기화가 붙으면 파일이 급격히 복잡해짐
```

현재처럼 나누면 각 파일의 질문이 명확해진다.

```txt
app.js
  = 서버를 어떻게 열 것인가?

multiplayerSocket.js
  = 어떤 네트워크 이벤트를 받을 것인가?

roomService.js
  = 방 상태를 어떻게 바꿀 것인가?

roomClient.js
  = 브라우저에서 어떤 요청을 보낼 것인가?
```

이 구분은 이후 멀티플레이 구현에서 중요하다.

게임 동기화를 붙일 때도 같은 원칙을 유지할 수 있다.

```txt
네트워크 이벤트
  "game:input"
  "game:snapshot"
  "game:ready"

게임 상태 로직
  applyInput()
  createSnapshot()
  updatePlayerState()
```

즉 Socket.IO 이벤트 이름과 게임 규칙 로직을 같은 곳에 다 밀어 넣지 않는 것이 핵심이다.

### 8. 현재 구조의 한계

현재 구현은 방 관리의 시작 단계다.

아직 완성된 멀티플레이 로비라고 보기는 어렵다.

남은 작업은 다음과 같다.

```txt
1. roomClient.js에 joinRoom(), leaveRoom() 추가
2. multiLobby.html에서 방 코드 입력 후 참가 기능 연결
3. 서버에서 socket.join(roomId) 사용
4. 방 상태 변경 시 방 안의 모든 플레이어에게 broadcast
5. disconnect 발생 시 자동 퇴장 처리
6. 방이 playing 상태가 되면 tetrisMulti.html로 이동
7. tetrisMulti.html에서 roomId/playerId를 받아 게임 런타임과 연결
8. 이후 게임 snapshot/input 동기화 연결
```

현재 코드에서 조심할 부분도 있다.

`joinRoom(roomId, guestPlayer)`에서는 `guestPlayer`가 없을 때를 먼저 검사하지 않는다.

그런데 아래 코드에서 `guestPlayer.playerId`를 바로 사용한다.

```js
const alreadyJoined = roomState.players.some(player => player.playerId === guestPlayer.playerId)
```

따라서 잘못된 요청이 들어오면 서버 에러가 날 수 있다.

나중에는 `createRoom()`처럼 다음 검사가 먼저 필요하다.

```js
if (!guestPlayer) {
  return failure("GUEST_PLAYER_REQUIRED")
}
```

### 9. 현재 단계의 결론

현재 구조는 아직 게임 동기화를 하는 단계는 아니지만, 멀티플레이의 기반은 올바른 방향으로 나뉘어 있다.

```txt
서버 실행
  → app.js

실시간 이벤트 연결
  → multiplayerSocket.js

방 상태 관리
  → roomService.js

브라우저 요청 함수
  → roomClient.js
```

이제 다음으로 할 일은 `roomService`를 더 복잡하게 만들기보다, 현재 있는 방 생성 흐름을 기준으로 `join`, `leave`, `broadcast`, `disconnect`를 하나씩 붙이는 것이다.

즉 다음 목표는 "게임 동기화"가 아니라 먼저 "로비에서 두 명이 같은 방에 들어가고, 양쪽 화면이 같은 방 상태를 보는 것"이다.

⸻

## Q. 유지보수를 위해 백엔드와 프론트엔드 파트를 나누어서 구조를 변경해줘. (2026-05-20)

답변 요약:
	•	서버에서 실행되는 Node.js 코드와 브라우저에서 실행되는 정적 파일을 물리적으로 분리함.
	•	새 구조는 `src/server`와 `src/client` 기준임.
	•	`src/app.js`는 계속 서버 실행 진입점으로 유지하고, 내부에서 `src/server/init.js`를 실행함.
	•	`src/server/init.js`는 Express, HTTP server, Socket.IO server 조립만 담당함.
	•	`src/server/sockets/multiplayerSocket.js`는 서버 Socket.IO 이벤트 핸들러 등록을 담당함.
	•	`src/server/services/roomService.js`는 Socket.IO를 모르는 순수 방 상태 관리 계층으로 유지함.
	•	`src/client`는 Express가 공개하는 정적 파일 루트가 됨.
	•	따라서 브라우저 URL은 기존처럼 `/pages/index.html`, `/pages/multiLobby.html` 형태를 유지함.
	•	브라우저 Socket.IO 어댑터는 `src/client/net/roomClient.js`로 이동함.
	•	게임 런타임, 렌더, 스타일, 사운드, HTML 페이지도 `src/client` 아래로 이동함.

현재 구조:

```txt
src/
├── app.js
├── server/
│   ├── init.js
│   ├── services/
│   │   └── roomService.js
│   └── sockets/
│       └── multiplayerSocket.js
└── client/
    ├── assets/
    ├── game/
    │   ├── core/
    │   ├── render/
    │   ├── runtime/
    │   ├── state/
    │   └── ui/
    ├── net/
    │   ├── chat.js
    │   └── roomClient.js
    ├── pages/
    └── styles/
```

실행 흐름:

```txt
node src/app.js
  ↓
src/server/init.js
  ↓
Express 정적 루트 = src/client
  ↓
Socket.IO 이벤트 등록 = server/sockets/multiplayerSocket.js
  ↓
방 상태 로직 = server/services/roomService.js
```

브라우저 흐름:

```txt
/pages/multiLobby.html
  ↓
../net/roomClient.js
  ↓
serverConnection.emit("room:create", player)
  ↓
server/sockets/multiplayerSocket.js
  ↓
server/services/roomService.js
```

검증:
	•	`node --check`로 server 주요 파일과 client 주요 모듈 문법 확인.
	•	`npm test`로 roomService 단위 테스트 10개 통과.
	•	로컬 서버를 `PORT=5599 node src/app.js`로 실행해 `/pages/index.html`, `/pages/multiLobby.html`, `/net/roomClient.js`, `/game/runtime/tetris.js`가 모두 `200 OK`로 응답하는지 확인.

⸻

## Q. Socket.IO 구조에서 `socketServer`, `clientSocket`, `serverConnection`, `handler`가 각각 어떤 의미야? (2026-06-23)

답변 요약:
	•	`socketServer`는 서버 전체 Socket.IO 관리자임.
	•	`clientSocket`은 서버가 바라보는 특정 브라우저 연결 1개임.
	•	`serverConnection`은 브라우저가 들고 있는 서버와의 Socket.IO 연결 객체임.
	•	`handler`는 이벤트가 도착했을 때 나중에 실행할 콜백 함수임.
	•	`emit()`은 이벤트를 보내는 함수이고, `on()`은 이벤트를 받을 함수를 등록하는 함수임.

### 1. 서버 시작과 Socket.IO 서버 생성

현재 시작점은 `src/app.js`다.

```js
require("./server/init.js")
```

이 파일은 실제 서버 조립을 하지 않고 `src/server/init.js`를 실행하는 얇은 진입점이다.

`src/server/init.js`에서는 다음 순서로 서버를 조립한다.

```js
const app = express()
const server = http.createServer(app)
const socketServer = socketIO(server)
```

각 객체의 의미는 다음과 같다.

```txt
app
  = Express 앱
  = HTTP 요청을 어떻게 처리할지 담는 객체

server
  = 실제 HTTP 서버
  = 포트를 열고 브라우저 요청을 받는 객체

socketServer
  = Socket.IO 서버 전체 관리자
  = 같은 HTTP server 위에서 실시간 연결을 관리하는 객체
```

구조로 보면 다음과 같다.

```txt
HTTP server
├── Express app
│   └── HTML/CSS/JS 정적 파일 제공
└── Socket.IO server
    └── 실시간 이벤트 통신
```

즉 Express와 Socket.IO는 같은 포트를 공유한다.

```txt
/pages/index.html
  → Express static 응답

/socket.io/...
  → Socket.IO 연결 처리
```

### 2. `/`로 접속할 때와 소켓 연결은 다른 흐름

`src/server/init.js`에는 다음 코드가 있다.

```js
app.use(express.static(STATIC_ROOT))

app.get("/", (_, res) => {
  res.sendFile(path.join(STATIC_ROOT, "pages", "index.html"))
})
```

브라우저가 `/`로 접속하면 흐름은 다음과 같다.

```txt
브라우저 GET /
  ↓
Express app.get("/")
  ↓
src/client/pages/index.html 파일 응답
```

중요한 점:

```txt
/ 로 접속한다고 소켓 연결이 자동으로 생기는 것은 아님.
소켓 연결은 브라우저에서 io()가 실행될 때 생김.
```

### 3. `registerMultiplayerSocket(socketServer)`의 의미

서버 조립 중 다음 코드가 실행된다.

```js
registerMultiplayerSocket(socketServer)
```

이 코드는 바로 방 생성이나 참가를 실행하는 것이 아니다.

의미는 다음과 같다.

```txt
socketServer에 앞으로 받을 이벤트 규칙을 등록한다.
```

`src/server/sockets/multiplayerSocket.js` 안에서는 다음처럼 등록한다.

```js
function registerMultiplayerSocket(socketServer) {
  socketServer.on("connection", (clientSocket) => {
    clientSocket.on("room:create", ...)
    clientSocket.on("room:join", ...)
    clientSocket.on("room:leave", ...)
    clientSocket.on("disconnect", ...)
  })
}
```

이 코드는 다음처럼 읽으면 된다.

```txt
socketServer야,
나중에 브라우저가 연결되면 clientSocket을 하나 받고,
그 clientSocket이 room:create를 보내면 이 함수 실행,
room:join을 보내면 이 함수 실행,
room:leave를 보내면 이 함수 실행해라.
```

즉 `registerMultiplayerSocket`은 이벤트를 즉시 실행하는 함수가 아니라, 이벤트 핸들러를 미리 등록하는 함수다.

### 4. `socketServer`와 `clientSocket`의 차이

`socketServer`는 전체 관리자다.

```js
const socketServer = socketIO(server)
```

```txt
socketServer
  = 모든 Socket.IO 연결을 관리하는 서버 전체 객체
  = 새 연결을 기다림
  = 전체 broadcast나 room broadcast에 사용
```

`clientSocket`은 연결된 클라이언트 1개다.

```js
socketServer.on("connection", (clientSocket) => {
  ...
})
```

```txt
clientSocket
  = 서버가 바라보는 특정 브라우저 연결 1개
  = 그 브라우저가 보낸 이벤트를 받음
  = 그 브라우저에게만 응답할 수 있음
```

브라우저 탭이 3개 연결되면 서버는 대략 이렇게 본다.

```txt
socketServer
├── clientSocket A
├── clientSocket B
└── clientSocket C
```

같은 코드 안에서 변수 이름은 `clientSocket` 하나지만, `connection` 콜백이 실행될 때마다 서로 다른 연결 객체가 들어온다.

```txt
탭 A 연결 → clientSocket = A 전용 연결
탭 B 연결 → clientSocket = B 전용 연결
탭 C 연결 → clientSocket = C 전용 연결
```

그래서 다음 코드는 현재 연결된 그 브라우저 1명에게만 보낸다.

```js
clientSocket.emit("room:result", result)
```

반대로 다음 코드는 같은 Socket.IO room에 들어간 모든 클라이언트에게 보낸다.

```js
socketServer.to(roomId).emit("room:updated", room)
```

### 5. 브라우저 쪽 `serverConnection`

브라우저 쪽 `src/client/net/roomClient.js`에는 다음 코드가 있다.

```js
if (typeof io !== "function") {
  throw new Error("Socket.IO client script must be loaded before client/net/roomClient.js")
}

const serverConnection = io()
```

여기서 `io()`는 `roomClient.js`에서 직접 선언한 함수가 아니다.

`multiLobby.html`에서 먼저 다음 스크립트를 로드한다.

```html
<script src="/socket.io/socket.io.js"></script>
```

이 스크립트가 브라우저 전역에 `window.io` 함수를 만들어준다.

그래서 다음 코드가 가능하다.

```js
const serverConnection = io()
```

의미:

```txt
브라우저가 서버와 Socket.IO 연결을 시작한다.
```

이 줄이 실행되면 서버의 다음 핸들러가 실행된다.

```js
socketServer.on("connection", (clientSocket) => {
  console.log("a user connected")
})
```

정리하면:

```txt
브라우저 serverConnection
        ⇄
서버 clientSocket
```

### 6. `emit()`과 `on()`의 방향

`emit()`은 이벤트를 보내는 함수다.

`on()`은 이벤트를 받았을 때 실행할 함수를 등록하는 함수다.

Socket.IO 이벤트는 클라이언트와 서버가 실시간으로 주고받는 "이름 붙은 메시지"라고 보면 된다.

```txt
event name: "player-input"
data: { roomId, action }
handler: socket.on("player-input", ...)
```

브라우저에서 서버로 보내는 경우:

```js
serverConnection.emit("room:create", player)
```

서버에서 받는 경우:

```js
clientSocket.on("room:create", (player) => {
  ...
})
```

서버에서 브라우저로 보내는 경우:

```js
clientSocket.emit("room:result", result)
```

브라우저에서 받는 경우:

```js
serverConnection.on("room:result", handler)
```

방향으로 보면 다음과 같다.

```txt
브라우저 → 서버
serverConnection.emit("room:create", player)
        ↓
clientSocket.on("room:create", handler)

서버 → 브라우저
clientSocket.emit("room:result", result)
        ↓
serverConnection.on("room:result", handler)
```

### 7. `onRoomUpdated(handler)`에서 handler는 언제 인자를 받는가?

`onRoomUpdated`는 다음처럼 생겼다.

```js
export function onRoomUpdated(handler) {
  serverConnection.on("room:updated", handler)
}
```

로비에서는 이렇게 사용한다.

```js
onRoomUpdated((room) => {
  if (!room) return
  renderRoom(room)
})
```

여기서 `(room) => { ... }`는 서버로 보내는 코드가 아니다.

이 함수는 나중에 실행할 콜백으로 등록된다.

```txt
등록 시점
  = 함수 모양만 넘김
  = 아직 room 값 없음

이벤트 도착 시점
  = 서버가 보낸 데이터를 Socket.IO가 handler 인자로 넣어 실행
```

서버가 다음 이벤트를 보낸다고 하자.

```js
socketServer.to(roomId).emit("room:updated", result.room)
```

그러면 클라이언트의 Socket.IO가 내부적으로 다음처럼 실행한다.

```js
handler(result.room)
```

그 순간 로비에서 작성한 화살표 함수의 `room` 파라미터에 값이 들어간다.

```js
(room) => {
  renderRoom(room)
}
```

즉 `handler`의 인자는 등록할 때 받는 것이 아니라, 이벤트가 도착해서 실행될 때 받는다.

### 8. `onRoomResult(handler)`는 왜 result와 requestType을 같이 받는가?

`roomClient.js`에는 다음 코드가 있다.

```js
let lastRoomRequestType = null

export function requestCreateRoom(player) {
  lastRoomRequestType = "create"
  serverConnection.emit("room:create", player)
}

export function onRoomResult(handler) {
  serverConnection.on("room:result", (result) => {
    handler(result, lastRoomRequestType)
  })
}
```

`result`는 서버가 보낸 값이다.

```js
clientSocket.emit("room:result", result)
```

`requestType`은 서버가 보낸 값이 아니라, 클라이언트가 마지막 요청 종류를 기억해둔 값이다.

```txt
requestCreateRoom() 실행
  → lastRoomRequestType = "create"

requestJoinRoom() 실행
  → lastRoomRequestType = "join"

requestLeaveRoom() 실행
  → lastRoomRequestType = "leave"
```

서버 응답이 도착하면 `roomClient.js`가 다음처럼 로비 콜백을 실행한다.

```js
handler(result, lastRoomRequestType)
```

그래서 로비에서는 다음처럼 받을 수 있다.

```js
onRoomResult((result, requestType) => {
  ...
})
```

정리:

```txt
result
  = 서버가 보낸 결과

requestType
  = 클라이언트가 마지막으로 보낸 요청 종류
```

### 9. Socket.IO room과 실시간 게임/음성 통신

실시간 게임은 보통 Socket.IO 이벤트로 주고받는다.

예시:

```js
serverConnection.emit("game:input", {
  roomId,
  playerId,
  action: "move-left",
  tick: 120,
})
```

서버는 입력을 받고 방 전체에 상태를 보낼 수 있다.

```js
clientSocket.on("game:input", ({ roomId, playerId, action, tick }) => {
  socketServer.to(roomId).emit("game:snapshot", snapshot)
})
```

즉 게임은 보통 다음 구조다.

```txt
클라이언트 → 서버
  입력 이벤트

서버 → 같은 room 클라이언트들
  상태 snapshot / 상대 입력 / 공격 정보
```

반면 음성/영상은 보통 Socket.IO 이벤트로 직접 보내지 않는다.

```txt
Socket.IO
  = 방 생성, 참가, WebRTC signaling 전달

WebRTC
  = 실제 음성/영상 데이터 전송
```

음성에서 Socket.IO가 담당하는 이벤트 예시는 다음과 같다.

```txt
voice:offer
voice:answer
voice:ice-candidate
voice:user-joined
voice:user-left
```

즉:

```txt
게임 입력/상태
  = Socket.IO 이벤트로 처리 가능

음성/영상 데이터
  = Socket.IO는 연결 협상만 돕고, 실제 데이터는 WebRTC 권장
```

### 10. Spring Boot STOMP와 비교

Socket.IO는 이벤트 이름 중심이다.

```js
serverConnection.emit("room:create", player)
clientSocket.on("room:create", handler)
```

Spring Boot STOMP는 destination 중심이다.

```js
stompClient.publish({
  destination: "/app/room/create",
  body: JSON.stringify(player),
})
```

```java
@MessageMapping("/room/create")
public void createRoom(PlayerDto player) {
  ...
}
```

`/app/room/create`는 정해진 실제 이름이 아니라 개발자가 정한 메시지 목적지 이름이다.

다만 Spring STOMP에서는 prefix 관례가 있다.

```txt
/app
  = 서버 @MessageMapping으로 보내는 요청 prefix

/topic
  = 여러 클라이언트가 구독하는 broadcast 목적지

/user/queue
  = 특정 사용자에게 보내는 개인 응답 목적지
```

현재 Socket.IO 코드와 비교하면 다음과 같다.

```txt
Socket.IO                         Spring STOMP
────────────────────────────────────────────
"room:create"                     "/app/room/create"
"room:join"                       "/app/room/join"
"room:leave"                      "/app/room/leave"
"room:result"                     "/user/queue/room/result"
"room:updated"                    "/topic/rooms/{roomId}"
"room:message"                    "/topic/rooms/{roomId}/messages"
```

Socket.IO의 room broadcast:

```js
clientSocket.join(roomId)
socketServer.to(roomId).emit("room:updated", room)
```

STOMP의 topic broadcast:

```js
stompClient.subscribe(`/topic/rooms/${roomId}`, handler)
```

```java
messagingTemplate.convertAndSend(
  "/topic/rooms/" + roomId,
  room
)
```

결론:

```txt
Socket.IO의 emit/on
  ≈ STOMP의 publish/subscribe

Socket.IO의 room broadcast
  ≈ STOMP의 topic broadcast

clientSocket.emit(...)
  ≈ convertAndSendToUser(...)
```

### 11. 핵심 결론

현재 프로젝트의 소켓 구조는 다음처럼 이해하면 된다.

```txt
src/server/init.js
  = Express/HTTP/Socket.IO 서버 조립

socketServer
  = 전체 Socket.IO 서버 관리자

registerMultiplayerSocket(socketServer)
  = 소켓 이벤트 규칙 등록

clientSocket
  = 서버가 바라보는 특정 브라우저 연결 1개

src/client/net/roomClient.js
  = 브라우저가 서버와 소켓 이벤트를 주고받는 어댑터

serverConnection
  = 브라우저가 들고 있는 서버 연결 객체

handler
  = 이벤트가 도착했을 때 실행할 콜백 함수
```

가장 중요한 문장:

```txt
socketServer는 전체 문이고,
clientSocket은 그 문으로 들어온 손님 한 명과 연결된 전용 창구다.

registerMultiplayerSocket은
그 문으로 손님이 들어왔을 때
각 손님 창구에서 어떤 말을 들을지 정해두는 곳이다.
```

### 12. 추가 Q&A: JavaScript `map()` 함수는 어떤 자료구조형이야?

`map()`은 자료구조형이 아니라 배열이 가진 내장 메서드다.

```js
const numbers = [1, 2, 3]

const doubled = numbers.map((num) => {
  return num * 2
})

console.log(doubled) // [2, 4, 6]
```

정리하면 다음과 같다.

```txt
Array
  = 자료구조

array.map(...)
  = 배열을 순회하면서 새 배열을 만드는 메서드
```

`map()`은 원본 배열을 직접 바꾸지 않고, 변환된 새 배열을 만든다.

```js
const original = [1, 2, 3]
const result = original.map((num) => num + 10)

console.log(original) // [1, 2, 3]
console.log(result)   // [11, 12, 13]
```

단, JavaScript에는 이름이 비슷한 `Map` 자료구조도 있다.

```js
const scoreMap = new Map()

scoreMap.set("player1", 100)
scoreMap.set("player2", 200)
```

차이는 다음과 같다.

```txt
array.map(...)
  = 배열 메서드
  = 배열을 변환해서 새 배열 생성

new Map()
  = key-value 자료구조
  = 특정 key로 값을 저장하고 조회
```

### 13. 추가 Q&A: `test/testRoomService.js` 코드는 무슨 의미야?

`test/testRoomService.js`는 `roomService.js`의 방 생성, 조회, 참가 기능이 기대대로 동작하는지 확인하는 테스트 코드다.

전체 흐름은 다음과 같다.

```txt
테스트 파일
  ↓ require()
roomService.js에서 함수 가져오기
  ↓
createRoom(), getRoomState(), joinRoom() 실행
  ↓
assert.equal()로 결과가 기대값과 같은지 확인
```

주요 키워드는 다음과 같다.

```js
const test = require("node:test")
const assert = require("node:assert/strict")
```

`require()`는 다른 모듈을 가져오는 CommonJS 문법이다.

```js
const {
  createRoom,
  getRoomState,
  joinRoom,
} = require("../src/server/services/roomService.js")
```

이 코드는 `roomService.js`가 `module.exports`로 내보낸 함수들을 구조 분해 할당으로 꺼내는 코드다.

```js
test("createRoom은 host player가 들어간 waiting room을 만든다", () => {
  // 테스트 내용
})
```

`test()`는 테스트 케이스 하나를 정의한다.

```js
assert.equal(result.ok, true)
```

`assert.equal(a, b)`는 `a`와 `b`가 같은지 검사한다. 다르면 테스트가 실패한다.

첫 번째 테스트는 `createRoom(hostPlayer)`가 다음 상태를 만드는지 확인한다.

```txt
ok: true
players.length: 1
players[0].playerId: "p1"
status: "waiting"
roomId type: string
```

두 번째 테스트는 `getRoomState(roomId)`로 생성된 방을 다시 조회할 수 있는지 확인한다.

세 번째 테스트는 `joinRoom(roomId, guestPlayer)`가 두 번째 플레이어를 추가하고 방 상태를 `waiting`으로 유지하는지 확인한다. 실제 게임 시작 상태인 `playing` 전환은 `startGame(roomId, playerId, socketId)` 흐름에서 처리한다.

### 14. 추가 Q&A: 현재 채팅 이벤트 코드는 무슨 의미야?

현재 채팅 이벤트는 별도 `chatSocket.js`가 아니라 `src/server/sockets/multiplayerSocket.js` 안에서 함께 등록된다.

전체 흐름은 다음과 같다.

```txt
브라우저 접속
  ↓
Socket.IO connection 발생
  ↓
서버가 socket 하나를 받음
  ↓
클라이언트가 "chatting" 이벤트 전송
  ↓
서버가 name, msg를 받음
  ↓
연결된 모든 클라이언트에게 다시 전송
```

```js
function registerMultiplayerSocket(socketServer) {
```

`registerMultiplayerSocket`은 Socket.IO 서버 객체인 `socketServer`에 멀티플레이와 채팅 이벤트 규칙을 등록하는 함수다.

```js
socketServer.on("connection", (clientSocket) => {
```

새 클라이언트가 서버에 연결될 때 실행된다.

```txt
socketServer
  = Socket.IO 서버 전체 객체

clientSocket
  = 방금 접속한 클라이언트 한 명의 연결 객체
```

```js
clientSocket.on("chatting", (data) => {
```

특정 클라이언트가 `"chatting"` 이벤트를 보냈을 때 실행된다.

```js
const { name, msg } = data
```

클라이언트가 보낸 객체에서 `name`, `msg`를 꺼내는 구조 분해 할당이다.

```js
socketServer.emit("chatting", {
  name,
  msg,
})
```

연결된 모든 클라이언트에게 `"chatting"` 이벤트를 다시 보낸다.

```txt
clientSocket.emit(...)
  = 현재 socket 한 명에게 보냄

socketServer.emit(...)
  = 연결된 모든 클라이언트에게 보냄

clientSocket.broadcast.emit(...)
  = 보낸 사람을 제외한 다른 클라이언트에게 보냄
```

### 15. 추가 Q&A: `"chatting"`은 내가 지정한 이벤트 이름이야? `connection`도 마음대로 바꿀 수 있어?

`"chatting"`은 개발자가 직접 정한 커스텀 이벤트 이름이다.

```js
socket.emit("chatting", data)
socket.on("chatting", (data) => {
  // 처리
})
```

이 이름은 마음대로 정할 수 있다.

```js
socket.emit("lobby-chat", data)
socket.emit("room-chat", data)
socket.emit("player-input", data)
socket.emit("game-start", data)
```

단, 보내는 쪽과 받는 쪽의 이름은 정확히 같아야 한다.

```js
// client
socket.emit("room-chat", data)

// server
socket.on("room-chat", (data) => {
  // 실행됨
})
```

반면 `"connection"`은 Socket.IO가 미리 정해둔 기본 이벤트 이름이다.

```js
io.on("connection", (socket) => {
  console.log("connected")
})
```

이 이름을 `"lobby-connection"`처럼 바꾸면 자동 연결 이벤트로 동작하지 않는다.

정리하면 다음과 같다.

```txt
"chatting"
  = 개발자가 정한 커스텀 이벤트 이름
  = 원하는 이름으로 바꿀 수 있음

"connection"
  = Socket.IO가 정한 기본 연결 이벤트
  = 자동 연결 이벤트로 쓰려면 그대로 사용해야 함
```

게임 기준으로는 다음처럼 구성할 수 있다.

```js
io.on("connection", (socket) => {
  socket.on("lobby-chat", (data) => {
    // 로비 채팅
  })

  socket.on("room-chat", (data) => {
    // 게임방 채팅
  })

  socket.on("join-room", (data) => {
    // 방 입장
  })

  socket.on("player-input", (data) => {
    // 이동, 회전, 하드드롭 입력
  })
})
```

구조로 보면 다음과 같다.

```txt
connection
  ├─ lobby-chat
  ├─ room-chat
  ├─ join-room
  ├─ leave-room
  ├─ player-ready
  ├─ player-input
  └─ game-over
```

`connection`은 연결이 열리는 순간이고, 그 안에서 주고받는 `"chatting"`, `"join-room"`, `"player-input"` 같은 이름들은 개발자가 설계하는 메시지 종류다.

---

## Q. 주기적으로 snapshot을 서버에 보내면 input을 보내는 게 의미 없는 거 아니야? snapshot 검증도 전송량이 많은 거 아니야? (2026-06-25)

맞다. **현재 구조 그대로만 보면 `game:input`은 상대 보드 표시 결과에 직접적인 영향을 거의 주지 않는다.**

현재 흐름은 다음에 가깝다.

```txt
클라이언트 A snapshot -> 서버 -> 클라이언트 B
클라이언트 B snapshot -> 서버 -> 클라이언트 A
100ms마다 반복
```

이 방식은 구현이 쉽고, 다음을 빠르게 검증하기 좋다.

```txt
두 클라이언트가 같은 room에 들어가는가
서버가 room 단위로 메시지를 중계하는가
상대 보드 canvas에 다른 player 상태를 그릴 수 있는가
snapshot 직렬화/역직렬화 경로가 동작하는가
```

하지만 장기적으로 좋은 구조는 아니다.

```txt
문제점
- 전체 board/state를 자주 보내므로 전송량이 크다.
- 서버가 게임 규칙을 판단하지 않는다.
- 클라이언트가 만든 상태를 서버가 거의 믿는 구조가 된다.
- input을 보내도 화면은 여전히 snapshot이 결정한다.
```

그래서 지금 `game:input`은 “상대 보드를 움직이기 위한 최종 구현”이 아니라, **input 중심 구조로 넘어가기 위한 첫 배관 검증**이다.

현재 단계의 의미는 다음과 같다.

```txt
클라이언트 키 입력
  -> game:input
  -> 서버 room/player/action 검증
  -> 같은 room 상대에게 전달
```

즉 지금은 “서버가 입력을 받을 수 있는가”를 확인한 단계다.

나중 목표는 다음처럼 바뀐다.

```txt
클라이언트 -> 서버
game:input

서버
input으로 게임 상태 계산

서버 -> 클라이언트
서버가 계산한 snapshot 또는 delta 전송
```

중요한 차이는 snapshot의 방향이다.

```txt
현재 snapshot:
클라이언트가 만든 snapshot을 서버로 보냄

목표 snapshot:
서버가 인정한 authoritative snapshot을 클라이언트로 내려줌
```

따라서 최종 구조에서도 snapshot이 완전히 사라지는 것은 아니다. 역할이 바뀐다.

```txt
현재:
snapshot = 상대 보드 표시의 중심
input = 통신 배관 검증

전환 중:
input = 서버 기록의 중심
snapshot = 화면 표시/보정용

목표:
input = 게임 상태 변경의 원인
snapshot = 서버가 계산한 결과 또는 복구/보정 자료
```

“snapshot 검증”도 전체 snapshot을 계속 양방향으로 비교한다는 뜻은 아니다. 더 나중에는 전체 snapshot 대신 작은 hash만 비교할 수 있다.

```js
{
  roomId,
  playerId,
  tick: 300,
  stateHash: "abc123"
}
```

평소에는 input 중심으로 동작하고, 가끔 hash만 비교한다.

```txt
평소:
input 위주

가끔:
stateHash 비교

불일치 시:
서버 snapshot으로 보정
```

그래서 결론은 다음과 같다.

```txt
현재 snapshot 왕복 구조는 전송량이 많다.
그래서 최종 구조로 유지하면 안 된다.

game:input을 추가한 이유는
이 snapshot 중심 구조에서 input 중심 구조로 옮겨가기 위해서다.
```

현재 프로젝트의 권장 전환 순서는 다음이다.

```txt
1. game:input 서버 도착 확인
2. 서버에 inputLog 저장
3. 서버에 player별 match state 만들기
4. 서버가 input으로 상태 계산
5. 서버가 snapshot을 클라이언트에게 내려줌
6. 클라이언트가 보내는 snapshot 주기를 줄임
7. 클라이언트 snapshot 전송 제거
8. 필요하면 hash 비교만 남김
```

정리하면:

```txt
지금 snapshot = 임시 화면 동기화 장치
지금 input = 다음 구조로 가기 위한 배관
최종 목표 = input 중심 + 서버 상태 계산 + 서버 snapshot/보정
```

---

## Q. 입력에는 `pieceIndex` 검사를 넣었는데, 왜 snapshot에도 `pieceIndex` 검사가 필요해? (2026-06-27)

`pieceIndex`는 쉽게 말해 **현재 몇 번째 블록인지 나타내는 번호표**다.

예를 들어 상대가 이렇게 플레이 중이라고 하자.

```txt
7번째 블록 조작 중
  -> 7번째 블록이 바닥에 고정됨
  -> 8번째 블록 등장
```

그런데 네트워크 메시지는 항상 정확한 순서와 타이밍으로 도착하지 않는다.

```txt
내 화면은 이미 상대의 8번째 블록을 보고 있음

그런데 늦게 도착한 메시지:
"상대의 7번째 블록은 여기 있었어"
```

이때 늦게 도착한 7번째 블록 snapshot을 그대로 적용하면, 상대 보드가 갑자기 과거 상태로 되돌아갈 수 있다.

```txt
현재 상대 보드: 8번째 블록
늦게 온 snapshot: 7번째 블록

그 snapshot을 적용하면:
8번째 블록 화면이 7번째 블록 화면으로 되돌아감
```

그래서 snapshot 보정 전에 먼저 확인해야 한다.

```txt
내가 보고 있는 상대 블록 번호 === 도착한 snapshot의 블록 번호
  -> 같은 블록 이야기이므로 위치/회전 보정 가능

내가 보고 있는 상대 블록 번호 !== 도착한 snapshot의 블록 번호
  -> 이미 지난 블록이거나 미래 블록일 수 있으므로 기본적으로 무시
```

코드로는 이런 의미다.

```js
if (localSnapshot.pieceIndex !== remoteSnapshot.pieceIndex) {
    return false
}
```

이 줄은 다음 뜻이다.

```txt
"내가 지금 상대의 8번째 블록을 보고 있는데,
도착한 snapshot이 7번째 블록 이야기라면 적용하지 마."
```

입력 동기화에도 같은 원리가 적용된다.

```txt
상대 입력이 도착함
  -> 입력의 pieceIndex 확인
  -> 현재 블록 번호와 같으면 적용
  -> 다르면 버림
```

입력은 이미 이 안전장치를 넣었다. 하지만 snapshot에는 아직 같은 검사가 없으면, 입력은 잘 막아도 snapshot이 과거 상태를 덮어쓸 수 있다.

정리하면 다음과 같다.

```txt
input의 pieceIndex 검사:
  늦게 도착한 입력이 현재 블록에 잘못 적용되는 것을 막음

snapshot의 pieceIndex 검사:
  늦게 도착한 상태 복사본이 상대 보드를 과거로 되돌리는 것을 막음
```

따라서 현재 단계에서 snapshot 보정 함수는 다음 순서가 적절하다.

```txt
1. snapshot이 없으면 보정하지 않음
2. gameOver 같은 종료 상태는 예외적으로 반영 가능
3. pieceIndex가 다르면 기본적으로 보정하지 않음
4. pieceIndex가 같을 때만 activePiece 위치/회전 차이를 보정
```

---

## Q. 상대 보드 `autoStart`를 `false`로 두면 더 정확하지 않아? 왜 다시 `true`를 유지해? (2026-06-28)

현재 멀티 화면의 상대 보드는 완전한 서버 authoritative 보드가 아니다. 지금은 다음 두 방식을 섞어서 상대 보드를 보여준다.

```txt
1. 상대의 game:input을 받아서 opponentGame을 예측 실행
2. 상대의 game:snapshot을 받아서 틀어진 상태를 보정
```

그래서 `opponentGame`에는 두 가지 선택지가 있다.

```txt
autoStart: false
  -> 상대 보드가 자체 중력으로 진행하지 않음
  -> input 또는 snapshot이 도착할 때만 화면이 바뀜
  -> 정확성은 높아질 수 있지만 움직임이 크게 끊김

autoStart: true
  -> 내 브라우저 안에서 상대 보드를 예측 실행함
  -> 상대 보드가 부드럽게 움직임
  -> 오차가 생기면 snapshotCorrection으로 보정
```

실험 결과 `autoStart: false`는 상대 블록 움직임이 너무 끊겨 보였다. 따라서 현재 MVP 단계에서는 `autoStart: true`를 유지한다.

현재 기준은 다음과 같다.

```txt
상대 보드 = 예측 실행 + snapshot 보정
```

즉 상대 보드가 완전히 독립적인 진실 원천이 되는 것이 아니라, 부드러운 표시를 위해 로컬에서 예측하고 snapshot으로 따라잡는 구조다.

코드 주석도 이 의미를 남긴다.

```js
// 상대 보드는 현재 input relay + snapshot correction 기반으로 예측 실행한다.
// autoStart를 false로 두면 snapshot 도착 시점에만 갱신되어 움직임이 크게 끊긴다.
// 서버 authoritative runtime으로 전환하기 전까지는 true를 유지한다.
opponentGame.init({ autoStart: true, serverBagChunks: opponentBagChunks })
```

나중에 서버가 직접 게임 상태를 계산하는 구조가 되면 방향이 달라진다.

```txt
현재:
상대 보드 = 클라이언트 예측 실행 + snapshot 보정

목표:
상대 보드 = 서버 authoritative snapshot 또는 delta 반영
```

따라서 `autoStart: true`는 최종 구조가 아니라, 현재 input relay 단계에서 부드러운 상대 보드 표시를 위한 임시 선택이다.

---

## Q. 변수명에 쓰이는 `resolve`, `pending`, `attach`, `detach` 같은 단어는 무슨 뜻이야? (2026-07-05)

코드에서 쓰이는 영어 단어는 일반 사전 뜻보다 **프로그래밍 문맥에서의 역할**로 이해하는 것이 좋다.

예를 들어 `pendingGarbageQueue`, `resolveGarbageCancel`, `attachKeyboardInput`, `detachKeyboard` 같은 이름은 단어를 쪼개면 역할이 드러난다.

| 단어 | 기본 의미 | 코드에서의 의미 | 프로젝트 예시 | 읽는 방법 |
|---|---|---|---|---|
| `pending` | 대기 중인 | 이미 발생했지만 아직 처리/적용되지 않은 상태 | `pendingGarbageQueue` | 상대 공격은 도착했지만 아직 보드에 올라오지 않은 garbage 대기열 |
| `queue` | 대기열 | 먼저 들어온 것을 먼저 처리하는 목록 | `pendingGarbageQueue` | pending garbage를 순서대로 쌓아두는 배열 |
| `resolve` | 해결하다, 정리하다 | 여러 상태를 계산해서 최종 결과를 만든다 | `resolveGarbageCancel()` | garbage 상쇄 결과를 계산해서 정리한다 |
| `raw` | 가공 전의 | 보정/상쇄/후처리 전 원본 값 | `rawAttackLines` | line clear로 생긴 순수 공격량 |
| `remaining` | 남아 있는 | 처리 후 아직 남은 값 | `remainingAttackLines` | garbage를 상쇄하고도 남은 공격량 |
| `incoming` | 들어오는 | 나에게 들어오는 데이터나 공격 | `incomingGarbageLines` | 상대에게서 들어온 garbage 총 줄 수 |
| `outgoing` | 나가는 | 내가 상대에게 보내는 데이터나 공격 | `outgoingAttackLines` | 상쇄 후 상대에게 보낼 공격 줄 수 |
| `canceled` | 취소된, 상쇄된 | 내 공격으로 막아낸 값 | `canceledGarbageLines` | 이번에 방어한 garbage 줄 수 |
| `apply` | 적용하다 | 계산 결과를 실제 상태에 반영한다 | `applyGarbageLines()` | board 배열에 garbage line을 실제로 넣는다 |
| `calculate` | 계산하다 | 상태를 바꾸지 않고 결과값만 만든다 | `calculateGarbageAttack()` | 지운 줄 수를 보고 공격량을 계산한다 |
| `enqueue` | queue에 넣다 | 바로 처리하지 않고 대기열에 추가한다 | `enqueueGarbage()` | garbage를 보드에 바로 넣지 않고 pending queue에 저장한다 |
| `dequeue` | queue에서 꺼내다 | 대기열에서 처리할 항목을 꺼낸다 | `dequeueGarbage()` | pending queue에서 다음 garbage를 꺼낸다 |
| `append` | 뒤에 추가하다 | 기존 데이터의 끝에 덧붙인다 | `game:garbage:append` | garbage 정보를 추가하라는 이벤트 |
| `sync` | 동기화하다 | 서로 다른 상태를 맞춘다 | `syncRoom()` | room 상태와 socket/player 상태를 맞춘다 |
| `handler` | 처리기 | 이벤트가 발생했을 때 실행되는 함수 | `registerMultiplayerHandlers()` | 멀티플레이 socket 이벤트 처리 함수를 등록한다 |
| `intent` | 의도, 목적 | 사용자가 하려는 행동이나 입력의 목적을 표현한다 | `inputIntent`, `moveIntent` | 실제 상태 변경 전, 어떤 행동을 하려는지 나타낸다 |
| `attach` | 붙이다 | 이벤트 리스너나 기능을 등록/연결한다 | `attachKeyboardInput()` | document에 키보드 입력 이벤트를 등록한다 |
| `detach` | 떼다 | 등록했던 이벤트 리스너나 연결을 해제한다 | `detachKeyboard()` | 등록했던 키보드 입력 이벤트를 제거한다 |
| `clone` | 복사하다 | 원본을 직접 바꾸지 않기 위해 새 객체/배열을 만든다 | `clonePendingGarbageQueue()` | pending garbage queue를 복사한다 |
| `emit` | 내보내다 | Socket.IO 이벤트를 보낸다 | `socket.emit("game:over", payload)` | `game:over` 이벤트를 서버나 클라이언트에 보낸다 |
| `on` | 켜다, 받다 | 특정 이벤트를 받았을 때 실행할 함수를 등록한다 | `socket.on("game:over", handler)` | `game:over` 이벤트가 오면 handler를 실행한다 |

예를 들어 다음 코드는 단어 단위로 읽을 수 있다.

```js
resolveGarbageCancel({
    pendingGarbageQueue,
    rawAttackLines,
})
```

의미는 다음과 같다.

```txt
아직 처리 대기 중인 garbage 목록과
가공 전 공격량을 받아서
garbage 상쇄 결과를 계산한다.
```

반환값도 단어 의미로 해석하면 쉽다.

```js
{
    pendingGarbageQueue,
    incomingGarbageLines,
    canceledGarbageLines,
    attackLines,
}
```

| 반환값 | 의미 |
|---|---|
| `pendingGarbageQueue` | 상쇄 후 아직 남은 garbage 대기열 |
| `incomingGarbageLines` | 상쇄 전 들어와 있던 garbage 총량 |
| `canceledGarbageLines` | 이번 공격으로 막아낸 garbage 줄 수 |
| `attackLines` | 막고도 남아서 상대에게 보낼 공격량 |

핵심 감각은 다음과 같다.

```txt
pending   = 기다리는 중
raw       = 아직 손대기 전
resolve   = 계산해서 정리
remaining = 정리 후 남은 것
intent    = 하려는 행동의 의도
apply     = 실제로 반영
enqueue   = 나중에 처리하려고 줄 세움
attach    = 등록하거나 연결함
detach    = 등록한 것을 제거함
```
