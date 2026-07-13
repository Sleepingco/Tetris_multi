import { createTetrisRuntime } from "../runtime/tetris.js"
import { attachKeyboardInput } from "../runtime/input.js"
import {
    receiveAuthoritativeSnapshot,
    sendGameInput,
    onGameInputResult,
    requestGameBagChunk,
    receiveGameBagAppend,
    onGameBagResult,
} from "../../net/roomClient.js"
import { sendPlacementDecisionLog } from "../../net/logClient.js"
import { evaluateOwnSnapshotCorrection } from "../runtime/snapshotCorrection.js"

function getPlayerBagChunks(match, targetPlayerId) {
    const matchPlayer = match?.players?.find(player => player.playerId === targetPlayerId)
    return Array.isArray(matchPlayer?.bagChunks) ? matchPlayer.bagChunks : null
}

function getPlayerInitialSnapshot(match, targetPlayerId) {
    const matchPlayer = match?.players?.find(player => player.playerId === targetPlayerId)
    return Array.isArray(matchPlayer?.snapshot?.board) ? matchPlayer.snapshot : null
}

/**
 * 멀티 게임 세션을 시작한다.
 * - 내 runtime, 상대 runtime, socket listener, heartbeat timer, cleanup handle을 함께 구성한다.
 * - 내 보드는 로컬 입력으로 예측 실행하고, 상대 보드는 server authoritative snapshot만 적용한다.
 *
 * @param {Object} params - 멀티 게임 세션 구성 요소
 * @returns {Object} runtime과 정리 함수를 포함한 게임 세션
 */
export function startMultiplayerGame({
    roomId,
    playerId,
    opponentPlayerId,
    match,
    myCanvas,
    opponentCanvas,
    myNextPreviewEl,
    myHoldPreviewEl,
    myScoreEl,
    myLinesEl,
    myPendingGarbageEl,
    myGarbageLogEl,
    opponentNextPreviewEl,
    opponentHoldPreviewEl,
    opponentScoreEl,
    opponentLinesEl,
    opponentPendingGarbageEl,
    opponentGarbageLogEl,
}) {
    const myBagChunks = getPlayerBagChunks(match, playerId)
    const opponentBagChunks = getPlayerBagChunks(match, opponentPlayerId)
    const gameId = match?.createdAt
        ? `${roomId}-${match.createdAt}`
        : roomId

    console.log("my bag chunks:", myBagChunks)
    console.log("opponent bag chunks:", opponentBagChunks)

    const myGame = createTetrisRuntime({
        boardCanvasEl: myCanvas,
        scoreEl: myScoreEl,
        linesEl: myLinesEl,
        pendingGarbageEl: myPendingGarbageEl,
        garbageLogEl: myGarbageLogEl,
        nextPreviewEl: myNextPreviewEl,
        holdPreviewEl: myHoldPreviewEl,
        mode: "multi",
        gameId,
        roomId,
        playerId,
        placementDecisionRecorder(log) {
            // 배치 로그는 분석/디버깅용으로 남기고, garbage 판정은 서버 lock 결과를 따른다.
            sendPlacementDecisionLog(roomId, playerId, log)
        },
    })
    myGame.init({ autoStart: true, serverBagChunks: myBagChunks })
    const myInitialSnapshot = getPlayerInitialSnapshot(match, playerId)
    if (myInitialSnapshot) {
        myGame.applySnapshot(myInitialSnapshot, { resumeGravity: true })
    }
    myGame.runtime.detachKeyboard = attachKeyboardInput({
        enqueueAction: (action) => {
            const input = myGame.enqueueInput(action, null, myGame.runtime.pieceIndex)
            if (!input) return

            sendGameInput(roomId, playerId, input.action, input.tick, input.pieceIndex)
        },
    })

    const opponentGame = createTetrisRuntime({
        boardCanvasEl: opponentCanvas,
        scoreEl: opponentScoreEl,
        linesEl: opponentLinesEl,
        pendingGarbageEl: opponentPendingGarbageEl,
        garbageLogEl: opponentGarbageLogEl,
        nextPreviewEl: opponentNextPreviewEl,
        holdPreviewEl: opponentHoldPreviewEl,
        mode: "multi",
        gameId,
        roomId,
        playerId: opponentPlayerId,
    })
    // 상대 보드는 서버 authoritative snapshot만 반영한다.
    opponentGame.init({ autoStart: false, serverBagChunks: opponentBagChunks })
    const opponentInitialSnapshot = getPlayerInitialSnapshot(match, opponentPlayerId)
    if (opponentInitialSnapshot) {
        opponentGame.applySnapshot(opponentInitialSnapshot)
    }

    let hasPendingBagRequest = false
    let pendingOwnDriftState = null
    let lastOpponentPresentationPieceIndex = -1
    let lastOpponentPresentationEffectId = null
    const bagLowWatermark = 7

    /**
     * server bag 잔량이 낮아지면 한 번만 추가 chunk를 요청한다.
     * - hasPendingBagRequest로 같은 구간의 중복 요청을 막는다.
     *
     * @returns {void}
     */
    function requestBagIfNeeded() {
        if (!hasPendingBagRequest && myGame.getServerBagRemainingCount() <= bagLowWatermark) {
            hasPendingBagRequest = true
            requestGameBagChunk(roomId, playerId)
        }
    }

    // 주기적으로 server bag 보충을 처리한다. game over 확정은 server authoritative 결과가 맡는다.
    const heartbeatTimer = setInterval(() => {
        requestBagIfNeeded()
    }, 500)

    const detachAuthoritativeSnapshot = receiveAuthoritativeSnapshot(({
        playerId: remotePlayerId,
        snapshot,
        presentationEffect,
    }) => {
        if (!snapshot || !Array.isArray(snapshot.board)) return

        if (remotePlayerId === opponentPlayerId) {
            opponentGame.applySnapshot(snapshot)
            if (shouldPlayOpponentPresentation(presentationEffect)) {
                const didPlay = opponentGame.playLineClearPresentation({
                    rows: presentationEffect.rows,
                    board: presentationEffect.boardBeforeClear,
                })
                if (didPlay) {
                    lastOpponentPresentationPieceIndex = presentationEffect.pieceIndex
                    lastOpponentPresentationEffectId = presentationEffect.id
                }
            }
            return
        }

        if (remotePlayerId === playerId) {
            const localSnapshot = myGame.getSnapshot()
            if (
                snapshot.phase !== "gameOver" &&
                myGame.getPendingInputCount() > 0
            ) {
                pendingOwnDriftState = null
                if (Number.isInteger(snapshot.pendingGarbageLines)) {
                    myGame.setAuthoritativePendingGarbageLines(snapshot.pendingGarbageLines)
                }
                return
            }
            const correctionDecision = evaluateOwnSnapshotCorrection(
                snapshot,
                localSnapshot,
                pendingOwnDriftState,
                globalThis.performance.now(),
            )
            pendingOwnDriftState = correctionDecision.nextPendingDriftState

            if (correctionDecision.shouldCorrect) {
                pendingOwnDriftState = null
                myGame.applySnapshot(snapshot, { resumeGravity: true })
                return
            }

            if (Number.isInteger(snapshot.pendingGarbageLines)) {
                myGame.setAuthoritativePendingGarbageLines(snapshot.pendingGarbageLines)
            }
        }
    })

    function shouldPlayOpponentPresentation(effect) {
        if (!effect || effect.type !== "line_clear") return false
        if (typeof effect.id !== "string" || effect.id.length === 0) return false
        if (!Number.isInteger(effect.pieceIndex) || effect.pieceIndex < 0) return false
        if (effect.id !== `${opponentPlayerId}:${effect.pieceIndex}:line_clear`) return false
        if (effect.id === lastOpponentPresentationEffectId) return false
        if (effect.pieceIndex <= lastOpponentPresentationPieceIndex) return false
        if (!Array.isArray(effect.rows) || !Array.isArray(effect.boardBeforeClear)) return false
        return true
    }
    const detachGameInputResult = onGameInputResult((result) => {
        if (result.ok) return
        console.warn("game:input failed:", result.reason)
    })
    const detachGameBagAppend = receiveGameBagAppend(({ playerId: bagPlayerId, bagChunk }) => {
        if (!Array.isArray(bagChunk)) return

        if (bagPlayerId === playerId) {
            myGame.appendServerBag(bagChunk)
            hasPendingBagRequest = false
            return
        }

        if (bagPlayerId === opponentPlayerId) {
            opponentGame.appendServerBag(bagChunk)
        }
    })
    const detachGameBagResult = onGameBagResult((result) => {
        if (result.ok) return
        hasPendingBagRequest = false
        console.warn("game:bag failed:", result.reason)
    })

    return {
        myGame,
        opponentGame,
        heartbeatTimer,
        detachAuthoritativeSnapshot,
        detachGameInputResult,
        detachGameBagAppend,
        detachGameBagResult,
    }
}
