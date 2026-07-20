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

const AFTER_ACTION_TRANSFORM_INPUTS = new Set([
    "move_left",
    "move_right",
    "rotate",
])
const BEFORE_ACTION_TRANSFORM_INPUTS = new Set([
    "soft_drop",
    "hard_drop",
])

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
    mode = "multi",
    match,
    myCanvas,
    opponentCanvas,
    myNextPreviewEl,
    myHoldPreviewEl,
    myScoreEl,
    myLinesEl,
    myPendingGarbageEl,
    opponentNextPreviewEl,
    opponentHoldPreviewEl,
    opponentScoreEl,
    opponentLinesEl,
    opponentPendingGarbageEl,
    onUserInteract,
}) {
    const myBagChunks = getPlayerBagChunks(match, playerId)
    const opponentBagChunks = getPlayerBagChunks(match, opponentPlayerId)
    const gameId = match?.createdAt
        ? `${roomId}-${match.createdAt}`
        : roomId
    const pendingPlacementAttempts = new Map()
    const placementAttemptKeyByClientSequence = new Map()
    const settledPlacementAttemptKeys = new Set()
    let placementLogBufferClosed = false
    let hasAuthoritativeGameOver = false

    console.log("my bag chunks:", myBagChunks)
    console.log("opponent bag chunks:", opponentBagChunks)

    const myGame = createTetrisRuntime({
        boardCanvasEl: myCanvas,
        scoreEl: myScoreEl,
        linesEl: myLinesEl,
        pendingGarbageEl: myPendingGarbageEl,
        nextPreviewEl: myNextPreviewEl,
        holdPreviewEl: myHoldPreviewEl,
        mode: mode === "pve" ? "pve" : "multi",
        gameId,
        roomId,
        playerId,
        placementDecisionRecorder(log) {
            bufferLocalPlacementLog(log)
        },
        inputOutcomeRecorder: handleLocalInputOutcome,
    })
    myGame.init({ autoStart: true, serverBagChunks: myBagChunks })
    const myInitialSnapshot = getPlayerInitialSnapshot(match, playerId)
    if (myInitialSnapshot) {
        myGame.applySnapshot(myInitialSnapshot, { resumeGravity: true })
    }
    const initialClientSequence = Number.isInteger(myInitialSnapshot?.lastProcessedClientSequence)
        && myInitialSnapshot.lastProcessedClientSequence >= 0
        ? myInitialSnapshot.lastProcessedClientSequence
        : 0
    let nextClientSequence = initialClientSequence + 1
    let lastAcknowledgedClientSequence = initialClientSequence
    const pendingServerInputs = new Map()
    let deferredOwnSnapshot = null
    let pendingOwnDriftState = null
    let lastForcedResyncClientSequence = -1

    function createPlacementAttemptKey(pieceIndex, tick) {
        if (!Number.isInteger(pieceIndex) || pieceIndex < 0) return null
        if (!Number.isInteger(tick) || tick < 0) return null
        return `${pieceIndex}:${tick}`
    }

    function getOrCreatePlacementAttempt(key, pieceIndex, tick) {
        if (!key || placementLogBufferClosed || settledPlacementAttemptKeys.has(key)) return null
        if (!pendingPlacementAttempts.has(key)) {
            pendingPlacementAttempts.set(key, {
                pieceIndex,
                tick,
                log: null,
                clientSequence: null,
                authoritativeCommitted: false,
            })
        }
        return pendingPlacementAttempts.get(key)
    }

    function settlePlacementAttempt(key) {
        if (!key) return
        pendingPlacementAttempts.delete(key)
        settledPlacementAttemptKeys.add(key)
    }

    function flushPlacementAttempt(key) {
        const attempt = pendingPlacementAttempts.get(key)
        if (!attempt?.log || !attempt.authoritativeCommitted) return false
        if (!Number.isInteger(attempt.clientSequence)) return false

        sendPlacementDecisionLog(roomId, playerId, {
            ...attempt.log,
            authoritativeClientSequence: attempt.clientSequence,
            authoritativePieceIndex: attempt.pieceIndex,
        })
        settlePlacementAttempt(key)
        maybeClosePlacementLogBufferAfterGameOver()
        return true
    }

    function bufferLocalPlacementLog(log) {
        const key = createPlacementAttemptKey(log?.pieceIndex, log?.tick)
        const attempt = getOrCreatePlacementAttempt(key, log?.pieceIndex, log?.tick)
        if (!attempt || attempt.log) return

        attempt.log = log
        flushPlacementAttempt(key)
    }

    function registerTerminalPlacementInput(outcome, clientSequence) {
        if (outcome?.placementCommitted !== true) return

        const pieceIndex = outcome.input?.pieceIndex
        const tick = outcome.input?.tick
        const key = createPlacementAttemptKey(pieceIndex, tick)
        const attempt = getOrCreatePlacementAttempt(key, pieceIndex, tick)
        if (!attempt) return

        attempt.clientSequence = clientSequence
        placementAttemptKeyByClientSequence.set(clientSequence, key)
    }

    function discardPlacementLogBuffer({ close = false } = {}) {
        for (const key of pendingPlacementAttempts.keys()) {
            settledPlacementAttemptKeys.add(key)
        }
        pendingPlacementAttempts.clear()
        placementAttemptKeyByClientSequence.clear()
        if (close) placementLogBufferClosed = true
    }

    function handlePlacementInputResult(result) {
        const clientSequence = result?.clientSequence
        if (!Number.isInteger(clientSequence)) return

        const key = placementAttemptKeyByClientSequence.get(clientSequence)
        if (!key) return
        placementAttemptKeyByClientSequence.delete(clientSequence)

        const attempt = pendingPlacementAttempts.get(key)
        const placementCommitted = result?.ok === true
            && result?.placementCommitted === true
            && result?.pieceIndex === attempt?.pieceIndex
        if (!attempt || !placementCommitted) {
            settlePlacementAttempt(key)
            return
        }

        attempt.authoritativeCommitted = true
        flushPlacementAttempt(key)
    }

    function maybeClosePlacementLogBufferAfterGameOver() {
        if (!hasAuthoritativeGameOver || placementLogBufferClosed) return
        if (placementAttemptKeyByClientSequence.size > 0) return
        const awaitsDelayedLocalLog = [...pendingPlacementAttempts.values()].some(attempt => {
            return attempt.authoritativeCommitted && !attempt.log
        })
        if (awaitsDelayedLocalLog) return

        discardPlacementLogBuffer({ close: true })
    }

    function createExpectedTransform(outcome) {
        const piece = AFTER_ACTION_TRANSFORM_INPUTS.has(outcome.input.action)
            ? outcome.activePieceAfter
            : BEFORE_ACTION_TRANSFORM_INPUTS.has(outcome.input.action)
                ? outcome.activePieceBefore
                : null
        if (!piece?.pieceType) return null

        return {
            pieceType: piece.pieceType,
            rotation: piece.rotation,
            col: piece.col,
        }
    }

    function handleLocalInputOutcome(outcome) {
        if (!outcome?.applied || !outcome.input) return

        const expectedTransform = createExpectedTransform(outcome)
        const clientSequence = nextClientSequence
        nextClientSequence += 1
        registerTerminalPlacementInput(outcome, clientSequence)
        pendingServerInputs.set(clientSequence, {
            ...outcome.input,
            ...(expectedTransform ? { expectedTransform } : {}),
        })
        sendGameInput(
            roomId,
            playerId,
            outcome.input.action,
            outcome.input.tick,
            outcome.input.pieceIndex,
            clientSequence,
            expectedTransform,
        )
    }

    myGame.runtime.detachKeyboard = attachKeyboardInput({
        enqueueAction: (action) => {
            myGame.enqueueInput(action, null, myGame.runtime.pieceIndex)
        },
        onUserInteract,
    })

    const opponentGame = createTetrisRuntime({
        boardCanvasEl: opponentCanvas,
        scoreEl: opponentScoreEl,
        linesEl: opponentLinesEl,
        pendingGarbageEl: opponentPendingGarbageEl,
        nextPreviewEl: opponentNextPreviewEl,
        holdPreviewEl: opponentHoldPreviewEl,
        mode: mode === "pve" ? "pve" : "multi",
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
    let lastOpponentPresentationPieceIndex = -1
    let lastOpponentPresentationEffectId = null
    const bagLowWatermark = 7

    function acknowledgeServerInputs(clientSequence) {
        if (!Number.isInteger(clientSequence) || clientSequence < 0) return
        if (clientSequence >= nextClientSequence) return
        if (clientSequence <= lastAcknowledgedClientSequence) return

        lastAcknowledgedClientSequence = clientSequence
        for (const sequence of pendingServerInputs.keys()) {
            if (sequence <= clientSequence) {
                pendingServerInputs.delete(sequence)
            }
        }
    }

    function updateOwnPendingGarbage(snapshot) {
        if (Number.isInteger(snapshot.pendingGarbageLines)) {
            myGame.setAuthoritativePendingGarbageLines(snapshot.pendingGarbageLines)
        }
    }

    function deferOwnSnapshot(snapshot) {
        const incomingSequence = Number.isInteger(snapshot.lastProcessedClientSequence)
            ? snapshot.lastProcessedClientSequence
            : 0
        const deferredSequence = Number.isInteger(deferredOwnSnapshot?.lastProcessedClientSequence)
            ? deferredOwnSnapshot.lastProcessedClientSequence
            : -1

        if (!deferredOwnSnapshot || incomingSequence >= deferredSequence) {
            deferredOwnSnapshot = snapshot
        }
        pendingOwnDriftState = null
    }

    function evaluateOwnSnapshot(snapshot, localSnapshot = myGame.getSnapshot()) {
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
        }
    }

    function applyDeferredOwnSnapshotIfReady() {
        if (!deferredOwnSnapshot) return
        if (pendingServerInputs.size > 0 || myGame.getPendingInputCount() > 0) return

        const snapshot = deferredOwnSnapshot
        deferredOwnSnapshot = null
        const snapshotClientSequence = Number.isInteger(snapshot.lastProcessedClientSequence)
            && snapshot.lastProcessedClientSequence >= 0
            ? snapshot.lastProcessedClientSequence
            : 0
        if (snapshotClientSequence < lastAcknowledgedClientSequence) return

        evaluateOwnSnapshot(snapshot)
    }

    function applyForcedOwnSnapshot(result) {
        const snapshot = result?.snapshot
        const clientSequence = result?.clientSequence
        if (!snapshot || !Array.isArray(snapshot.board)) return false
        if (!Number.isInteger(clientSequence) || clientSequence < 0) return false
        if (clientSequence >= nextClientSequence) return false
        if (clientSequence <= lastForcedResyncClientSequence) return false

        const snapshotClientSequence = Number.isInteger(snapshot.lastProcessedClientSequence)
            ? snapshot.lastProcessedClientSequence
            : clientSequence
        if (snapshotClientSequence < lastAcknowledgedClientSequence) return false

        lastForcedResyncClientSequence = clientSequence
        updateOwnPendingGarbage(snapshot)
        discardPlacementLogBuffer()
        pendingServerInputs.clear()
        deferredOwnSnapshot = null
        pendingOwnDriftState = null
        myGame.applySnapshot(snapshot, {
            resumeGravity: true,
            clearInputQueue: true,
            cancelPresentation: true,
        })
        return true
    }

    function handleOwnAuthoritativeSnapshot(snapshot) {
        const localSnapshot = myGame.getSnapshot()
        const snapshotClientSequence = Number.isInteger(snapshot.lastProcessedClientSequence)
            && snapshot.lastProcessedClientSequence >= 0
            ? snapshot.lastProcessedClientSequence
            : 0

        if (snapshot.phase === "gameOver") {
            hasAuthoritativeGameOver = true
            updateOwnPendingGarbage(snapshot)
            acknowledgeServerInputs(snapshotClientSequence)
            pendingServerInputs.clear()
            deferredOwnSnapshot = null
            pendingOwnDriftState = null
            myGame.applySnapshot(snapshot, { resumeGravity: true })
            maybeClosePlacementLogBufferAfterGameOver()
            return
        }

        if (snapshotClientSequence < lastAcknowledgedClientSequence) return

        updateOwnPendingGarbage(snapshot)
        acknowledgeServerInputs(snapshotClientSequence)

        if (pendingServerInputs.size > 0 || myGame.getPendingInputCount() > 0) {
            deferOwnSnapshot(snapshot)
            return
        }

        deferredOwnSnapshot = null
        evaluateOwnSnapshot(snapshot, localSnapshot)
    }

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
            handleOwnAuthoritativeSnapshot(snapshot)
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
    const detachGameInputResultListener = onGameInputResult((result) => {
        handlePlacementInputResult(result)
        if (Number.isInteger(result?.clientSequence)) {
            acknowledgeServerInputs(result.clientSequence)
        }
        if (result?.reason === "PREDICTION_DIVERGED" && applyForcedOwnSnapshot(result)) {
            console.warn("game:input failed:", result.reason)
            return
        }
        if (Number.isInteger(result?.clientSequence)) {
            applyDeferredOwnSnapshotIfReady()
        }
        if (!result?.ok) {
            console.warn("game:input failed:", result?.reason)
        }
        maybeClosePlacementLogBufferAfterGameOver()
    })
    const detachGameInputResult = () => {
        detachGameInputResultListener()
        discardPlacementLogBuffer({ close: true })
        pendingServerInputs.clear()
        deferredOwnSnapshot = null
    }
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
