import { initLobbySound } from "../runtime/sound.js"
import { queryElement } from "./dom.js"
import { applySavedTheme, toggleTheme } from "./theme.js"

export function renderHomePage() {
  return `
    <div class="container">
      <header class="header">
        <h1 class="brand">Tetris Multi</h1>
        <nav class="nav">
          <button id="themeToggle" type="button" class="btn ghost" aria-pressed="false">다크 모드</button>
          <button id="soundToggle" type="button" class="btn ghost" aria-pressed="false">사운드 켜기</button>
        </nav>
      </header>

      <main class="main">
        <section class="hero">
          <h2 class="hero-title">Welcome to Tetris Multi</h2>
          <p class="hero-desc">이 게임은 다양한 사람들이 함께 테트리스를 하는 게임입니다.<br>많이 즐겨 주셨으면 좋겠습니다.</p>
          <div class="cta">
            <a class="btn primary" href="#/single">싱글 게임</a>
            <a class="btn" href="#/lobby">멀티 게임</a>
          </div>
        </section>

        <section class="cards">
          <a class="card" href="#/single">
            <div class="card-title">Single</div>
            <div class="card-desc">혼자 연습하기 — 현재 구현된 싱글 플레이로 바로 시작</div>
            <div class="card-cta">시작하기 →</div>
          </a>
          <a class="card" href="#/lobby">
            <div class="card-title">Online</div>
            <div class="card-desc">웹소켓 멀티 대전 — 대기실/매칭은 순차 오픈 예정</div>
            <div class="card-cta">입장하기 →</div>
          </a>
        </section>

        <section id="guide" class="guide">
          <h3>키 가이드</h3>
          <ul>
            <li><kbd>←</kbd><span>왼쪽 이동</span></li>
            <li><kbd>→</kbd><span>오른쪽 이동</span></li>
            <li><kbd>↓</kbd><span>한 칸 하강(소프트 드롭)</span></li>
            <li><kbd>↑</kbd><span>회전</span></li>
            <li><kbd>Space</kbd><span>하드 드롭</span></li>
          </ul>
        </section>
      </main>

      <footer class="footer">
        <span>© <span id="year"></span> Tetris Multi</span>
        <span class="dot">•</span>
        <a href="https://github.com/" target="_blank" rel="noreferrer">GitHub</a>
      </footer>
    </div>
  `
}

/**
 * 홈 화면의 테마/사운드 UI를 초기화하고 정리 함수를 반환한다.
 *
 * @param {ParentNode} root - 현재 홈 화면이 렌더된 루트
 * @returns {() => void} 홈 화면 리스너와 사운드 토글을 정리하는 정리 함수
 */
export function mountHomePage(root) {
  const themeToggleBtn = queryElement(root, "#themeToggle")
  const soundToggleBtn = queryElement(root, "#soundToggle")
  const yearEl = queryElement(root, "#year")

  if (yearEl) {
    yearEl.textContent = new Date().getFullYear()
  }
  applySavedTheme(themeToggleBtn)

  const onToggleTheme = () => {
    toggleTheme(themeToggleBtn)
  }

  themeToggleBtn?.addEventListener("click", onToggleTheme)
  const cleanupSound = initLobbySound(soundToggleBtn)

  let isUnmounted = false
  return () => {
    if (isUnmounted) return
    isUnmounted = true
    themeToggleBtn?.removeEventListener("click", onToggleTheme)
    cleanupSound?.()
  }
}
