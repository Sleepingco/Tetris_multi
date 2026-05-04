import { attachKeyboardInput } from "../runtime/input.js"
import { createTetrisRuntime } from "../runtime/tetris.js"
import { initGameSound } from "../runtime/sound.js"
import { queryElement, requireElement } from "./dom.js"

const SNAPSHOT_INTERVAL_MS = 200
const SERVER_BAG_LOW_WATERMARK = 7

function getPlayerElements(root, playerId) {
  const column = queryElement(root, `.player-column[data-player="${playerId}"]`)
  if (!column) return null

  return {
    boardCanvasEl: requireElement(column, "canvas.tetrisBoardCanvas", `multi player ${playerId}`),
    gameOverEl: requireElement(column, ".game-text", `multi player ${playerId}`),
    scoreEl: requireElement(column, ".score", `multi player ${playerId}`),
    nextPreviewEl: requireElement(column, ".next-preview", `multi player ${playerId}`),
    holdPreviewEl: requireElement(column, ".hold-preview", `multi player ${playerId}`),
  }
}

function getProtocolEvents() {
  return window.TetrisProtocol?.WS_EVENT ?? null
}

function parseMultiQuery() {
  const hash = window.location.hash ?? ""
  const [, query = ""] = hash.split("?")
  return new URLSearchParams(query)
}

export function renderMultiGamePage() {
  return `
    <div class="multi-wrapper">
      <header class="multi-header">
        <div class="multi-title">
          <h1>Multiplayer Tetris</h1>
          <p>2인용 대전 모드 (WebSocket 연동 예정)</p>
        </div>
        <div class="multi-actions">
          <a class="home-btn" href="#/">홈으로</a>
        </div>
      </header>

      <main class="multi-grid">
        <section class="player-column" data-player="1">
          <div class="player-header">
            <div class="player-id">Player 1</div>
            <div class="player-stats">
              <div class="stat">
                <span class="label">Score</span>
                <span class="score">0</span>
              </div>
              <div class="stat">
                <span class="label">Lines</span>
                <span class="lines">0</span>
              </div>
            </div>
          </div>

          <div class="player-panels">
            <aside class="panel panel--left">
              <div class="panel-section">
                <h2>Hold</h2>
                <div class="hold-preview" data-player="1"></div>
              </div>
              <div class="panel-section">
                <h2>Next Up</h2>
                <div class="next-preview" data-player="1"></div>
              </div>
            </aside>

            <section class="playfield playfield--multi">
              <div class="game-text" data-player="1">
                <span>대기중</span>
              </div>
              <div class="playground" data-player="1">
                <canvas class="tetrisBoardCanvas" width="300" height="600"></canvas>
              </div>
            </section>
          </div>
        </section>

        <section class="player-column" data-player="2">
          <div class="player-header">
            <div class="player-id">Player 2</div>
            <div class="player-stats">
              <div class="stat">
                <span class="label">Score</span>
                <span class="score">0</span>
              </div>
              <div class="stat">
                <span class="label">Lines</span>
                <span class="lines">0</span>
              </div>
            </div>
          </div>

          <div class="player-panels">
            <aside class="panel panel--left">
              <div class="panel-section">
                <h2>Hold</h2>
                <div class="hold-preview" data-player="2"></div>
              </div>
              <div class="panel-section">
                <h2>Next Up</h2>
                <div class="next-preview" data-player="2"></div>
              </div>
            </aside>

            <section class="playfield playfield--multi">
              <div class="game-text" data-player="2">
                <span>대기중</span>
              </div>
              <div class="playground" data-player="2">
                <canvas class="tetrisBoardCanvas" width="300" height="600"></canvas>
              </div>
            </section>
          </div>
        </section>
      </main>
    </div>
  `
}

/**
 * 멀티 보드 화면을 현재 root 내부 DOM에 붙이고, 런타임 정리 함수를 반환한다.
 *
 * @param {ParentNode} [root=document] - SPA가 현재 화면을 렌더한 루트
 * @returns {() => void} 로컬 입력과 두 보드 런타임을 정리하는 정리 함수
 */
export function mountMultiGame(root = document) {
  const events = getProtocolEvents()
  const socketFactory = window.io
  const query = parseMultiQuery()
  const localElements = getPlayerElements(root, "1")
  const remoteElements = getPlayerElements(root, "2")
  const cleanupSound = initGameSound(null)
  const mode = query.get("mode") ?? "create"
  const requestedRoomId = query.get("roomId")?.trim().toUpperCase() ?? ""
  const roomLabel = requireElement(root, ".multi-title p", "multi page")

  const localGame = localElements
    ? createTetrisRuntime(localElements)
    : null

  const remoteGame = remoteElements
    ? createTetrisRuntime(remoteElements)
    : null

  if (!events || typeof socketFactory !== "function") {
    roomLabel.textContent = "Socket.IO client or protocol script is missing."
    localGame?.init()
    remoteGame?.init({ autoStart: false })

    let isUnmounted = false
    return () => {
      if (isUnmounted) return
      isUnmounted = true
      cleanupSound?.()
      localGame?.destroy()
      remoteGame?.destroy()
    }
  }

  const socket = socketFactory()
  let activeRoomId = ""
  let snapshotTimer = null
  let localStarted = false
  let remoteStarted = false

  function ensureSnapshotRelay() {
    clearInterval(snapshotTimer)
    snapshotTimer = setInterval(() => {
      if (!activeRoomId || !localStarted || !localGame) return

      socket.emit(events.GAME_SNAPSHOT, {
        roomId: activeRoomId,
        snapshot: localGame.getSnapshot(),
      })

      if (localGame.runtime.serverBagQueue.length <= SERVER_BAG_LOW_WATERMARK) {
        socket.emit(events.GAME_BAG_REQUEST, { roomId: activeRoomId })
      }
    }, SNAPSHOT_INTERVAL_MS)
  }

  function startMatch(chunks) {
    if (!Array.isArray(chunks) || !localGame || !remoteGame) return

    localGame.applyServerBag(chunks)
    remoteGame.applyServerBag(chunks)

    if (!localStarted) {
      localGame.runtime.detachKeyboard = attachKeyboardInput({
        enqueueAction: localGame.enqueueInput,
        onUserInteract: () => {},
      })
      localGame.init()
      localStarted = true
    }

    if (!remoteStarted) {
      remoteGame.init({ autoStart: false })
      remoteStarted = true
    }

    roomLabel.textContent = `Room ${activeRoomId} · snapshot sync active`
    ensureSnapshotRelay()
  }

  socket.on("connect", () => {
    roomLabel.textContent = "서버에 연결되었습니다. 방을 준비하는 중..."

    if (mode === "join" && requestedRoomId) {
      socket.emit(events.ROOM_JOIN, { roomId: requestedRoomId }, (response) => {
        if (!response?.ok) {
          roomLabel.textContent = response?.reason ?? "방 입장에 실패했습니다."
          return
        }

        activeRoomId = response.roomId
        roomLabel.textContent = `Room ${activeRoomId} · 상대를 기다리는 중...`
        socket.emit(events.MATCH_READY, { roomId: activeRoomId, ready: true })
      })
      return
    }

    socket.emit(events.ROOM_CREATE, {}, (response) => {
      if (!response?.ok) {
        roomLabel.textContent = response?.reason ?? "방 생성에 실패했습니다."
        return
      }

      activeRoomId = response.roomId
      roomLabel.textContent = `Room ${activeRoomId} · 상대를 기다리는 중...`
      socket.emit(events.MATCH_READY, { roomId: activeRoomId, ready: true })
    })
  })

  socket.on(events.ROOM_STATE, (payload) => {
    if (!payload?.roomId) return
    activeRoomId = payload.roomId
    const playerCount = payload.players?.length ?? 0
    roomLabel.textContent = `Room ${activeRoomId} · players ${playerCount}/2`
  })

  socket.on(events.MATCH_START, (payload) => {
    if (!payload?.roomId || !Array.isArray(payload.bagChunks)) return
    activeRoomId = payload.roomId
    startMatch(payload.bagChunks)
  })

  socket.on(events.GAME_BAG_INIT, (payload) => {
    if (!payload?.roomId || !Array.isArray(payload.chunks) || !localGame || !remoteGame) return
    activeRoomId = payload.roomId
    localGame.applyServerBag(payload.chunks)
    remoteGame.applyServerBag(payload.chunks)
  })

  socket.on(events.GAME_BAG_APPEND, (payload) => {
    if (!payload?.roomId || !Array.isArray(payload.pieces)) return
    if (payload.roomId !== activeRoomId) return
    localGame?.appendServerBag(payload.pieces)
    remoteGame?.appendServerBag(payload.pieces)
  })

  socket.on(events.GAME_SNAPSHOT, (payload) => {
    if (!payload?.roomId || !payload.snapshot) return
    if (payload.roomId !== activeRoomId) return
    remoteGame?.applySnapshot(payload.snapshot)
  })

  socket.on("disconnect", () => {
    clearInterval(snapshotTimer)
    snapshotTimer = null
    roomLabel.textContent = "서버 연결이 끊어졌습니다."
  })

  let isUnmounted = false

  return () => {
    if (isUnmounted) return
    isUnmounted = true

    clearInterval(snapshotTimer)
    cleanupSound?.()
    socket.disconnect()
    localGame?.destroy()
    remoteGame?.destroy()
  }
}
