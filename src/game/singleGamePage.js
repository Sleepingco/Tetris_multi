import { initGameSound, tryPlayMusic } from "./sound.js"
import { attachKeyboardInput } from "./input.js"
import { createTetrisRuntime } from "./tetris.js"

const boardCanvasEl = document.querySelector("canvas#tetrisBoardCanvas")
const multiCanvasEls = document.querySelectorAll("canvas.tetrisBoardCanvas")
const gameOverEl = document.querySelector(".game-text")
const scoreEl = document.querySelector(".score")
const restartBtn = document.querySelector(".game-text > button")
const nextPreviewEl = document.querySelector(".next-preview")
const holdPreviewEl = document.querySelector(".hold-preview")
const soundToggleBtn = document.getElementById("soundToggle")

const game = createTetrisRuntime({
    boardCanvasEl,
    multiCanvasEls,
    gameOverEl,
    scoreEl,
    nextPreviewEl,
    holdPreviewEl,
})

initGameSound(soundToggleBtn)
game.runtime.detachKeyboard = attachKeyboardInput({
    enqueueAction: game.enqueueInput,
    onUserInteract: tryPlayMusic,
})

restartBtn?.addEventListener("click", () => {
    game.hideGameOver()
    game.init()
})

game.init()
