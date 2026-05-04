import { initGameSound, tryPlayMusic } from "../runtime/sound.js"
import { attachKeyboardInput } from "../runtime/input.js"
import { createTetrisRuntime } from "../runtime/tetris.js"
import { queryElement, requireElement } from "./dom.js"

export function renderSingleGamePage() {
  return `
    <div class="single-wrapper">
      <header class="single-header">
        <h1 class="page-title">Single Player Tetris</h1>
        <div class="scoreboard">
          <span class="score-label">Score</span>
          <span class="score">0</span>
        </div>
        <div class="header-actions">
          <button id="soundToggle" class="sound-toggle" type="button" aria-pressed="false">사운드 켜기</button>
          <a class="home-btn" href="#/">홈으로</a>
        </div>
      </header>

      <main class="single-layout">
        <aside class="panel panel--left">
          <div class="panel-section">
            <h2>Next Up</h2>
            <div class="next-preview"></div>
          </div>
        </aside>

        <section class="playfield">
          <div class="game-text">
            <span>게임 종료</span>
            <button>다시 시작</button>
          </div>
          <div class="playground">
            <canvas id="tetrisBoardCanvas" width="300" height="600"></canvas>
          </div>
        </section>

        <aside class="panel panel--right">
          <div class="panel-section">
            <h2>Hold</h2>
            <div class="hold-preview"></div>
          </div>
          <div class="panel-section">
            <h2>Controls</h2>
            <ul class="controls-list">
              <li><kbd>←</kbd><span>왼쪽 이동</span></li>
              <li><kbd>→</kbd><span>오른쪽 이동</span></li>
              <li><kbd>↑</kbd><span>회전</span></li>
              <li><kbd>↓</kbd><span>소프트 드롭</span></li>
              <li><kbd>Space</kbd><span>하드 드롭</span></li>
              <li><kbd>C</kbd><span>홀드 / 교체</span></li>
            </ul>
          </div>
        </aside>
      </main>
    </div>
  `
}

/**
 * 싱글 플레이 화면을 현재 root 내부 DOM에 붙이고, 정리 함수를 반환한다.
 *
 * @param {ParentNode} [root=document] - SPA가 현재 화면을 렌더한 루트
 * @returns {() => void} 입력, 사운드, 런타임을 정리하는 정리 함수
 */
export function mountSingleGame(root = document) {
  const boardCanvasEl = requireElement(root, "canvas#tetrisBoardCanvas", "single game")
  const gameOverEl = requireElement(root, ".game-text", "single game")
  const scoreEl = requireElement(root, ".score", "single game")
  const nextPreviewEl = requireElement(root, ".next-preview", "single game")
  const holdPreviewEl = requireElement(root, ".hold-preview", "single game")
  const restartBtn = queryElement(root, ".game-text > button")
  const soundToggleBtn = queryElement(root, "#soundToggle")

  const game = createTetrisRuntime({
    boardCanvasEl,
    gameOverEl,
    scoreEl,
    nextPreviewEl,
    holdPreviewEl,
  })

  const cleanupSound = initGameSound(soundToggleBtn)
  game.runtime.detachKeyboard = attachKeyboardInput({
    enqueueAction: game.enqueueInput,
    onUserInteract: tryPlayMusic,
  })

  const onRestart = () => {
    game.hideGameOver()
    game.init()
  }

  restartBtn?.addEventListener("click", onRestart)
  game.init()

  let isUnmounted = false

  return () => {
    if (isUnmounted) return
    isUnmounted = true

    restartBtn?.removeEventListener("click", onRestart)
    cleanupSound?.()
    game.destroy()
  }
}
