import { createTetrisRuntime } from "../runtime/tetris.js"
import { attachKeyboardInput } from "../runtime/input.js"
import { shouldCorrectSnapshot } from "../runtime/snapshotCorrection.js"
import {
    sendGameSnapshot,
    receiveSnapshot,
    receiveAuthoritativeSnapshot,
    onGameSnapshotResult,
    sendGameOver,
    onGameOverResult,
    sendGameInput,
    receiveGameInput,
    onGameInputResult,
    requestGameBagChunk,
    receiveGameBagAppend,
    onGameBagResult,
    sendGarbageAttack,
    receiveGarbageAppend,
    onGarbageResult,
} from "../../net/roomClient.js"
import { sendPlacementDecisionLog } from "../../net/logClient.js"

// off      snapshot 무시
// apply    항상 applySnapshot
// correct 다를 때만 applySnapshot
const SNAPSHOT_MODE = "correct"

function getPlayerBagChunks(match, targetPlayerId) {
    const matchPlayer = match?.players?.find(player => player.playerId === targetPlayerId)
    return Array.isArray(matchPlayer?.bagChunks) ? matchPlayer.bagChunks : null
}

/**
 * 멀티 게임 세션을 시작한다.
 * - 내 runtime, 상대 runtime, socket listener, snapshot timer, cleanup handle을 함께 구성한다.
 * - 현재 MVP에서는 내 보드는 로컬 입력으로 실행하고, 상대 보드는 input relay와 snapshot correction으로 보정한다.
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
            // 클라이언트가 계산한 배치 로그와 공격 줄을 서버에 보고하는 MVP 경계다.
            sendPlacementDecisionLog(roomId, playerId, log)
            const attackLines = log?.placementResult?.attackLines ?? 0
            if (attackLines > 0) {
                sendGarbageAttack(roomId, playerId, attackLines)
            }
        },
    })
    myGame.init({ autoStart: true, serverBagChunks: myBagChunks })
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
    // 상대 보드는 현재 input relay + snapshot correction 기반으로 예측 실행한다.
    // autoStart를 false로 두면 snapshot 도착 시점에만 갱신되어 움직임이 크게 끊긴다.
    // 서버 authoritative runtime으로 전환하기 전까지는 true를 유지한다.
    opponentGame.init({ autoStart: true, serverBagChunks: opponentBagChunks })

    let hasReportedGameOver = false
    let hasPendingBagRequest = false
    let hasReceivedOpponentAuthoritativeSnapshot = false
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

    function reportGameOverIfNeeded(snapshot) {
        if (!hasReportedGameOver && snapshot.phase === "gameOver") {
            hasReportedGameOver = true
            sendGameOver(roomId, playerId, "top_out")
        }
    }

    // 주기적으로 내 snapshot을 보내고, bag 보충과 game over 보고도 같은 heartbeat에서 처리한다.
    const snapshotTimer = setInterval(() => {
        const snapshot = myGame.getSnapshot()
        sendGameSnapshot(roomId, playerId, snapshot)
        requestBagIfNeeded()
        reportGameOverIfNeeded(snapshot)
    }, 500)

    const detachSnapshotResult = onGameSnapshotResult((result) => {
        if (result.ok) return
        console.warn("game:snapshot failed:", result.reason)
    })
    const detachReceiveSnapshot = receiveSnapshot(({ playerId: remotePlayerId, snapshot }) => {
        if (remotePlayerId === playerId) return
        if (remotePlayerId !== opponentPlayerId) return
        if (!snapshot || !Array.isArray(snapshot.board)) {
            console.error("Invalid snapshot from", remotePlayerId)
            return
        }
        if (hasReceivedOpponentAuthoritativeSnapshot) return

        // snapshot은 상대 runtime 보정용이다. 입력 relay보다 늦게 도착할 수 있어 모드별로 적용 범위를 제한한다.
        if (SNAPSHOT_MODE === "apply") {
            opponentGame.applySnapshot(snapshot)
            return
        }

        if (SNAPSHOT_MODE === "correct") {
            const localSnapshot = opponentGame.getSnapshot()

            if (shouldCorrectSnapshot(localSnapshot, snapshot)) {
                opponentGame.applySnapshot(snapshot)
            }
        }
    })
    const detachAuthoritativeSnapshot = receiveAuthoritativeSnapshot(({ playerId: remotePlayerId, snapshot }) => {
        if (remotePlayerId !== opponentPlayerId) return
        if (!snapshot || !Array.isArray(snapshot.board)) return

        opponentGame.applySnapshot(snapshot)
        hasReceivedOpponentAuthoritativeSnapshot = true
    })
    const detachGameOverResult = onGameOverResult((result) => {
        if (result.ok) return
        console.warn("game:over failed:", result.reason)
    })
    const detachGameInput = receiveGameInput(({ playerId: remotePlayerId, action, tick, pieceIndex }) => {
        if (remotePlayerId === playerId) return
        // 상대 입력은 상대 보드 runtime에 enqueue해서 먼저 예측 실행하고, 이후 snapshot으로 오차를 보정한다.
        opponentGame.enqueueInput(action, tick, pieceIndex)
    })
    const detachGameInputResult = onGameInputResult((result) => {
        if (result.ok) return
        console.warn("game:input failed:", result.reason)
    })
    const detachGarbageAppend = receiveGarbageAppend((payload) => {
        const { targetPlayerId, lines, holeCol } = payload
        if (targetPlayerId === playerId) {
            myGame.queueGarbageLines({ lines, holeCol })
            return
        }

        if (targetPlayerId === opponentPlayerId) {
            opponentGame.queueGarbageLines({ lines, holeCol })
        }
    })
    const detachGarbageResult = onGarbageResult((result) => {
        if (result.ok) return
        console.warn("game:garbage failed:", result.reason)
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
        snapshotTimer,
        detachSnapshotResult,
        detachReceiveSnapshot,
        detachAuthoritativeSnapshot,
        detachGameOverResult,
        detachGameInput,
        detachGameInputResult,
        detachGarbageAppend,
        detachGarbageResult,
        detachGameBagAppend,
        detachGameBagResult,
    }
}
