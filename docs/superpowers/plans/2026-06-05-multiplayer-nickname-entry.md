# Multiplayer Nickname Entry Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 메인 페이지에서 닉네임을 입력한 뒤 멀티 로비에 입장하고, 로비의 room create/join 요청이 해당 닉네임을 사용하게 만든다.

**Architecture:** 메인 페이지는 닉네임을 `sessionStorage`에 저장하고 `multiLobby.html`로 이동한다. 멀티 로비는 `sessionStorage`에서 닉네임을 읽어 `currentPlayer.nickname`으로 사용하며, `playerId`는 로비 안에서 `crypto.randomUUID()`로 생성해 URL과 화면에 노출하지 않는다.

**Tech Stack:** Vanilla JS, HTML, existing CSS, Socket.IO client adapter.

---

### Task 1: 메인 페이지 멀티 입장 폼

**Files:**
- Modify: `src/client/pages/index.html`
- Modify: `src/client/styles/style.css`

- [ ] **Step 1: 멀티 입장 UI 추가**

`src/client/pages/index.html`의 hero CTA 근처에 닉네임 입력 form을 추가한다.

```html
<form class="nickname-entry" id="nicknameEntryForm">
    <input id="nicknameInput" class="input-box" type="text" maxlength="16" placeholder="닉네임" autocomplete="nickname">
    <button class="btn" type="submit">멀티 게임</button>
</form>
```

- [ ] **Step 2: 기존 멀티 링크를 form 흐름으로 맞추기**

기존 `./multiLobby.html` 링크는 닉네임 입력 없이 바로 이동하지 않도록 form submit을 유도한다. 카드 링크는 버튼/카드 역할을 유지하되 `id`를 부여하고 JS에서 기본 이동을 막는다.

```html
<a class="card" id="multiLobbyCard" href="./multiLobby.html">
```

- [ ] **Step 3: 닉네임 저장 후 이동 로직 추가**

`src/client/pages/index.html`의 module script에 DOM 참조와 submit handler를 추가한다.

```js
const nicknameEntryForm = queryElement(document, "#nicknameEntryForm")
const nicknameInput = queryElement(document, "#nicknameInput")
const multiLobbyCard = queryElement(document, "#multiLobbyCard")

function createGuestNickname() {
    return `Guest${Math.floor(1000 + Math.random() * 9000)}`
}

function enterMultiLobby(event) {
    event?.preventDefault()
    const nickname = nicknameInput?.value.trim() || createGuestNickname()
    sessionStorage.setItem("tetris:nickname", nickname)
    window.location.href = "./multiLobby.html"
}
```

- [ ] **Step 4: 이벤트 연결과 정리**

```js
nicknameEntryForm?.addEventListener("submit", enterMultiLobby)
multiLobbyCard?.addEventListener("click", enterMultiLobby)

window.addEventListener("pagehide", () => {
    nicknameEntryForm?.removeEventListener("submit", enterMultiLobby)
    multiLobbyCard?.removeEventListener("click", enterMultiLobby)
}, { once: true })
```

### Task 2: 로비 currentPlayer 닉네임 연결

**Files:**
- Modify: `src/client/pages/multiLobby.html`

- [ ] **Step 1: 저장된 닉네임 읽기 helper 추가**

```js
function createGuestNickname() {
    return `Guest${Math.floor(1000 + Math.random() * 9000)}`
}

function getSavedNickname() {
    const savedNickname = sessionStorage.getItem("tetris:nickname")?.trim()
    if (savedNickname) return savedNickname

    const guestNickname = createGuestNickname()
    sessionStorage.setItem("tetris:nickname", guestNickname)
    return guestNickname
}
```

- [ ] **Step 2: currentPlayer 생성에 적용**

```js
const currentPlayer = {
    playerId: crypto.randomUUID(),
    nickname: getSavedNickname(),
}
```

### Task 3: 검증

**Files:**
- Verify: `src/client/pages/index.html`
- Verify: `src/client/pages/multiLobby.html`
- Verify: `src/server/services/roomService.js`
- Verify: `src/server/sockets/multiplayerSocket.js`
- Verify: `test/testRoomService.js`
- Verify: `test/testMultiplayerSocket.js`

- [ ] **Step 1: 서버/테스트 문법 확인**

Run:

```bash
node --check src/server/services/roomService.js
node --check src/server/sockets/multiplayerSocket.js
npm test
```

Expected:

```txt
all checks exit 0
15 tests pass
```

- [ ] **Step 2: 브라우저 수동 확인**

Run:

```bash
node src/app.js
```

Open:

```txt
http://localhost:5500/pages/index.html
```

Expected:

```txt
닉네임 입력 후 멀티 게임 진입 -> 방 생성 -> 채팅 시스템 메시지와 서버 room players에 입력한 nickname이 사용됨
```
