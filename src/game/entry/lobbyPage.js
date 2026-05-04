import { initLobbySound } from "../runtime/sound.js"
import { queryElement, requireElement } from "./dom.js"
import { applySavedTheme, toggleTheme } from "./theme.js"

function escapeHtml(text) {
    return text.replace(/</g, "&lt;").replace(/>/g, "&gt;")
}

export function renderLobbyPage() {
    return `
    <div class="container">
      <header class="header">
        <h1 class="brand">Multi Lobby</h1>
        <nav class="nav">
          <button id="soundToggle" type="button" class="btn ghost" aria-pressed="false">사운드 켜기</button>
          <button id="themeToggle" type="button" class="btn ghost" aria-pressed="false">다크 모드</button>
          <a href="#/" class="btn ghost">← 홈으로</a>
        </nav>
      </header>

      <main class="main" style="padding-top: 10px;">
        <div class="lobby-grid">
          <section class="card chat-panel">
            <h2 class="card-title" style="margin-bottom: 4px;">Global Chat</h2>
            <div class="chat-messages" id="chatMessages">
              <div class="chat-msg"><span class="system">[System]</span> 로비 서버에 연결되었습니다. 대화나 게임 매칭을 시작하세요!</div>
            </div>
            <form class="chat-input-group" id="chatForm">
              <input type="text" id="chatInput" class="input-box" placeholder="메시지를 입력하세요..." autocomplete="off">
              <button type="submit" class="btn primary">전송</button>
            </form>
          </section>

          <section class="action-panel">
            <div class="action-box">
              <h3>Quick Match</h3>
              <p>현재 접속 중인 다른 플레이어와 무작위로 실시간 매칭됩니다.</p>
              <button id="btnQuickMatch" class="btn primary btn-match">매칭 시작 (Play)</button>
            </div>

            <div class="action-box">
              <h3>Join by Code</h3>
              <p>친구가 생성한 방의 고유 코드를 입력하여 전용 방으로 입장하세요.</p>
              <div class="join-group">
                <input type="text" id="roomCodeInput" class="input-box input-code" placeholder="ENTER CODE" maxlength="8">
                <button id="btnJoinCode" class="btn">방 입장 (Join)</button>
              </div>
            </div>

            <div class="action-box" style="padding: 16px;">
              <p style="text-align:center; font-size:0.85rem;">또는 새로운 프라이빗 방을 생성합니다.</p>
              <button id="btnCreateRoom" class="btn ghost" style="width:100%;">방 생성 (Create Room)</button>
            </div>
          </section>
        </div>
      </main>
    </div>
  `
}

/**
 * 로비 화면의 채팅 데모와 공용 버튼 이벤트를 연결하고 정리 함수를 반환한다.
 *
 * @param {ParentNode} root - 현재 로비 화면이 렌더된 루트
 * @returns {() => void} 로비 리스너와 사운드 토글을 정리하는 정리 함수
 */
export function mountLobbyPage(root) {
    const themeToggleBtn = queryElement(root, "#themeToggle")
    const soundToggleBtn = queryElement(root, "#soundToggle")
    const chatForm = requireElement(root, "#chatForm", "lobby")
    const chatInput = requireElement(root, "#chatInput", "lobby")
    const messages = requireElement(root, "#chatMessages", "lobby")
    const roomCodeInput = requireElement(root, "#roomCodeInput", "lobby")
    const quickMatchBtn = requireElement(root, "#btnQuickMatch", "lobby")
    const joinCodeBtn = requireElement(root, "#btnJoinCode", "lobby")
    const createRoomBtn = requireElement(root, "#btnCreateRoom", "lobby")

    applySavedTheme(themeToggleBtn)

    const appendMessage = (type, text) => {
        const div = document.createElement("div")
        div.className = "chat-msg"
        const tag = type === "system"
            ? '<span class="system">[System]</span>'
            : '<span class="user">[Guest]</span>'
        div.innerHTML = `${tag} ${escapeHtml(text)}`
        messages.appendChild(div)
        messages.scrollTop = messages.scrollHeight
    }

    const onToggleTheme = () => toggleTheme(themeToggleBtn)
    themeToggleBtn?.addEventListener("click", onToggleTheme)

    const onSubmitChat = (event) => {
        event.preventDefault()
        const message = chatInput.value.trim()
        if (!message) return
        appendMessage("user", message)
        chatInput.value = ""
    }

    const onQuickMatch = () => {
        window.location.hash = "#/multi?mode=create"
    }

    const onJoinCode = () => {
        const code = roomCodeInput.value.trim()
        if (!code) {
            window.alert("방 코드를 입력해주세요.")
            return
        }
        window.location.hash = `#/multi?mode=join&roomId=${encodeURIComponent(code.toUpperCase())}`
    }

    const onCreateRoom = () => {
        window.location.hash = "#/multi?mode=create"
    }

    chatForm.addEventListener("submit", onSubmitChat)
    quickMatchBtn.addEventListener("click", onQuickMatch)
    joinCodeBtn.addEventListener("click", onJoinCode)
    createRoomBtn.addEventListener("click", onCreateRoom)
    const cleanupSound = initLobbySound(soundToggleBtn)

    let isUnmounted = false
    return () => {
        if (isUnmounted) return
        isUnmounted = true
        themeToggleBtn?.removeEventListener("click", onToggleTheme)
        chatForm.removeEventListener("submit", onSubmitChat)
        quickMatchBtn.removeEventListener("click", onQuickMatch)
        joinCodeBtn.removeEventListener("click", onJoinCode)
        createRoomBtn.removeEventListener("click", onCreateRoom)
        cleanupSound?.()
    }
}
