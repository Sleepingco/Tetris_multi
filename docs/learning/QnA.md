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

이 답변은 2026-06-28의 input relay + client snapshot correction 단계 기준이다. 당시 멀티 화면의 상대 보드는 완전한 서버 authoritative 보드가 아니었고, 다음 두 방식을 섞어서 상대 보드를 보여줬다.

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

당시 실험 결과 `autoStart: false`는 상대 블록 움직임이 너무 끊겨 보였다. 따라서 그 시점의 MVP 단계에서는 `autoStart: true`를 유지했다.

당시 기준은 다음과 같았다.

```txt
상대 보드 = 예측 실행 + snapshot 보정
```

즉 상대 보드가 완전히 독립적인 진실 원천이 되는 것이 아니라, 부드러운 표시를 위해 로컬에서 예측하고 snapshot으로 따라잡는 구조였다.

코드 주석도 이 의미를 남긴다.

```js
// 당시 상대 보드는 input relay + snapshot correction 기반으로 예측 실행했다.
// autoStart를 false로 두면 snapshot 도착 시점에만 갱신되어 움직임이 크게 끊긴다.
// 서버 authoritative runtime으로 전환하기 전까지는 true를 유지한다.
opponentGame.init({ autoStart: true, serverBagChunks: opponentBagChunks })
```

2026-07-10 기준으로는 이 방향이 실제로 바뀌었다.

```txt
과거:
상대 보드 = 클라이언트 예측 실행 + snapshot 보정

현재:
상대 보드 = server authoritative snapshot full apply
상대 runtime = autoStart: false
상대 game:input relay = 수신해도 opponentGame에 적용하지 않음
```

따라서 `autoStart: true`는 최종 구조가 아니라, input relay 단계에서 부드러운 상대 보드 표시를 위한 임시 선택이었다.

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

---

## Q. 서버 authoritative까지는 얼마나 남았고, 멀티 완성은 server auth가 끝이야? (2026-07-09)

server authoritative 전환은 한 번에 끝나는 기능이 아니라, 여러 책임을 서버 쪽으로 옮기는 과정이다.

현재까지 옮긴 큰 축은 다음과 같다.

```txt
서버가 player별 authoritativeState 보유
서버가 input을 authoritativeState에 적용
서버가 lock / line clear / score / attack / garbage 계산
서버가 gravity tick 실행
서버가 authoritative snapshot emit
상대 보드는 server snapshot 기준으로 표시
game over / match finish는 서버 결과 기준으로 처리
```

그래서 server auth MVP 기준으로는 상당히 많이 왔다. 하지만 "멀티 완성"은 server auth만으로 끝나지 않는다.

```txt
server auth = 게임 결과의 진실 원천을 서버로 옮기는 것
멀티 완성 = 그 구조가 실제 사용자 플레이에서 안정적이고 자연스럽게 보이는 것
```

server auth 이후에도 남는 작업은 있다.

- garbage 표시와 pending queue 의미 정리
- 내 보드 prediction과 server correction 충돌 완화
- disconnect/rejoin 안정화
- match finish 후 결과 표시와 로비 복귀 흐름
- 2탭 수동 회귀
- 이후 AI 분석용 로그 신뢰도 정리

즉, server auth는 멀티 완성의 **끝**이 아니라, AI 분석과 공정한 멀티플레이를 위한 **핵심 기반**이다.

---

## Q. pure function 분리는 언제까지 해야 하고, 언제 server auth로 넘어가야 해? (2026-07-09)

pure function 분리는 server auth를 위한 준비 작업이었다.

예를 들어 다음 함수들은 서버에서도 재사용하기 쉬운 형태가 되었다.

- `isPieceAboveTop()`
- `createSpawnedPiece()`
- `getHardDropRow()`
- `resolveInputMoveIntent()`
- `isTSpinLock()`
- `resolveAttackState()`
- `calculateGarbageAttack()`
- `resolveGarbageCancel()`
- `applyGarbageLines()`

하지만 pure function 분리를 계속 늘리는 것이 목표는 아니다. 기준은 이 질문이다.

```txt
이 분리가 server authoritative 전환에 직접 필요한가?
```

직접 필요하면 한다. 직접 필요하지 않으면 나중으로 미룬다.

이번에는 서버가 실제로 player state를 계산해야 했기 때문에 다음 단계로 넘어갔다.

```txt
pure logic 준비
  -> server authoritativeState 생성
  -> server input 적용
  -> server lock/attack/garbage 계산
  -> server gravity ticker
  -> server snapshot emit
```

즉, 지금은 더 많은 pure function 후보를 찾는 단계가 아니라, 이미 분리한 core logic을 서버 실행 흐름에 연결하는 단계다.

---

## Q. `applyInputToMatchPlayerState()`와 hard drop 처리가 왜 나뉘어 있었고, 왜 `applyAuthoritativeInput()` 하나로 합쳤어? (2026-07-09)

초기에는 위험을 줄이기 위해 이동 입력과 hard drop lifecycle을 나눴다.

```txt
move_left / move_right / rotate / soft_drop
  -> 단순 위치/회전 변경

hard_drop
  -> 최하단 row 계산
  -> lock
  -> line clear
  -> score
  -> attack
  -> next spawn
```

처음부터 모두 한 함수에 넣으면 lock/spawn/score/garbage까지 한 번에 흔들릴 수 있었다.

하지만 server authoritative 입장에서 보면 최종 public entry는 하나여야 한다.

```js
applyAuthoritativeInput(authoritativeState, input, gameCore)
```

이 함수 하나가 모든 action을 받아야 한다.

- `move_left`
- `move_right`
- `soft_drop`
- `rotate`
- `hard_drop`
- `hold`

테스트도 특정 내부 helper를 직접 보는 방식보다 public entry를 기준으로 보는 것이 맞다.

```txt
좋은 테스트 방향:
applyAuthoritativeInput({ action: "hard_drop" }) 결과 확인

피해야 할 방향:
applyHardDropInput() 같은 내부 helper를 직접 테스트
```

이렇게 해야 socket, matchService, ticker가 모두 같은 server authoritative 진입점을 기준으로 동작한다.

---

## Q. server snapshot과 client snapshot의 최종 형태는 뭐야? snapshot을 계속 보내면 비용이 너무 크지 않아? (2026-07-09)

snapshot이 완전히 사라지는 것은 아니다. 역할이 바뀐다.

이전 구조는 다음에 가까웠다.

```txt
client A snapshot -> server -> client B
client B snapshot -> server -> client A
```

이 구조의 문제는 서버가 상태의 진실 원천이 아니라는 점이다. client가 만든 board, score, lines를 상대에게 보여주는 흐름이 된다.

목표 구조는 이렇다.

```txt
client input -> server
server authoritativeState 계산
server authoritative snapshot -> clients
```

중요한 차이는 snapshot의 방향이다.

```txt
이전 snapshot:
client가 만든 상태를 서버가 중계

목표 snapshot:
server가 계산한 상태를 client에게 내려줌
```

통신 비용은 당연히 봐야 한다. 그래서 최종적으로는 모든 frame마다 큰 board snapshot을 보내는 구조가 아니라, 아래처럼 단계적으로 줄일 수 있다.

```txt
초기 server auth MVP:
주기적 authoritative snapshot

안정화 후:
input 결과 / lock 결과 / 변경된 필드 중심 delta

더 이후:
snapshot은 복구, 재접속, drift correction 용도
```

지금은 먼저 정확한 구조를 만들고, 그 다음 전송량을 줄이는 순서가 맞다.

---

## Q. 내 보드는 내가 직접 플레이한 결과인데, 서버 계산이 늦거나 틀리면 강제로 덮여서 이상해지지 않을까? (2026-07-09)

이 걱정은 맞다. 그래서 내 보드는 상대 보드와 다르게 처리한다.

상대 보드는 내가 조작하는 보드가 아니므로 server authoritative snapshot을 그대로 적용해도 된다.

```txt
opponent board:
server authoritative snapshot을 그대로 적용
```

하지만 내 보드는 조작감이 중요하다.

```txt
my board:
client prediction 유지
server snapshot은 보수적인 correction 후보
```

그래서 `shouldCorrectMyPrediction(serverSnapshot, localSnapshot)` 같은 보수적 기준을 둔다.

예를 들어 active piece 위치만 조금 다르면 바로 덮지 않는다.

```txt
activePiece만 다름
  -> 즉시 보정하지 않음
  -> 입력감 보호
```

하지만 의미 있는 drift는 보정 후보가 된다.

```txt
server pieceIndex가 더 앞섬
score 다름
lines 다름
phase 다름
  -> 보정 후보
```

핵심은 다음이다.

```txt
상대 보드 = 서버 snapshot이 기준
내 보드 = client prediction 우선, 서버 snapshot은 안전장치
```

이 정책은 아직 2탭 실제 플레이에서 조작감 확인이 필요하다.

---

## Q. 왜 기존 `game:snapshot`, `game:garbage:attack`, `game:over`를 제거했어? (2026-07-09)

server authoritative로 가면 client가 결과를 선언하는 이벤트는 점점 줄어야 한다.

기존 구조에서는 client가 이런 값을 직접 보냈다.

```txt
game:snapshot
  -> 내 board/score/lines를 client가 만들어 서버에 보냄

game:garbage:attack
  -> 내 공격량 lines를 client가 선언

game:over
  -> 내가 졌다고 client가 선언
```

MVP 초반에는 빠르게 멀티 흐름을 만들기 위해 괜찮은 선택이었다. 하지만 server authoritative 전환 후에는 위험하다.

```txt
공격량은 서버 lock 결과가 계산해야 함
game over는 서버 top-out 판정이 결정해야 함
상대 보드는 서버 authoritative snapshot이 내려줘야 함
```

그래서 client 송신 경로를 제거했다.

- `sendGameSnapshot()`
- `sendGarbageAttack()`
- `sendGameOver()`

그리고 서버 legacy event는 match 결과를 바꾸지 않도록 테스트로 고정했다.

이건 기능을 없앤 것이 아니라, 결과 결정권을 client에서 server로 옮긴 것이다.

---

## Q. 상대 보드는 왜 이제 `game:input` relay를 적용하지 않고 `autoStart: false`로 뒀어? (2026-07-09)

예전에는 상대 보드를 부드럽게 보이게 하려고 두 가지를 섞었다.

```txt
상대 game:input relay
  -> opponentGame.enqueueInput()
  -> 내 브라우저가 상대 보드를 예측 실행

상대 game:snapshot
  -> 틀어진 부분 보정
```

하지만 server authoritative snapshot을 적용하기 시작하면 문제가 생긴다.

```txt
opponent input relay로 한 번 움직임
server authoritative snapshot으로 다시 움직임
```

즉, 같은 상대 상태를 두 경로가 동시에 바꾸게 된다.

그래서 전환 후에는 상대 보드를 server snapshot 전용으로 바꿨다.

```js
opponentGame.init({ autoStart: false, serverBagChunks: opponentBagChunks })
```

그리고 client에서 `receiveGameInput()`으로 상대 입력을 받아 `opponentGame.enqueueInput()` 하던 경로를 제거했다.

현재 의미는 다음과 같다.

```txt
내 보드:
내 입력으로 client prediction 실행

상대 보드:
server authoritative snapshot으로만 갱신
```

단점은 상대 보드 움직임이 500ms snapshot 주기에 따라 끊겨 보일 수 있다는 점이다. 이건 correctness를 먼저 확보한 뒤, 나중에 interpolation이나 더 작은 delta 전송으로 개선할 수 있다.

---

## Q. `gameOver` finish 처리를 왜 공통 helper로 모았어? (2026-07-09)

server authoritative 전환 후 game over는 두 경로에서 발생할 수 있다.

```txt
1. client input 처리 중 lock -> top-out
2. server gravity ticker 중 lock -> top-out
```

두 경로 모두 같은 side effect를 가져야 한다.

```txt
finishGame()
ticker stop
match:finish emit
game_over log 저장
```

처음에는 input 경로와 ticker 경로가 각각 이 일을 했다. 그러면 한쪽만 수정되거나, 거의 동시에 gameOver가 발생했을 때 중복 처리될 위험이 있다.

그래서 `finishAuthoritativeMatch()`로 모았다.

```js
finishAuthoritativeMatch({
    roomId,
    loserPlayerId,
    finishGame,
    stopRoomTicker,
    emitMatchFinish,
    saveGameEventLog,
})
```

이 helper는 첫 finish만 처리하고, 이미 `finishGame()`이 `GAME_NOT_PLAYING`을 반환하면 `ALREADY_FINISHED`로 보고 emit/log를 반복하지 않는다.

```txt
첫 호출:
finish + ticker stop + match:finish + game_over log

두 번째 호출:
ALREADY_FINISHED
추가 emit/log 없음
```

이렇게 해야 match 결과와 game log가 한 번만 남는다.

---

## Q. 지금 남은 작업은 뭐야? (2026-07-09)

현재 큰 blocker는 네 가지다.

1. `pendingGarbageQueue`와 client 표시/DTO 정리

```txt
서버는 pendingGarbageQueue를 들고 있음
client는 game:garbage:append로 표시/queue를 받음
authoritative snapshot DTO에는 pending garbage가 빠져 있음
```

이 의미를 정해야 한다.

2. 내 보드 correction 안정화

```txt
client prediction 유지
server snapshot correction
applySnapshot() 이후 gravity/input 흐름 유지
```

이 세 가지가 실제 플레이에서 부딪히지 않는지 확인해야 한다.

3. ticker 지연 정책

```txt
event loop가 밀렸을 때:
  밀린 시간만큼 catch-up 할지
  callback당 최대 1 step만 처리할지
```

이 정책을 정해야 한다.

4. 2탭 수동 회귀

자동 테스트로는 통신 흐름을 많이 잡았지만, 실제 사용자 체감은 2탭에서 봐야 한다.

```txt
create room
join room
start
input
attack
garbage
top-out
match finish
lobby/rejoin
```

이 흐름이 자연스럽게 이어지는지 확인해야 한다.

---

## Q. 이제 멀티 MVP는 완료로 봐도 돼? (2026-07-10)

자동 테스트 기준으로는 server authoritative 멀티 MVP의 핵심 구현은 완료에 가깝다.

현재 포함된 흐름은 다음과 같다.

```txt
room create/join/start
server bag
server authoritative player state
input apply
server gravity ticker
authoritative snapshot
garbage attack/cancel/apply
combo / back-to-back / T-Spin attack
top-out / gameOver / match finish
match cleanup
```

다만 포트폴리오 시연 기준으로는 **조건부 완료**다.

최종 완료 판정은 2탭 수동 회귀를 통과한 뒤로 본다.

```txt
자동 테스트 기준: 완료에 가까움
시연 MVP 기준: 2탭 회귀 통과 후 완료
AI 전환 기준: 2탭 회귀 통과 후 가능
```

---

## Q. 왜 내 보드는 server snapshot을 항상 적용하지 않아? (2026-07-10)

내 보드는 사용자가 직접 조작하는 화면이다.

server snapshot을 매번 full apply하면 서버 기준으로는 더 정확해 보일 수 있지만, 사용자는 다음 문제를 느낄 수 있다.

```txt
입력이 느려짐
조각이 되감기는 느낌
line clear effect가 끊김
gravity가 멈춘 것처럼 보임
```

그래서 현재 정책은 다음과 같다.

```txt
내 보드:
client prediction 우선

상대 보드:
server authoritative snapshot full apply
```

내 보드에 server snapshot을 full apply하는 경우는 제한한다.

```txt
1. server snapshot이 gameOver인 경우
2. pendingGarbageLines가 감소했고 board가 달라진 경우
   즉, 서버가 실제 garbage를 board에 적용한 것으로 볼 수 있는 경우
```

단순히 `pieceIndex`가 서버에서 앞섰다는 이유만으로 내 보드를 덮지 않는다.

---

## Q. 왜 garbage line이 gameOver 때만 갑자기 보였어? (2026-07-10)

원인은 `pendingGarbageLines`와 실제 `pendingGarbageQueue`의 차이였다.

서버는 실제 상태로 다음 값을 가진다.

```txt
authoritativeState.pendingGarbageQueue
```

하지만 client snapshot DTO에는 queue 전체를 보내지 않고 표시용 숫자만 보낸다.

```txt
pendingGarbageLines
```

처음 정책은 내 snapshot에서 `pendingGarbageLines` 숫자만 표시하고, board full apply는 `gameOver`일 때만 허용했다.

그래서 서버가 lock 시점에 garbage를 board에 적용해도 내 화면에는 board 변화가 보이지 않고, `gameOver` snapshot에서만 갑자기 반영됐다.

수정 후 정책은 다음과 같다.

```txt
pendingGarbageLines 증가:
  표시만 갱신

pendingGarbageLines 감소 + board 변경:
  서버가 garbage를 실제 board에 적용한 것으로 보고 full apply

lineClearing 중:
  gameOver가 아니면 full apply 차단
```

이렇게 해서 line clear effect는 보호하면서, garbage 적용 board는 gameOver 전에도 볼 수 있게 했다.

---

## Q. 왜 `game:garbage:append`를 다시 살리지 않았어? (2026-07-10)

server authoritative 구조에서는 garbage의 원천이 서버 상태여야 한다.

`game:garbage:append`를 다시 살리면 client runtime queue와 server `pendingGarbageQueue`가 동시에 같은 의미를 수정할 수 있다.

```txt
server pendingGarbageQueue
client queueGarbageLines()
```

이 둘이 동시에 살아 있으면 중복 적용이나 표시 drift가 생길 수 있다.

그래서 현재 정책은 다음과 같다.

```txt
garbage 원천:
server authoritativeState.pendingGarbageQueue

client 표시:
snapshot.pendingGarbageLines

client board 반영:
server snapshot correction 조건을 통과할 때만
```

즉, `game:garbage:append`는 gameplay state 변경 경로로 쓰지 않는다.

---

## Q. local prediction과 server authoritative snapshot 충돌은 무슨 뜻이야? (2026-07-10)

현재 내 보드에는 두 개의 상태 원천이 동시에 영향을 준다.

```txt
1. local prediction
   - 내 키 입력을 즉시 반영하는 브라우저 내부 상태
   - 조작감과 line clear effect를 담당

2. server authoritative snapshot
   - 서버가 계산한 정답 상태
   - garbage, top-out, score, attack 결과의 기준
```

상대 보드는 내가 직접 조작하지 않으므로 server snapshot을 바로 적용해도 된다.

```txt
상대 보드:
server snapshot -> opponentGame.applySnapshot()
```

하지만 내 보드는 내가 직접 조작하고 있기 때문에 server snapshot을 매번 full apply하면 다음 문제가 생긴다.

```txt
입력 반응이 되감기는 느낌
line clear effect 생략
local이 아직 처리 중인 상태를 server snapshot이 덮어씀
```

그래서 현재 정책은 다음과 같다.

```txt
상대 보드:
server authoritative snapshot을 full apply

내 보드:
local prediction을 우선
필요한 경우에만 server snapshot을 제한적으로 full apply
```

full apply를 허용하는 대표 상황은 다음과 같다.

```txt
1. server snapshot phase가 gameOver인 경우
2. 서버가 garbage를 실제 board에 적용한 것으로 볼 수 있는 경우
   예: pendingGarbageLines 감소 + board 변경
3. 명백한 desync로 local 상태를 계속 유지하면 더 어색한 경우
```

반대로 다음 상황에서는 full apply를 피한다.

```txt
local phase가 lineClearing인 경우
단순히 server pieceIndex가 조금 앞선 경우
activePiece 위치 차이만 있는 경우
```

핵심은 다음과 같다.

```txt
상대 보드 = 서버 상태를 바로 믿어도 됨
내 보드 = 조작감/연출을 보호하면서 서버 상태를 필요한 순간에만 반영
```

---

## Q. 여기서 DTO라는 표현을 써도 맞아? (2026-07-10)

써도 된다. DTO는 Spring 전용 용어가 아니다.

```txt
DTO = Data Transfer Object
```

뜻은 계층 사이에서 데이터를 전달하기 위해 만든 객체다.

현재 프로젝트에서는 서버 내부 상태와 클라이언트 전송 객체가 다르다.

```txt
authoritativeState
  - 서버 내부 원본 상태
  - board, activePiece, pendingPiece, pieceQueue, combo, backToBack 등 포함

snapshot DTO
  - 클라이언트에 보내기 위해 정리한 전송용 객체
  - tick, board, activePiece, score, pendingGarbageLines 등 포함
```

즉 다음 표현은 자연스럽다.

```txt
authoritativeState -> snapshot DTO
```

의미는 다음과 같다.

```txt
서버 내부 상태를 클라이언트 전송용 snapshot 객체로 변환한다.
```

다만 JavaScript/Node 문맥에서는 다음 표현도 자주 쓴다.

```txt
snapshot payload
snapshot response
transport payload
serialized snapshot
client snapshot
```

포트폴리오나 문서에서는 `authoritative snapshot DTO`라고 써도 괜찮다. 더 직관적으로 쓰고 싶다면 `snapshot payload`도 좋다.

---

## Q. 왜 match cleanup을 따로 보강했어? (2026-07-10)

server authoritative 전환 후 `matchService`는 player별 board, queue, inputLog, authoritativeState를 메모리에 들고 있다.

게임이 끝났는데 `matches Map`에서 제거하지 않으면 장시간 실행 시 메모리에 계속 남는다.

처리한 cleanup은 두 가지다.

```txt
game:leave 성공:
  ticker stop
  deleteMatch(roomId)

authoritative gameOver 정상 종료:
  finishGame()
  game_over log 생성
  ticker stop
  match:finish emit
  deleteMatch(roomId)
  game_over log 저장
```

중요한 점은 log 생성 순서다.

`deleteMatch()`를 먼저 하면 `gameId`에 필요한 `match.createdAt`을 잃을 수 있다.

그래서 `game_over` log 객체를 먼저 만들고, 그 다음 match를 삭제한다.

---

## Q. inputLog 상한은 왜 필요해? (2026-07-10)

`recordInput()`은 player 입력을 계속 저장한다.

상한이 없으면 긴 게임이나 반복 테스트에서 `inputLog`가 계속 커질 수 있다.

현재 정책은 다음과 같다.

```txt
player별 inputLog 최대 1000개 유지
오래된 로그는 앞에서 제거
sequence는 nextInputSequence로 계속 증가
```

`inputLog.length + 1`로 sequence를 만들면 오래된 로그를 자른 뒤 sequence가 중복될 수 있다.

그래서 별도 필드가 필요하다.

```js
nextInputSequence
```

이 값은 로그가 잘려도 전체 입력 순서를 유지한다.

---

## Q. 상대 보드에도 line clear effect를 줄 수 있어? (2026-07-10)

가능하다. 다만 정확한 local line clear animation과 표시용 effect는 다르다.

현재 상대 보드는 server snapshot만 적용한다.

```txt
server already cleared board
-> sends authoritative snapshot
-> opponentGame.applySnapshot(snapshot)
```

이 상태에서는 상대 client가 “어떤 줄이 방금 지워졌는지”를 알기 어렵다.

최소 구현은 서버 snapshot DTO에 표시용 정보를 추가하는 것이다.

```js
lineClearEffect: {
    rows: [18, 19],
    pieceIndex: 12
}
```

client는 상대 snapshot 적용 후 해당 row만 flash하면 된다.

```txt
opponentGame.applySnapshot(snapshot)
opponentGame.playLineClearEffect(rows)
```

소리는 빼는 것이 맞다.

동일한 snapshot에서 effect가 반복 재생되지 않도록 `pieceIndex` 또는 effect key로 중복 방지를 해야 한다.

## GPT 모델별 추천 수준 (2026-07-11)
| 작업 | 추천 모델 | 추론 |
|------|-----------|------|
| 문법 질문 | Luna | Low |
| 간단한 코드 | Terra | Medium |
| 기능 구현 | Terra | High |
| 버그 분석 | Sol | High |
| 테스트 전략 | Sol | High |
| 서버 아키텍처 | Sol | Extra High |
| AI 설계 | Sol | Max |
| 프로젝트 전체 리뷰 | Sol | Ultra |
| Codex 프롬프트 작성 | Terra 또는 Sol | High |
| 포트폴리오 기술 근거 작성 | Sol | Extra High |

---

## Q. 빠른 입력에서 왜 server snapshot correction이 내 블록을 되돌렸고, 왜 시간 기준으로 바꿨어? (2026-07-10)

문제의 원인은 서버가 틀린 상태를 보낸 것이 아니라, client와 server의 정상적인 처리 시간 차이를 너무 빨리 desync로 판단한 것이다.

클라이언트는 키 입력을 받으면 조작감을 위해 즉시 조각을 움직인다. 서버도 같은 입력을 처리하지만, 네트워크 왕복과 서버 처리 뒤에 결과 snapshot을 보낸다.

```txt
right 입력을 계속 누르는 상황

client local: col 3 -> col 4 -> col 5
server state: col 3 -> col 4
```

이 한 칸 차이는 오류가 아니라 정상적인 local prediction 상태다.

기존 정책은 activePiece 차이가 snapshot 두 번 연속 보이면 full `applySnapshot()`을 실행했다.

```txt
snapshot 1: server col 4 / local col 3
-> 잠시 대기

snapshot 2: server col 5 / local col 4
-> 계속 다르므로 drift라고 판단
-> myGame.applySnapshot(serverSnapshot)
-> 내 조각이 서버 위치로 되돌아감
```

문제는 snapshot이 500ms ticker 때만 오는 것이 아니라, 성공한 `game:input` 직후에도 온다는 점이다. 빠르게 키를 누르면 두 snapshot은 1초가 아니라 수십 ms 차이로 도착할 수 있다. 따라서 "두 번 연속 다름"은 지속적인 오류의 증거가 될 수 없다.

수정 후 판단 기준은 다음과 같다.

```txt
기존: snapshot이 몇 번 연속 다른가?
변경: 확정 상태가 실제로 얼마나 오래 또는 크게 다른가?
```

own player snapshot에서는 `activePiece`의 다음 차이를 correction 근거로 사용하지 않는다.

```txt
pieceType
row
col
rotation
snapshot tick
```

이 값들은 조작 중인 조각의 순간 상태이므로 local prediction을 우선한다.

대신 correction은 확정 결과가 어긋난 경우에만 한다.

```txt
즉시 correction
1. server snapshot이 gameOver
2. server가 garbage를 실제 board에 적용한 경우
   예: pendingGarbageLines 감소 + board 변경
3. 같은 pieceIndex인데 settled board가 다른 경우
4. server와 local의 pieceIndex 차이가 2 이상인 경우

지연 correction
5. pieceIndex 차이가 1인 상태가 같은 방향으로 750ms 이상 유지되는 경우
```

`pieceIndex`는 조각이 lock되고 다음 조각으로 진행되는 확정 단계에 가까운 값이다. 차이가 1이면 잠시 처리 순서가 밀린 것일 수 있으므로 기다린다. 차이가 2 이상이면 조각 고정, spawn, garbage 적용 같은 진행 단계가 실제로 어긋났을 가능성이 높아 즉시 맞춘다.

또한 local phase가 `lineClearing`이면 full correction을 미룬다. 서버 snapshot을 바로 적용하면 내 화면에서 진행 중인 line clear effect가 사라질 수 있기 때문이다. 단, `gameOver`는 최종 결과이므로 즉시 적용할 수 있다.

정리하면 역할은 다음과 같다.

```txt
움직이는 activePiece
-> client prediction 우선

고정된 board, score, garbage 적용, gameOver
-> server authoritative 우선
```

이 방식은 최종 입력 sequence 기반 reconciliation 전의 현실적인 중간 단계다. 장기적으로는 server snapshot에 "서버가 처리한 마지막 input sequence"를 넣고, client가 아직 확인되지 않은 입력만 다시 적용하는 방식이 가장 정확하다.

---

## Q. boardMetrics가 이미 있는데 AI 구현은 이제 어떤 순서로 가야 해? (2026-07-10)

`boardMetrics`는 이미 구현된 기반으로 보면 된다.

현재 파일 위치는 다음과 같다.

```txt
src/client/game/core/boardMetrics.js
test/testBoardMetrics.js
```

이 함수들은 board를 읽어서 `columnHeights`, `aggregateHeight`, `maxHeight`, `holes`, `bumpiness`, `completeLines`를 계산한다. DOM, runtime, socket에 의존하지 않는 순수 함수라서 Node 테스트로 바로 검증할 수 있고, 원본 board를 mutate하지 않는 테스트도 있다.

현재 `src/client/game/core`에 둔 이유는 board 표현과 core 판정 함수가 이 경계에 있기 때문이다. 나중에 서버 AI, 클라이언트 분석, 별도 학습 파이프라인이 같은 metric을 더 넓게 공유해야 하면 `shared` 계층으로 옮길 수 있다. 지금은 불필요한 이동보다 순수성과 테스트를 유지하는 것이 우선이다.

다음 구현 순서는 이렇다.

```txt
boardMetrics       // 완료
-> placementGenerator
-> simulatePlacement
-> heuristicEvaluator
-> PVE AI Player
```

PVE AI는 추천 코치가 아니라 실제 상대다. 즉 "사용자에게 어디에 두라고 알려주는 기능"이 아니라, 게임 안에서 자기 board를 보고 배치를 선택하는 player다.

현재 우선순위는 ML 학습이 아니다. 먼저 휴리스틱 PVE AI와 로그 축적을 만든 뒤, 사용자 배치와 PVE AI 선택을 비교할 수 있는 지표를 쌓는다.

후순위로 미룰 것:

- Python AI 서버
- 강화학습
- LLM 코칭 리포트

LLM은 나중에 판단 엔진이 아니라 설명 계층으로 붙인다. 판단은 `boardMetrics`, 배치 시뮬레이션, 휴리스틱 평가 같은 분석 계층이 만들고, LLM은 그 결과를 사람이 읽기 쉽게 풀어주는 역할이다.

---

## Q. `schemaVersion: 1`과 `schemaVersion: 2`는 무엇이 다르고, 왜 나눴어? (2026-07-16)

`schemaVersion`은 JSON 로그의 **형식 계약 버전**이다. 같은 `placement_decision` 이벤트라도, 분석과 학습에 필요한 정보가 늘어나면 예전 로그를 깨지 않고 새 형식을 추가해야 한다.

```txt
placement_decision schemaVersion: 1
-> 기본 또는 fallback 게임 로그

placement_decision schemaVersion: 2
-> 분석과 ML dataset에 사용할 수 있도록 필수 정보 의미를 고정한 로그
```

v2 placement log에는 `activePiece`, `boardBefore`, `boardAfter`, `nextQueue`, `holdPiece`, `placementResult`, metrics, source/model 정보처럼 후보 재생성과 분석에 필요한 정보가 엄격한 형식으로 들어간다.

runtime은 lock 직전에 v1 형태의 초안을 만든 뒤, lock 후 분석에 필요한 정보가 모두 확보되면 v2로 승격한다.

```txt
lock 직전
-> v1 초안 생성

lock/line clear/score/attack 확정
-> Human 분석 가능
-> v2로 승격

분석 정보 부족
-> v1 fallback으로 남음
```

서버 validator는 v1과 v2를 모두 저장할 수 있게 받는다. 하지만 dataset builder는 v2 `placement_decision`만 학습에 사용한다. v1까지 섞으면 feature 의미와 필수 정보가 보장되지 않기 때문이다.

주의할 점은 `game_start`, `game_over`도 현재 v1이라는 것이다. 이들은 학습 대상이 아니라 game lifecycle 확인용 이벤트다.

```txt
game_start v1
-> 게임 참가자와 시작 확인

placement_decision v2
-> 학습 sample 생성

game_over v1
-> 정상 종료와 승자 확인
```

`placement_decision schemaVersion`과 dataset의 `datasetSchemaVersion`은 다른 버전이다.

```txt
placement_decision schemaVersion
-> 원본 게임 로그 형식

datasetSchemaVersion
-> 원본 로그를 변환한 학습용 candidate row 형식
```

---

## Q. 테스트를 돌리면 옛날 v1 placement log가 실제 학습 로그에 섞이지 않아? (2026-07-16)

테스트는 의도적으로 v1과 v2 fixture를 모두 만든다.

```txt
v1 placement log fixture
-> 예전 형식 호환과 exporter rejection 확인

v2 placement log fixture
-> 정상 학습 변환 확인
```

테스트의 v1 placement log는 보통 임시 폴더나 mock repository로 저장한다. production `data/logs/game-events.jsonl`에 쌓여서는 안 된다.

또한 exporter는 v1 placement decision을 발견해도 train/validation에 넣지 않는다.

```txt
v1 placement_decision
-> rejected.jsonl에 UNSUPPORTED_SCHEMA_VERSION 사유 기록
-> 학습 sample 생성 안 함
```

따라서 실제 로그 파일에서 v1 이벤트가 보인다고 바로 데이터 오염이라고 판단하면 안 된다. `game_start`와 `game_over`의 v1은 정상이다. 확인할 대상은 학습에 쓰려는 `placement_decision`이 v2인지다.

---

## Q. 게임 로그는 매번 학습용 dataset으로 전처리해야 해? 기존 dataset에는 append돼? (2026-07-16)

매 게임마다 exporter를 실행할 필요는 없다.

```txt
게임 플레이
-> data/logs/game-events.jsonl에 원본 이벤트 누적

원하는 시점 또는 모델 학습 직전
-> dataset exporter 실행
-> 원본 로그 전체를 읽어 dataset 재생성
```

exporter는 기존 `train.jsonl` 뒤에 새 row만 append하지 않는다. 같은 output directory를 지정하면 원본 로그 전체를 기준으로 결과 파일을 안전하게 교체한다.

```txt
원본 로그: 8게임
-> dataset 생성

원본 로그: 13게임
-> exporter 실행
-> 13게임 전체 기준 train/validation/rejected/manifest 재생성
```

append 방식은 중복 row, stale rejection, train/validation gameId leakage를 만들기 쉽다. dataset은 원본 로그의 특정 시점 snapshot으로 다시 만드는 편이 안전하다.

이전 결과를 보존해야 하면 output directory를 버전별로 분리한다.

```txt
data/datasets/placement-v1
data/datasets/placement-v2
```

원본 `game-events.jsonl`은 exporter가 수정하지 않는다.

---

## Q. 사람 행동을 모방하는 placement model은 hold도 학습해? (2026-07-16)

현재 첫 placement model은 hold를 학습하지 않는다. 현재 모델이 답하는 질문은 하나다.

```txt
"현재 activePiece를 어디에 놓을까?"
```

hold는 다른 질문이다.

```txt
"현재 조각을 hold slot에 넣거나 교환할까?"
```

현재 `inputSequence`에는 `hold` action이 metadata로 남을 수 있다. 하지만 dataset builder는 `boardBefore`와 `activePiece`로 현재 조각의 reachable placement 후보만 생성한다. hold 후 조각을 바꾼 경우에도, 모델은 바뀐 조각의 최종 위치를 배치 문제로만 본다.

```txt
현재 placement model
-> 현재 조각의 위치/회전 선택

hold decision model
-> hold 할지 여부와 hold 후 상태 전환 선택
```

나중에 hold를 학습하려면 hold 직전 상태를 명시적으로 남겨야 한다.

```txt
board
activePieceBeforeHold
holdPieceBefore
nextQueueBefore
holdUsedThisDrop
holdApplied
```

그 뒤에는 다음 두 가지 전체 후보를 비교할 수 있다.

```txt
hold 안 함
-> 현재 조각의 placement 후보

hold 함
-> hold 교환을 가상 적용
-> 새 activePiece의 placement 후보
```

첫 모델에 hold까지 섞으면 label과 상태 전환이 복잡해진다. 따라서 현재는 placement ranker를 먼저 검증하고, hold는 별도 의사결정 문제로 추가하는 것이 맞다.

---

## Q. JavaScript에 특별한 ML 라이브러리 없이도 모델을 만들 수 있어? Python은 왜 다시 필요해? (2026-07-16)

가능하다. 언어와 ML 여부는 별개다. 작은 선형 모델은 배열과 `Math` 연산만으로 구현할 수 있다.

```txt
feature 준비
-> weight와 곱해 후보 score 계산
-> Human 선택과 비교해 loss 계산
-> gradient로 weight 수정
-> 반복
```

현재 첫 모델은 JavaScript로 직접 구현한 Pairwise Linear Ranker다.

```txt
feature 표준화
pairwise logistic loss
gradient 계산
L2 regularization
full-batch gradient descent
model.json 저장
```

이 모델은 Human 로그를 보고 실제 weight를 학습하므로 실제 ML 모델이다. 신경망이나 외부 라이브러리가 없다는 것은 모델이 아니라는 뜻이 아니다.

다만 JavaScript 구현은 작은 reference baseline에는 적합하고, 여러 모델을 비교하는 장기 실험에는 Python/scikit-learn이 더 편하다.

```txt
JavaScript
-> 현재 데이터/게임 코드와 바로 연결
-> 모델 validation과 Node 추론에 적합
-> 학습 원리 이해와 기준선 구현에 적합

Python/scikit-learn
-> 여러 optimizer와 모델 비교에 적합
-> hyperparameter 탐색, 시각화, feature 분석에 적합
-> XGBoost, LightGBM, PyTorch 등으로 확장하기 쉬움
```

권장 구조는 다음과 같다.

```txt
오프라인 개발 환경
Python trainer
-> model.json 생성

게임 실행 환경
Node.js
-> model.json 검증/로드
-> 후보 score 계산
-> 기존 authoritative executor로 action 실행
```

Python 서버를 추가하자는 뜻은 아니다. Python은 학습할 때만 사용하고, 실제 PVE 실행은 계속 Node.js가 담당한다.

---

## Q. 그러면 실제 ML 모델까지 이미 만든 거야? 왜 PVE에는 적용하지 않았어? (2026-07-16)

만들었다. 현재는 외부 dependency 없이 구현한 Pairwise Linear Ranker를 Human placement log로 실제 학습하고 `model.json` artifact까지 만든 상태다.

```txt
Human 로그
-> candidate feature 생성
-> 사람이 선택한 candidate를 정답으로 표시
-> 선택 candidate score가 나머지보다 높아지도록 학습
-> model.json 저장
```

하지만 PVE에 연결하지는 않았다. held-out game으로 평가한 LOGO 결과가 기존 heuristic보다 낮았기 때문이다.

```txt
Heuristic
Top-1 50.00%
Top-3 80.87%
MRR   0.6694

Pairwise Linear Ranker
Top-1 45.85%
Top-3 77.44%
MRR   0.6330
```

ML ranker는 random보다 훨씬 좋고 학습 파이프라인도 정상이다. 그러나 현재 데이터에서는 heuristic보다 사람의 실제 선택을 덜 맞힌다.

```txt
모델 파일 생성 O
오프라인 학습/평가 O
기존 heuristic 교체 X
PVE 연결 X
```

이 판단은 "ML이 실패했다"가 아니라, 아직 데이터가 13게임으로 적고 winner game도 1개뿐이므로 휴리스틱보다 좋다는 근거가 부족하다는 뜻이다. 다음 우선순위는 모델을 바로 연결하는 것이 아니라, 속도를 조정한 PVE에서 더 다양한 완료 게임 데이터를 수집하고 재평가하는 것이다.

---

## Q. 지금까지의 실험 흐름을 쉽게 설명해줘. (2026-07-17)

목표는 "강한 AI를 바로 만들기"가 아니라, 먼저 **사람이 테트리스에서 어떤 배치를 선택하는지 따라 하는 모델**을 만들고 그 평가가 믿을 만한지 확인하는 것이다.

전체 흐름은 다음과 같다.

```txt
게임 플레이
-> JSONL 게임 로그 저장
-> 완료된 v2 placement 로그만 추림
-> 각 조각의 가능한 배치 후보 생성
-> 사람이 고른 후보와 나머지 후보를 비교
-> Python 모델 학습
-> 게임 단위 평가(LOGO)
-> 후보 표현이 충분한지 분석
```

### 1. 게임 로그를 학습 데이터로 바꾼다

게임을 하면 `placement_decision` 로그가 남는다. 여기에는 당시 보드, 현재 조각, 사람이 실제로 고른 배치가 들어 있다.

```txt
현재 보드 + I 조각
-> 가능한 후보 A, B, C, D 생성
-> 사람이 C를 선택
```

데이터셋에는 C만 저장하는 것이 아니라, A~D 각각을 후보 행으로 저장한다. 그리고 C에만 `selectedBySource: true`를 붙인다.

학습에는 최신 형식인 schema v2 placement 로그를 사용한다. v1은 이전 로그 형식이라 현재 placement 학습의 기준 데이터로 사용하지 않는다.

### 2. Pairwise는 "선택한 후보가 더 높아야 한다"는 학습 방식이다

모델은 키 입력 자체를 예측하지 않는다. 후보 배치의 점수를 매긴다.

```txt
사람이 C를 선택했다면

C vs A: C 점수가 더 높아야 함
C vs B: C 점수가 더 높아야 함
C vs D: C 점수가 더 높아야 함
```

이처럼 선택한 후보와 선택하지 않은 후보를 한 쌍(pair)씩 비교하므로 `pairwise ranking`이라고 한다. 후보 수가 많은 조각이 학습에 과도한 영향을 주지 않도록, 한 decision에서 만들어진 pair들의 가중치 합은 1이 되게 한다.

### 3. 처음에는 JavaScript와 Python이 같은 계산을 하는지 확인했다

처음 JavaScript로 만든 선형 ranker의 계산을 Python/NumPy와 scikit-learn으로 다시 실행했다.

```txt
같은 데이터
-> feature 값
-> scaler 평균/표준화 값
-> pair와 가중치
-> score와 순위
```

이 값들이 허용 오차 안에서 일치하는지 확인했다. 이것은 "Python 모델이 더 강하다"는 실험이 아니라, **학습 계산을 Python으로 옮겨도 데이터 의미와 수학식이 바뀌지 않았는지** 검증하는 작업이다.

이후 역할은 다음처럼 정리했다.

```txt
JavaScript
-> 게임 규칙으로 candidate JSONL 생성
-> 나중에 Node.js에서 model artifact를 읽어 추론

Python + pandas + scikit-learn
-> feature 실험
-> 학습
-> 평가
-> 모델 비교
```

### 4. 모델이 보는 feature는 16개다

각 후보 배치 후 보드가 어떻게 달라지는지를 숫자로 표현한다.

```txt
linesCleared
gameOver
aggregateHeight 변화
maxHeight 변화
holes 변화
bumpiness 변화
각 열 높이 변화 10개
```

반대로 정답을 미리 알려 주거나 미래 결과를 암시하는 값은 feature에서 제외한다.

```txt
selectedBySource      -> 정답 label이므로 제외
isWinner              -> 게임 종료 뒤에만 아는 정보라 제외
heuristic score       -> 비교 기준일 뿐 기본 feature에서는 제외
inputSequence         -> 행동 모방 실험 전까지 제외
```

### 5. LOGO는 게임 하나를 통째로 숨기고 시험하는 평가다

`LOGO(Leave-One-Game-Out)`는 게임 단위 교차 검증이다.

```txt
26게임이 있다면

1번 평가: 25게임 학습 -> 남은 1게임 평가
2번 평가: 다른 25게임 학습 -> 다른 1게임 평가
...
26번 반복
```

같은 게임의 초반과 후반을 학습과 평가에 섞으면 모델이 그 게임의 패턴을 외울 수 있다. 그래서 게임 전체를 분리한다. scaler도 매 fold마다 학습 게임 데이터로만 계산해 데이터 누수를 막는다.

### 6. 현재 26게임 평가 결과

현재 Human 데이터는 26게임, 1,158개 decision, 39,375개 candidate로 평가했다.

```txt
Top-1           48.45%
Top-3           76.51%
MRR             0.645
평균 선택 순위  2.96
Tie-aware Top-1 56.91%
```

의미는 다음과 같다.

```txt
Top-1: 모델 1위 후보가 사람 선택과 같은 비율
Top-3: 사람 선택이 모델 상위 3개 안에 든 비율
MRR: 사람이 고른 후보의 순위를 점수화해 평균낸 값
```

예를 들어 사람이 고른 후보가 1위면 reciprocal rank는 `1`, 2위면 `1/2`, 4위면 `1/4`다. MRR은 이 값을 전체 decision에 대해 평균낸 지표다.

이 수치는 "사람의 배치를 어느 정도 따라 한다"는 뜻일 뿐, 더 오래 생존하거나 휴리스틱보다 강한 게임 AI라는 뜻은 아니다. 승리 게임도 아직 3개뿐이라 gameplay 성능을 주장하기에는 데이터가 부족하다.

### 7. 가장 중요한 발견: 모델보다 후보 표현에 중복이 있었다

처음에는 모델이 같은 feature를 가진 후보를 구분하지 못하는 이유가 회전이나 위치 정보가 없기 때문이라고 의심했다.

하지만 조사 결과, 충돌한 후보들은 회전 표기만 다를 뿐 **실제로 보드에서 차지하는 칸이 완전히 같은 배치**였다.

```txt
후보 A: 회전 표현 1
후보 B: 회전 표현 3

최종 occupied cells: 동일
최종 보드: 동일
```

따라서 rotation 같은 값을 feature로 추가하면 더 좋은 배치를 구분하는 것이 아니라, candidate generator가 붙인 표현 이름만 외우게 될 수 있다.

현재 발견된 중복은 다음과 같다.

```txt
선택 후보와 같은 16-feature를 가진 decision: 670 / 1,158
0 차이 pair: 1,010 / 38,217
최고 score 동점 decision: 672
```

### 8. 다음 실험은 feature 추가가 아니라 같은 실제 배치 묶기다

다음에는 같은 occupied cells를 만드는 후보들을 하나의 동등 클래스(equivalence class)로 묶는다.

```txt
기존: 회전 표현이 다르면 별도 candidate
다음: 최종 occupied cells가 같으면 하나의 physical placement
```

그 뒤 같은 26게임, 같은 모델, 같은 LOGO 평가로 기존 방식과 비교한다. 이 실험은 모델을 복잡하게 만들기 전에 데이터 표현 자체의 중복을 제거하는 작업이다.

### 현재 상태 요약

```txt
게임 로그 수집                O
dataset export                 O
JavaScript-Python 계산 일치 검증 O
Python/scikit-learn 학습/LOGO 평가 O
Human 배치 모방 baseline       O
PVE에 ML 모델 연결             X
휴리스틱보다 강한 AI 입증       X
동일 실제 배치 후보 묶기 실험   다음 단계
```

## Q. 최근 AI/ML 실험에서 나온 용어와 파일은 무엇을 뜻해? (2026-07-20)

### 1. 현재 모델은 무엇을 하는가?

현재 모델은 사람이 누를 키를 바로 예측하지 않는다. 먼저 게임 규칙으로 가능한 배치 후보를 만들고, 그중 사람이 선택할 법한 후보의 순위를 매긴다.

```txt
board + activePiece
  -> reachable placement 후보 생성
  -> 모델이 후보별 점수 계산
  -> 가장 높은 후보 선택
  -> 기존 planner가 move / rotate / hard_drop 행동열 생성
  -> 기존 authoritative executor가 실제 입력으로 실행
```

따라서 현재 모델은 "배치 선택 모델"이다. `hold`, 연속 입력 타이밍, 키를 누르고 있는 시간까지 모방하는 행동 모델은 아직 아니다.

### 2. 왜 pairwise 학습을 사용하는가?

로그에는 한 decision마다 사람이 선택한 후보 하나와, 선택하지 않은 후보 여러 개가 있다. 하지만 각 후보의 절대 점수나 정확한 선택 확률은 없다.

```txt
선택 후보 A
선택하지 않은 후보 B, C, D

학습 목표:
A의 점수 > B의 점수
A의 점수 > C의 점수
A의 점수 > D의 점수
```

이처럼 후보 두 개의 상대적 순서를 학습하는 방식을 `pairwise ranking`이라고 한다. 후보 수가 decision마다 달라도 처리하기 쉽고, "사람이 무엇을 골랐는가"라는 현재 로그 구조와 맞는다.

### 3. sigmoid는 왜 학습에는 쓰고, 배치 선택에는 안 쓰는가?

학습에서는 두 후보의 점수 차이를 확률 형태로 바꾸기 위해 sigmoid를 사용한다.

```txt
P(A가 B보다 선호됨)
= sigmoid(score(A) - score(B))
```

하지만 실제 배치 선택은 점수가 높은 후보를 고르면 된다.

```txt
score(A) > score(B)
이면
sigmoid(score(A)) > sigmoid(score(B))
```

sigmoid는 순서를 바꾸지 않는 단조 증가 함수다. 따라서 추론 단계에서 각 후보에 sigmoid를 다시 적용해도 1등 후보는 달라지지 않는다. `sigmoid(score(A))`는 여러 후보 중 A를 고를 확률도 아니다. 후보 전체의 확률을 만들려면 별도의 softmax 또는 확률 보정 계약이 필요하다.

### 4. `gameOver: true` 후보가 0개인데, 실제 게임에서는 왜 패배할 수 있는가?

두 의미를 구분해야 한다.

```txt
candidateResult.gameOver
= 지금 이 후보 배치를 즉시 고정했을 때 top-out이 나는가?

game_over event
= 실제 한 게임이 최종적으로 끝났다는 기록
```

현재 winner-only dataset은 승자의 placement만 사용한다. 패배한 player의 마지막 top-out 배치는 제외되므로, 학습 후보에 `candidateResult.gameOver: true`가 거의 또는 전혀 없을 수 있다. 이것은 "게임에서 패배한 적이 없다"는 뜻이 아니다.

그래서 실전 AI에서는 모델 점수보다 먼저 안전 규칙을 둬야 한다.

```js
const safeCandidates = candidates.filter(candidate => {
    return candidate.candidateResult.gameOver !== true;
});
```

safe 후보가 하나라도 있으면 위험한 후보는 모델 점수가 높아도 선택하지 않는다. 이를 hard-safety filter라고 한다. 단, 모든 후보가 위험하면 피할 방법이 없는 game over다.

### 5. 승자만 학습하면 내 행동을 학습하는 것이 아닌가?

맞다. 현재 `winner-only + source all` 설정이라면 사람 승자와 heuristic AI 승자의 행동이 섞인 데이터다. "나만의 플레이 모방 모델"은 아니다.

목적에 따라 dataset을 분리해야 한다.

```txt
사람 행동 모방:
source = human
selection policy = all-completed

휴리스틱 AI 재현:
source = heuristic_ai
selection policy = all-completed

승자 행동 기준선:
source = all
selection policy = winner-only
```

현재 데이터는 마지막 세 번째, 즉 "이긴 쪽이 고른 배치" 기준선에 가깝다.

### 6. T-Spin도 현재 배치 선택 방식으로 재현할 수 있는가?

일부는 가능하지만, 안정적으로 선택하도록 학습되지는 않았다.

현재 planner는 `move_left`, `move_right`, `rotate`, `soft_drop`, `hard_drop` 행동을 탐색한다. 따라서 회전과 wall kick이 필요한 경로 자체는 만들 수 있다.

```txt
후보 배치 선택
-> plannedActions 생성
-> rotate 포함 행동열 실행
-> 조건이 맞으면 T-Spin 판정 가능
```

문제는 같은 최종 위치라도 마지막 동작이 회전인지에 따라 일반 lock과 T-Spin이 달라진다는 점이다. 현재 후보 중복 제거와 feature는 이 lock 문맥을 충분히 구분하지 않는다. 나중에 T-Spin을 전략으로 다루려면 후보에 `lastActionWasRotation`, `isTSpin`, 공격량 같은 결과를 포함하고, 같은 칸을 차지해도 일반 배치와 T-Spin 배치를 합치지 않아야 한다.

### 7. JSON도 실제 모델 파일이 될 수 있는가?

가능하다. 현재 선형 모델은 큰 신경망 파일이 아니라 숫자 표다.

```json
{
  "featureNames": ["linesCleared", "holesDelta"],
  "mean": [0.1, 2.4],
  "scale": [0.3, 1.1],
  "weights": [0.8, -1.2],
  "intercept": 0.05
}
```

Node는 후보 feature를 같은 순서로 표준화한 뒤 `weights`와 곱해 더하면 점수를 계산할 수 있다. 즉 JSON은 현재처럼 작은 선형 모델에는 충분한 model artifact다.

### 8. ONNX 파일로 바꿀 수도 있는가?

가능하지만 지금 바로 바꿀 이유는 약하다.

```txt
Python sklearn 모델
-> ONNX 변환
-> Node의 ONNX Runtime으로 추론
```

ONNX는 여러 언어와 환경에서 모델을 실행하기 위한 바이너리 배포 형식이다. 복잡한 트리 모델이나 신경망으로 커졌을 때 유리하다. 현재 모델은 16개 feature를 표준화하고 가중치와 곱하는 정도라 JSON이 더 작고, 사람이 확인하기 쉽고, Node 의존성도 필요 없다.

ONNX로 옮긴다면 `mean`과 `scale`도 ONNX 그래프에 포함하거나, 별도 전처리 계약을 반드시 고정해야 한다. 가중치만 옮기고 표준화를 빠뜨리면 점수와 순위가 달라진다.

```txt
현재 권장:
JSON = 기준 artifact

나중:
ONNX = JSON과 같은 점수/순위를 내는 배포용 파생 artifact
```

### 9. SHA-256은 왜 계산하는가?

SHA-256은 파일 내용을 고정 길이의 지문으로 바꾸는 함수다.

```txt
같은 파일 내용
-> 같은 SHA-256

공백 하나라도 다른 파일 내용
-> 거의 항상 다른 SHA-256
```

그래서 다음을 확인할 수 있다.

```txt
export 전 로그 SHA = export 후 로그 SHA
-> exporter가 원본 로그를 수정하지 않음

같은 설정으로 두 번 만든 model/report SHA가 같음
-> 결과가 byte 단위로 동일함
```

같은 명령을 실행했다고 항상 같은 파일이 만들어지는 것은 아니다. 실행 시각, 랜덤 seed, 데이터 순서, 라이브러리 버전, 병렬 계산 순서가 결과를 바꿀 수 있다. SHA 기록은 실제 결과가 같은지 확인하는 가장 짧은 증거다.

### 10. Python test가 JavaScript test와 별도로 있는 이유는 무엇인가?

Node 테스트는 JavaScript exporter, 게임 규칙, JSON 계약을 검증한다. Python 테스트는 pandas, NumPy, scikit-learn으로 읽고 학습하고 평가하는 경로를 검증한다.

```txt
Node test
-> 로그 export / 게임 규칙 / JS 계약

Python test
-> feature 로딩 / scaler / pair 생성 / sklearn 학습 / LOGO 평가
```

두 언어가 같은 데이터 계약을 사용하더라도 실행 환경과 라이브러리가 다르므로 둘 다 테스트해야 한다.

### 11. Notebook, smoke, full run은 각각 무엇인가?

Notebook은 실험 설명, 코드, 결과를 한 파일에 묶는 Jupyter 문서다. 내부적으로는 JSON이고 cell마다 고정 `id`를 넣을 수 있다. 이 id는 화면 제목이 아니라 테스트가 특정 계산 cell을 찾는 식별자다.

```txt
smoke run
-> 작은 일부 게임만 실행
-> 경로, 환경, leakage 검사, report 생성이 되는지 확인

full run
-> 전체 대상 게임을 실행
-> 실제 성능 수치와 gate 판단에 사용
```

smoke 결과는 실행 확인용이므로 모델 성능 결론에 사용하지 않는다.

### 12. 지금 ML 프로세스는 어디까지 완료된 것인가?

현재 완료는 "오프라인 학습과 평가 파이프라인" 단계다.

```txt
로그 수집 / dataset export                    O
feature / pairwise model / LOGO 평가           O
시간 분리 holdout 평가                         O
versioned model artifact 후보 생성             O
PVE에 모델 연결                                X
gameOver hard-safety filter                    X
휴리스틱보다 gameplay가 강하다는 benchmark    X
```

따라서 `candidate_artifact_validated`는 artifact 형식, 학습, 결정성, 저장 연결이 정상이라는 뜻이다. `productionIntegration=false`는 아직 실제 게임 AI 판단에 연결하지 않았다는 뜻이고, `heldOutEvidence=false`는 이번 125게임 전체 학습의 training loss만으로는 새 게임 성능을 증명하지 못한다는 뜻이다.

## Q. Docker 또는 무료 PaaS에 배포한 뒤에도 사용자 행동 로그를 학습용으로 보존하려면 유료 Persistent Disk가 꼭 필요해? (2026-07-23)

꼭 Persistent Disk가 필요한 것은 아니다. 다만 컨테이너 내부 JSONL 파일만 원본 저장소로 쓰면 재배포, 장애 재시작, 컨테이너 교체 때 로그가 사라질 수 있다.

```txt
컨테이너 내부 /app/data/logs/game-events.jsonl
-> 컨테이너가 교체되면 유실 가능
```

종료 직전에 사람이 파일을 복사하는 방식은 근본 해결이 아니다.

```txt
수동 백업이 가능한 경우
-> 계획된 종료 전에 사람이 접속해 파일을 복사할 수 있음

수동 백업이 불가능한 경우
-> 자동 재배포
-> 서버 장애 또는 강제 재시작
-> 배포 플랫폼의 인스턴스 교체
```

학습용 행동 로그를 실제로 보존하려면, 배포 서버 파일이 아니라 외부 저장소에 이벤트를 기록해야 한다. 현재 프로젝트에서는 PostgreSQL이 가장 자연스러운 선택이다.

```txt
authoritative placement_decision 발생
-> PostgreSQL game_events에 저장
-> 나중에 DB에서 dataset용 JSONL export
-> Python 학습
```

DB에는 최소한 아래 이벤트만 저장하면 된다.

```txt
game_start
placement_decision
game_over
```

동일 이벤트가 재시도되어도 중복 저장되지 않도록 `(gameId, playerId, pieceIndex)` 기반의 고유 키를 둔다. 이 구조에서는 Docker 컨테이너가 교체되어도 이미 DB에 저장된 행동 기록은 남는다.

```txt
PostgreSQL
= 사용자, 전적, 게임 결과, 학습용 placement event의 영구 저장소

JSONL
= DB에서 export해 만든 학습용 파일 또는 로컬 실험 로그
```

현재 PostgreSQL shadow storage는 게임을 멈추지 않기 위해 DB 실패 시 로그 일부를 잃을 수 있는 보조 저장 방식이다. 학습 로그를 완전하게 수집하는 원본 저장소로 승격하려면 DB 장애 시 재시도, 누락 구간 표시, dataset export 기준을 별도로 정해야 한다.

따라서 단계별 권장은 다음과 같다.

```txt
현재 로컬 학습
-> Mac의 JSONL 로그 사용, 비용 없음

무료 공개 데모
-> 로그 유실 가능성을 허용하거나 DB 무료 플랜으로 제한적 수집

장기 사용자 행동 수집
-> PostgreSQL 또는 외부 저장소를 원본으로 사용
```

## Q. Docker, 배포, 로그 보존 관련 질문 (2026-07-22 ~ 2026-07-23)

### 1. Docker 적용 설계는 무엇을 하려는 작업인가?

Docker는 게임 로직을 바꾸는 도구가 아니라, 서버 실행 환경을 하나의 이미지로 고정하는 도구다.

```txt
소스 코드
-> Docker build 단계에서 npm run build
-> dist/client + dist/server 생성
-> 실행에 필요한 파일만 담은 Docker image 생성
-> 어느 Linux 서버에서도 같은 방식으로 실행
```

최종 image에는 개발용 source, 테스트, 문서, 개발 의존성을 빼고 아래만 남기는 것이 목표다.

```txt
dist/client       브라우저에 제공할 Vite build 결과
dist/server       Node가 실행할 compiled server
production node_modules
/app/data/logs    로그를 쓸 수 있는 경로
```

Docker가 해결하는 것은 실행 환경 차이다.

```txt
내 Mac에서만 실행됨
-> Docker image에서 실행 확인
-> 배포 Linux에서도 같은 Node와 같은 파일로 실행
```

Docker만으로 room, match, Socket.IO 연결 상태가 보존되지는 않는다. 현재 게임 상태는 Node 메모리에 있으므로 컨테이너가 종료되면 진행 중 게임도 끝난다.

### 2. Docker 적용 전에 승인해야 할 다섯 가지는 무엇인가?

이는 Dockerfile 문법 문제가 아니라, 배포된 서버를 어떤 규칙으로 만들고 운영할지 정하는 기준이다.

```txt
1. 정확한 Node image
2. build와 production 실행을 분리하는 multi-stage 구조
3. non-root 실행, 로그 경로, secret 주입 방식
4. health check와 SIGTERM 종료 방식
5. commit SHA image tag와 rollback 방식
```

각 항목의 의미는 다음과 같다.

```txt
정확한 Node image
-> node:24.18.0 같은 버전과 Linux base를 고정
-> 개발/배포 환경 차이를 줄임

multi-stage build
-> 첫 단계에서 source로 dist를 build
-> 마지막 단계에는 dist와 production dependency만 복사

non-root, logs, secrets
-> root 대신 node 사용자로 실행
-> 로그 폴더만 쓰기 허용
-> token, origin, CSP 설정은 image가 아니라 deploy 환경 변수로 전달

health check와 SIGTERM
-> Docker가 서버의 HTTP 응답을 확인
-> 종료 시 Socket.IO와 ticker를 정리할 시간을 줌

commit SHA tag와 rollback
-> 예: tetris:<git-commit-sha>
-> 새 버전에 문제가 있으면 이전 SHA image로 되돌림
```

### 3. Docker로 무중단 배포도 가능한가?

일부는 가능하지만 Docker만으로 자동 해결되지는 않는다.

```txt
Load Balancer
-> 기존 컨테이너 A는 서비스 유지
-> 새 컨테이너 B를 먼저 시작하고 health check
-> 정상일 때 새 연결을 B로 전환
-> A에 SIGTERM을 보내 정리 후 종료
```

현재 프로젝트에서는 신규 HTTP 접속과 로비는 거의 끊기지 않게 만들 수 있다. 하지만 room, match, board, Socket.IO 연결이 A의 메모리에 있으므로 A에서 진행 중인 멀티 게임은 B로 자동 이동할 수 없다.

```txt
현재 가능한 수준
-> 신규 접속/로비의 배포 중단 최소화
-> 진행 중 게임은 disconnect 또는 종료 가능

진짜 게임 중 무중단 복구에 필요한 것
-> 공유 room/match 상태 저장소
-> Socket.IO 다중 인스턴스 adapter
-> 재연결 및 match 복원 정책
```

현재 단계에서는 재배포 전에 신규 매치를 막고, 진행 중 게임을 짧게 기다린 뒤 종료하는 graceful shutdown이 현실적인 범위다.

### 4. `dist` 폴더는 무엇인가?

`dist`는 distribution의 줄임말이며, 원본 `src`를 실제 실행과 배포에 맞게 변환한 결과물이다.

```txt
src/client
-> Vite build
-> dist/client

src/server
-> TypeScript compile
-> dist/server
```

예를 들면:

```txt
src/client/pages/multiLobby.tsx
-> dist/client/assets/multiLobby-<hash>.js

src/app.ts
-> dist/server/app.js
```

배포 시에는 원칙적으로 `src`가 아니라 build된 결과를 실행한다.

```bash
npm run build
npm start
```

`dist`는 직접 수정하는 폴더가 아니다. `src`를 수정한 뒤 다시 build하면 새로 만들어진다.

### 5. 파일을 수정할 때마다 build해야 하는가? Vite는 백엔드인가?

프론트엔드 개발 중에는 매번 수동 build할 필요가 없다.

```txt
npm run dev
-> Vite 개발 서버 실행
-> src/client 변경 감지
-> 브라우저 화면 자동 갱신
```

Vite는 백엔드가 아니라 프론트엔드 개발 및 build 도구다.

```txt
Vite
= React, TypeScript, CSS를 브라우저용 파일로 변환

Express + Socket.IO
= room, match, 게임 판정, 실시간 통신을 처리하는 백엔드
```

배포 시에는 Vite 개발 서버를 계속 실행하지 않는다. Vite가 미리 만든 `dist/client`를 Express가 정적 파일로 제공한다.

### 6. JSONL 로그는 Linux 서버 폴더에 쓰는 것 아닌가? 왜 Persistent Disk가 필요한가?

코드에서는 단순히 지정된 파일 경로에 append한다.

```txt
/app/data/logs/game-events.jsonl
```

문제는 그 경로가 실제 Linux VM의 영구 디스크인지, 컨테이너 내부의 임시 파일 시스템인지다.

```txt
직접 관리하는 Linux VM
-> /srv/tetris/logs/game-events.jsonl
-> 서버 재시작 뒤에도 파일 유지

PaaS 컨테이너 내부
-> /app/data/logs/game-events.jsonl
-> 재배포/교체 시 컨테이너와 함께 사라질 수 있음
```

Persistent Disk는 컨테이너의 특정 경로를 컨테이너 밖의 영구 디스크와 연결하는 기능이다. 코드는 같은 `/app/data/logs`에 쓰지만, 실제 데이터는 컨테이너 교체 뒤에도 남는다.

### 7. Persistent Disk는 유료인가? 다른 해결책은 없는가?

Render 기준으로 Persistent Disk는 유료 Web Service에서만 사용할 수 있다. 무료 배포 환경에서 "무료 + 장기 보존 + 서버 내부 파일"을 동시에 보장하기는 어렵다.

대안은 저장 책임을 서버 파일에서 분리하는 것이다.

```txt
로컬 실험
-> Mac의 JSONL에 저장, 비용 없음

공개 데모
-> 로그 유실을 허용하고 무료 배포

서비스 기능 데이터
-> PostgreSQL 저장

대량 파일/backup
-> object storage 사용

직접 운영
-> Linux VM의 실제 디스크에 저장
```

컨테이너 종료 직전에 수동으로 JSONL을 복사하는 것은 계획된 종료에는 가능하지만, 자동 재배포나 장애 재시작에서는 시점을 보장할 수 없다. 자동 backup도 결국 DB, object storage, 영구 디스크 중 하나에 저장해야 한다.

### 8. 사용자 행동을 모방하려면 유료 저장소가 무조건 필요한가?

아니다. 자신의 플레이를 수집하고 학습하는 단계에서는 로컬 JSONL만으로 충분하다.

```txt
내 Mac에서 게임 실행
-> game-events.jsonl 기록
-> dataset export
-> Python 학습
```

비용이 필요한 시점은 공개 서비스에서 여러 사용자의 행동을 장기간 안정적으로 수집하고자 할 때다. 이때는 행동 로그를 DB 또는 외부 저장소에 기록해야 한다.

### 9. 사용자 행동 로그 보존에는 DB가 가장 쉬운가?

현재 요구에는 그렇다. 특히 JSONL 파일을 배포 컨테이너에 보존하려는 문제보다 PostgreSQL에 authoritative 이벤트를 저장하는 편이 구조가 단순하다.

```txt
authoritative placement_decision 발생
-> PostgreSQL game_events 저장
-> 나중에 DB에서 JSONL dataset export
-> 학습
```

DB에는 현재 학습에 필요한 이벤트만 저장하면 된다.

```txt
game_start
placement_decision
game_over
```

`gameId + playerId + pieceIndex` 같은 고유 키를 두면 재시도되어도 같은 placement가 중복 저장되지 않는다. 반면 사용자, 전적, ranking, rating 같은 서비스 기능도 PostgreSQL에 적합하다.

현재 PostgreSQL shadow storage는 DB 장애가 gameplay를 멈추지 않도록 일부 로그 유실을 허용하는 보조 경로다. 학습 로그의 원본 저장소로 쓸 때는 재시도와 누락 구간 정책을 별도로 정해야 한다.

## Q. Redis와 재접속은 현재 어떻게 동작하는가? (2026-07-23)

### 1. 현재도 재접속 로직이 있는가?

있다. Redis 없이 브라우저 `sessionStorage`와 Node 메모리의 session service를 이용한다.

```txt
처음 연결
-> 서버가 playerId + token 발급
-> 브라우저 sessionStorage에 저장

연결 끊김
-> Socket.IO가 재연결 시도
-> playerId + token + nickname을 handshake auth로 재전송
-> 서버가 같은 사용자로 인증
-> session:ready 전송
-> 로비는 room:sync, 게임은 game:join 재실행
```

서버는 연결이 끊긴 사용자를 바로 내보내지 않고 30초 grace timer를 둔다.

```txt
30초 안에 재접속
-> disconnect timer 취소
-> room/match 유지

30초 초과
-> playing이면 disconnect 패배 처리
-> lobby면 room에서 퇴장
```

단, session, room, match 모두 현재 Node 메모리이므로 서버 자체가 재시작되면 복구할 수 없다.

### 2. Redis를 추가하면 무엇이 달라지고, 왜 범위가 커질 수 있는가?

Redis에 session 정보만 옮기는 작은 범위는 가능하다.

```txt
Redis
playerId -> token, nickname, expiresAt
```

그러면 서버 재시작 뒤에도 같은 사용자가 다시 인증받을 수 있다. 하지만 진행 중 game까지 이어 하려면 room, match, board, activePiece, bag, garbage, tick까지 Redis에 저장하고 복원해야 한다.

```txt
session 복구
!= 진행 중 게임 복구
```

현재 단계에서는 Redis 없이 session 재연결과 로비 복귀까지만 지원하는 것이 적절하다.

### 3. 게임 시작 및 재접속 countdown은 Redis 없이 가능한가?

가능하다. 단일 Node 서버가 기준 시간을 결정하면 된다.

```txt
게임 시작
host start 요청
-> 서버가 startAt = now + 3초 결정
-> 양쪽에 startAt 전송
-> 클라이언트는 숫자만 표시
-> 서버 timer가 끝났을 때 실제 game 시작
```

재접속 countdown도 이미 있는 30초 grace timer를 서버 규칙으로 유지하고, 클라이언트에는 남은 시간을 표시하면 된다.

```txt
서버 timer
= 실제 패배/퇴장 판정

클라이언트 countdown
= 사용자에게 보여 주는 UI
```

## Q. 테트리스 조작감 향상 용어인 DAS, ARR, SDF, IRS는 무엇인가? (2026-07-23)

```txt
DAS
= 좌우 키를 누른 뒤 자동 연속 이동이 시작되기까지의 지연 시간

ARR
= 자동 연속 이동이 시작된 뒤 좌우 반복 이동 속도

SDF
= soft drop 낙하 속도 배율

IRS
= 새 조각 spawn 순간 회전 키를 미리 누르면 회전된 상태로 spawn하는 기능

IHS
= 새 조각 spawn 순간 hold 키를 미리 누르면 즉시 hold하는 기능

Lock Delay
= 바닥에 닿아도 즉시 고정하지 않고 잠깐 이동/회전을 허용하는 시간
```

대회 테트리스에서 바닥에 닿은 조각을 잠깐 움직이거나 회전하는 모습은 주로 Lock Delay와 빠른 DAS/ARR, 강한 SDF가 결합된 결과다.

```txt
조각이 바닥에 닿음
-> lock delay 동안 좌우 이동 또는 회전
-> hard drop 또는 delay 종료
-> board에 고정
```

현재 게임에 도입하려면 DAS/ARR/SDF는 입력 처리와, Lock Delay/IRS/IHS는 spawn 및 lock 상태 전이와 연결해야 한다.

## Q. Git branch와 worktree는 왜 둘 다 필요한가? (2026-07-23)

branch는 커밋 이력의 갈림길을 가리키는 이름이고, worktree는 특정 branch를 실제 파일로 펼쳐 둔 폴더다.

```txt
branch만 사용
Tetris_multi 폴더 하나
-> git switch main
-> git switch feature
-> 같은 폴더의 파일이 branch마다 바뀜

worktree 사용
Tetris_multi/      main 파일
Tetris_multi-ai/   ai branch 파일
-> 두 branch를 동시에 열고 편집 가능
```

처음에는 같은 commit에서 갈라졌으므로 파일 내용이 같아 보인다. 하지만 실제 디스크 파일은 각 worktree 폴더에 따로 존재한다.

```txt
Tetris_multi-ai/src/app.ts 수정
-> Tetris_multi/src/app.ts는 변경되지 않음
```

두 worktree는 Git object와 commit 이력은 공유한다. AI worktree에서 만든 commit은 main worktree에서도 Git이 알고 있지만, main 파일에 자동 반영되지는 않는다. merge 또는 switch해야 반영된다.

확인 명령은 다음과 같다.

```bash
git worktree list
pwd
git branch --show-current
git status --short --branch
```

VS Code에서는 각 worktree의 실제 폴더를 `Open Folder...`로 각각 열면 된다.

## Q. 현재 snapshot rollback 안정화는 어떻게 해결했는가? (2026-07-23)

문제는 client가 입력을 먼저 적용한 뒤, 서버가 그 입력을 아직 처리하지 않은 이전 snapshot을 보내면서 내 조각이 되돌아가는 현상이었다.

```txt
client: 오른쪽 이동 적용
server: 아직 처리 전 snapshot 전송
client: snapshot 전체 적용
-> 오른쪽 이동이 취소된 것처럼 보임
```

해결은 local input과 server acknowledgment를 구분하는 것이다.

```txt
local input 성공
-> clientSequence 부여
-> pendingServerInputs에 보관
-> 서버에 전송

server 처리 완료
-> game:input:result(clientSequence)
-> snapshot.lastProcessedClientSequence

client
-> 확인된 sequence까지 pendingServerInputs 제거
-> 그 뒤에만 보류 snapshot 검토
```

각 값의 역할은 다음과 같다.

```txt
clientSequence
= client가 성공한 입력마다 붙이는 단조 증가 번호

lastProcessedClientSequence
= server가 실제 처리 완료한 마지막 입력 번호

pendingServerInputs
= client에는 적용됐지만 server 확인 전인 입력들

deferredOwnSnapshot
= 미확인 입력 때문에 당장 적용하지 않고 보류한 snapshot
```

미확인 입력이 있으면 snapshot은 저장만 하고 바로 적용하지 않는다. server가 이미 최신 sequence를 확인한 뒤 도착한 오래된 snapshot도 버린다.

또한 떨어지는 조각의 `row`, `col`, `rotation` 차이만으로 own board를 보정하지 않는다. 빠른 입력에서는 정상적인 처리 시간 차이일 수 있기 때문이다.

```txt
local prediction 우선
-> 떨어지는 activePiece의 순간 위치

server snapshot 우선
-> gameOver
-> 실제 garbage 적용
-> settled board 불일치
-> 큰 pieceIndex 차이
```

server에서는 input 처리와 gravity 처리를 mutation queue로 직렬화해 같은 player state를 동시에 바꾸는 경쟁도 줄였다. 최종 정답은 server board이며, client prediction은 빠른 조작감을 위한 임시 화면이다.

## Q. TypeScript/React를 직접 작성하지 않았는데 읽고 이해할 가치가 있는가? 포트폴리오에는 어떻게 써야 하는가? (2026-07-23)

가치는 있다. 다만 "React를 사용해 게임 엔진을 만들었다"가 아니라, 기존 Canvas runtime과 server authoritative 구조를 보존하면서 React/TypeScript가 담당하는 경계를 이해하는 것이 목표다.

```txt
React/TSX
= 로비, 버튼, HUD, 페이지 lifecycle

Canvas runtime/core
= 입력, 낙하, 충돌, 줄 삭제, board render

Express + Socket.IO
= room, match, authoritative multiplayer
```

우선 `useState`, `useEffect`, mount/unmount 시 listener 정리, props와 TypeScript type, page가 `roomClient`와 runtime을 연결하는 흐름을 읽는 것이 적절하다. React Router, Context, 상태 관리 library까지 바로 확장할 필요는 없다.

포트폴리오에는 다음처럼 사실대로 쓴다.

> 기존 Vanilla Canvas 게임 런타임과 server-authoritative Socket.IO 구조를 유지한 채, Vite multi-page 환경과 page-local React/TypeScript UI shell을 점진적으로 도입했다. React는 로비·HUD·페이지 lifecycle을 담당하고, 테트리스 규칙과 Canvas rendering은 독립 runtime으로 분리했다.

직접 작성하거나 설명할 수 없는 범위를 "React 기반 게임 엔진 구현" 또는 "TypeScript 전면 전환"이라고 쓰면 안 된다.

### TypeScript 함수 선언에서 `): ReturnType`은 무엇인가?

```ts
function validateBaseLog(
    log: unknown,
    options: ValidationOptions = {},
): LogValidationResult {
    // function body
}
```

구조는 다음과 같다.

```txt
function validateBaseLog(
    ...
)                         인자 목록 끝
: LogValidationResult     반환값 type
{ ... }                   함수 body
```

`):`는 하나의 특수 연산자가 아니다.

```txt
)  = parameter 목록을 닫음
:  = TypeScript에서 반환 type을 표시
```

`options: ValidationOptions = {}`는 두 번째 인자를 생략하면 빈 객체를 기본값으로 사용한다는 뜻이다. `unknown`은 외부에서 들어온 `log`를 아직 신뢰하지 않으므로 검증 전에는 안전하게 사용할 수 없다는 type이다.

## Q. GitHub Actions CI 관련 용어와 gate는 무엇인가? (2026-07-23)

### 1. 정상 실행 gate가 통과했다는 것은 무엇인가?

GitHub의 Ubuntu runner에서 다음 흐름이 실제로 실행되고 통과했다는 뜻이다.

```txt
Fast gate
-> typecheck
-> build
-> unit test

Browser/Docker gate
-> Chromium PVP/PVE E2E
-> Docker 관련 검증
```

즉 내 Mac에서만 통과한 것이 아니라, 깨끗한 GitHub Linux 환경에서도 프로젝트의 build와 검증 흐름이 동작한다는 증거다. 실제 서비스 배포가 완료됐다는 뜻은 아니다.

### 2. "의도적인 실패 라우팅 검증"은 무엇인가?

새 테스트를 만드는 것이 아니다. disposable branch에서 일부러 오류를 만든 뒤, 해당 오류가 담당 gate에서 실패하는지 보는 작업이다.

```txt
TypeScript 오류를 일부러 만듦
-> Fast gate 실패를 기대

E2E 오류를 일부러 만듦
-> Fast gate는 통과
-> Chromium PVP/PVE gate 실패를 기대
```

현재는 정상 코드가 통과하는지만 검증됐고, 고의 실패가 정확히 어느 job에 표시되는지는 확인하지 않았다는 의미다. 포트폴리오 기준에서는 미검증 위험으로 문서화하고 생략할 수 있다.

### 3. flake는 무엇인가?

flake는 코드가 바뀌지 않았는데 테스트가 어떤 실행에서는 통과하고, 다른 실행에서는 실패하는 불안정한 테스트다.

```txt
첫 실행: 통과
두 번째 실행: 실패
세 번째 실행: 통과
```

PVE timing flake는 AI ticker, timer, game loop의 실행 순서가 CI 부하나 기계 속도에 따라 달라져 기대 시간 안에 결과가 오지 않는 경우가 대표적이다.

```txt
항상 실패
-> 재현 가능한 버그일 가능성

가끔 실패
-> timing, async 순서, 외부 환경에 의존한 flake일 가능성
```

## Q. 프로젝트를 포트폴리오에서 설명 가능한 단계까지 얼마나 걸리는가? (2026-07-23)

모든 코드 줄을 설명하는 것이 목표가 아니라면, 현재 기준으로 약 20~30시간의 집중 학습이 현실적이다.

```txt
1. 전체 흐름을 3분 안에 설명
2. multiplayer input -> server -> snapshot 흐름 설명
3. clientSequence -> pendingServerInputs -> snapshot 보류 설명
4. Vite, dist, Docker, CI의 역할 설명
5. React/TSX의 작은 UI 변경 하나를 직접 수행
```

면접에서 중요한 것은 다음 질문에 답하는 것이다.

```txt
무슨 문제를 해결했는가?
왜 이 구조를 골랐는가?
상태의 최종 소유자는 누구인가?
어떤 버그가 있었고 어떻게 검증했는가?
무엇을 아직 해결하지 않았는가?
```

## Q. 최근 CI, PostgreSQL, OCI, Docker Compose 질문 정리 (2026-07-23 ~ 2026-07-24)

### 1. Goal 11E에서 게임이 아니라 테스트가 실패했다는 것은 무슨 뜻인가?

Goal 11E의 실패 원인은 T-Spin 또는 garbage 게임 규칙이 고장난 것이 아니라, E2E 테스트가 너무 이른 순간의 화면 값을 정답으로 가정한 timing 문제였다.

```txt
기존 테스트
키 입력
-> 특정 순간의 row/score/pending 값 확인
-> server gravity 또는 AI event가 먼저 실행되면 실패

수정 방향
키 입력
-> server authoritative snapshot과 최종 board/score/pieceIndex 대기
-> 확정된 결과 확인
```

T-Spin에서는 과거 snapshot 중 `row === 16`이었던 적이 있다는 사실만 확인한 뒤 회전과 hard drop을 보냈다. 그 사이 gravity가 조각을 lock하면 다음 조각에 입력이 들어갈 수 있으므로 `scoreDelta = 0`이 나올 수 있다.

```txt
올바른 검증 순서
1. 최신 snapshot에서 같은 T 조각과 pieceIndex 확인
2. rotate 후 최신 snapshot에서 wall kick 회전 성공 확인
3. 그 뒤 hard drop
4. 최종 scoreDelta, board, pieceIndex 확인
```

강화된 precondition에서도 회전 전에 조각이 lock된다면 그때는 테스트 문제가 아니라 server lock delay 또는 gravity 규칙 문제로 분리 조사해야 한다.

### 2. 문서의 줄 끝 공백 때문에 왜 CI가 멈추는가?

CI Fast gate는 테스트 전에 `git diff --check`를 실행한다.

```txt
문서 줄 끝의 공백 두 칸
-> git diff --check가 whitespace error로 판단
-> Fast gate 실패
-> Fast gate에 의존하는 Browser/Docker job은 skip
```

Markdown에서는 줄 끝 공백 두 칸이 줄바꿈 문법이 될 수 있다. 하지만 이 저장소는 모든 변경 diff에 trailing whitespace가 없어야 한다는 Git 규칙을 적용한다.

```txt
게임 코드 문제 X
문서 내용 문제 X
변경 파일 형식 규칙 위반 O
```

### 3. force-push 뒤 CI가 이전 SHA를 못 찾아 실패한 것은 무슨 뜻인가?

일반 push CI는 변경분을 검사하려고 이전 SHA와 현재 SHA를 비교한다.

```txt
git diff --check <이전 SHA>..<현재 SHA>
```

force-push로 원격 branch 이력이 다시 작성되면 이전 SHA가 현재 branch 계보에서 사라질 수 있다. 이때 Fast gate가 테스트 시작 전 실패하고, `needs: fast`인 Browser/Docker job은 실행되지 않는다.

```txt
shallow checkout 문제 X
사라진 이전 SHA를 비교 대상으로 사용한 문제 O
```

이 경우 기존 실패 run을 재실행하지 않고 GitHub Actions에서 `Run workflow`를 사용해 현재 `main` SHA로 새 수동 실행을 한다. 수동 실행은 이전 push SHA가 아니라 현재 커밋 자체를 검사할 수 있다.

### 4. DB 작업에서 migration이라는 표현은 왜 쓰는가?

DB migration은 데이터를 다른 서버로 옮기는 것만 뜻하지 않는다. DB table, column, index, constraint 같은 schema를 버전별로 생성·변경하는 작업이다.

```txt
migration 001
-> CREATE TABLE game_events

migration 002
-> ALTER TABLE ... ADD COLUMN ...
```

개발 DB, 테스트 DB, 배포 DB가 모두 코드가 기대하는 같은 구조를 갖도록 만드는 장치다.

```txt
코드는 새 column을 사용
-> 배포 DB에 column 없음
-> runtime error
```

그래서 배포 전에 migration을 명시적으로 실행해 DB 구조를 맞춘다.

### 5. Goal 9A~9D는 각각 무엇을 하는가?

Goal 9는 단순 전적 table 하나가 아니라, 사용자 gameplay event를 장기적으로 저장하고 학습 데이터로도 활용할 수 있는 저장 파이프라인이다.

```txt
9A: DB 자체의 기초 공사
9B: 실제 game server와 DB 연결
9C: 기존 JSONL history import
9D: CI/Docker/release 환경 검증
```

각 단계는 다음 책임을 가진다.

```txt
9A Schema, Migration, Repository
-> game_events table 생성
-> raw SQL migration runner
-> duplicate/conflict 구분
-> PostgreSQL에 한 event를 안전하게 insert
-> 아직 gameplay는 DB에 저장하지 않음

9B Runtime Storage
-> game_start, placement_decision, game_over를 server에서 DB에 저장
-> JSONL 또는 PostgreSQL 중 하나의 sink만 선택
-> 개인정보 제거, trust level 구분
-> DB 실패가 gameplay를 rollback하지 않도록 처리

9C JSONL Backfill
-> 기존 game-events.jsonl을 한 줄씩 읽음
-> legacy schema 검증과 개인정보 제거
-> 중복 없이 DB로 import
-> lifecycle/placement 누락 보고

9D CI and Release
-> GitHub Actions의 실제 PostgreSQL service 검증
-> Docker app과 DB network/shutdown 확인
-> migration 재실행, runtime 저장, import가 clean 환경에서 되는지 확인
```

이렇게 나누는 이유는 schema 문제, runtime 연결 문제, 과거 로그 변환 문제, 배포 환경 문제를 한 변경에서 섞지 않기 위해서다.

단, `users`, `match_results`, score ranking, rating만 만들 목적이라면 Goal 9 전체는 과하다. 그 경우에는 다음처럼 더 작은 DB 기능부터 시작하는 편이 맞다.

```txt
users table
match_results table

게임 종료
-> 결과 한 행 INSERT
-> 승률/점수/ranking SELECT
```

Goal 9는 ML용 placement event와 개인정보 정제, 기존 JSONL history까지 다루려는 큰 범위다.

### 6. OCI Always Free VM 한 대에서 app과 PostgreSQL을 같이 돌릴 수 있는가?

가능하다. 월 운영비 0원을 우선한다면 Render와 외부 DB를 분리하는 것보다 단순한 구조다.

```txt
OCI Always Free Linux VM
├─ app container: Express + Socket.IO
└─ postgres container: PostgreSQL
```

두 container는 같은 Docker network에서 통신하고 PostgreSQL 포트는 외부 인터넷에 열지 않는다.

```txt
Node app container
-> postgres:5432
```

DB와 JSONL의 실제 데이터는 VM 디스크에 volume으로 연결한다.

```txt
/srv/tetris/postgres-data
-> PostgreSQL volume

/srv/tetris/logs
-> JSONL log volume
```

app container를 새 image로 교체해도 VM 디스크의 DB 데이터와 로그는 유지된다. 단, VM 한 대이므로 app과 DB가 함께 중단될 수 있고, PostgreSQL backup과 server 보안·업데이트는 직접 관리해야 한다.

OCI의 Always Free Autonomous Database는 Oracle Database다. 현재 프로젝트의 `pg` 기반 PostgreSQL 코드와 직접 호환되는 서비스가 아니므로, 이 프로젝트에서는 VM 안에 PostgreSQL을 직접 실행하는 쪽이 맞다.

### 7. Docker Compose YAML은 다른 컴퓨터에서도 같은 container를 만드는 설정인가?

맞다. `compose.yml`은 여러 container를 함께 어떻게 실행하고 연결할지 선언하는 파일이다.

```yaml
services:
  app:
    build: .
    ports:
      - "5500:5500"

  postgres:
    image: postgres:16
```

다른 컴퓨터에서 Docker를 설치하고 repository를 받은 뒤 다음을 실행하면 같은 app/PostgreSQL 구조를 만들 수 있다.

```bash
docker compose up --build
```

```text
Dockerfile
= app image를 어떻게 build할지

compose.yml
= app, PostgreSQL, network, volume을 어떻게 함께 실행할지
```

다만 YAML은 container 구성만 재현한다. 기존 PostgreSQL 데이터와 JSONL 로그를 다른 컴퓨터로 옮기려면 volume backup/restore가 별도로 필요하다.

---

## Q. Caddy 설정과 tar.gz 배포에서 생긴 문제는 무엇인가? (2026-09-08 제공 로그 기준)

### 1. `/stats/script.js` 같은 상대 주소는 항상 잘못된 것인가?

항상 잘못된 것은 아니다. 이 주소는 게임 서버로 요청하므로 Caddy가 해당 경로를 Umami에 proxy하도록 설정돼 있으면 정상적인 구성이다. proxy 경로가 없는 경우에는 게임 앱이 요청을 받아 404를 반환할 수 있다.

Caddy는 공개 HTTPS 요청을 받아 app이나 지정한 upstream으로 전달하는 서버다. Vite는 client source를 개발 서버에서 제공하거나 배포 artifact로 build하는 역할을 맡는다.

### 2. 호스트의 Caddyfile을 바꿨는데 왜 container 안에는 이전 내용이 있었는가?

제공 로그에서는 mount source가 `/srv/tetris/repository/Caddyfile`임에도 container 안에는 새 `/stats` 설정이 없었다. 단일 파일 bind mount에서는 파일 교체로 inode가 바뀌면 기존 container가 이전 파일을 계속 참조할 수 있다. `reload`는 container 안에서 읽히는 설정을 재적용할 뿐 mount를 다시 만들지는 않는다.

따라서 호스트 파일과 container 내부 파일을 각각 확인해야 한다. mount를 갱신하려면 Caddy container를 재생성하거나, 상황에 맞게 기존 mount 파일의 내용을 갱신해야 한다. 실제 적용 여부는 내부 설정 확인과 공개 주소의 응답으로 판단한다.

### 3. `compose.production.yml`과 `DATABASE_URL` 오류는 왜 발생했는가?

Compose 파일의 상대 경로는 현재 작업 directory 기준이다. 파일이 없는 directory에서 실행하면 경로 오류가 발생한다. Compose는 명령 대상이 Caddy여도 전체 설정의 환경변수를 먼저 해석하므로 필수 `DATABASE_URL`이 없으면 실행 전 멈출 수 있다.

운영 명령에는 올바른 Compose 경로와 `/srv/tetris/secrets/production.env`를 명시한다. 실행 중인 Caddy의 설정만 읽거나 reload하는 경우에는 정확한 container를 확인한 뒤 `docker exec`로 접근할 수도 있다.

---

## Q. GitHub Actions production 배포 과정은 어떻게 동작하는가? (2026-09-14 ~ 2026-10-04)

### 1. CI가 green이면 CD도 완료된 것인가?

CI는 해당 commit의 typecheck, build와 테스트가 통과했다는 의미다. CD는 검증된 commit의 artifact를 서버에 전달하고 실제 앱을 교체·확인하는 별도 과정이다. 현재 production workflow는 사람이 `Run workflow`로 시작하면 나머지 단계를 자동 수행한다. main push마다 자동으로 배포하는 구성은 아니다.

### 2. SSH private key, `OCI_HOST`, `OCI_KNOWN_HOSTS`는 각각 왜 필요한가?

private key는 runner가 서버에 접속할 권한을 증명한다. host는 접속할 서버 주소다. known hosts는 상대 서버가 기대한 서버인지 확인하는 공개 host key 기록이다. 맥에서 생성하는 기록도 맥의 신원 정보가 아니라, 맥이 접속하거나 조회한 서버의 host key다.

`ssh-keyscan`은 key를 수집하는 도구이며 그 결과만으로 서버의 신원이 보증되지는 않는다. 서버에서 확인한 fingerprint 등 신뢰할 수 있는 값과 대조한 뒤 runner에 제공하는 것이 맞다. private key 내용은 문서·로그·Git에 남기지 않는다.

### 3. GitHub Actions가 마지막 commit을 압축해서 서버에 보내는가?

현재 workflow는 checkout한 정확한 release commit을 `git archive`로 압축한다. `release_ref`가 있으면 그 ref를 사용하고, 비어 있으면 workflow 실행에서 선택한 ref의 commit을 사용한다. 로컬의 미커밋 변경은 포함되지 않는다.

압축 파일과 checksum은 서버의 incoming directory로 전송되고 SHA-256을 확인한 뒤 사용한다. `tetris-<sha>.tar.gz`의 `<sha>`는 설명용 자리표시자다. 실제 명령에서는 전달된 파일명의 SHA를 넣어야 하며, shell에서 꺾쇠를 그대로 입력하면 redirection으로 해석될 수 있다.

### 4. build directory는 무엇이며 왜 배포마다 준비하는가?

`/srv/tetris/builds/<release_sha>`는 해당 commit의 source를 풀어 Docker 이미지를 만드는 작업 directory다. 실행 중인 앱이 이 directory의 source를 직접 읽는 것은 아니다. 앱은 build된 이미지의 compiled `dist`를 실행한다.

release별 directory를 쓰면 source가 섞이지 않는다. 같은 후보 이미지가 이미 있다면 현재 workflow는 commit과 artifact checksum label을 확인한 뒤 재사용할 수 있다.

### 5. 이미지 label은 어디에 저장되고 무엇을 보증하는가?

label은 Docker 이미지의 metadata에 저장된다. `docker image inspect`로 읽을 수 있으며 현재 workflow는 전체 release commit SHA와 artifact checksum을 기록한다. 재사용할 후보 이미지가 지금 배포하려는 source에 대응하는지 확인하는 근거다. 이름의 짧은 SHA만 비교하는 것보다 정확하지만, label이 이미지에 대한 독립적인 서명 검증을 대신하는 것은 아니다.

이미지가 존재한다는 사실과 현재 앱이 그 이미지로 실행 중이라는 사실은 다르다. 실행 container의 image ref/ID도 확인해야 한다.

### 6. `PostgreSQL migrations applied=0 skipped=2`가 두 번 나오는 것은 오류인가?

migration 두 개가 이미 적용돼 있어 이번 실행에서는 추가 변경 없이 생략했다는 뜻이다. 배포 workflow는 migration을 적용하고 다시 실행해 멱등성을 확인하므로 결과가 두 번 출력된다. migration 성공과 앱 실행 성공은 각각 확인해야 한다.

### 7. `RELEASE_COMMIT_HAS_NO_SUCCESSFUL_MAIN_CI`는 무엇인가?

현재 배포 검사는 동일한 전체 commit SHA에 대해 `ci.yml`의 `main` push run이 completed/success인지 확인한다. 이전 commit의 green, 실행 중인 CI, PR CI나 수동 CI 성공은 이 조건을 만족하지 않는다. 해당 commit의 main push CI가 완료된 뒤 production workflow를 다시 실행한다.

### 8. 후보 앱이 unhealthy가 되면 원인을 어떻게 찾는가?

container state, exit code, OOM 여부, healthcheck의 실제 출력과 앱 로그를 함께 확인한다. 자동 rollback이 후보 container를 교체하기 전에 읽어야 원래 실패 흔적을 보존할 수 있다. 현재 workflow는 이 진단을 rollback 직전에 출력한다.

제공된 로그에서는 migration은 통과했지만 후보 앱이 unhealthy가 됐고 이전 `abb9ebc`로 복구된 앱은 healthy였다. 이것만으로 후보의 원인이 메모리·DB·경로 문제 중 무엇인지 확정할 수는 없다. 로그에 release SHA가 설정돼 있었으므로 SHA 입력란을 비웠다는 사실만으로 실패 원인을 설명할 수 없다.

### 9. production workflow 전체가 green이면 어느 범위까지 끝난 것인가?

artifact 전송, 이미지 준비, DB 백업·migration, 앱 교체와 health/HTTPS 검사까지 통과한 것이다. 그 뒤 브라우저에서 실제 싱글·PVP/PVE와 게임 로그 저장을 확인하면 해당 release 검증을 보완할 수 있다.

실패 시 rollback은 이전 앱 이미지를 복구하는 범위다. 이미 적용한 DB schema를 자동으로 이전 버전으로 되돌리지는 않는다. Compose/Caddy 설정 변경, 백업 보관·외부 복사와 장기 모니터링은 별도 운영 항목이다.

---

## Q. Umami 국가·hostname과 개발 통계는 어떻게 해석하는가? (2026-10-04)

### 1. 일본 OCI 서버를 쓰면 방문 국가도 일본으로 잡히는가?

브라우저가 Umami Cloud에 직접 보내는 현재 구성에서는 방문자 쪽 IP가 국가 판단의 기준이다. 게임 서버가 일본에 있다는 이유만으로 모든 방문이 일본이 되는 것은 아니다.

통계 API까지 일본 서버를 통해 proxy하면 수집 서버가 OCI의 IP를 사용할 가능성이 있다. 실제 방문자 IP가 반영되는지는 별도 검증해야 한다. 과거 proxy 기간의 기록도 현재 조회 범위에 남을 수 있다. 당시 일본 기록의 원인은 로그와 전송 경로 확인 없이 확정하지 않았다.

### 2. 미국 방문은 GitHub Actions 테스트일 수 있는가?

CI의 Playwright는 실제 브라우저로 홈페이지를 열기 때문에 domain 제한이 없던 tracker가 테스트 방문을 기록할 수 있다. runner의 외부 IP가 미국으로 분류되면 US 방문이 나타날 수 있지만, 국가만으로 CI 방문이라고 단정하지 않는다.

Umami에서 날짜를 CI 실행 시간에 맞추고 `Hostname Is 127.0.0.1` 필터를 적용한다. 기록이 있으면 CI 또는 로컬 테스트 수집이 있었다는 뜻이며 시각도 대조해야 한다. `Hostname Is tetra-arena.duckdns.org`는 운영 사이트 방문을 조회하는 조건이다. 값에는 scheme과 port를 넣지 않는다.

Hostname은 방문한 페이지의 host를 뜻하며, 국가 판단에 사용한 IP를 보여주는 항목은 아니다. [공식 필터 안내](https://docs.umami.is/docs/filters)

### 3. `data-domains`는 어떤 문제를 해결하는가?

현재 설정은 `window.location.hostname`이 `tetra-arena.duckdns.org`일 때만 추적한다. 개발·CI 주소의 수집을 제한하며 국가를 강제로 한국으로 바꾸거나 광고 차단기를 우회하는 옵션은 아니다. [공식 tracker 설정](https://docs.umami.is/docs/tracker-configuration#data-domains)

---

## Q. Umami 공식 방식과 브라우저 차단은 어떻게 구분하는가? (2026-10-06)

### 1. 현재 직접 연결 방식은 공식 권장 사용법과 맞는가?

공식 기본 설치는 대시보드의 tracking code를 페이지 head에 넣는 방식이다. 현재 Cloud script 사용과 `data-domains`는 이 방식에서 지원되는 설정이다. proxy는 기본 설치의 필수 조건이 아니라 광고 차단기 대응을 위한 별도 선택지다. [공식 설치 안내](https://docs.umami.is/docs/collect-data), [proxy 안내](https://docs.umami.is/docs/bypass-ad-blockers)

### 2. CSP에 `gateway.umami.is`를 추가하는 것이 억지 우회인가?

공식 collector로 전송할 수 있도록 사이트가 관리하는 허용 목록을 맞추는 정상적인 설정이다. 스크립트는 Cloud에서 로드하지만 통계 전송은 Gateway로 이루어진다. Cloud 변경 기록의 2026-06-06 항목과 실제 제공 script에서 이 주소를 확인했다. 기존 Cloud만 허용한 설명·설정은 불완전했으며 이를 보완했다.

`script-src`는 script 다운로드를, `connect-src`는 fetch나 beacon 같은 전송을 제한한다. CSP 자체를 끄거나 wildcard로 모든 외부 서버를 허용할 필요는 없다. [공식 Cloud 변경 기록](https://docs.umami.is/docs/cloud/changelog), [connect-src 설명](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Content-Security-Policy/connect-src)

### 3. `UMAMI_CLOUD_ORIGIN` 상수는 여전히 필요한가?

`cloud.umami.is/script.js`를 불러오는 `script-src`에 필요하다. collector용 `gateway.umami.is`는 `connect-src`에서 별도로 허용한다. 기본 통계 전송만 기준으로 Cloud의 connect 허용을 정리할 수는 있지만 script 허용과 상수까지 삭제하면 tracker 로딩이 막힌다.

### 4. `ERR_BLOCKED_BY_CLIENT`와 CSP 위반은 같은 오류인가?

`ERR_BLOCKED_BY_CLIENT`는 광고 차단 확장이나 브라우저 추적 방지 등이 요청을 막을 때 나타날 수 있다. CSP 위반은 사이트 응답의 정책이 요청 주소를 허용하지 않아 발생한다. domain 제한·CSP 허용만으로 사용자의 차단기까지 해제되지는 않는다.

`favicon.ico`의 404는 아이콘 파일이 없다는 별도 요청 실패이며 Umami 통계 전송 오류의 원인은 아니다.

### 5. Chrome에서는 한국 방문이 잡히고 Brave에서는 수집되지 않으면 어떻게 확인하는가?

이 관찰은 직접 전송과 위치 판정이 Chrome에서 동작한다는 근거다. Brave에서는 기본 Shields 차단 가능성이 높지만 원인 확정에는 비교가 필요하다. 주소창 사자 아이콘에서 해당 사이트의 Shields를 잠시 끄고 새로고침해 수집되는지 확인한다. 확인 뒤 원래 설정으로 되돌릴 수 있다. [Brave 사이트별 Shields 안내](https://support.brave.com/hc/en-us/articles/360022806212-How-do-I-use-Shields-while-browsing)

### 6. 광고 차단기 사용자를 위해 반드시 proxy로 바꿔야 하는가?

방문 추세를 보는 보조 통계라면 일부 누락을 받아들이고 직접 연결을 유지할 수 있다. 사용자는 현재 정상 수집을 확인한 뒤 추가 proxy 작업을 보류했다.

누락을 줄여야 한다는 요구가 생기면 공식 proxy 방식을 검토한다. script만 자체 domain으로 제공해도 collector 요청이 따로 차단될 수 있다. 두 경로와 CSP를 함께 확인해야 하며, 모든 차단기 우회나 위치 정확도가 자동으로 보장되는 것은 아니다.

---

## Q. React 페이지인데 왜 HTML마다 Umami script를 추가했는가? (2026-10-09)

현재 네 화면은 하나의 SPA가 아니라 각 HTML이 독립 entry인 MPA다. index의 script는 새 문서인 lobby/single/multi로 이동하면 자동으로 따라가지 않는다. 각 HTML의 head에 같은 tracker를 한 번씩 설치해야 페이지별 방문을 수집할 수 있다.

동일 website ID를 쓰므로 하나의 Umami 사이트 안에서 URL 경로별로 비교할 수 있다. 각 페이지에서도 운영 domain 제한을 유지했다. 게임 결과·공격 등 custom event 추가는 이번 pageview 설정에 포함하지 않았다.

---

## Q. 현재 디자인과 누적 로그 정제 작업은 어디까지 진행됐는가? (2026-10-12 기존 계획·대화 요약 기준)

### 1. 싱글에 nickname을 입력해야 하는가? NEXT 4개도 구현됐는가?

현재 홈 1단계 구현에서는 싱글은 바로 진입하고, 멀티 진입에만 nickname을 선택 입력한다. 빈 멀티 nickname에는 Guest 이름을 만든다. NEXT 4개 확대와 나머지 화면·공격 연출은 후속 계획이며 홈 구현 완료와 구분한다. [디자인 계획](docs/design/charcoal-gold-design-plan.md)

### 2. 새로 받은 DB dump는 모두 새 학습 게임인가?

새 파일이라고 모든 게임이 신규 또는 미학습 게임인 것은 아니다. 누적 운영 snapshot과 기존 모델의 실제 학습 gameId 목록을 대조해야 한다. 보고된 246게임 중 lifecycle이 완결된 230게임도 placement/source/candidate 검증 전에는 최종 학습 대상 수가 아니다.

데이터를 단순 append하지 않고 event identity로 중복과 내용 충돌을 구분한다. 미학습 게임으로 기존 모델을 먼저 평가한 뒤 재학습에 편입할 데이터를 정한다. 시간상 이후 데이터임이 확인된 경우에만 temporal holdout이라고 부른다.

### 3. 5시간 이상 기록된 게임은 사람이 계속 플레이한 것인가?

기존 분석 요약의 최장 불완전 게임에는 종료 이벤트와 Human placement가 없고 AI placement만 기록돼 있었다. 이것은 사람의 장시간 플레이를 증명하지 않는다. 로그만으로 AFK나 서버 오류라고 확정하지 않고, 완결 게임의 duration과 종료 없는 게임의 관찰 구간을 구분한다.

현재는 읽기 전용 분석과 계획 작성 단계다. 정제 결과 생성, dataset export, 모델 학습과 운영 AI 적용은 아직 수행하지 않았다. [기존 대화 요약](docs/ai-ml/strategy/data-cleaning-training-conversation-summary.md)

---

## Q. 멀티 재시작 제한과 서버 기준 카운트다운을 어떻게 이해하고 설계했는가? (2026-10-13)

### 1. Lifecycle, rate limit, limit은 각각 무엇인가? 그냥 속성값 객체인가?

Lifecycle은 방 생성·대기·시작·참가·종료·로비 복귀라는 생명주기다. 코드의 `lifecycle`은 관련 요청을 묶은 bucket 이름이다. Rate limit은 일정 시간 동안의 요청 횟수를 제한하는 정책이고 `limit`은 허용 횟수다.

```ts
lifecycle: { limit: 10, windowMs: 60_000 }
```

이 값 자체는 일반 설정 객체다. 실제 동작은 `consume()`이 player별 count와 resetAt을 Map에서 확인해 결정한다. 첫 요청부터 60초 동안 이 묶음의 요청을 합쳐 10회 허용한다. 같은 player로 페이지/socket이 바뀌어도 횟수는 이어진다.

### 2. `bag: { limit: 2, windowMs: 1_000 }`은 NEXT 4개를 나눠 보내는 설정인가?

아니다. `bag`은 `game:bag:request` 보충 요청의 제한 이름이다. NEXT 4칸은 이미 확보한 다음 조각 목록의 일부를 표시한다. 7-bag은 조각 7종을 하나씩 섞은 묶음이며 게임 시작 시 3묶음, 총 21개를 준비한다.

Client는 숨은 queue와 표시 queue를 합친 잔량이 7개 이하인지 500ms마다 확인하고, 필요하면 한 번 요청해 7개 묶음을 받는다. 이 설정은 player당 1초에 보충 요청 최대 2회라는 뜻이며 0.2초 간격 전송이나 블록 2개 공급을 뜻하지 않는다. 한도 초과 요청은 지연 queue에 넣지 않고 `RATE_LIMITED`로 거부한다.

빠른 소비나 네트워크 지연으로 확보한 조각을 모두 소진할 가능성은 있다. 그 경우 잔량·요청/응답 시각·제한 응답을 함께 조사해야 한다. 이번 작업에서 bag 공급 정책이나 극단적 소비 속도를 변경·부하 검증하지는 않았다.

### 3. 빠르게 세 판 반복하는 것을 제한하고 sync 제한 분리를 나중으로 미뤄도 되는가?

현재 MVP 정책으로 가능하며 사용자 결정에 따라 lifecycle 공유 bucket과 60초·10회 한도를 유지했다. 다만 빠른 패배·재시작도 정상 사용일 수 있다. 사용자가 직접 연타하는 start와 앱이 자동으로 보내는 join/sync는 성격이 다르다.

방 생성 1회와 세 판의 start/join/sync 각 3회면 총 10회다. 따라서 현재 정책은 필수 자동 요청까지 함께 제한한다. 이번에는 제한 초과를 정확히 안내하고 실패 복구를 마련했다. 정상 플레이에서도 자주 막힌다는 근거가 생기면 동기화 제한 분리를 다시 검토한다.

### 4. 시작 버튼 중복 클릭 차단은 멱등성을 구현한 것인가?

Client의 대기 flag는 응답 전 추가 요청을 보내지 않는 전송 차단이다. 서버 멱등성은 같은 요청이 여러 번 도착해도 실제 게임이 한 번만 시작되는 성질이다. 버튼 차단만으로 서버의 중복 실행 방지가 보장되지는 않는다.

현재 서버는 첫 start에서 waiting을 playing으로 바꾸고 이후 start는 `GAME_ALREADY_STARTED`로 거부한다. 상태 변화 관점의 중복 시작 방지를 유지하며, 이번에는 ref의 즉시 차단과 React의 버튼 표시를 추가했다. 같은 요청의 재전송에 최초 성공 응답까지 그대로 돌려주는 requestId 기반 결과 저장은 구현하지 않았다.

### 5. 일시적 제한 실패 처리는 다른 이벤트나 모든 예외를 같은 방식으로 처리한다는 뜻인가?

어떤 event가 실패했는지와 reason이 무엇인지 함께 본다는 뜻이다. 선택한 start/sync/join 흐름에서 `RATE_LIMITED`는 이번 요청이 거절됐다는 의미이며 room 퇴장이 아니다.

| 실패 | 처리 |
| --- | --- |
| start의 `RATE_LIMITED` | 방 유지, 요청 대기 해제, 사용자 재시도 |
| sync의 `RATE_LIMITED` | 저장 room 유지, 시작 차단, `방 상태 다시 확인` 제공 |
| game join의 `RATE_LIMITED` | runtime 실행 보류, `참가 다시 시도` 제공 |
| game leave의 `RATE_LIMITED` | 성공 전 이동·캐시 삭제를 하지 않고 퇴장 실패 안내 |
| `ROOM_NOT_FOUND` | 저장 room 정리 |
| sync의 `NOT_AUTHORIZED` 또는 terminal session 오류 | 현재 권한을 신뢰할 수 없어 room 표시/캐시 정리 |

서버가 `{ ok: false, reason }`으로 반환하는 예상 가능한 실패와 내부 exception, 응답을 못 받은 transport 단절은 구분한다. 응답 부재만으로 서버가 요청을 실행하지 않았다고 단정할 수 없으며, reconnect 뒤 sync로 현재 상태를 확인한다. 같은 malformed 요청을 자동 반복하거나 모든 실패를 방 삭제로 처리하지 않는다.

### 6. 페이지에서 숫자만 3초 보여 주면 안 되는가?

서버 ticker나 AI가 먼저 진행되면 client가 countdown을 보는 동안 게임 상태가 바뀐다. 그래서 실제 서버 실행과 local prediction도 함께 대기해야 한다.

```text
room:start로 match 준비
→ 게임 페이지 이동
→ 필요한 human의 game:join 완료
→ 서버가 startsAt = now + 3000 예약
→ game:countdown으로 시작 시각 전달
→ client 표시와 서버 실행을 시작 시각에 맞춰 해제
```

PVP는 human 2명, PVE는 human 1명을 기다린다. 참가가 덜 끝났으면 `상대 참가 대기 중`을 표시한다. 준비·예약 정보는 match metadata이며 board나 gameplay phase에 새 상태를 추가하지 않았다. Client는 서버가 보낸 남은 시간을 `performance.now()` 기준으로 표시하므로, 네트워크 전달 지연까지 제거한 정밀 clock 동기화를 보장하는 구현은 아니다.

### 7. Countdown 중 새로고침, reconnect나 퇴장이 발생하면 어떻게 되는가?

시작 전 disconnect나 active socket 교체는 해당 player의 readiness를 회수하고 참가 대기로 돌아간다. 필요한 human이 다시 참가하면 새로운 3초를 예약한다. 같은 socket의 반복 join은 기존 예약을 연장하지 않고, 오래된 socket의 늦은 disconnect는 새 연결의 준비 상태를 취소하지 않는다.

명시적 퇴장은 기존 membership 제거 정책을 따른다. ticker/match를 정리하고 남은 player를 로비로 복귀시킨다. 종료된 이전 ticker의 늦은 callback은 현재 ticker instance와 다르면 실행하지 않는다. 이미 시작된 게임의 disconnect에는 기존 grace 정책을 유지한다.

### 8. E2E가 제한 실패를 모의로 만들면 실제 rate limit도 검증된 것인가?

브라우저 복구 테스트는 첫 제한 응답만 모의로 발생시켜 버튼·room 캐시·재시도 화면을 결정적으로 확인한다. 실제 room/match는 서버가 소유한다. 이 테스트만으로 기본 한도를 검증했다고 말하지 않는다.

기본 production 한도를 쓰는 별도 socket 테스트에서 start 성공 직후 join 제한, 인증 유효성, membership 보존과 60초 경과 후 재참가를 검증했다. 기존 E2E test profile은 lifecycle 한도가 높으므로 일반 gameplay 회귀와 제한 정책 검증의 역할을 구분한다.

### 9. 착지 색상 오탐은 무엇이며 rollback 검사를 약하게 만든 것인가?

오탐은 실제 rollback이 없는데 검사에서 rollback이라고 판단한 경우다. 실패 trace에서 고정 좌표와 authoritative board는 유지됐지만 착지 연출 중 local cell RGB가 `(11, 165, 230)`이고 상대 기본 색상은 `(14, 165, 233)`이었다. 정확한 Canvas 색상 비교가 이 차이를 상태 변화로 오인했다.

Rollback spec에서 양쪽의 공개 `효과 축소` 설정을 켰다. 좌표, 보드 수렴과 committed fingerprint의 되감김 검사는 유지하며 실제 게임의 연출은 제거하지 않았다. 이 spec은 효과를 축소한 상태의 rollback을 검증하고, 연출 자체는 별도 E2E가 검증한다. 정상 효과가 켜진 상태의 색상 변화까지 같은 검사로 보장하는 것은 아니다.

구현 시 최종 하네스는 Node 674 pass·1 skip이며 시작/복구 spec 5개와 rollback spec을 3회 반복해 18/18 통과했다. 최초 전체 Playwright는 색상 오탐 1건을 포함해 45/46이었고 수정 후 전체 46개를 재실행한 기록과 혼동하지 않는다. 이번 QnA 추가에서는 테스트를 재실행하지 않았다.
