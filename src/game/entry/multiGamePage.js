import { attachKeyboardInput } from "../runtime/input.js"
import { createTetrisRuntime } from "../runtime/tetris.js"

function getPlayerElements(playerId) {
    const root = document.querySelector(`.player-column[data-player="${playerId}"]`)
    if (!root) return null

    return {
        root,
        boardCanvasEl: root.querySelector("canvas.tetrisBoardCanvas"),
        gameOverEl: root.querySelector(".game-text"),
        scoreEl: root.querySelector(".score"),
        nextPreviewEl: root.querySelector(".next-preview"),
        holdPreviewEl: root.querySelector(".hold-preview"),
    }
}

const localElements = getPlayerElements("1")
const remoteElements = getPlayerElements("2")

const localGame = localElements
    ? createTetrisRuntime({
        boardCanvasEl: localElements.boardCanvasEl,
        gameOverEl: localElements.gameOverEl,
        scoreEl: localElements.scoreEl,
        nextPreviewEl: localElements.nextPreviewEl,
        holdPreviewEl: localElements.holdPreviewEl,
    })
    : null

const remoteGame = remoteElements
    ? createTetrisRuntime({
        boardCanvasEl: remoteElements.boardCanvasEl,
        gameOverEl: remoteElements.gameOverEl,
        scoreEl: remoteElements.scoreEl,
        nextPreviewEl: remoteElements.nextPreviewEl,
        holdPreviewEl: remoteElements.holdPreviewEl,
    })
    : null

if (localGame) {
    localGame.runtime.detachKeyboard = attachKeyboardInput({
        enqueueAction: localGame.enqueueInput,
        onUserInteract: () => {},
    })
    localGame.init()
}

if (remoteGame) {
    remoteGame.init({ autoStart: false })
}
