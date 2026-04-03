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
