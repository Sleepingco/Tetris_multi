/**
 * Socket.IO 진입점부터 room/match/log service까지 이어지는 server multiplayer 경계를 검증한다.
 *
 * 준비: 실제 transport 대신 fake server/client를 연결하고, 필요할 때 ticker·session·game core 의존성을 주입한다.
 * 실행: room/chat/game/log/PVE event와 disconnect·재접속·동시 input 순서를 실제 handler에 전달한다.
 * 검증: socket session의 identity만 신뢰하고, payload를 domain 변경 전에 검증하며, 같은 player의
 * authoritative mutation은 FIFO로 처리되어야 한다. finish·저장 같은 단일 부수효과는
 * 중복 없이 한 번만 발생하고, event는 의도한 대상에게 전달되어야 한다.
 *
 * 이 파일의 fixture 배열은 화면 결과가 아니라 "어떤 socket이 어떤 event를 받았는가"를 관찰하기 위한 기록장이다.
 */
const test = require("node:test")
const assert = require("node:assert/strict")
const { mkdtemp, readFile, rm } = require("node:fs/promises")
const { tmpdir } = require("node:os")
const path = require("node:path")

const { registerSocketHandlers } = require("../dist/server/server/sockets/index.js")
const {
    handleDisconnectGraceExpired,
} = require("../dist/server/server/sockets/multiplayerHandlers.js")
const {
    applyGravityStepToMatchPlayerState,
    getAuthoritativePlayerSnapshot,
    getAuthoritativePlayerSnapshotDto,
    getMatchState,
    recordHumanPlacementReceipt,
} = require("../dist/server/server/services/matchService.js")
const { loadGameCore } = require("../dist/server/server/services/gameCoreLoader.js")
const {
    createAuthoritativeTickerService,
} = require("../dist/server/server/services/authoritativeTickerService.js")
const {
    createAuthoritativePlayerMutationQueue,
} = require("../dist/server/server/services/authoritativePlayerMutationQueue.js")
const {
    createPlayerSessionService,
} = require("../dist/server/server/services/playerSessionService.js")
const {
    clearRoomsForTest,
    findRoomByPlayerId,
    finishGame,
    getRoomState,
} = require("../dist/server/server/services/roomService.js")

test.beforeEach(clearRoomsForTest)

/**
 * Socket.IO Server의 connection 등록, room emit, 전체 broadcast만 재현한다.
 * 전송 내용을 배열에 남겨 실제 port 없이 수신 대상과 횟수를 검증한다.
 */
class FakeSocketServer {
    constructor() {
        this.handlers = new Map()
        this.roomEvents = []
        this.clients = []
    }

    on(eventName, handler) {
        this.handlers.set(eventName, handler)
    }

    to(roomId) {
        return {
            emit: (eventName, payload) => {
                this.roomEvents.push({ roomId, eventName, payload })
            },
        }
    }

    emit(eventName, payload) {
        this.clients.forEach(socket => socket.emit(eventName, payload))
    }

    connect(clientSocket) {
        clientSocket.socketServer = this
        this.clients.push(clientSocket)
        this.handlers.get("connection")(clientSocket)
    }
}

/**
 * 한 browser socket의 인증 data, 가입 room, client 수신 event를 분리해 기록한다.
 * 여러 instance를 만들면 host/guest와 stale/new socket의 권한 차이를 재현할 수 있다.
 */
class FakeClientSocket {
    constructor(id) {
        this.id = id
        this.data = {
            playerSession: {
                playerId: null,
                generation: 1,
            },
            playerIdentity: {
                playerId: null,
                nickname: null,
            },
        }
        this.handlers = new Map()
        this.clientEvents = []
        this.socketRoomEvents = []
        this.joinedRooms = []
        this.leftRooms = []
    }

    on(eventName, handler) {
        const handlers = this.handlers.get(eventName) || []
        handlers.push(handler)
        this.handlers.set(eventName, handlers)
    }

    emit(eventName, payload) {
        this.clientEvents.push({ eventName, payload })
    }

    join(roomId) {
        if (this.joinedRooms.includes(roomId)) return
        this.joinedRooms.push(roomId)
    }

    leave(roomId) {
        this.leftRooms.push(roomId)
    }

    to(roomId) {
        return {
            emit: (eventName, payload) => {
                this.socketRoomEvents.push({ roomId, eventName, payload })
                this.socketServer.clients
                    .filter(socket => socket !== this)
                    .filter(socket => socket.joinedRooms.includes(roomId))
                    .forEach(socket => socket.emit(eventName, payload))
            },
        }
    }

    trigger(eventName, payload) {
        this.setInitialIdentity(payload)
        const wirePayload = this.createWirePayload(payload)
        const handlers = this.handlers.get(eventName) || []
        handlers.forEach(handler => handler(wirePayload))
    }

    async triggerAsync(eventName, payload) {
        this.setInitialIdentity(payload)
        const wirePayload = this.createWirePayload(payload)
        const handlers = this.handlers.get(eventName) || []
        await Promise.all(handlers.map(handler => handler(wirePayload)))
    }

    triggerRaw(eventName, payload) {
        const handlers = this.handlers.get(eventName) || []
        handlers.forEach(handler => handler(payload))
    }

    lastClientEvent(eventName) {
        return this.clientEvents.findLast(event => event.eventName === eventName)
    }

    setInitialIdentity(payload) {
        if (this.data.playerIdentity.playerId) return

        const player = payload?.player || payload
        const playerId = player?.playerId || payload?.log?.playerId
        if (!playerId) return

        this.data.playerSession.playerId = playerId
        this.data.playerIdentity.playerId = playerId
        this.data.playerIdentity.nickname = player?.nickname || "Player"
    }

    createWirePayload(payload) {
        if (!payload || typeof payload !== "object" || Array.isArray(payload)) return payload

        const {
            player: _player,
            playerId: _playerId,
            nickname: _nickname,
            ...wirePayload
        } = payload
        return wirePayload
    }
}

function createNoopAuthoritativeTickerService() {
    return {
        startRoomTicker() {
            return { ok: true, started: false }
        },
        stopRoomTicker() {
            return { ok: true, stopped: false }
        },
        stopAllRoomTickers() {},
    }
}

function saveTestLog(log) {
    return {
        ok: true,
        log,
        reason: null,
    }
}

function createDeferred() {
    let resolve
    let reject
    const promise = new Promise((resolvePromise, rejectPromise) => {
        resolve = resolvePromise
        reject = rejectPromise
    })

    return { promise, resolve, reject }
}

function registerTestSocketHandlers(socketServer, dependencies = {}) {
    return registerSocketHandlers(socketServer, {
        gameStartCountdownMs: 0,
        authoritativeTickerService: createNoopAuthoritativeTickerService(),
        saveGameEventLog: saveTestLog,
        savePlacementDecisionLog: saveTestLog,
        playerSessionService: {
            cleanupExpired() {},
            isActiveSocket() {
                return true
            },
            isDisconnectedSession() {
                return false
            },
            markDisconnected() {
                return false
            },
        },
        socketRateLimitService: {
            cleanupExpired() {},
            consume() {
                return true
            },
        },
        ...dependencies,
    })
}

function createLineClearBoard(gameCore, piece, rowsToClear) {
    const board = gameCore.createEmptyBoard(gameCore.BOARD_ROWS, gameCore.BOARD_COLS)
    const pieceCells = new Set(gameCore.BLOCKS[piece.pieceType][piece.rotation].map(([offsetX, offsetY]) => {
        return `${piece.row + offsetY}:${piece.col + offsetX}`
    }))

    rowsToClear.forEach((row) => {
        board[row] = Array(gameCore.BOARD_COLS).fill("stack")
    })
    pieceCells.forEach((cellKey) => {
        const [row, col] = cellKey.split(":").map(Number)
        if (rowsToClear.includes(row)) {
            board[row][col] = null
        }
    })

    return board
}

function prepareTopOutState(gameCore, match, playerId) {
    const player = match.players.find((matchPlayer) => {
        return matchPlayer.playerId === playerId
    })

    player.authoritativeState.board = gameCore.createEmptyBoard(gameCore.BOARD_ROWS, gameCore.BOARD_COLS)
    player.authoritativeState.board[0] = Array(gameCore.BOARD_COLS).fill("stack")
    player.authoritativeState.activePiece = {
        pieceType: "tree",
        rotation: 1,
        row: -1,
        col: 4,
    }
    player.authoritativeState.pendingPiece = { ...player.authoritativeState.activePiece }
    player.authoritativeState.pieceQueue = ["square"]
    player.authoritativeState.pieceIndex = 1

    return player
}

async function createStartedPvpSocketFixture(prefix, dependencies = {}) {
    const socketServer = new FakeSocketServer()
    const hostSocket = new FakeClientSocket(`${prefix}-host-socket`)
    const guestSocket = new FakeClientSocket(`${prefix}-guest-socket`)

    registerTestSocketHandlers(socketServer, dependencies)
    socketServer.connect(hostSocket)
    socketServer.connect(guestSocket)

    const hostPlayerId = `${prefix}-host-player`
    const guestPlayerId = `${prefix}-guest-player`
    hostSocket.trigger("room:create", {
        playerId: hostPlayerId,
        nickname: "Host",
    })
    const roomId = hostSocket.lastClientEvent("room:result").payload.room.roomId
    guestSocket.trigger("room:join", {
        roomId,
        player: {
            playerId: guestPlayerId,
            nickname: "Guest",
        },
    })
    await hostSocket.triggerAsync("room:start", {
        roomId,
        playerId: hostPlayerId,
    })

    const match = getMatchState(roomId).match
    const hostPlayer = match.players.find(player => player.playerId === hostPlayerId)
    const guestPlayer = match.players.find(player => player.playerId === guestPlayerId)

    return {
        socketServer,
        hostSocket,
        guestSocket,
        roomId,
        hostPlayerId,
        guestPlayerId,
        match,
        hostPlayer,
        guestPlayer,
    }
}

function setAuthoritativePieceFixture(gameCore, player, piece) {
    player.authoritativeState.board = gameCore.createEmptyBoard(
        gameCore.BOARD_ROWS,
        gameCore.BOARD_COLS,
    )
    player.authoritativeState.activePiece = { ...piece }
    player.authoritativeState.pendingPiece = { ...piece }
    player.authoritativeState.pieceQueue = ["square", "bar"]
    player.authoritativeState.pieceIndex = 1
    player.authoritativeState.phase = "playing"
}

function getExpectedLockedPiece(gameCore, board, piece) {
    const row = gameCore.getHardDropRow(piece, targetRow => {
        return gameCore.canPlacePiece(board, {
            ...piece,
            row: targetRow,
        }, gameCore.BLOCKS)
    })

    return { ...piece, row }
}

function getPieceCells(gameCore, piece) {
    return gameCore.BLOCKS[piece.pieceType][piece.rotation]
        .map(([offsetX, offsetY]) => [piece.row + offsetY, piece.col + offsetX])
        .sort(([rowA, colA], [rowB, colB]) => rowA - rowB || colA - colB)
}

function getBoardCells(board, pieceType) {
    const cells = []
    board.forEach((row, rowIndex) => {
        row.forEach((cell, colIndex) => {
            if (cell === pieceType) cells.push([rowIndex, colIndex])
        })
    })
    return cells
}

function createExpectedTransform(piece, overrides = {}) {
    return {
        pieceType: piece.pieceType,
        rotation: piece.rotation,
        col: piece.col,
        ...overrides,
    }
}

function createPlacementResult(overrides = {}) {
    return {
        linesCleared: 0,
        isTSpin: false,
        combo: 0,
        backToBack: false,
        rawAttackLines: 0,
        attackLines: 0,
        canceledGarbageLines: 0,
        incomingGarbageLines: 0,
        appliedGarbageLines: 0,
        scoreBefore: 100,
        scoreAfter: 100,
        scoreDelta: 0,
        gameOver: false,
        ...overrides,
    }
}

function createHumanPlacementLogV1(roomId, overrides = {}) {
    return {
        eventType: "placement_decision",
        schemaVersion: 1,
        gameId: `${roomId}-game`,
        pieceIndex: 2,
        authoritativeClientSequence: 1,
        authoritativePieceIndex: 2,
        boardBefore: [[null]],
        boardAfter: [["square"]],
        selectedPlacement: {
            pieceType: "square",
            rotation: 0,
            row: 18,
            col: 4,
        },
        placementResult: createPlacementResult(),
        ...overrides,
    }
}

function createHumanPlacementLogV2(roomId, overrides = {}) {
    const cells = [
        { row: 0, col: 0, x: 0, y: 0 },
        { row: 0, col: 1, x: 1, y: 0 },
        { row: 1, col: 0, x: 0, y: 1 },
        { row: 1, col: 1, x: 1, y: 1 },
    ]
    const placement = {
        type: "square",
        pieceType: "square",
        rotation: 0,
        row: 0,
        col: 0,
        x: 0,
        y: 0,
        cells,
    }
    const metricsBefore = {
        columnHeights: [0, 0],
        aggregateHeight: 0,
        maxHeight: 0,
        holes: 0,
        bumpiness: 0,
        completeLines: 0,
    }

    return {
        eventType: "placement_decision",
        schemaVersion: 2,
        playerId: "untrusted-player",
        gameId: `${roomId}-game`,
        roomId,
        source: "human",
        modelType: null,
        tick: 10,
        pieceIndex: 3,
        authoritativeClientSequence: 1,
        authoritativePieceIndex: 3,
        createdAt: 1,
        boardBefore: [[null, null], [null, null]],
        boardAfter: [["square", "square"], ["square", "square"]],
        activePiece: placement,
        nextQueue: ["bar", "tree"],
        holdPiece: null,
        selectedPlacement: placement,
        placementResult: createPlacementResult({
            linesCleared: 2,
            scoreBefore: 0,
            scoreAfter: 300,
            scoreDelta: 300,
        }),
        metricsBefore,
        metricsAfter: {
            ...metricsBefore,
            columnHeights: [2, 2],
            aggregateHeight: 4,
            maxHeight: 2,
            completeLines: 2,
        },
        evaluation: {
            score: 20,
            candidateCount: 1,
            reason: {
                linesCleared: 2,
                holesDelta: 0,
                bumpinessDelta: 0,
                aggregateHeightDelta: 4,
                maxHeightDelta: 2,
            },
        },
        aiComparison: {
            heuristicPlacement: placement,
            heuristicScore: 20,
            userScore: 20,
            betterBy: 0,
            samePlacement: true,
        },
        ...overrides,
    }
}

test("malformed expectedTransform은 state 변경 전에 거부된다", async () => {
    const gameCore = await loadGameCore()
    const fixture = await createStartedPvpSocketFixture("invalid-expected-transform")
    setAuthoritativePieceFixture(gameCore, fixture.hostPlayer, {
        pieceType: "tree",
        rotation: 0,
        row: 0,
        col: 3,
    })
    const stateBefore = structuredClone(fixture.hostPlayer.authoritativeState)

    await fixture.hostSocket.triggerAsync("game:input", {
        roomId: fixture.roomId,
        playerId: fixture.hostPlayerId,
        action: "move_left",
        tick: 1,
        pieceIndex: 1,
        clientSequence: 1,
    })
    assert.equal(
        fixture.hostSocket.lastClientEvent("game:input:result")?.payload.reason,
        "INVALID_PAYLOAD",
    )

    await fixture.hostSocket.triggerAsync("game:input", {
        roomId: fixture.roomId,
        playerId: fixture.hostPlayerId,
        action: "move_left",
        tick: 1,
        pieceIndex: 1,
        clientSequence: 1,
        expectedTransform: {
            pieceType: "invalid",
            rotation: 0,
            col: 2,
        },
    })

    assert.deepEqual(fixture.hostSocket.lastClientEvent("game:input:result")?.payload, {
        ok: false,
        reason: "INVALID_PAYLOAD",
        clientSequence: 1,
        pieceIndex: 1,
        placementCommitted: false,
    })
    assert.deepEqual(fixture.hostPlayer.authoritativeState, stateBefore)
})

test("soft_drop의 malformed expectedTransform은 state 변경 전에 거부된다", async () => {
    const gameCore = await loadGameCore()
    const fixture = await createStartedPvpSocketFixture("invalid-soft-drop-transform")
    setAuthoritativePieceFixture(gameCore, fixture.hostPlayer, {
        pieceType: "square",
        rotation: 0,
        row: 18,
        col: 4,
    })
    const stateBefore = structuredClone(fixture.hostPlayer.authoritativeState)

    await fixture.hostSocket.triggerAsync("game:input", {
        roomId: fixture.roomId,
        playerId: fixture.hostPlayerId,
        action: "soft_drop",
        tick: 1,
        pieceIndex: 1,
        clientSequence: 1,
    })

    assert.deepEqual(fixture.hostSocket.lastClientEvent("game:input:result")?.payload, {
        ok: false,
        reason: "INVALID_PAYLOAD",
        clientSequence: 1,
        pieceIndex: 1,
        placementCommitted: false,
    })
    assert.deepEqual(fixture.hostPlayer.authoritativeState, stateBefore)
})

test("local 성공 transform이 server에서 MOVE_RETRY면 snapshot을 포함한 divergence가 된다", async () => {
    const gameCore = await loadGameCore()
    const fixture = await createStartedPvpSocketFixture("move-retry-divergence")
    const activePiece = {
        pieceType: "tree",
        rotation: 0,
        row: 0,
        col: 3,
    }
    setAuthoritativePieceFixture(gameCore, fixture.hostPlayer, activePiece)
    fixture.hostPlayer.authoritativeState.board[1][2] = "stack"

    await fixture.hostSocket.triggerAsync("game:input", {
        roomId: fixture.roomId,
        playerId: fixture.hostPlayerId,
        action: "move_left",
        tick: 1,
        pieceIndex: 1,
        clientSequence: 1,
        expectedTransform: createExpectedTransform(activePiece, { col: 2 }),
    })

    const result = fixture.hostSocket.lastClientEvent("game:input:result")?.payload
    assert.equal(result.ok, false)
    assert.equal(result.reason, "PREDICTION_DIVERGED")
    assert.equal(result.clientSequence, 1)
    assert.equal(result.snapshot.lastProcessedClientSequence, 1)
    assert.deepEqual(result.snapshot.activePiece, activePiece)
    assert.equal(fixture.hostPlayer.lastProcessedClientSequence, 1)
    assert.equal(fixture.hostPlayer.authoritativeState.board[1][2], "stack")
})

test("server move 결과가 expectedTransform과 다르면 계산 결과를 유지하고 divergence를 반환한다", async () => {
    const gameCore = await loadGameCore()
    const fixture = await createStartedPvpSocketFixture("move-result-divergence")
    const activePiece = {
        pieceType: "tree",
        rotation: 0,
        row: 0,
        col: 3,
    }
    setAuthoritativePieceFixture(gameCore, fixture.hostPlayer, activePiece)

    await fixture.hostSocket.triggerAsync("game:input", {
        roomId: fixture.roomId,
        playerId: fixture.hostPlayerId,
        action: "move_left",
        tick: 1,
        pieceIndex: 1,
        clientSequence: 1,
        expectedTransform: createExpectedTransform(activePiece, { col: 1 }),
    })

    const result = fixture.hostSocket.lastClientEvent("game:input:result")?.payload
    assert.equal(result.ok, false)
    assert.equal(result.reason, "PREDICTION_DIVERGED")
    assert.equal(result.snapshot.activePiece.col, 2)
    assert.equal(fixture.hostPlayer.authoritativeState.activePiece.col, 2)
    assert.equal(fixture.hostPlayer.authoritativeState.expectedTransform, undefined)
    assert.equal(fixture.hostPlayer.lastProcessedClientSequence, 1)
})

test("server rotate 결과가 expectedTransform과 다르면 계산 결과를 유지하고 divergence를 반환한다", async () => {
    const gameCore = await loadGameCore()
    const fixture = await createStartedPvpSocketFixture("rotate-result-divergence")
    const activePiece = {
        pieceType: "tree",
        rotation: 0,
        row: 0,
        col: 3,
    }
    setAuthoritativePieceFixture(gameCore, fixture.hostPlayer, activePiece)

    await fixture.hostSocket.triggerAsync("game:input", {
        roomId: fixture.roomId,
        playerId: fixture.hostPlayerId,
        action: "rotate",
        tick: 1,
        pieceIndex: 1,
        clientSequence: 1,
        expectedTransform: createExpectedTransform(activePiece, { rotation: 2 }),
    })

    const result = fixture.hostSocket.lastClientEvent("game:input:result")?.payload
    assert.equal(result.ok, false)
    assert.equal(result.reason, "PREDICTION_DIVERGED")
    assert.equal(result.snapshot.activePiece.rotation, 1)
    assert.equal(fixture.hostPlayer.authoritativeState.activePiece.rotation, 1)
    assert.equal(fixture.hostPlayer.lastProcessedClientSequence, 1)
})

test("hard_drop transform mismatch는 board와 pieceIndex를 변경하지 않고 ack한다", async () => {
    const gameCore = await loadGameCore()
    const fixture = await createStartedPvpSocketFixture("hard-drop-divergence")
    const activePiece = {
        pieceType: "tree",
        rotation: 1,
        row: 4,
        col: 3,
    }
    setAuthoritativePieceFixture(gameCore, fixture.hostPlayer, activePiece)
    const stateBefore = structuredClone(fixture.hostPlayer.authoritativeState)

    await fixture.hostSocket.triggerAsync("game:input", {
        roomId: fixture.roomId,
        playerId: fixture.hostPlayerId,
        action: "hard_drop",
        tick: 1,
        pieceIndex: 1,
        clientSequence: 1,
        expectedTransform: createExpectedTransform(activePiece, { col: 2 }),
    })

    const result = fixture.hostSocket.lastClientEvent("game:input:result")?.payload
    assert.equal(result.ok, false)
    assert.equal(result.reason, "PREDICTION_DIVERGED")
    assert.equal(result.clientSequence, 1)
    assert.equal(result.pieceIndex, 1)
    assert.equal(result.snapshot.lastProcessedClientSequence, 1)
    assert.deepEqual(fixture.hostPlayer.authoritativeState, stateBefore)
    assert.equal(fixture.hostPlayer.lastProcessedClientSequence, 1)

    await fixture.hostSocket.triggerAsync("game:input", {
        roomId: fixture.roomId,
        playerId: fixture.hostPlayerId,
        action: "move_left",
        tick: 2,
        pieceIndex: 1,
        clientSequence: 2,
        expectedTransform: createExpectedTransform(activePiece, { col: 2 }),
    })
    assert.equal(fixture.hostSocket.lastClientEvent("game:input:result")?.payload.ok, true)
    assert.equal(fixture.hostPlayer.authoritativeState.activePiece.col, 2)
    assert.equal(fixture.hostPlayer.lastProcessedClientSequence, 2)
})

test("soft_drop transform mismatch는 lock 전에 state를 보존하고 ack한다", async () => {
    const gameCore = await loadGameCore()
    const fixture = await createStartedPvpSocketFixture("soft-drop-divergence")
    const activePiece = {
        pieceType: "square",
        rotation: 0,
        row: 18,
        col: 4,
    }
    setAuthoritativePieceFixture(gameCore, fixture.hostPlayer, activePiece)
    const stateBefore = structuredClone(fixture.hostPlayer.authoritativeState)

    await fixture.hostSocket.triggerAsync("game:input", {
        roomId: fixture.roomId,
        playerId: fixture.hostPlayerId,
        action: "soft_drop",
        tick: 1,
        pieceIndex: 1,
        clientSequence: 1,
        expectedTransform: createExpectedTransform(activePiece, { col: 3 }),
    })

    const result = fixture.hostSocket.lastClientEvent("game:input:result")?.payload
    assert.equal(result.ok, false)
    assert.equal(result.reason, "PREDICTION_DIVERGED")
    assert.equal(result.snapshot.lastProcessedClientSequence, 1)
    assert.deepEqual(fixture.hostPlayer.authoritativeState, stateBefore)
    assert.equal(fixture.hostPlayer.lastProcessedClientSequence, 1)
})

test("soft_drop expectedTransform의 unknown row는 lock 전에 거부한다", async () => {
    const gameCore = await loadGameCore()
    const fixture = await createStartedPvpSocketFixture("soft-drop-row-ignored")
    const activePiece = {
        pieceType: "square",
        rotation: 0,
        row: 18,
        col: 4,
    }
    setAuthoritativePieceFixture(gameCore, fixture.hostPlayer, activePiece)

    await fixture.hostSocket.triggerAsync("game:input", {
        roomId: fixture.roomId,
        playerId: fixture.hostPlayerId,
        action: "soft_drop",
        tick: 1,
        pieceIndex: 1,
        clientSequence: 1,
        expectedTransform: createExpectedTransform(activePiece, { row: -999 }),
    })

    const result = fixture.hostSocket.lastClientEvent("game:input:result")?.payload
    assert.equal(result.ok, false)
    assert.equal(result.reason, "INVALID_PAYLOAD")
    assert.deepEqual(getBoardCells(fixture.hostPlayer.authoritativeState.board, "square"), [])
    assert.equal(fixture.hostPlayer.authoritativeState.pieceIndex, 1)
})

test("hard_drop expectedTransform의 unknown row는 lock 전에 거부한다", async () => {
    const gameCore = await loadGameCore()
    const fixture = await createStartedPvpSocketFixture("hard-drop-row-ignored")
    const activePiece = {
        pieceType: "tree",
        rotation: 1,
        row: 4,
        col: 2,
    }
    setAuthoritativePieceFixture(gameCore, fixture.hostPlayer, activePiece)
    await fixture.hostSocket.triggerAsync("game:input", {
        roomId: fixture.roomId,
        playerId: fixture.hostPlayerId,
        action: "hard_drop",
        tick: 1,
        pieceIndex: 1,
        clientSequence: 1,
        expectedTransform: createExpectedTransform(activePiece, { row: -999 }),
    })

    const result = fixture.hostSocket.lastClientEvent("game:input:result")?.payload
    assert.equal(result.ok, false)
    assert.equal(result.reason, "INVALID_PAYLOAD")
    assert.deepEqual(getBoardCells(fixture.hostPlayer.authoritativeState.board, "tree"), [])
    assert.equal(fixture.hostPlayer.authoritativeState.pieceIndex, 1)
    assert.equal(fixture.hostPlayer.authoritativeState.expectedTransform, undefined)
})

async function sendInputsWithoutWaiting(hostSocket, {
    roomId,
    playerId,
    pieceIndex,
    actions,
    expectedTransforms,
}) {
    const requests = actions.map((action, index) => {
        return hostSocket.triggerAsync("game:input", {
            roomId,
            playerId,
            action,
            tick: index + 1,
            pieceIndex,
            clientSequence: index + 1,
            expectedTransform: expectedTransforms[index],
        })
    })
    await Promise.all(requests)

    return hostSocket.clientEvents
        .filter(event => event.eventName === "game:input:result")
        .map(event => event.payload)
}

test("queued move divergence 뒤 soft_drop과 hard_drop은 stale transform에서 lock하지 않는다", async (t) => {
    const gameCore = await loadGameCore()

    for (const terminalAction of ["soft_drop", "hard_drop"]) {
        await t.test(terminalAction, async () => {
            const fixture = await createStartedPvpSocketFixture(`queued-${terminalAction}-divergence`)
            const activePiece = {
                pieceType: "tree",
                rotation: 0,
                row: 0,
                col: 3,
            }
            setAuthoritativePieceFixture(gameCore, fixture.hostPlayer, activePiece)
            fixture.hostPlayer.authoritativeState.board[1][2] = "stack"
            const stateBefore = structuredClone(fixture.hostPlayer.authoritativeState)
            const expectedTransform = createExpectedTransform(activePiece, { col: 2 })

            const results = await sendInputsWithoutWaiting(fixture.hostSocket, {
                roomId: fixture.roomId,
                playerId: fixture.hostPlayerId,
                pieceIndex: 1,
                actions: ["move_left", terminalAction],
                expectedTransforms: [expectedTransform, expectedTransform],
            })

            assert.deepEqual(results.map(result => ({
                clientSequence: result.clientSequence,
                ok: result.ok,
                reason: result.reason,
            })), [
                { clientSequence: 1, ok: false, reason: "PREDICTION_DIVERGED" },
                { clientSequence: 2, ok: false, reason: "PREDICTION_DIVERGED" },
            ])
            assert.deepEqual(fixture.hostPlayer.authoritativeState, stateBefore)
            assert.equal(fixture.hostPlayer.lastProcessedClientSequence, 2)

            await fixture.hostSocket.triggerAsync("game:input", {
                roomId: fixture.roomId,
                playerId: fixture.hostPlayerId,
                action: "soft_drop",
                tick: 3,
                pieceIndex: 1,
                clientSequence: 3,
                expectedTransform: createExpectedTransform(activePiece),
            })
            assert.equal(fixture.hostSocket.lastClientEvent("game:input:result")?.payload.ok, true)
            assert.equal(fixture.hostPlayer.authoritativeState.activePiece.row, 1)
            assert.equal(fixture.hostPlayer.lastProcessedClientSequence, 3)
        })
    }
})

test("pending socket input 뒤의 같은 player gravity는 shared mutation queue에서 FIFO로 실행된다", async () => {
    const socketServer = new FakeSocketServer()
    const hostSocket = new FakeClientSocket("mutation-queue-host-socket")
    const guestSocket = new FakeClientSocket("mutation-queue-guest-socket")
    const mutationQueue = createAuthoritativePlayerMutationQueue()
    const inputCoreLoadStarted = createDeferred()
    const releaseInputCoreLoad = createDeferred()
    const gameCore = await loadGameCore()
    const gravityCalls = []
    const tickerService = createAuthoritativeTickerService({
        authoritativePlayerMutationQueue: mutationQueue,
        setIntervalFn() {
            return { unref() {} }
        },
        clearIntervalFn() {},
        loadGameCore: async () => gameCore,
        applyGravityStepToMatchPlayerState(roomId, playerId, core) {
            gravityCalls.push(playerId)
            return applyGravityStepToMatchPlayerState(roomId, playerId, core)
        },
        saveGameEventLog: saveTestLog,
    })

    registerTestSocketHandlers(socketServer, {
        authoritativePlayerMutationQueue: mutationQueue,
        authoritativeTickerService: tickerService,
        async loadGameCore() {
            inputCoreLoadStarted.resolve()
            return releaseInputCoreLoad.promise
        },
    })
    socketServer.connect(hostSocket)
    socketServer.connect(guestSocket)

    hostSocket.trigger("room:create", {
        playerId: "mutation-queue-host-player",
        nickname: "Host",
    })
    const roomId = hostSocket.lastClientEvent("room:result").payload.room.roomId
    guestSocket.trigger("room:join", {
        roomId,
        player: {
            playerId: "mutation-queue-guest-player",
            nickname: "Guest",
        },
    })
    await hostSocket.triggerAsync("room:start", {
        roomId,
        playerId: "mutation-queue-host-player",
    })

    const match = getMatchState(roomId).match
    const hostPlayer = match.players.find(player => {
        return player.playerId === "mutation-queue-host-player"
    })
    const guestPlayer = match.players.find(player => {
        return player.playerId === "mutation-queue-guest-player"
    })
    const stateBeforeInput = structuredClone(hostPlayer.authoritativeState)
    const guestStateBeforeGravity = structuredClone(guestPlayer.authoritativeState)
    const inputResultPromise = hostSocket.triggerAsync("game:input", {
        roomId,
        playerId: hostPlayer.playerId,
        action: "move_left",
        tick: 1,
        pieceIndex: stateBeforeInput.pieceIndex,
        clientSequence: 1,
        expectedTransform: createExpectedTransform(stateBeforeInput.activePiece, {
            col: stateBeforeInput.activePiece.col - 1,
        }),
    })
    await inputCoreLoadStarted.promise

    const gravityResultPromise = tickerService.tickRoom(roomId, socketServer, 500)
    await Promise.resolve()
    await Promise.resolve()

    const guestSnapshotBeforeRelease = socketServer.roomEvents.findLast(event => {
        return event.eventName === "game:authoritative:snapshot"
            && event.payload.playerId === guestPlayer.playerId
    })
    assert.deepEqual(gravityCalls, [guestPlayer.playerId])
    assert.deepEqual(hostPlayer.authoritativeState, stateBeforeInput)
    assert.equal(
        guestPlayer.authoritativeState.activePiece.row,
        guestStateBeforeGravity.activePiece.row + 1,
    )
    assert.equal(
        guestSnapshotBeforeRelease.payload.snapshot.activePiece.row,
        guestStateBeforeGravity.activePiece.row + 1,
    )

    releaseInputCoreLoad.resolve(gameCore)
    await Promise.all([inputResultPromise, gravityResultPromise])

    assert.equal(hostPlayer.authoritativeState.activePiece.col, stateBeforeInput.activePiece.col - 1)
    assert.equal(hostPlayer.authoritativeState.activePiece.row, stateBeforeInput.activePiece.row + 1)
    assert.equal(hostPlayer.authoritativeState.pieceIndex, stateBeforeInput.pieceIndex)
    assert.equal(hostPlayer.lastProcessedClientSequence, 1)
    assert.deepEqual(gravityCalls, [guestPlayer.playerId, hostPlayer.playerId])
    const hostSnapshots = socketServer.roomEvents.filter(event => {
        return event.eventName === "game:authoritative:snapshot"
            && event.payload.playerId === hostPlayer.playerId
    })
    assert.equal(hostSnapshots.at(-2).payload.snapshot.activePiece.row, stateBeforeInput.activePiece.row)
    assert.equal(hostSnapshots.at(-2).payload.snapshot.activePiece.col, stateBeforeInput.activePiece.col - 1)
    assert.equal(hostSnapshots.at(-1).payload.snapshot.activePiece.row, stateBeforeInput.activePiece.row + 1)
    assert.equal(hostSnapshots.at(-1).payload.snapshot.activePiece.col, stateBeforeInput.activePiece.col - 1)
    assert.deepEqual(hostSocket.lastClientEvent("game:input:result")?.payload, {
        ok: true,
        reason: null,
        clientSequence: 1,
        pieceIndex: stateBeforeInput.pieceIndex,
        placementCommitted: false,
    })
})

test("hard_drop과 hold spawn은 해당 player의 gravity 500ms를 다시 시작한다", async (t) => {
    for (const action of ["hard_drop", "hold"]) {
        await t.test(action, async () => {
            const gameCore = await loadGameCore()
            const mutationQueue = createAuthoritativePlayerMutationQueue()
            const tickerService = createAuthoritativeTickerService({
                authoritativePlayerMutationQueue: mutationQueue,
                setIntervalFn() {
                    return { unref() {} }
                },
                clearIntervalFn() {},
                loadGameCore: async () => gameCore,
                saveGameEventLog: saveTestLog,
            })
            const fixture = await createStartedPvpSocketFixture(`gravity-reset-${action}`, {
                authoritativePlayerMutationQueue: mutationQueue,
                authoritativeTickerService: tickerService,
            })
            const activePiece = {
                pieceType: "tree",
                rotation: 0,
                row: 0,
                col: 3,
            }
            setAuthoritativePieceFixture(gameCore, fixture.hostPlayer, activePiece)

            await tickerService.tickRoom(fixture.roomId, fixture.socketServer, 400)
            await fixture.hostSocket.triggerAsync("game:input", {
                roomId: fixture.roomId,
                playerId: fixture.hostPlayerId,
                action,
                tick: 1,
                pieceIndex: 1,
                clientSequence: 1,
                ...(action === "hard_drop"
                    ? { expectedTransform: createExpectedTransform(activePiece) }
                    : {}),
            })

            const spawnedPiece = { ...fixture.hostPlayer.authoritativeState.activePiece }
            assert.equal(fixture.hostSocket.lastClientEvent("game:input:result")?.payload.ok, true)

            await tickerService.tickRoom(fixture.roomId, fixture.socketServer, 499)
            assert.deepEqual(fixture.hostPlayer.authoritativeState.activePiece, spawnedPiece)

            await tickerService.tickRoom(fixture.roomId, fixture.socketServer, 1)
            assert.equal(
                fixture.hostPlayer.authoritativeState.activePiece.row,
                spawnedPiece.row + 1,
            )
        })
    }
})

test("응답 대기 없는 move/rotate 후 hard_drop은 마지막 성공 위치의 정확한 cell을 고정한다", async (t) => {
    const gameCore = await loadGameCore()
    const cases = [
        {
            name: "move_left -> hard_drop",
            actions: ["move_left", "hard_drop"],
            expectedTransforms: [
                { pieceType: "tree", rotation: 0, col: 2 },
                { pieceType: "tree", rotation: 0, col: 2 },
            ],
            expectedPiece: { pieceType: "tree", rotation: 0, row: 0, col: 2 },
        },
        {
            name: "move_right -> hard_drop",
            actions: ["move_right", "hard_drop"],
            expectedTransforms: [
                { pieceType: "tree", rotation: 0, col: 4 },
                { pieceType: "tree", rotation: 0, col: 4 },
            ],
            expectedPiece: { pieceType: "tree", rotation: 0, row: 0, col: 4 },
        },
        {
            name: "rotate -> hard_drop",
            actions: ["rotate", "hard_drop"],
            expectedTransforms: [
                { pieceType: "tree", rotation: 1, col: 3 },
                { pieceType: "tree", rotation: 1, col: 3 },
            ],
            expectedPiece: { pieceType: "tree", rotation: 1, row: 0, col: 3 },
        },
        {
            name: "move_left -> move_left -> rotate -> hard_drop",
            actions: ["move_left", "move_left", "rotate", "hard_drop"],
            expectedTransforms: [
                { pieceType: "tree", rotation: 0, col: 2 },
                { pieceType: "tree", rotation: 0, col: 1 },
                { pieceType: "tree", rotation: 1, col: 1 },
                { pieceType: "tree", rotation: 1, col: 1 },
            ],
            expectedPiece: { pieceType: "tree", rotation: 1, row: 0, col: 1 },
        },
    ]

    for (const [caseIndex, testCase] of cases.entries()) {
        await t.test(testCase.name, async () => {
            const fixture = await createStartedPvpSocketFixture(`rapid-input-${caseIndex}`)
            setAuthoritativePieceFixture(gameCore, fixture.hostPlayer, {
                pieceType: "tree",
                rotation: 0,
                row: 0,
                col: 3,
            })
            const initialPieceIndex = fixture.hostPlayer.authoritativeState.pieceIndex
            const expectedLockedPiece = getExpectedLockedPiece(
                gameCore,
                fixture.hostPlayer.authoritativeState.board,
                testCase.expectedPiece,
            )

            const results = await sendInputsWithoutWaiting(fixture.hostSocket, {
                roomId: fixture.roomId,
                playerId: fixture.hostPlayerId,
                pieceIndex: initialPieceIndex,
                actions: testCase.actions,
                expectedTransforms: testCase.expectedTransforms,
            })

            assert.deepEqual(results.map(result => ({
                clientSequence: result.clientSequence,
                ok: result.ok,
                reason: result.reason,
            })), testCase.actions.map((action, index) => ({
                clientSequence: index + 1,
                ok: true,
                reason: null,
            })))
            assert.deepEqual(
                getBoardCells(fixture.hostPlayer.authoritativeState.board, "tree"),
                getPieceCells(gameCore, expectedLockedPiece),
            )
            assert.equal(fixture.hostPlayer.authoritativeState.pieceIndex, initialPieceIndex + 1)
            assert.equal(fixture.hostPlayer.authoritativeState.activePiece.pieceType, "square")
            assert.equal(fixture.hostPlayer.lastProcessedClientSequence, testCase.actions.length)
        })
    }
})

test("첫 blocked gravity가 먼저 등록되어도 grace 중 move/hard_drop은 변경된 위치에 lock한다", async () => {
    const gameCore = await loadGameCore()
    const mutationQueue = createAuthoritativePlayerMutationQueue()
    const holdQueue = createDeferred()
    const queueEntryStarted = createDeferred()
    const gravityCalls = []
    const tickerService = createAuthoritativeTickerService({
        authoritativePlayerMutationQueue: mutationQueue,
        setIntervalFn() {
            return { unref() {} }
        },
        clearIntervalFn() {},
        loadGameCore: async () => gameCore,
        applyGravityStepToMatchPlayerState(roomId, playerId, core) {
            gravityCalls.push(playerId)
            return applyGravityStepToMatchPlayerState(roomId, playerId, core)
        },
        saveGameEventLog: saveTestLog,
    })
    const fixture = await createStartedPvpSocketFixture("gravity-first-lock", {
        authoritativePlayerMutationQueue: mutationQueue,
        authoritativeTickerService: tickerService,
    })
    const groundedPiece = {
        pieceType: "square",
        rotation: 0,
        row: 18,
        col: 4,
    }
    setAuthoritativePieceFixture(gameCore, fixture.hostPlayer, groundedPiece)
    const initialPieceIndex = fixture.hostPlayer.authoritativeState.pieceIndex
    const queueBlocker = mutationQueue.enqueueAuthoritativePlayerMutation(
        fixture.roomId,
        fixture.hostPlayerId,
        async () => {
            queueEntryStarted.resolve()
            await holdQueue.promise
        },
    )
    await queueEntryStarted.promise

    const tickerResult = tickerService.tickRoom(fixture.roomId, fixture.socketServer, 500)
    await new Promise(resolve => setImmediate(resolve))
    const inputResultsPromise = sendInputsWithoutWaiting(fixture.hostSocket, {
        roomId: fixture.roomId,
        playerId: fixture.hostPlayerId,
        pieceIndex: initialPieceIndex,
        actions: ["move_left", "hard_drop"],
        expectedTransforms: [
            createExpectedTransform(groundedPiece, { col: groundedPiece.col - 1 }),
            createExpectedTransform(groundedPiece, { col: groundedPiece.col - 1 }),
        ],
    })

    holdQueue.resolve()
    const [results] = await Promise.all([
        inputResultsPromise,
        tickerResult,
        queueBlocker,
    ])

    assert.deepEqual(gravityCalls.filter(playerId => playerId === fixture.hostPlayerId), [
        fixture.hostPlayerId,
    ])
    assert.deepEqual(results.map(result => ({
        clientSequence: result.clientSequence,
        ok: result.ok,
        reason: result.reason,
    })), [
        { clientSequence: 1, ok: true, reason: null },
        { clientSequence: 2, ok: true, reason: null },
    ])
    assert.deepEqual(
        getBoardCells(fixture.hostPlayer.authoritativeState.board, "square"),
        getPieceCells(gameCore, {
            ...groundedPiece,
            col: groundedPiece.col - 1,
        }),
    )
    assert.equal(fixture.hostPlayer.authoritativeState.pieceIndex, initialPieceIndex + 1)
    assert.equal(fixture.hostPlayer.lastProcessedClientSequence, 2)
    const snapshots = fixture.socketServer.roomEvents.filter(event => {
        return event.eventName === "game:authoritative:snapshot"
            && event.payload.playerId === fixture.hostPlayerId
    })
    assert.deepEqual(
        snapshots.map(event => event.payload.snapshot.lastProcessedClientSequence),
        [1, 2],
    )
})

test("높은 jagged board의 한 칸 row 차이는 이전 col 자동 lock 전에 divergence snapshot을 보낸다", async () => {
    const gameCore = await loadGameCore()
    const mutationQueue = createAuthoritativePlayerMutationQueue()
    const tickerService = createAuthoritativeTickerService({
        authoritativePlayerMutationQueue: mutationQueue,
        setIntervalFn() {
            return { unref() {} }
        },
        clearIntervalFn() {},
        loadGameCore: async () => gameCore,
        saveGameEventLog: saveTestLog,
    })
    const fixture = await createStartedPvpSocketFixture("jagged-row-divergence", {
        authoritativePlayerMutationQueue: mutationQueue,
        authoritativeTickerService: tickerService,
    })
    const clientVisiblePiece = {
        pieceType: "square",
        rotation: 0,
        row: 17,
        col: 4,
    }
    setAuthoritativePieceFixture(gameCore, fixture.hostPlayer, clientVisiblePiece)
    fixture.hostPlayer.authoritativeState.board[19][3] = "stack"

    await tickerService.tickRoom(fixture.roomId, fixture.socketServer, 500)
    assert.equal(fixture.hostPlayer.authoritativeState.activePiece.row, 18)

    await tickerService.tickRoom(fixture.roomId, fixture.socketServer, 500)
    assert.equal(fixture.hostPlayer.authoritativeState.pieceIndex, 1)
    assert.deepEqual(getBoardCells(
        fixture.hostPlayer.authoritativeState.board,
        "square",
    ), [])

    await fixture.hostSocket.triggerAsync("game:input", {
        roomId: fixture.roomId,
        playerId: fixture.hostPlayerId,
        action: "move_left",
        tick: 1,
        pieceIndex: 1,
        clientSequence: 1,
        expectedTransform: createExpectedTransform(clientVisiblePiece, { col: 3 }),
    })

    const inputResult = fixture.hostSocket.lastClientEvent("game:input:result")?.payload
    assert.equal(inputResult.ok, false)
    assert.equal(inputResult.reason, "PREDICTION_DIVERGED")
    assert.equal(inputResult.snapshot.activePiece.col, 4)
    assert.equal(inputResult.snapshot.activePiece.row, 18)
    assert.equal(fixture.hostPlayer.authoritativeState.pieceIndex, 1)
    assert.deepEqual(getBoardCells(
        fixture.hostPlayer.authoritativeState.board,
        "square",
    ), [])
})

test("grounded piece가 턱을 벗어나 gravity move하면 새 바닥에서 grace를 다시 받는다", async () => {
    const gameCore = await loadGameCore()
    const mutationQueue = createAuthoritativePlayerMutationQueue()
    const tickerService = createAuthoritativeTickerService({
        authoritativePlayerMutationQueue: mutationQueue,
        setIntervalFn() {
            return { unref() {} }
        },
        clearIntervalFn() {},
        loadGameCore: async () => gameCore,
        saveGameEventLog: saveTestLog,
    })
    const fixture = await createStartedPvpSocketFixture("grounded-ledge-release", {
        authoritativePlayerMutationQueue: mutationQueue,
        authoritativeTickerService: tickerService,
    })
    const ledgePiece = {
        pieceType: "square",
        rotation: 0,
        row: 17,
        col: 4,
    }
    setAuthoritativePieceFixture(gameCore, fixture.hostPlayer, ledgePiece)
    fixture.hostPlayer.authoritativeState.board[19][5] = "stack"

    await tickerService.tickRoom(fixture.roomId, fixture.socketServer, 500)
    assert.equal(fixture.hostPlayer.authoritativeState.pieceIndex, 1)

    await fixture.hostSocket.triggerAsync("game:input", {
        roomId: fixture.roomId,
        playerId: fixture.hostPlayerId,
        action: "move_left",
        tick: 1,
        pieceIndex: 1,
        clientSequence: 1,
        expectedTransform: createExpectedTransform(ledgePiece, { col: 3 }),
    })
    assert.equal(fixture.hostSocket.lastClientEvent("game:input:result")?.payload.ok, true)

    await tickerService.tickRoom(fixture.roomId, fixture.socketServer, 500)
    assert.deepEqual(fixture.hostPlayer.authoritativeState.activePiece, {
        ...ledgePiece,
        row: 18,
        col: 3,
    })

    await tickerService.tickRoom(fixture.roomId, fixture.socketServer, 500)
    assert.equal(fixture.hostPlayer.authoritativeState.pieceIndex, 1)
    assert.deepEqual(getBoardCells(
        fixture.hostPlayer.authoritativeState.board,
        "square",
    ), [])

    await tickerService.tickRoom(fixture.roomId, fixture.socketServer, 500)
    assert.equal(fixture.hostPlayer.authoritativeState.pieceIndex, 2)
    assert.deepEqual(
        getBoardCells(fixture.hostPlayer.authoritativeState.board, "square"),
        getPieceCells(gameCore, {
            ...ledgePiece,
            row: 18,
            col: 3,
        }),
    )
})

test("room:leave는 퇴장한 socket을 room에서 제거하고 남은 room 상태를 broadcast한다", () => {
    const socketServer = new FakeSocketServer()
    const hostSocket = new FakeClientSocket("host-socket")
    const guestSocket = new FakeClientSocket("guest-socket")

    registerTestSocketHandlers(socketServer)
    socketServer.connect(hostSocket)
    socketServer.connect(guestSocket)

    hostSocket.trigger("room:create", {
        playerId: "p1",
        nickname: "Host",
    })
    const createResult = hostSocket.lastClientEvent("room:result").payload
    const roomId = createResult.room.roomId

    guestSocket.trigger("room:join", {
        roomId,
        player: {
            playerId: "p2",
            nickname: "Guest",
        },
    })

    assert.doesNotThrow(() => {
        guestSocket.trigger("room:leave", {
            roomId,
            playerId: "p2",
        })
    })

    const leaveResult = guestSocket.lastClientEvent("room:result").payload

    assert.equal(leaveResult.ok, true)
    assert.equal(leaveResult.room.players.length, 1)
    assert.equal(leaveResult.room.players[0].playerId, "p1")
    assert.deepEqual(guestSocket.leftRooms, [roomId])
    assert.equal(socketServer.roomEvents.at(-2).eventName, "room:updated")
    assert.equal(socketServer.roomEvents.at(-2).payload.players.length, 1)
})

test("room:leave는 마지막 player가 나가면 room null 결과를 요청자에게 보낸다", () => {
    const socketServer = new FakeSocketServer()
    const hostSocket = new FakeClientSocket("host-socket")

    registerTestSocketHandlers(socketServer)
    socketServer.connect(hostSocket)

    hostSocket.trigger("room:create", {
        playerId: "p1",
        nickname: "Host",
    })
    const createResult = hostSocket.lastClientEvent("room:result").payload
    const roomId = createResult.room.roomId

    assert.doesNotThrow(() => {
        hostSocket.trigger("room:leave", {
            roomId,
            playerId: "p1",
        })
    })

    const leaveResult = hostSocket.lastClientEvent("room:result").payload

    assert.equal(leaveResult.ok, true)
    assert.equal(leaveResult.room, null)
    assert.deepEqual(hostSocket.leftRooms, [roomId])
})

test("disconnect는 grace가 끝나기 전 player를 room에서 제거하지 않는다", () => {
    const socketServer = new FakeSocketServer()
    const hostSocket = new FakeClientSocket("disconnect-host-socket")
    const guestSocket = new FakeClientSocket("disconnect-guest-socket")

    registerTestSocketHandlers(socketServer)
    socketServer.connect(hostSocket)
    socketServer.connect(guestSocket)

    hostSocket.trigger("room:create", {
        playerId: "disconnect-p1",
        nickname: "Host",
    })
    const createResult = hostSocket.lastClientEvent("room:result").payload
    const roomId = createResult.room.roomId

    guestSocket.trigger("room:join", {
        roomId,
        player: {
            playerId: "disconnect-p2",
            nickname: "Guest",
        },
    })

    assert.doesNotThrow(() => {
        guestSocket.trigger("disconnect")
    })

    assert.deepEqual(guestSocket.leftRooms, [])
    assert.equal(getRoomState(roomId).players.length, 2)
})

test("game:leave 이후 old game socket disconnect와 lobby sync 순서와 무관하게 남은 player를 보존한다", () => {
    const socketServer = new FakeSocketServer()

    registerTestSocketHandlers(socketServer)

    function createStartedRoom(prefix) {
        const hostGameSocket = new FakeClientSocket(`${prefix}-host-game-socket`)
        const guestGameSocket = new FakeClientSocket(`${prefix}-guest-game-socket`)
        const hostLobbySocket = new FakeClientSocket(`${prefix}-host-lobby-socket`)
        const hostPlayerId = `${prefix}-host-player`
        const guestPlayerId = `${prefix}-guest-player`

        socketServer.connect(hostGameSocket)
        socketServer.connect(guestGameSocket)
        socketServer.connect(hostLobbySocket)

        hostGameSocket.trigger("room:create", {
            playerId: hostPlayerId,
            nickname: "Host",
        })
        const roomId = hostGameSocket.lastClientEvent("room:result").payload.room.roomId
        guestGameSocket.trigger("room:join", {
            roomId,
            player: {
                playerId: guestPlayerId,
                nickname: "Guest",
            },
        })
        hostGameSocket.trigger("room:start", {
            roomId,
            playerId: hostPlayerId,
        })
        guestGameSocket.trigger("game:leave", {
            roomId,
            playerId: guestPlayerId,
        })

        return {
            roomId,
            hostPlayerId,
            hostGameSocket,
            hostLobbySocket,
        }
    }

    const disconnectFirst = createStartedRoom("leave-race-disconnect-first")
    disconnectFirst.hostGameSocket.trigger("disconnect")
    disconnectFirst.hostLobbySocket.trigger("room:sync", {
        roomId: disconnectFirst.roomId,
        playerId: disconnectFirst.hostPlayerId,
    })

    let room = getRoomState(disconnectFirst.roomId)
    assert.equal(disconnectFirst.hostLobbySocket.lastClientEvent("room:result").payload.ok, true)
    assert.equal(room.status, "waiting")
    assert.equal(room.players.length, 1)
    assert.equal(room.players[0].playerId, disconnectFirst.hostPlayerId)
    assert.equal(room.players[0].socketId, undefined)

    const syncFirst = createStartedRoom("leave-race-sync-first")
    syncFirst.hostLobbySocket.trigger("room:sync", {
        roomId: syncFirst.roomId,
        playerId: syncFirst.hostPlayerId,
    })
    syncFirst.hostGameSocket.trigger("disconnect")

    room = getRoomState(syncFirst.roomId)
    assert.equal(syncFirst.hostLobbySocket.lastClientEvent("room:result").payload.ok, true)
    assert.equal(room.status, "waiting")
    assert.equal(room.players.length, 1)
    assert.equal(room.players[0].playerId, syncFirst.hostPlayerId)
    assert.equal(room.players[0].socketId, undefined)
})

test("finished game socket disconnect와 lobby sync 순서는 player와 room을 보존하고 재시작할 수 있다", () => {
    const socketServer = new FakeSocketServer()
    const hostGameSocket = new FakeClientSocket("finished-race-host-game-socket")
    const guestGameSocket = new FakeClientSocket("finished-race-guest-game-socket")
    const hostLobbySocket = new FakeClientSocket("finished-race-host-lobby-socket")
    const guestLobbySocket = new FakeClientSocket("finished-race-guest-lobby-socket")
    const stoppedRoomIds = []

    registerTestSocketHandlers(socketServer, {
        authoritativeTickerService: {
            startRoomTicker() {
                return { ok: true, started: false }
            },
            stopRoomTicker(roomId) {
                stoppedRoomIds.push(roomId)
                return { ok: true, stopped: true }
            },
        },
    })
    socketServer.connect(hostGameSocket)
    socketServer.connect(guestGameSocket)
    socketServer.connect(hostLobbySocket)
    socketServer.connect(guestLobbySocket)

    hostGameSocket.trigger("room:create", {
        playerId: "finished-race-host",
        nickname: "Host",
    })
    const roomId = hostGameSocket.lastClientEvent("room:result").payload.room.roomId
    guestGameSocket.trigger("room:join", {
        roomId,
        player: {
            playerId: "finished-race-guest",
            nickname: "Guest",
        },
    })
    hostGameSocket.trigger("room:start", {
        roomId,
        playerId: "finished-race-host",
    })
    finishGame(roomId, "finished-race-guest")

    const eventsBeforeDisconnect = socketServer.roomEvents.length

    // A: old game socket disconnect -> new lobby socket sync
    hostGameSocket.trigger("disconnect")
    let room = getRoomState(roomId)
    assert.equal(room.status, "finished")
    assert.equal(room.players.length, 2)
    assert.equal(room.hostPlayerId, "finished-race-host")
    assert.equal(socketServer.roomEvents.length, eventsBeforeDisconnect)
    assert.deepEqual(stoppedRoomIds, [])

    hostLobbySocket.trigger("room:sync", {
        roomId,
        playerId: "finished-race-host",
    })
    room = getRoomState(roomId)
    assert.equal(room.status, "finished")
    assert.equal(room.players.find(player => player.playerId === "finished-race-host").socketId, undefined)

    // B: new lobby socket sync -> old game socket disconnect
    guestLobbySocket.trigger("room:sync", {
        roomId,
        playerId: "finished-race-guest",
    })
    guestGameSocket.trigger("disconnect")
    room = getRoomState(roomId)
    assert.equal(room.status, "waiting")
    assert.equal(room.players.length, 2)
    assert.equal(room.hostPlayerId, "finished-race-host")
    assert.equal(room.players.find(player => player.playerId === "finished-race-guest").socketId, undefined)
    assert.deepEqual(stoppedRoomIds, [])

    hostLobbySocket.trigger("room:start", {
        roomId,
        playerId: "finished-race-host",
    })
    const restartResult = hostLobbySocket.lastClientEvent("room:result").payload

    assert.equal(restartResult.ok, true)
    assert.equal(restartResult.room.status, "playing")
})

test("PVE 재시작 뒤 room:leave는 거부하고 game:leave만 player를 제거한다", () => {
    const socketServer = new FakeSocketServer()
    const gameSocket = new FakeClientSocket("pve-finished-game-socket")
    const lobbySocket = new FakeClientSocket("pve-finished-lobby-socket")

    registerTestSocketHandlers(socketServer)
    socketServer.connect(gameSocket)
    socketServer.connect(lobbySocket)

    gameSocket.trigger("room:create", {
        mode: "pve",
        player: {
            playerId: "pve-finished-host",
            nickname: "Host",
        },
    })
    const roomId = gameSocket.lastClientEvent("room:result").payload.room.roomId
    gameSocket.trigger("room:start", {
        roomId,
        playerId: "pve-finished-host",
    })
    finishGame(roomId, "pve-finished-host")

    gameSocket.trigger("disconnect")
    let room = getRoomState(roomId)
    assert.equal(room.status, "finished")
    assert.equal(room.players.length, 2)

    lobbySocket.trigger("room:sync", {
        roomId,
        playerId: "pve-finished-host",
    })
    room = getRoomState(roomId)
    assert.equal(room.status, "waiting")
    assert.equal(room.players.length, 2)
    assert.equal(room.hostPlayerId, "pve-finished-host")
    assert.equal(room.players.find(player => player.playerId === "pve-finished-host").socketId, undefined)

    lobbySocket.trigger("room:start", {
        roomId,
        playerId: "pve-finished-host",
    })
    assert.equal(lobbySocket.lastClientEvent("room:result").payload.ok, true)

    lobbySocket.trigger("room:leave", {
        roomId,
        playerId: "pve-finished-host",
    })
    assert.equal(lobbySocket.lastClientEvent("room:result").payload.ok, false)
    assert.equal(lobbySocket.lastClientEvent("room:result").payload.reason, "GAME_IN_PROGRESS")

    lobbySocket.trigger("game:leave", {
        roomId,
        playerId: "pve-finished-host",
    })
    assert.equal(lobbySocket.lastClientEvent("game:leave:result").payload.ok, true)
    assert.equal(getRoomState(roomId), null)
})

test("room:start는 방장만 실행 가능하며, 성공 시 게임 시작 이벤트와 룸 정보를 broadcast한다", () => {
    const socketServer = new FakeSocketServer()
    const hostSocket = new FakeClientSocket("host-socket")
    const guestSocket = new FakeClientSocket("guest-socket")

    registerTestSocketHandlers(socketServer)
    socketServer.connect(hostSocket)
    socketServer.connect(guestSocket)

    hostSocket.trigger("room:create", {
        playerId: "p1",
        nickname: "Host",
    })
    const createResult = hostSocket.lastClientEvent("room:result").payload
    const roomId = createResult.room.roomId

    guestSocket.trigger("room:join", {
        roomId,
        player: {
            playerId: "p2",
            nickname: "Guest",
        },
    })

    assert.doesNotThrow(() => {
        hostSocket.trigger("room:start", {
            roomId,
            playerId: "p1",
        })
    })

    const startResult = hostSocket.lastClientEvent("room:result").payload

    assert.equal(startResult.ok, true)
    assert.equal(startResult.room.players.length, 2)
    assert.equal(startResult.room.players[0].playerId, "p1")
    assert.equal(startResult.room.players[1].playerId, "p2")
    assert.equal(startResult.room.status, "playing")

    const updatedEvent = socketServer.roomEvents.findLast(event => event.eventName === "room:updated")
    const messageEvent = socketServer.roomEvents.findLast(event => event.eventName === "room:message")

    assert.equal(updatedEvent.roomId, roomId)
    assert.equal(updatedEvent.payload.status, "playing")
    assert.equal(updatedEvent.payload.players.length, 2)
    assert.equal(messageEvent.roomId, roomId)
    assert.equal(messageEvent.payload.text, "Host님이 게임을 시작했습니다.")
})

test("room:start 성공 후 authoritative ticker를 시작한다", () => {
    const socketServer = new FakeSocketServer()
    const hostSocket = new FakeClientSocket("ticker-start-host-socket")
    const guestSocket = new FakeClientSocket("ticker-start-guest-socket")
    const startedRoomIds = []

    registerTestSocketHandlers(socketServer, {
        authoritativeTickerService: {
            startRoomTicker(roomId, providedSocketServer) {
                startedRoomIds.push({ roomId, socketServer: providedSocketServer })
                return { ok: true, started: true }
            },
            stopRoomTicker() {
                return { ok: true, stopped: false }
            },
        },
    })
    socketServer.connect(hostSocket)
    socketServer.connect(guestSocket)

    hostSocket.trigger("room:create", {
        playerId: "ticker-start-host-player",
        nickname: "Host",
    })
    const createResult = hostSocket.lastClientEvent("room:result").payload
    const roomId = createResult.room.roomId

    guestSocket.trigger("room:join", {
        roomId,
        player: {
            playerId: "ticker-start-guest-player",
            nickname: "Guest",
        },
    })

    hostSocket.trigger("room:start", {
        roomId,
        playerId: "ticker-start-host-player",
    })

    assert.deepEqual(startedRoomIds, [{ roomId, socketServer }])
})

test("game:leave로 player가 게임에서 나가면 authoritative ticker를 정리한다", () => {
    const socketServer = new FakeSocketServer()
    const hostSocket = new FakeClientSocket("ticker-leave-game-host-socket")
    const guestSocket = new FakeClientSocket("ticker-leave-game-guest-socket")
    const stoppedRoomIds = []

    registerTestSocketHandlers(socketServer, {
        authoritativeTickerService: {
            startRoomTicker() {
                return { ok: true, started: true }
            },
            stopRoomTicker(roomId) {
                stoppedRoomIds.push(roomId)
                return { ok: true, stopped: true }
            },
        },
    })
    socketServer.connect(hostSocket)
    socketServer.connect(guestSocket)

    hostSocket.trigger("room:create", {
        playerId: "ticker-leave-game-host-player",
        nickname: "Host",
    })
    const createResult = hostSocket.lastClientEvent("room:result").payload
    const roomId = createResult.room.roomId

    guestSocket.trigger("room:join", {
        roomId,
        player: {
            playerId: "ticker-leave-game-guest-player",
            nickname: "Guest",
        },
    })
    hostSocket.trigger("room:start", {
        roomId,
        playerId: "ticker-leave-game-host-player",
    })
    assert.equal(getMatchState(roomId).ok, true)

    guestSocket.trigger("game:leave", {
        roomId,
        playerId: "ticker-leave-game-guest-player",
    })

    assert.deepEqual(stoppedRoomIds, [roomId])
    assert.deepEqual(getMatchState(roomId), {
        ok: false,
        match: null,
        reason: "MATCH_NOT_FOUND",
    })
})

test("playing room socket disconnect는 authoritative ticker를 유지하고 game 재입장을 허용한다", () => {
    const socketServer = new FakeSocketServer()
    const hostSocket = new FakeClientSocket("ticker-disconnect-host-socket")
    const guestSocket = new FakeClientSocket("ticker-disconnect-guest-socket")
    const reconnectSocket = new FakeClientSocket("ticker-disconnect-reconnect-socket")
    const stoppedRoomIds = []

    registerTestSocketHandlers(socketServer, {
        authoritativeTickerService: {
            startRoomTicker() {
                return { ok: true, started: true }
            },
            stopRoomTicker(roomId) {
                stoppedRoomIds.push(roomId)
                return { ok: true, stopped: true }
            },
        },
    })
    socketServer.connect(hostSocket)
    socketServer.connect(guestSocket)
    socketServer.connect(reconnectSocket)

    hostSocket.trigger("room:create", {
        playerId: "ticker-disconnect-host-player",
        nickname: "Host",
    })
    const createResult = hostSocket.lastClientEvent("room:result").payload
    const roomId = createResult.room.roomId

    guestSocket.trigger("room:join", {
        roomId,
        player: {
            playerId: "ticker-disconnect-guest-player",
            nickname: "Guest",
        },
    })
    hostSocket.trigger("room:start", {
        roomId,
        playerId: "ticker-disconnect-host-player",
    })
    guestSocket.trigger("disconnect")

    reconnectSocket.trigger("game:join", {
        roomId,
        playerId: "ticker-disconnect-guest-player",
    })

    const joinResult = reconnectSocket.lastClientEvent("game:join:result")?.payload

    assert.deepEqual(stoppedRoomIds, [])
    assert.equal(joinResult.ok, true)
    assert.equal(joinResult.room.status, "playing")
    assert.equal(joinResult.room.players.length, 2)
})

test("room:start는 host playerId를 보내도 다른 socket이면 NOT_AUTHORIZED를 반환한다", () => {
    const socketServer = new FakeSocketServer()
    const hostSocket = new FakeClientSocket("start-host-socket")
    const guestSocket = new FakeClientSocket("start-guest-socket")

    registerTestSocketHandlers(socketServer)
    socketServer.connect(hostSocket)
    socketServer.connect(guestSocket)

    hostSocket.trigger("room:create", {
        playerId: "start-host-player",
        nickname: "Host",
    })
    const createResult = hostSocket.lastClientEvent("room:result").payload
    const roomId = createResult.room.roomId

    guestSocket.trigger("room:join", {
        roomId,
        player: {
            playerId: "start-guest-player",
            nickname: "Guest",
        },
    })

    guestSocket.trigger("room:start", {
        roomId,
        playerId: "start-host-player",
    })

    const startResult = guestSocket.lastClientEvent("room:result").payload

    assert.equal(startResult.ok, false)
    assert.equal(startResult.room, null)
    assert.equal(startResult.reason, "NOT_AUTHORIZED")
})

test("global:chat은 모든 socket에 global:message를 broadcast한다", () => {
    const socketServer = new FakeSocketServer()
    const hostSocket = new FakeClientSocket("global-chat-host-socket")
    const guestSocket = new FakeClientSocket("global-chat-guest-socket")

    registerTestSocketHandlers(socketServer)
    socketServer.connect(hostSocket)
    socketServer.connect(guestSocket)

    hostSocket.trigger("global:chat", {
        playerId: "global-chat-host",
        nickname: "Host",
        text: "hello global",
    })

    const hostMessage = hostSocket.lastClientEvent("global:message").payload
    const guestMessage = guestSocket.lastClientEvent("global:message").payload

    assert.equal(hostMessage.type, "chat")
    assert.equal(hostMessage.nickname, "Host")
    assert.equal(hostMessage.text, "hello global")
    assert.deepEqual(guestMessage, hostMessage)
})

test("room:chat은 같은 room 참가자에게 room:message를 broadcast한다", () => {
    const socketServer = new FakeSocketServer()
    const hostSocket = new FakeClientSocket("room-chat-host-socket")
    const guestSocket = new FakeClientSocket("room-chat-guest-socket")

    registerTestSocketHandlers(socketServer)
    socketServer.connect(hostSocket)
    socketServer.connect(guestSocket)

    hostSocket.trigger("room:create", {
        playerId: "room-chat-host",
        nickname: "Host",
    })
    const createResult = hostSocket.lastClientEvent("room:result").payload
    const roomId = createResult.room.roomId

    guestSocket.trigger("room:join", {
        roomId,
        player: {
            playerId: "room-chat-guest",
            nickname: "Guest",
        },
    })

    guestSocket.trigger("room:chat", {
        roomId,
        playerId: "room-chat-guest",
        text: "<script>alert(1)</script>",
    })

    const messageEvent = socketServer.roomEvents.findLast(event => event.eventName === "room:message")

    assert.equal(messageEvent.roomId, roomId)
    assert.equal(messageEvent.payload.type, "chat")
    assert.equal(messageEvent.payload.nickname, "Guest")
    assert.equal(messageEvent.payload.text, "<script>alert(1)</script>")
})

test("room:chat은 room에 없는 player면 NOT_AUTHORIZED를 반환한다", () => {
    const socketServer = new FakeSocketServer()
    const hostSocket = new FakeClientSocket("room-chat-auth-host-socket")
    const intruderSocket = new FakeClientSocket("room-chat-auth-intruder-socket")

    registerTestSocketHandlers(socketServer)
    socketServer.connect(hostSocket)
    socketServer.connect(intruderSocket)

    hostSocket.trigger("room:create", {
        playerId: "room-chat-auth-host",
        nickname: "Host",
    })
    const createResult = hostSocket.lastClientEvent("room:result").payload

    intruderSocket.trigger("room:chat", {
        roomId: createResult.room.roomId,
        playerId: "room-chat-auth-intruder",
        text: "bad message",
    })

    const result = intruderSocket.lastClientEvent("chat:result").payload

    assert.equal(result.ok, false)
    assert.equal(result.reason, "NOT_AUTHORIZED")
})

test("chat은 빈 메시지와 너무 긴 메시지를 차단한다", () => {
    const socketServer = new FakeSocketServer()
    const chatClientSocket = new FakeClientSocket("chat-validation-socket")

    registerTestSocketHandlers(socketServer)
    socketServer.connect(chatClientSocket)

    chatClientSocket.trigger("global:chat", {
        playerId: "chat-validation-player",
        nickname: "Player",
        text: "   ",
    })
    chatClientSocket.trigger("global:chat", {
        playerId: "chat-validation-player",
        nickname: "Player",
        text: "x".repeat(201),
    })

    const results = chatClientSocket.clientEvents
        .filter(event => event.eventName === "chat:result")
        .map(event => event.payload.reason)

    assert.deepEqual(results, ["INVALID_PAYLOAD", "INVALID_PAYLOAD"])
})

test("chat은 같은 socket의 1초 내 연속 전송을 CHAT_RATE_LIMITED로 차단한다", () => {
    const socketServer = new FakeSocketServer()
    const chatClientSocket = new FakeClientSocket("chat-rate-limit-socket")
    const originalNow = Date.now

    try {
        let now = 100000
        Date.now = () => now

        let chatCount = 0
        registerTestSocketHandlers(socketServer, {
            socketRateLimitService: {
                cleanupExpired() {},
                consume(bucket) {
                    if (bucket !== "chat") return true
                    chatCount += 1
                    return chatCount === 1
                },
            },
        })
        socketServer.connect(chatClientSocket)

        chatClientSocket.trigger("global:chat", {
            playerId: "chat-rate-limit-player",
            nickname: "Player",
            text: "first",
        })
        now += 500
        chatClientSocket.trigger("global:chat", {
            playerId: "chat-rate-limit-player",
            nickname: "Player",
            text: "second",
        })

        const result = chatClientSocket.lastClientEvent("chat:result").payload

        assert.equal(result.ok, false)
        assert.equal(result.reason, "CHAT_RATE_LIMITED")
    } finally {
        Date.now = originalNow
    }
})

test("disconnect는 chat rate limit 상태를 정리한다", () => {
    const socketServer = new FakeSocketServer()
    const firstSocket = new FakeClientSocket("chat-reconnect-socket")
    const secondSocket = new FakeClientSocket("chat-reconnect-socket")
    const originalNow = Date.now

    try {
        let now = 200000
        Date.now = () => now

        registerTestSocketHandlers(socketServer)
        socketServer.connect(firstSocket)

        firstSocket.trigger("global:chat", {
            playerId: "chat-reconnect-player",
            nickname: "Player",
            text: "first",
        })
        firstSocket.trigger("disconnect")

        now += 500
        socketServer.connect(secondSocket)
        secondSocket.trigger("global:chat", {
            playerId: "chat-reconnect-player",
            nickname: "Player",
            text: "second",
        })

        const rateLimitResult = secondSocket.lastClientEvent("chat:result")
        const message = secondSocket.lastClientEvent("global:message")?.payload

        assert.equal(rateLimitResult, undefined)
        assert.equal(message?.text, "second")
    } finally {
        Date.now = originalNow
    }
})

test("game:input은 authoritativeState에 input을 적용한다", async () => {
    const fixture = await createStartedPvpSocketFixture("authoritative-input")
    const { hostSocket, guestSocket, roomId, hostPlayer } = fixture

    hostSocket.trigger("game:join", {
        roomId,
        playerId: "authoritative-input-host-player",
    })
    guestSocket.trigger("game:join", {
        roomId,
        playerId: "authoritative-input-guest-player",
    })

    hostPlayer.authoritativeState.activePiece = {
        pieceType: "square",
        rotation: 0,
        row: -1,
        col: 3,
    }
    hostPlayer.authoritativeState.pendingPiece = { ...hostPlayer.authoritativeState.activePiece }
    hostPlayer.authoritativeState.pieceQueue = ["tree"]
    hostPlayer.authoritativeState.score = 0
    hostPlayer.authoritativeState.pieceIndex = 1

    await hostSocket.triggerAsync("game:input", {
        roomId,
        playerId: "authoritative-input-host-player",
        action: "hard_drop",
        tick: 12,
        pieceIndex: 1,
        clientSequence: 1,
        expectedTransform: createExpectedTransform(hostPlayer.authoritativeState.activePiece),
    })

    assert.equal(hostPlayer.authoritativeState.score, 38)
    assert.equal(hostPlayer.authoritativeState.pieceIndex, 2)
    const inputResult = hostSocket.lastClientEvent("game:input:result")?.payload
    assert.deepEqual(inputResult, {
        ok: true,
        reason: null,
        clientSequence: 1,
        pieceIndex: 1,
        placementCommitted: true,
    })
    assert.equal(hostPlayer.authoritativeState.board[18][3], "square")
    assert.equal(hostPlayer.authoritativeState.board[18][4], "square")
    assert.equal(hostPlayer.authoritativeState.board[19][3], "square")
    assert.equal(hostPlayer.authoritativeState.board[19][4], "square")
})

test("game:input server lock attackLines는 상대 authoritative pendingGarbageQueue에 추가된다", async () => {
    const fixture = await createStartedPvpSocketFixture("server-garbage", {
        createGarbageHoleCol: () => 2,
    })
    const { socketServer, hostSocket, roomId, hostPlayer, guestPlayer } = fixture
    const gameCore = await loadGameCore()
    hostPlayer.authoritativeState.activePiece = {
        pieceType: "bar",
        rotation: 1,
        row: 0,
        col: 3,
    }
    const lockedPiece = {
        ...hostPlayer.authoritativeState.activePiece,
        row: 16,
    }
    hostPlayer.authoritativeState.board = createLineClearBoard(gameCore, lockedPiece, [16, 17, 18, 19])
    hostPlayer.authoritativeState.pendingPiece = { ...hostPlayer.authoritativeState.activePiece }
    hostPlayer.authoritativeState.pieceQueue = ["square"]
    hostPlayer.authoritativeState.pieceIndex = 1

    await hostSocket.triggerAsync("game:input", {
        roomId,
        playerId: "server-garbage-host-player",
        action: "hard_drop",
        tick: 12,
        pieceIndex: 1,
        clientSequence: 1,
        expectedTransform: createExpectedTransform(hostPlayer.authoritativeState.activePiece),
    })

    assert.deepEqual(guestPlayer.authoritativeState.pendingGarbageQueue, [
        { lines: 4, holeCol: 2 },
    ])
    const garbageEvent = socketServer.roomEvents.findLast(event => {
        return event.eventName === "game:garbage:append"
    })
    const guestSnapshotResult = getAuthoritativePlayerSnapshotDto(roomId, "server-garbage-guest-player")
    const guestSnapshotEvent = socketServer.roomEvents.findLast(event => {
        return event.eventName === "game:authoritative:snapshot"
            && event.payload.playerId === "server-garbage-guest-player"
    })
    const hostSnapshotEvent = socketServer.roomEvents.findLast(event => {
        return event.eventName === "game:authoritative:snapshot"
            && event.payload.playerId === "server-garbage-host-player"
    })

    assert.equal(garbageEvent, undefined)
    assert.equal(hostSnapshotEvent.payload.presentationEffect.type, "line_clear")
    assert.equal(
        hostSnapshotEvent.payload.presentationEffect.id,
        "server-garbage-host-player:1:line_clear",
    )
    assert.deepEqual(hostSnapshotEvent.payload.presentationEffect.rows, [16, 17, 18, 19])
    assert.equal(hostSnapshotEvent.payload.combatEffect.sentLines, 4)
    assert.equal(hostSnapshotEvent.payload.combatEffect.targetPlayerId, "server-garbage-guest-player")
    assert.equal(hostSnapshotEvent.payload.combatEffect.gameId, getMatchState(roomId).match.gameId)
    assert.equal(Object.hasOwn(guestSnapshotEvent.payload, "combatEffect"), false)
    assert.equal(guestSnapshotResult.ok, true)
    assert.equal(guestSnapshotResult.snapshot.pendingGarbageLines, 4)
    assert.equal(Object.hasOwn(guestSnapshotResult.snapshot, "pendingGarbageQueue"), false)
    assert.equal(guestSnapshotEvent.payload.snapshot.pendingGarbageLines, 4)
    assert.equal(Object.hasOwn(guestSnapshotEvent.payload.snapshot, "pendingGarbageQueue"), false)
    assert.equal(Object.hasOwn(guestSnapshotEvent.payload, "presentationEffect"), false)
})


function prepareTetrisAttack(gameCore, player) {
    const piece = { pieceType: "bar", rotation: 1, row: 0, col: 3 };
    const state = player.authoritativeState;
    state.board = createLineClearBoard(gameCore, { ...piece, row: 16 }, [16, 17, 18, 19]);
    state.activePiece = { ...piece };
    state.pendingPiece = { ...piece };
    state.pieceQueue = ["square"];
}

test("연속 공격은 상대 queue에 누적되고 일부 상쇄 뒤 남은 FIFO entry만 적용된다", async () => {
    const holes = [2, 7];
    const fixture = await createStartedPvpSocketFixture("successive-attack", {
        createGarbageHoleCol: () => holes.shift(),
    });
    const core = await loadGameCore();
    const { hostPlayer, guestPlayer, hostSocket, guestSocket, roomId, socketServer } = fixture;
    for (let sequence = 1; sequence <= 2; sequence++) {
        prepareTetrisAttack(core, hostPlayer);
        await hostSocket.triggerAsync("game:input", {
            roomId, action: "hard_drop", tick: sequence,
            pieceIndex: hostPlayer.authoritativeState.pieceIndex, clientSequence: sequence,
            expectedTransform: createExpectedTransform(hostPlayer.authoritativeState.activePiece),
        });
        assert.equal(hostSocket.lastClientEvent("game:input:result").payload.ok, true);
    }
    assert.deepEqual(guestPlayer.authoritativeState.pendingGarbageQueue, [
        { lines: 4, holeCol: 2 }, { lines: 6, holeCol: 7 },
    ]);
    const attacks = socketServer.roomEvents.filter(event => event.payload.combatEffect);
    assert.deepEqual(attacks.map(event => event.payload.combatEffect.sentLines), [4, 6]);
    assert.equal(new Set(attacks.map(event => event.payload.combatEffect.id)).size, 2);
    assert.equal(getAuthoritativePlayerSnapshotDto(roomId, fixture.guestPlayerId).snapshot.pendingGarbageLines, 10);

    prepareTetrisAttack(core, guestPlayer);
    await guestSocket.triggerAsync("game:input", {
        roomId, action: "hard_drop", tick: 1,
        pieceIndex: guestPlayer.authoritativeState.pieceIndex, clientSequence: 1,
        expectedTransform: createExpectedTransform(guestPlayer.authoritativeState.activePiece),
    });
    assert.equal(guestSocket.lastClientEvent("game:input:result").payload.ok, true);
    const defense = socketServer.roomEvents.findLast(event => event.payload.combatEffect)?.payload.combatEffect;
    assert.equal(defense.canceledLines, 4);
    assert.equal(defense.appliedLines, 6);
    assert.equal(defense.sentLines, 0);
    assert.equal(defense.targetPlayerId, null);
    assert.deepEqual(hostPlayer.authoritativeState.pendingGarbageQueue, []);
    assert.deepEqual(guestPlayer.authoritativeState.pendingGarbageQueue, []);
    assert.equal(getAuthoritativePlayerSnapshotDto(roomId, fixture.guestPlayerId).snapshot.pendingGarbageLines, 0);
    assert.ok(guestPlayer.authoritativeState.board.slice(-6).every(row => (
        row[7] === null && row.filter(cell => cell === "garbage").length === 9
    )));
});

test("양쪽 동시 공격 입력은 확정 순서로 상쇄하며 중복 전송과 잔여 queue를 만들지 않는다", { timeout: 5000 }, async (t) => {
    const core = await loadGameCore();
    for (const firstRole of ["host", "guest"]) {
        for (const initialPending of [0, 2]) {
            await t.test(`${firstRole} first / pending ${initialPending}`, async () => {
                const bothStarted = createDeferred();
                const releaseCore = createDeferred();
                let started = 0;
                const fixture = await createStartedPvpSocketFixture(`concurrent-${firstRole}-${initialPending}`, {
                    async loadGameCore() {
                        if (++started === 2) bothStarted.resolve();
                        return releaseCore.promise;
                    },
                    createGarbageHoleCol: () => 3,
                });
                const players = {
                    host: { socket: fixture.hostSocket, player: fixture.hostPlayer },
                    guest: { socket: fixture.guestSocket, player: fixture.guestPlayer },
                };
                for (const { player } of Object.values(players)) {
                    prepareTetrisAttack(core, player);
                    player.authoritativeState.pendingGarbageQueue = initialPending ? [{ lines: initialPending, holeCol: 1 }] : [];
                }
                const order = [firstRole, firstRole === "host" ? "guest" : "host"];
                const inputs = order.map(role => players[role].socket.triggerAsync("game:input", {
                    roomId: fixture.roomId, action: "hard_drop", tick: 1,
                    pieceIndex: 1, clientSequence: 1,
                    expectedTransform: createExpectedTransform(players[role].player.authoritativeState.activePiece),
                }));
                await bothStarted.promise
                assert.equal(fixture.socketServer.roomEvents.filter(event => event.payload.combatEffect).length, 0);
                releaseCore.resolve(core);
                await Promise.all(inputs);
                const effects = fixture.socketServer.roomEvents.filter(event => event.payload.combatEffect).map(event => event.payload);
                assert.equal(effects.length, 2);
                assert.equal(effects[0].playerId, players[firstRole].player.playerId);
                assert.equal(effects[0].combatEffect.sentLines, 4 - initialPending);
                assert.equal(effects[0].combatEffect.canceledLines, initialPending);
                assert.equal(effects[1].combatEffect.sentLines, 0);
                assert.equal(effects[1].combatEffect.canceledLines, 4);
                assert.equal(effects[1].combatEffect.targetPlayerId, null);
                for (const { socket, player } of Object.values(players)) {
                    assert.equal(socket.lastClientEvent("game:input:result").payload.ok, true);
                    assert.equal(player.lastProcessedClientSequence, 1);
                    assert.equal(player.authoritativeState.pieceIndex, 2);
                    assert.deepEqual(player.authoritativeState.pendingGarbageQueue, []);
                    assert.equal(player.authoritativeState.board.flat().filter(cell => cell === "garbage").length, 0);
                    assert.equal(getAuthoritativePlayerSnapshotDto(fixture.roomId, player.playerId).snapshot.pendingGarbageLines, 0);
                }
                assert.equal(new Set(effects.map(event => event.combatEffect.id)).size, 2);
                assert.equal(effects.reduce((total, event) => total + event.combatEffect.appliedLines, 0), 0);
            });
        }
    }
});

test("game:input server lock gameOver는 match finish와 ticker 정리를 처리한다", async () => {
    const stoppedRoomIds = []
    const savedLogs = []

    const fixture = await createStartedPvpSocketFixture("server-gameover", {
        authoritativeTickerService: {
            startRoomTicker() {
                return { ok: true, started: true }
            },
            stopRoomTicker(roomId) {
                stoppedRoomIds.push(roomId)
                return { ok: true, stopped: true }
            },
        },
        saveGameEventLog(log) {
            savedLogs.push(log)
            return Promise.resolve({
                ok: true,
                log,
                reason: null,
            })
        },
    })
    const { socketServer, hostSocket, roomId, match } = fixture

    const gameCore = await loadGameCore()
    prepareTopOutState(gameCore, match, "server-gameover-host-player")

    await hostSocket.triggerAsync("game:input", {
        roomId,
        playerId: "server-gameover-host-player",
        action: "hard_drop",
        tick: 12,
        pieceIndex: 1,
        clientSequence: 1,
        expectedTransform: {
            pieceType: "tree",
            rotation: 1,
            col: 4,
        },
    })

    const authoritativeSnapshotEvent = socketServer.roomEvents.findLast(event => {
        return event.eventName === "game:authoritative:snapshot"
    })
    const finishEvent = socketServer.roomEvents.findLast(event => {
        return event.eventName === "match:finish"
    })

    assert.equal(authoritativeSnapshotEvent.payload.playerId, "server-gameover-host-player")
    assert.equal(authoritativeSnapshotEvent.payload.snapshot.phase, "gameOver")
    assert.equal(finishEvent.payload.room.status, "finished")
    assert.equal(finishEvent.payload.winnerPlayerId, "server-gameover-guest-player")
    assert.equal(finishEvent.payload.loserPlayerId, "server-gameover-host-player")
    assert.equal(finishEvent.payload.reason, "top_out")
    assert.deepEqual(stoppedRoomIds, [roomId])
    const overLog = savedLogs.find(log => log.eventType === "game_over")
    assert.equal(overLog.roomId, roomId)
    assert.equal(overLog.winnerPlayerId, "server-gameover-guest-player")
    assert.equal(overLog.loserPlayerId, "server-gameover-host-player")
    assert.equal(overLog.reason, "top_out")
    assert.equal(overLog.finishType, "normal")
    assert.deepEqual(getMatchState(roomId), {
        ok: false,
        match: null,
        reason: "MATCH_NOT_FOUND",
    })
})

test("game:input hold block-out은 snapshot과 match finish를 한 번만 전송한다", async () => {
    const stoppedRoomIds = []
    const savedLogs = []
    const fixture = await createStartedPvpSocketFixture("hold-block-out", {
        authoritativeTickerService: {
            startRoomTicker() {
                return { ok: true, started: true }
            },
            resetPlayerGravity() {},
            stopRoomTicker(roomId) {
                stoppedRoomIds.push(roomId)
                return { ok: true, stopped: true }
            },
        },
        saveGameEventLog(log) {
            savedLogs.push(log)
            return Promise.resolve({ ok: true, log, reason: null })
        },
    })
    const { socketServer, hostSocket, roomId, hostPlayer, hostPlayerId } = fixture
    const gameCore = await loadGameCore()
    const board = gameCore.createEmptyBoard(gameCore.BOARD_ROWS, gameCore.BOARD_COLS)
    board[0][3] = "stack"
    const activePiece = {
        pieceType: "square",
        rotation: 0,
        row: 5,
        col: 0,
    }
    hostPlayer.authoritativeState.board = board
    hostPlayer.authoritativeState.activePiece = { ...activePiece }
    hostPlayer.authoritativeState.pendingPiece = { ...activePiece }
    hostPlayer.authoritativeState.pieceQueue = ["bar"]
    hostPlayer.authoritativeState.holdPieceType = null
    hostPlayer.authoritativeState.holdUsedThisDrop = false
    hostPlayer.authoritativeState.pieceIndex = 1

    await hostSocket.triggerAsync("game:input", {
        roomId,
        playerId: hostPlayerId,
        action: "hold",
        tick: 12,
        pieceIndex: 1,
        clientSequence: 1,
    })

    const snapshotEvents = socketServer.roomEvents.filter(event => {
        return event.eventName === "game:authoritative:snapshot"
            && event.payload.playerId === hostPlayerId
    })
    const finishEvents = socketServer.roomEvents.filter(event => {
        return event.eventName === "match:finish"
    })
    const overLogs = savedLogs.filter(log => log.eventType === "game_over")

    assert.equal(snapshotEvents.at(-1).payload.snapshot.phase, "gameOver")
    assert.equal(snapshotEvents.at(-1).payload.snapshot.activePiece.pieceType, "")
    assert.equal(finishEvents.length, 1)
    assert.equal(finishEvents[0].payload.reason, "block_out")
    assert.deepEqual(stoppedRoomIds, [roomId])
    assert.equal(overLogs.length, 1)
    assert.equal(overLogs[0].reason, "block_out")
    assert.deepEqual(getMatchState(roomId), {
        ok: false,
        match: null,
        reason: "MATCH_NOT_FOUND",
    })
})

test("game:input 첫 move_left는 match 시작 직후 authoritativeState에 반영된다", async () => {
    const fixture = await createStartedPvpSocketFixture("authoritative-first-input")
    const { hostSocket, guestSocket, roomId, hostPlayer } = fixture

    hostSocket.trigger("game:join", {
        roomId,
        playerId: "authoritative-first-input-host-player",
    })
    guestSocket.trigger("game:join", {
        roomId,
        playerId: "authoritative-first-input-guest-player",
    })

    const activePieceBefore = { ...hostPlayer.authoritativeState.activePiece }

    await hostSocket.triggerAsync("game:input", {
        roomId,
        playerId: "authoritative-first-input-host-player",
        action: "move_left",
        tick: 12,
        pieceIndex: hostPlayer.authoritativeState.pieceIndex,
        clientSequence: 1,
        expectedTransform: createExpectedTransform(activePieceBefore, {
            col: activePieceBefore.col - 1,
        }),
    })

    assert.equal(hostPlayer.authoritativeState.activePiece.pieceType, activePieceBefore.pieceType)
    assert.equal(hostPlayer.authoritativeState.activePiece.col, activePieceBefore.col - 1)
    assert.equal(hostPlayer.authoritativeState.pieceIndex, 1)
})

test("game:input은 연속 authoritativeState와 clientSequence를 갱신한다", async () => {
    const fixture = await createStartedPvpSocketFixture("authoritative-sequence")
    const { socketServer, hostSocket, guestSocket, roomId, hostPlayer } = fixture

    hostSocket.trigger("game:join", {
        roomId,
        playerId: "authoritative-sequence-host-player",
    })
    guestSocket.trigger("game:join", {
        roomId,
        playerId: "authoritative-sequence-guest-player",
    })

    const initialPieceIndex = hostPlayer.authoritativeState.pieceIndex
    const initialCol = hostPlayer.authoritativeState.activePiece.col
    const initialPieceType = hostPlayer.authoritativeState.activePiece.pieceType

    await hostSocket.triggerAsync("game:input", {
        roomId,
        playerId: "authoritative-sequence-host-player",
        action: "move_left",
        tick: 12,
        pieceIndex: initialPieceIndex,
        clientSequence: 1,
        expectedTransform: {
            pieceType: initialPieceType,
            rotation: hostPlayer.authoritativeState.activePiece.rotation,
            col: initialCol - 1,
        },
    })

    assert.equal(hostPlayer.authoritativeState.activePiece.col, initialCol - 1)
    assert.equal(hostPlayer.authoritativeState.pieceIndex, initialPieceIndex)

    const moveSnapshotEvents = socketServer.roomEvents.filter((event) => {
        return event.eventName === "game:authoritative:snapshot"
    })

    assert.equal(moveSnapshotEvents.length, 1)
    assert.equal(moveSnapshotEvents[0].roomId, roomId)
    assert.equal(moveSnapshotEvents[0].payload.roomId, roomId)
    assert.equal(moveSnapshotEvents[0].payload.playerId, "authoritative-sequence-host-player")
    assert.equal(moveSnapshotEvents[0].payload.snapshot.tick, 0)
    assert.equal(moveSnapshotEvents[0].payload.snapshot.pieceIndex, initialPieceIndex)
    assert.equal(moveSnapshotEvents[0].payload.snapshot.activePiece.col, initialCol - 1)

    await hostSocket.triggerAsync("game:input", {
        roomId,
        playerId: "authoritative-sequence-host-player",
        action: "hard_drop",
        tick: 13,
        pieceIndex: initialPieceIndex,
        clientSequence: 2,
        expectedTransform: createExpectedTransform(hostPlayer.authoritativeState.activePiece),
    })

    assert.equal(hostPlayer.authoritativeState.pieceIndex, initialPieceIndex + 1)

    const hardDropSnapshotEvents = socketServer.roomEvents.filter((event) => {
        return event.eventName === "game:authoritative:snapshot"
    })

    assert.equal(hardDropSnapshotEvents.length, 2)
    assert.equal(hardDropSnapshotEvents[1].payload.roomId, roomId)
    assert.equal(hardDropSnapshotEvents[1].payload.playerId, "authoritative-sequence-host-player")
    assert.equal(hardDropSnapshotEvents[1].payload.snapshot.tick, 0)
    assert.equal(hardDropSnapshotEvents[1].payload.snapshot.pieceIndex, initialPieceIndex + 1)
    assert.notEqual(hardDropSnapshotEvents[1].payload.snapshot.activePiece.pieceType, "")

    const snapshotResult = getAuthoritativePlayerSnapshot(roomId, "authoritative-sequence-host-player")
    const snapshot = snapshotResult.snapshot
    const hasLockedPieceCell = snapshot.board.some((row) => {
        return row.some((cell) => cell === initialPieceType)
    })

    assert.equal(snapshotResult.ok, true)
    assert.equal(snapshot.pieceIndex, initialPieceIndex + 1)
    assert.notEqual(snapshot.activePiece.pieceType, "")
    assert.equal(hasLockedPieceCell, true)

    snapshot.activePiece.pieceType = "mutated"
    snapshot.board[19][0] = "mutated"
    assert.notEqual(hostPlayer.authoritativeState.activePiece.pieceType, "mutated")
    assert.notEqual(hostPlayer.authoritativeState.board[19][0], "mutated")

    const stateBeforeStaleInput = structuredClone(hostPlayer.authoritativeState)
    const snapshotEventCountBeforeStaleInput = socketServer.roomEvents.filter((event) => {
        return event.eventName === "game:authoritative:snapshot"
    }).length

    await hostSocket.triggerAsync("game:input", {
        roomId,
        playerId: "authoritative-sequence-host-player",
        action: "move_left",
        tick: 14,
        pieceIndex: initialPieceIndex,
        clientSequence: 3,
        expectedTransform: createExpectedTransform(hostPlayer.authoritativeState.activePiece, {
            col: hostPlayer.authoritativeState.activePiece.col - 1,
        }),
    })

    assert.deepEqual(hostPlayer.authoritativeState, stateBeforeStaleInput)
    assert.equal(socketServer.roomEvents.filter((event) => {
        return event.eventName === "game:authoritative:snapshot"
    }).length, snapshotEventCountBeforeStaleInput + 1)
    assert.equal(hostSocket.lastClientEvent("game:input:result")?.payload.reason, "PIECE_INDEX_MISMATCH")

    await hostSocket.triggerAsync("game:input", {
        roomId,
        playerId: "authoritative-sequence-host-player",
        action: "move_right",
        tick: 15,
        pieceIndex: hostPlayer.authoritativeState.pieceIndex,
        clientSequence: 2,
        expectedTransform: createExpectedTransform(hostPlayer.authoritativeState.activePiece, {
            col: hostPlayer.authoritativeState.activePiece.col + 1,
        }),
    })

    assert.deepEqual(hostPlayer.authoritativeState, stateBeforeStaleInput)
    assert.deepEqual(hostSocket.lastClientEvent("game:input:result")?.payload, {
        ok: false,
        reason: "CLIENT_SEQUENCE_OUT_OF_ORDER",
        clientSequence: 2,
        pieceIndex: hostPlayer.authoritativeState.pieceIndex,
        placementCommitted: false,
    })
})

test("game:input PIECE_INDEX_MISMATCH는 state를 변경하지 않고 즉시 authoritative snapshot을 emit한다", async () => {
    const fixture = await createStartedPvpSocketFixture("stale-index")
    const { socketServer, hostSocket, guestSocket, roomId, hostPlayer } = fixture

    hostSocket.trigger("game:join", {
        roomId,
        playerId: "stale-index-host-player",
    })
    guestSocket.trigger("game:join", {
        roomId,
        playerId: "stale-index-guest-player",
    })

    const beforeState = structuredClone(hostPlayer.authoritativeState)

    await hostSocket.triggerAsync("game:input", {
        roomId,
        playerId: "stale-index-host-player",
        action: "move_left",
        tick: 12,
        pieceIndex: hostPlayer.authoritativeState.pieceIndex + 1,
        clientSequence: 1,
        expectedTransform: createExpectedTransform(beforeState.activePiece, {
            col: beforeState.activePiece.col - 1,
        }),
    })

    assert.deepEqual(hostPlayer.authoritativeState, beforeState)

    const inputResult = hostSocket.lastClientEvent("game:input:result")?.payload
    const snapshotEvents = socketServer.roomEvents.filter((event) => {
        return event.eventName === "game:authoritative:snapshot"
            && event.payload.playerId === "stale-index-host-player"
    })

    assert.equal(inputResult?.ok, false)
    assert.equal(inputResult?.reason, "PIECE_INDEX_MISMATCH")
    assert.equal(inputResult?.clientSequence, 1)
    assert.equal(inputResult?.pieceIndex, beforeState.pieceIndex + 1)
    assert.equal(snapshotEvents.length, 1)
    assert.equal(snapshotEvents[0].payload.snapshot.pieceIndex, beforeState.pieceIndex)
    assert.equal(snapshotEvents[0].payload.snapshot.lastProcessedClientSequence, 1)
    assert.deepEqual(snapshotEvents[0].payload.snapshot.board, beforeState.board)
    assert.equal(Object.hasOwn(snapshotEvents[0].payload.snapshot, "pendingGarbageQueue"), false)
})

test("game:input은 clientSequence가 없으면 INVALID_PAYLOAD로 거부한다", async () => {
    const socketServer = new FakeSocketServer()
    const hostSocket = new FakeClientSocket("missing-client-sequence-host-socket")
    const guestSocket = new FakeClientSocket("missing-client-sequence-guest-socket")

    registerTestSocketHandlers(socketServer)
    socketServer.connect(hostSocket)
    socketServer.connect(guestSocket)

    hostSocket.trigger("room:create", {
        playerId: "missing-client-sequence-host-player",
        nickname: "Host",
    })
    const roomId = hostSocket.lastClientEvent("room:result").payload.room.roomId
    guestSocket.trigger("room:join", {
        roomId,
        player: {
            playerId: "missing-client-sequence-guest-player",
            nickname: "Guest",
        },
    })
    await hostSocket.triggerAsync("room:start", {
        roomId,
        playerId: "missing-client-sequence-host-player",
    })

    await hostSocket.triggerAsync("game:input", {
        roomId,
        playerId: "missing-client-sequence-host-player",
        action: "move_left",
        tick: 1,
        pieceIndex: 1,
    })

    const result = hostSocket.lastClientEvent("game:input:result")?.payload
    assert.equal(result?.ok, false)
    assert.equal(result?.reason, "INVALID_PAYLOAD")
})

test("game:input은 authoritative apply 실패를 ack한다", async () => {
    const socketServer = new FakeSocketServer()
    const hostSocket = new FakeClientSocket("authoritative-failure-host-socket")
    const guestSocket = new FakeClientSocket("authoritative-failure-guest-socket")

    registerTestSocketHandlers(socketServer)
    socketServer.connect(hostSocket)
    socketServer.connect(guestSocket)

    hostSocket.trigger("room:create", {
        playerId: "authoritative-failure-host-player",
        nickname: "Host",
    })
    const createResult = hostSocket.lastClientEvent("room:result").payload
    const roomId = createResult.room.roomId

    guestSocket.trigger("room:join", {
        roomId,
        player: {
            playerId: "authoritative-failure-guest-player",
            nickname: "Guest",
        },
    })

    await hostSocket.triggerAsync("room:start", {
        roomId,
        playerId: "authoritative-failure-host-player",
    })

    hostSocket.trigger("game:join", {
        roomId,
        playerId: "authoritative-failure-host-player",
    })
    guestSocket.trigger("game:join", {
        roomId,
        playerId: "authoritative-failure-guest-player",
    })

    const matchResult = getMatchState(roomId)
    const hostPlayer = matchResult.match.players.find((player) => {
        return player.playerId === "authoritative-failure-host-player"
    })
    hostPlayer.authoritativeState.holdUsedThisDrop = true
    const currentPieceIndex = hostPlayer.authoritativeState.pieceIndex

    await hostSocket.triggerAsync("game:input", {
        roomId,
        playerId: "authoritative-failure-host-player",
        action: "hold",
        tick: 12,
        pieceIndex: currentPieceIndex,
        clientSequence: 1,
    })

    assert.deepEqual(hostSocket.lastClientEvent("game:input:result")?.payload, {
        ok: false,
        reason: "HOLD_NOT_AVAILABLE",
        clientSequence: 1,
        pieceIndex: currentPieceIndex,
        placementCommitted: false,
    })
})

test("game:input authoritative 예외는 sequence를 ack하고 현재 snapshot과 실패 result를 보낸다", async () => {
    const socketServer = new FakeSocketServer()
    const hostSocket = new FakeClientSocket("authoritative-exception-host-socket")
    const guestSocket = new FakeClientSocket("authoritative-exception-guest-socket")

    registerTestSocketHandlers(socketServer, {
        loadGameCore() {
            return Promise.reject(new Error("core load failed"))
        },
    })
    socketServer.connect(hostSocket)
    socketServer.connect(guestSocket)

    hostSocket.trigger("room:create", {
        playerId: "authoritative-exception-host-player",
        nickname: "Host",
    })
    const roomId = hostSocket.lastClientEvent("room:result").payload.room.roomId
    guestSocket.trigger("room:join", {
        roomId,
        player: {
            playerId: "authoritative-exception-guest-player",
            nickname: "Guest",
        },
    })
    await hostSocket.triggerAsync("room:start", {
        roomId,
        playerId: "authoritative-exception-host-player",
    })

    const match = getMatchState(roomId).match
    const hostPlayer = match.players.find(player => {
        return player.playerId === "authoritative-exception-host-player"
    })
    const stateBeforeInput = structuredClone(hostPlayer.authoritativeState)

    await hostSocket.triggerAsync("game:input", {
        roomId,
        playerId: "authoritative-exception-host-player",
        action: "move_left",
        tick: 1,
        pieceIndex: stateBeforeInput.pieceIndex,
        clientSequence: 1,
        expectedTransform: createExpectedTransform(stateBeforeInput.activePiece, {
            col: stateBeforeInput.activePiece.col - 1,
        }),
    })

    const snapshotEvent = socketServer.roomEvents.findLast(event => {
        return event.eventName === "game:authoritative:snapshot"
            && event.payload.playerId === "authoritative-exception-host-player"
    })
    assert.equal(hostPlayer.lastProcessedClientSequence, 1)
    assert.deepEqual(hostPlayer.authoritativeState, stateBeforeInput)
    assert.equal(snapshotEvent.payload.snapshot.lastProcessedClientSequence, 1)
    assert.deepEqual(hostSocket.lastClientEvent("game:input:result")?.payload, {
        ok: false,
        reason: "AUTHORITATIVE_INPUT_FAILED",
        clientSequence: 1,
        pieceIndex: stateBeforeInput.pieceIndex,
        placementCommitted: false,
    })
})

test("game:log:placement_decision은 유효한 로그를 한 번만 저장하고 replay를 거부한다", async () => {
    const socketServer = new FakeSocketServer()
    const hostSocket = new FakeClientSocket("log-host-socket")
    const guestSocket = new FakeClientSocket("log-guest-socket")

    registerTestSocketHandlers(socketServer, {
        savePlacementDecisionLog(log) {
            savedLogs.push(log)
            return Promise.resolve({
                ok: true,
                log,
                reason: null,
            })
        },
        saveGameEventLog(log) {
            return Promise.resolve({
                ok: true,
                log,
                reason: null,
            })
        },
    })
    const savedLogs = []
    socketServer.connect(hostSocket)
    socketServer.connect(guestSocket)

    hostSocket.trigger("room:create", {
        playerId: "log-host-player",
        nickname: "Host",
    })
    const createResult = hostSocket.lastClientEvent("room:result").payload
    const roomId = createResult.room.roomId

    guestSocket.trigger("room:join", {
        roomId,
        player: {
            playerId: "log-guest-player",
            nickname: "Guest",
        },
    })
    hostSocket.trigger("room:start", {
        roomId,
        playerId: "log-host-player",
    })
    assert.equal(
        recordHumanPlacementReceipt(roomId, "log-host-player", 1, 2).ok,
        true,
    )

    await hostSocket.triggerAsync("game:log:placement_decision", {
        roomId,
        playerId: "log-host-player",
        log: {
            eventType: "placement_decision",
            schemaVersion: 1,
            roomId,
            playerId: "log-host-player",
            gameId: `${roomId}-game`,
            pieceIndex: 2,
            authoritativeClientSequence: 1,
            authoritativePieceIndex: 2,
            boardBefore: [[null]],
            boardAfter: [["square"]],
            placementResult: {
                linesCleared: 0,
                isTSpin: false,
                combo: 0,
                backToBack: false,
                rawAttackLines: 0,
                attackLines: 0,
                canceledGarbageLines: 0,
                incomingGarbageLines: 0,
                appliedGarbageLines: 0,
                scoreBefore: 100,
                scoreAfter: 100,
                scoreDelta: 0,
                gameOver: false,
            },
            selectedPlacement: {
                pieceType: "square",
                rotation: 0,
                row: 18,
                col: 4,
            },
        },
    })

    const logResult = hostSocket.lastClientEvent("game:log:result")?.payload

    assert.equal(savedLogs.length, 1)
    assert.equal(savedLogs[0].eventType, "placement_decision")
    assert.equal(savedLogs[0].gameId, getMatchState(roomId).match.gameId)
    assert.notEqual(savedLogs[0].gameId, `${roomId}-game`)
    assert.equal(savedLogs[0].playerId, "log-host-player")
    assert.equal(logResult.ok, true)
    assert.equal(logResult.reason, null)

    await hostSocket.triggerAsync("game:log:placement_decision", {
        roomId,
        log: savedLogs[0],
    })
    assert.equal(savedLogs.length, 1)
    assert.equal(
        hostSocket.lastClientEvent("game:log:result")?.payload.reason,
        "PLACEMENT_RECEIPT_NOT_FOUND",
    )
})

test("game:log:placement_decision은 waiting 상태이면 저장하지 않는다", async () => {
    const socketServer = new FakeSocketServer()
    const hostSocket = new FakeClientSocket("log-waiting-host-socket")
    const guestSocket = new FakeClientSocket("log-waiting-guest-socket")
    const savedLogs = []

    registerTestSocketHandlers(socketServer, {
        savePlacementDecisionLog(log) {
            savedLogs.push(log)
            return Promise.resolve({
                ok: true,
                log,
                reason: null,
            })
        },
    })
    socketServer.connect(hostSocket)
    socketServer.connect(guestSocket)

    hostSocket.trigger("room:create", {
        playerId: "log-waiting-host",
        nickname: "Host",
    })
    const createResult = hostSocket.lastClientEvent("room:result").payload
    const roomId = createResult.room.roomId

    guestSocket.trigger("room:join", {
        roomId,
        player: {
            playerId: "log-waiting-guest",
            nickname: "Guest",
        },
    })

    await hostSocket.triggerAsync("game:log:placement_decision", {
        roomId,
        playerId: "log-waiting-host",
        log: {
            eventType: "placement_decision",
            schemaVersion: 1,
            roomId,
            playerId: "log-waiting-host",
            placementResult: {
                linesCleared: 0,
            },
        },
    })

    const logResult = hostSocket.lastClientEvent("game:log:result")?.payload

    assert.equal(savedLogs.length, 0)
    assert.equal(logResult.ok, false)
    assert.equal(logResult.reason, "GAME_LOG_NOT_ALLOWED")
})

test("game:log:placement_decision은 invalid schema이면 저장하지 않는다", async () => {
    const socketServer = new FakeSocketServer()
    const hostSocket = new FakeClientSocket("log-schema-host-socket")
    const guestSocket = new FakeClientSocket("log-schema-guest-socket")
    const savedLogs = []

    registerTestSocketHandlers(socketServer, {
        savePlacementDecisionLog(log) {
            savedLogs.push(log)
            return Promise.resolve({
                ok: true,
                log,
                reason: null,
            })
        },
    })
    socketServer.connect(hostSocket)
    socketServer.connect(guestSocket)

    hostSocket.trigger("room:create", {
        playerId: "log-schema-host",
        nickname: "Host",
    })
    const createResult = hostSocket.lastClientEvent("room:result").payload
    const roomId = createResult.room.roomId

    guestSocket.trigger("room:join", {
        roomId,
        player: {
            playerId: "log-schema-guest",
            nickname: "Guest",
        },
    })
    hostSocket.trigger("room:start", {
        roomId,
        playerId: "log-schema-host",
    })

    await hostSocket.triggerAsync("game:log:placement_decision", {
        roomId,
        playerId: "log-schema-host",
        log: {
            eventType: "placement_decision",
            schemaVersion: 1,
            roomId: "different-room",
            playerId: "log-schema-host",
            placementResult: createPlacementResult(),
        },
    })

    const logResult = hostSocket.lastClientEvent("game:log:result")?.payload

    assert.equal(savedLogs.length, 0)
    assert.equal(logResult.ok, false)
    assert.equal(logResult.reason, "GAME_ID_REQUIRED")
})

test("game:log:placement_decision은 v1/v2 placementResult scalar 하나가 invalid이면 저장하지 않는다", async () => {
    const socketServer = new FakeSocketServer()
    const hostSocket = new FakeClientSocket("log-result-schema-host-socket")
    const guestSocket = new FakeClientSocket("log-result-schema-guest-socket")
    const savedLogs = []

    registerTestSocketHandlers(socketServer, {
        savePlacementDecisionLog(log) {
            savedLogs.push(log)
            return Promise.resolve({
                ok: true,
                log,
                reason: null,
            })
        },
    })
    socketServer.connect(hostSocket)
    socketServer.connect(guestSocket)

    hostSocket.trigger("room:create", {
        playerId: "log-result-schema-host",
        nickname: "Host",
    })
    const createResult = hostSocket.lastClientEvent("room:result").payload
    const roomId = createResult.room.roomId

    guestSocket.trigger("room:join", {
        roomId,
        player: {
            playerId: "log-result-schema-guest",
            nickname: "Guest",
        },
    })
    hostSocket.trigger("room:start", {
        roomId,
        playerId: "log-result-schema-host",
    })

    const invalidPlacementResult = createPlacementResult({ rawAttackLines: -1 })
    for (const log of [
        createHumanPlacementLogV1(roomId, { placementResult: invalidPlacementResult }),
        createHumanPlacementLogV2(roomId, { placementResult: invalidPlacementResult }),
    ]) {
        await hostSocket.triggerAsync("game:log:placement_decision", { roomId, log })
        assert.equal(hostSocket.lastClientEvent("game:log:result")?.payload.reason, "INVALID_PLACEMENT_DECISION_LOG")
    }

    assert.equal(savedLogs.length, 0)
})

test("game:log:placement_decision은 순환 및 512 KiB 미만 깊은 payload를 예외 없이 거부한다", async () => {
    const socketServer = new FakeSocketServer()
    const hostSocket = new FakeClientSocket("log-deep-host-socket")
    const savedLogs = []
    registerTestSocketHandlers(socketServer, {
        savePlacementDecisionLog(log) {
            savedLogs.push(log)
            return Promise.resolve({ ok: true, log, reason: null })
        },
    })
    socketServer.connect(hostSocket)
    hostSocket.trigger("room:create", {
        mode: "pve",
        playerId: "log-deep-host",
        nickname: "Host",
    })
    const roomId = hostSocket.lastClientEvent("room:result").payload.room.roomId
    hostSocket.trigger("room:start", { roomId })

    const cyclicLog = createHumanPlacementLogV1(roomId)
    cyclicLog.diagnostics = cyclicLog
    await assert.doesNotReject(() => hostSocket.triggerAsync(
        "game:log:placement_decision",
        { roomId, log: cyclicLog },
    ))
    assert.equal(hostSocket.lastClientEvent("game:log:result").payload.reason, "INVALID_LOG_PAYLOAD")

    const depth = 12_000
    const deepLog = createHumanPlacementLogV1(roomId, { diagnostics: {} })
    let cursor = deepLog.diagnostics
    for (let index = 0; index < depth; index += 1) {
        cursor.next = {}
        cursor = cursor.next
    }
    assert.equal((depth * 9) + 2 < 512 * 1024, true)
    await assert.doesNotReject(() => hostSocket.triggerAsync(
        "game:log:placement_decision",
        { roomId, log: deepLog },
    ))
    assert.equal(hostSocket.lastClientEvent("game:log:result").payload.reason, "INVALID_LOG_PAYLOAD")
    assert.equal(savedLogs.length, 0)
})

test("game:log:placement_decision은 finished 상태의 늦은 로그 저장을 허용한다", async () => {
    const socketServer = new FakeSocketServer()
    const hostSocket = new FakeClientSocket("log-finished-host-socket")
    const guestSocket = new FakeClientSocket("log-finished-guest-socket")
    const savedLogs = []

    registerTestSocketHandlers(socketServer, {
        savePlacementDecisionLog(log) {
            savedLogs.push(log)
            return Promise.resolve({
                ok: true,
                log,
                reason: null,
            })
        },
    })
    socketServer.connect(hostSocket)
    socketServer.connect(guestSocket)

    hostSocket.trigger("room:create", {
        playerId: "log-finished-host",
        nickname: "Host",
    })
    const createResult = hostSocket.lastClientEvent("room:result").payload
    const roomId = createResult.room.roomId

    guestSocket.trigger("room:join", {
        roomId,
        player: {
            playerId: "log-finished-guest",
            nickname: "Guest",
        },
    })
    hostSocket.trigger("room:start", {
        roomId,
        playerId: "log-finished-host",
    })
    assert.equal(
        recordHumanPlacementReceipt(roomId, "log-finished-host", 2, 2).ok,
        true,
    )
    const gameCore = await loadGameCore()
    const matchResult = getMatchState(roomId)
    prepareTopOutState(gameCore, matchResult.match, "log-finished-guest")

    await guestSocket.triggerAsync("game:input", {
        roomId,
        playerId: "log-finished-guest",
        action: "hard_drop",
        tick: 12,
        pieceIndex: 1,
        clientSequence: 1,
        expectedTransform: { pieceType: "tree", rotation: 1, col: 4 },
    })

    await hostSocket.triggerAsync("game:log:placement_decision", {
        roomId,
        playerId: "log-finished-host",
        log: {
            eventType: "placement_decision",
            schemaVersion: 1,
            roomId,
            playerId: "log-finished-host",
            gameId: `${roomId}-game`,
            pieceIndex: 2,
            authoritativeClientSequence: 2,
            authoritativePieceIndex: 2,
            boardBefore: [[null]],
            boardAfter: [["square"]],
            selectedPlacement: {
                pieceType: "square",
                rotation: 0,
                row: 18,
                col: 4,
            },
            placementResult: {
                linesCleared: 0,
                isTSpin: false,
                combo: 0,
                backToBack: false,
                rawAttackLines: 0,
                attackLines: 0,
                canceledGarbageLines: 0,
                incomingGarbageLines: 0,
                appliedGarbageLines: 0,
                scoreBefore: 100,
                scoreAfter: 100,
                scoreDelta: 0,
                gameOver: false,
            },
        },
    })

    const logResult = hostSocket.lastClientEvent("game:log:result")?.payload

    assert.equal(savedLogs.length, 1)
    assert.equal(savedLogs[0].roomId, roomId)
    assert.equal(logResult.ok, true)
    assert.equal(logResult.reason, null)
})

test("human v2 placement log는 확장 좌표를 보존하고 private field를 차단한다", async () => {
    const socketServer = new FakeSocketServer()
    const hostSocket = new FakeClientSocket("log-v2-host-socket")
    const savedLogs = []
    registerTestSocketHandlers(socketServer, {
        savePlacementDecisionLog(log) {
            savedLogs.push(log)
            return Promise.resolve({ ok: true, log, reason: null })
        },
    })
    socketServer.connect(hostSocket)
    hostSocket.trigger("room:create", {
        mode: "pve",
        player: { playerId: "log-v2-host", nickname: "Host" },
    })
    const roomId = hostSocket.lastClientEvent("room:result").payload.room.roomId
    hostSocket.trigger("room:start", { roomId })
    assert.equal(
        recordHumanPlacementReceipt(roomId, "log-v2-host", 1, 3).ok,
        true,
    )

    await hostSocket.triggerAsync("game:log:placement_decision", {
        roomId,
        log: createHumanPlacementLogV2(roomId),
    })
    assert.equal(savedLogs.length, 1)
    assert.equal(savedLogs[0].selectedPlacement.type, "square")
    assert.equal(savedLogs[0].selectedPlacement.cells[0].x, 0)

    await hostSocket.triggerAsync("game:log:placement_decision", {
        roomId,
        log: createHumanPlacementLogV2(roomId, {
            diagnostics: { token: "must-not-be-accepted" },
        }),
    })
    assert.equal(savedLogs.length, 1)
    assert.equal(hostSocket.lastClientEvent("game:log:result").payload.reason, "INVALID_PLACEMENT_DECISION_LOG")
})

test("game:log:placement_decision은 room 참가자가 아닌 playerId면 저장하지 않는다", async () => {
    const socketServer = new FakeSocketServer()
    const hostSocket = new FakeClientSocket("log-auth-host-socket")
    const intruderSocket = new FakeClientSocket("log-auth-intruder-socket")
    const savedLogs = []

    registerTestSocketHandlers(socketServer, {
        savePlacementDecisionLog(log) {
            savedLogs.push(log)
            return Promise.resolve({
                ok: true,
                log,
                reason: null,
            })
        },
    })
    socketServer.connect(hostSocket)
    socketServer.connect(intruderSocket)

    hostSocket.trigger("room:create", {
        playerId: "log-auth-host-player",
        nickname: "Host",
    })
    const createResult = hostSocket.lastClientEvent("room:result").payload
    const roomId = createResult.room.roomId

    await intruderSocket.triggerAsync("game:log:placement_decision", {
        roomId,
        playerId: "log-auth-intruder-player",
        log: {
            eventType: "placement_decision",
            schemaVersion: 1,
            playerId: "log-auth-intruder-player",
            gameId: `${roomId}-game`,
            pieceIndex: 2,
            boardBefore: [[null]],
            boardAfter: [["square"]],
            selectedPlacement: {
                pieceType: "square",
                rotation: 0,
                row: 18,
                col: 4,
            },
        },
    })

    const logResult = intruderSocket.lastClientEvent("game:log:result")?.payload

    assert.equal(savedLogs.length, 0)
    assert.equal(logResult.ok, false)
    assert.equal(logResult.reason, "NOT_AUTHORIZED")
})

test("room:start는 game_start 로그를 저장한다", async () => {
    const socketServer = new FakeSocketServer()
    const hostSocket = new FakeClientSocket("start-log-host-socket")
    const guestSocket = new FakeClientSocket("start-log-guest-socket")
    const savedLogs = []

    registerTestSocketHandlers(socketServer, {
        saveGameEventLog(log) {
            savedLogs.push(log)
            return Promise.resolve({
                ok: true,
                log,
                reason: null,
            })
        },
    })
    socketServer.connect(hostSocket)
    socketServer.connect(guestSocket)

    hostSocket.trigger("room:create", {
        playerId: "start-log-host",
        nickname: "Host",
    })
    const createResult = hostSocket.lastClientEvent("room:result").payload
    const roomId = createResult.room.roomId

    guestSocket.trigger("room:join", {
        roomId,
        player: {
            playerId: "start-log-guest",
            nickname: "Guest",
        },
    })

    await hostSocket.triggerAsync("room:start", {
        roomId,
        playerId: "start-log-host",
    })

    const startLog = savedLogs.find(log => log.eventType === "game_start")

    assert.equal(startLog.roomId, roomId)
    assert.equal(startLog.mode, "multi")
    assert.equal(startLog.players.length, 2)
    assert.equal(startLog.players[0].role, "host")
    assert.equal(typeof startLog.startedAt, "number")
})

test("socket disposer 이후 기존 socket은 새 경기 event를 생산하지 않는다", async () => {
    const socketServer = new FakeSocketServer()
    const hostSocket = new FakeClientSocket("shutdown-host-socket")
    const savedLogs = []
    const dispose = registerTestSocketHandlers(socketServer, {
        saveGameEventLog(log) {
            savedLogs.push(log)
            return Promise.resolve({ ok: true, log, reason: null })
        },
    })
    socketServer.connect(hostSocket)
    hostSocket.trigger("room:create", {
        mode: "pve",
        player: { playerId: "shutdown-host", nickname: "Host" },
    })
    const roomId = hostSocket.lastClientEvent("room:result").payload.room.roomId

    dispose()
    await hostSocket.triggerAsync("room:start", { roomId })

    assert.equal(getRoomState(roomId).status, "waiting")
    assert.equal(savedLogs.length, 0)
})

test("server authoritative gameOver는 game_over 로그를 저장한다", async () => {
    const socketServer = new FakeSocketServer()
    const hostSocket = new FakeClientSocket("over-log-host-socket")
    const guestSocket = new FakeClientSocket("over-log-guest-socket")
    const savedLogs = []

    registerTestSocketHandlers(socketServer, {
        saveGameEventLog(log) {
            savedLogs.push(log)
            return Promise.resolve({
                ok: true,
                log,
                reason: null,
            })
        },
    })
    socketServer.connect(hostSocket)
    socketServer.connect(guestSocket)

    hostSocket.trigger("room:create", {
        playerId: "over-log-host",
        nickname: "Host",
    })
    const createResult = hostSocket.lastClientEvent("room:result").payload
    const roomId = createResult.room.roomId

    guestSocket.trigger("room:join", {
        roomId,
        player: {
            playerId: "over-log-guest",
            nickname: "Guest",
        },
    })

    await hostSocket.triggerAsync("room:start", {
        roomId,
        playerId: "over-log-host",
    })
    const gameCore = await loadGameCore()
    const matchResult = getMatchState(roomId)
    prepareTopOutState(gameCore, matchResult.match, "over-log-guest")

    await guestSocket.triggerAsync("game:input", {
        roomId,
        playerId: "over-log-guest",
        action: "hard_drop",
        tick: 12,
        pieceIndex: 1,
        clientSequence: 1,
        expectedTransform: { pieceType: "tree", rotation: 1, col: 4 },
    })

    const overLog = savedLogs.find(log => log.eventType === "game_over")

    assert.equal(overLog.roomId, roomId)
    assert.equal(overLog.gameId, matchResult.match.gameId)
    assert.equal(overLog.mode, "multi")
    assert.equal(overLog.winnerPlayerId, "over-log-host")
    assert.equal(overLog.loserPlayerId, "over-log-guest")
    assert.equal(overLog.reason, "top_out")
    assert.equal(overLog.finishType, "normal")
    assert.equal(typeof overLog.endedAt, "number")
    assert.deepEqual(getMatchState(roomId), {
        ok: false,
        match: null,
        reason: "MATCH_NOT_FOUND",
    })
})

test("game:input은 room 참가자가 아닌 playerId면 거부한다", () => {
    const socketServer = new FakeSocketServer()
    const hostSocket = new FakeClientSocket("input-auth-host-socket")
    const guestSocket = new FakeClientSocket("input-auth-guest-socket")
    const intruderSocket = new FakeClientSocket("input-auth-intruder-socket")

    registerTestSocketHandlers(socketServer)
    socketServer.connect(hostSocket)
    socketServer.connect(guestSocket)
    socketServer.connect(intruderSocket)

    hostSocket.trigger("room:create", {
        playerId: "input-auth-host",
        nickname: "Host",
    })
    const createResult = hostSocket.lastClientEvent("room:result").payload
    const roomId = createResult.room.roomId

    guestSocket.trigger("room:join", {
        roomId,
        player: {
            playerId: "input-auth-guest",
            nickname: "Guest",
        },
    })

    hostSocket.trigger("game:join", {
        roomId,
        playerId: "input-auth-host",
    })
    guestSocket.trigger("game:join", {
        roomId,
        playerId: "input-auth-guest",
    })

    intruderSocket.trigger("game:input", {
        roomId,
        playerId: "input-auth-intruder",
        action: "move_left",
        tick: 12,
        pieceIndex: 1,
        clientSequence: 1,
        expectedTransform: { pieceType: "bar", rotation: 0, col: 3 },
    })

    const inputResult = intruderSocket.lastClientEvent("game:input:result")?.payload
    assert.equal(inputResult?.ok, false)
    assert.equal(inputResult?.reason, "NOT_AUTHORIZED")
})

test("game:input은 허용되지 않은 action이면 거부한다", () => {
    const socketServer = new FakeSocketServer()
    const hostSocket = new FakeClientSocket("input-invalid-host-socket")
    const guestSocket = new FakeClientSocket("input-invalid-guest-socket")

    registerTestSocketHandlers(socketServer)
    socketServer.connect(hostSocket)
    socketServer.connect(guestSocket)

    hostSocket.trigger("room:create", {
        playerId: "input-invalid-host",
        nickname: "Host",
    })
    const createResult = hostSocket.lastClientEvent("room:result").payload
    const roomId = createResult.room.roomId

    guestSocket.trigger("room:join", {
        roomId,
        player: {
            playerId: "input-invalid-guest",
            nickname: "Guest",
        },
    })
    hostSocket.trigger("room:start", {
        roomId,
        playerId: "input-invalid-host",
    })

    hostSocket.trigger("game:input", {
        roomId,
        playerId: "input-invalid-host",
        action: "delete_board",
        tick: 12,
        clientSequence: 1,
    })

    const inputResult = hostSocket.lastClientEvent("game:input:result")?.payload
    assert.equal(inputResult?.ok, false)
    assert.equal(inputResult?.reason, "INVALID_PAYLOAD")
})

test("game:input은 invalid tick 또는 pieceIndex면 거부한다", () => {
    const socketServer = new FakeSocketServer()
    const hostSocket = new FakeClientSocket("input-invalid-timing-host-socket")
    const guestSocket = new FakeClientSocket("input-invalid-timing-guest-socket")

    registerTestSocketHandlers(socketServer)
    socketServer.connect(hostSocket)
    socketServer.connect(guestSocket)

    hostSocket.trigger("room:create", {
        playerId: "input-invalid-timing-host",
        nickname: "Host",
    })
    const createResult = hostSocket.lastClientEvent("room:result").payload
    const roomId = createResult.room.roomId

    guestSocket.trigger("room:join", {
        roomId,
        player: {
            playerId: "input-invalid-timing-guest",
            nickname: "Guest",
        },
    })
    hostSocket.trigger("room:start", {
        roomId,
        playerId: "input-invalid-timing-host",
    })

    hostSocket.trigger("game:input", {
        roomId,
        playerId: "input-invalid-timing-host",
        action: "move_left",
        tick: -1,
        pieceIndex: 4,
        clientSequence: 1,
    })

    const inputResult = hostSocket.lastClientEvent("game:input:result")?.payload
    assert.equal(inputResult?.ok, false)
    assert.equal(inputResult?.reason, "INVALID_PAYLOAD")
})

test("game:input은 playing 상태가 아니면 거부한다", () => {
    const socketServer = new FakeSocketServer()
    const hostSocket = new FakeClientSocket("input-waiting-host-socket")
    const guestSocket = new FakeClientSocket("input-waiting-guest-socket")

    registerTestSocketHandlers(socketServer)
    socketServer.connect(hostSocket)
    socketServer.connect(guestSocket)

    hostSocket.trigger("room:create", {
        playerId: "input-waiting-host",
        nickname: "Host",
    })
    const createResult = hostSocket.lastClientEvent("room:result").payload
    const roomId = createResult.room.roomId

    guestSocket.trigger("room:join", {
        roomId,
        player: {
            playerId: "input-waiting-guest",
            nickname: "Guest",
        },
    })

    hostSocket.trigger("game:input", {
        roomId,
        playerId: "input-waiting-host",
        action: "move_left",
        tick: 12,
        pieceIndex: 4,
        clientSequence: 1,
        expectedTransform: { pieceType: "bar", rotation: 0, col: 3 },
    })

    const inputResult = hostSocket.lastClientEvent("game:input:result")?.payload
    assert.equal(inputResult?.ok, false)
    assert.equal(inputResult?.reason, "GAME_NOT_PLAYING")
})

test("server authoritative gameOver 이후 한 명만 로비로 돌아오면 room:start를 허용하지 않는다", async () => {
    const socketServer = new FakeSocketServer()
    const hostSocket = new FakeClientSocket("finish-restart-host-socket")
    const guestSocket = new FakeClientSocket("finish-restart-guest-socket")
    const hostLobbySocket = new FakeClientSocket("finish-restart-host-lobby-socket")

    registerTestSocketHandlers(socketServer)
    socketServer.connect(hostSocket)
    socketServer.connect(guestSocket)
    socketServer.connect(hostLobbySocket)

    hostSocket.trigger("room:create", {
        playerId: "finish-restart-host-player",
        nickname: "Host",
    })
    const createResult = hostSocket.lastClientEvent("room:result").payload
    const roomId = createResult.room.roomId

    guestSocket.trigger("room:join", {
        roomId,
        player: {
            playerId: "finish-restart-guest-player",
            nickname: "Guest",
        },
    })

    hostSocket.trigger("room:start", {
        roomId,
        playerId: "finish-restart-host-player",
    })

    const gameCore = await loadGameCore()
    const matchResult = getMatchState(roomId)
    prepareTopOutState(gameCore, matchResult.match, "finish-restart-guest-player")

    await guestSocket.triggerAsync("game:input", {
        roomId,
        playerId: "finish-restart-guest-player",
        action: "hard_drop",
        tick: 12,
        pieceIndex: 1,
        clientSequence: 1,
        expectedTransform: { pieceType: "tree", rotation: 1, col: 4 },
    })

    hostLobbySocket.trigger("room:sync", {
        roomId,
        playerId: "finish-restart-host-player",
    })

    hostLobbySocket.trigger("room:start", {
        roomId,
        playerId: "finish-restart-host-player",
    })

    const syncResult = hostLobbySocket.clientEvents
        .filter(event => event.eventName === "room:result")
        .at(-2)
        .payload
    const startResult = hostLobbySocket.lastClientEvent("room:result").payload

    assert.equal(syncResult.ok, true)
    assert.equal(syncResult.room.status, "finished")
    assert.equal(startResult.ok, false)
    assert.equal(startResult.reason, "GAME_NOT_READY")
})

test("game:join은 서버에 없는 room이면 실패 결과를 돌려준다", () => {
    const socketServer = new FakeSocketServer()
    const gameSocket = new FakeClientSocket("missing-game-socket")

    registerTestSocketHandlers(socketServer)
    socketServer.connect(gameSocket)

    gameSocket.trigger("game:join", {
        roomId: "DEADBEEF",
        playerId: "missing-player",
    })

    const joinResult = gameSocket.lastClientEvent("game:join:result")

    assert.equal(joinResult.payload.ok, false)
    assert.equal(joinResult.payload.room, null)
    assert.equal(joinResult.payload.reason, "NOT_AUTHORIZED")
    assert.deepEqual(gameSocket.joinedRooms, [])
})

test("game:join은 시작 전 waiting room에서 gameplay 참가를 거부한다", () => {
    const socketServer = new FakeSocketServer()
    const lobbySocket = new FakeClientSocket("game-join-lobby-socket")
    const gameSocket = new FakeClientSocket("game-join-game-socket")

    registerTestSocketHandlers(socketServer)
    socketServer.connect(lobbySocket)
    socketServer.connect(gameSocket)

    lobbySocket.trigger("room:create", {
        playerId: "game-join-player",
        nickname: "Host",
    })
    const createResult = lobbySocket.lastClientEvent("room:result").payload
    const roomId = createResult.room.roomId

    gameSocket.trigger("game:join", {
        roomId,
        playerId: "game-join-player",
    })

    const joinResult = gameSocket.lastClientEvent("game:join:result").payload

    assert.equal(joinResult.ok, false)
    assert.equal(joinResult.reason, "GAME_NOT_PLAYING")
    assert.equal(joinResult.room.roomId, roomId)
    assert.deepEqual(gameSocket.joinedRooms, [])
})

test("새 game socket join만 해당 player gravity를 reset하고 같은 socket 반복 join은 reset하지 않는다", async () => {
    const gameCore = await loadGameCore()
    const mutationQueue = createAuthoritativePlayerMutationQueue()
    const tickerService = createAuthoritativeTickerService({
        authoritativePlayerMutationQueue: mutationQueue,
        setIntervalFn() {
            return { unref() {} }
        },
        clearIntervalFn() {},
        loadGameCore: async () => gameCore,
        saveGameEventLog: saveTestLog,
    })
    const fixture = await createStartedPvpSocketFixture("game-join-gravity-phase", {
        authoritativePlayerMutationQueue: mutationQueue,
        authoritativeTickerService: tickerService,
    })
    const gameSocket = new FakeClientSocket("game-join-gravity-phase-new-socket")
    fixture.socketServer.connect(gameSocket)
    const initialRow = fixture.hostPlayer.authoritativeState.activePiece.row

    await tickerService.tickRoom(fixture.roomId, fixture.socketServer, 400)
    gameSocket.trigger("game:join", {
        roomId: fixture.roomId,
        playerId: fixture.hostPlayerId,
    })

    await tickerService.tickRoom(fixture.roomId, fixture.socketServer, 100)
    assert.equal(fixture.hostPlayer.authoritativeState.activePiece.row, initialRow)

    await tickerService.tickRoom(fixture.roomId, fixture.socketServer, 400)
    assert.equal(fixture.hostPlayer.authoritativeState.activePiece.row, initialRow + 1)

    await tickerService.tickRoom(fixture.roomId, fixture.socketServer, 400)
    gameSocket.trigger("game:join", {
        roomId: fixture.roomId,
        playerId: fixture.hostPlayerId,
    })
    await tickerService.tickRoom(fixture.roomId, fixture.socketServer, 100)

    assert.equal(fixture.hostPlayer.authoritativeState.activePiece.row, initialRow + 2)
})

test("game:join은 진행된 server state의 player별 client snapshot과 bag chunks를 반환한다", () => {
    const socketServer = new FakeSocketServer()
    const hostSocket = new FakeClientSocket("game-join-bag-host-socket")
    const guestSocket = new FakeClientSocket("game-join-bag-guest-socket")
    const gameSocket = new FakeClientSocket("game-join-bag-game-socket")
    const expectedPieces = ["bar", "eleft", "eright", "ess", "square", "tree", "zee"]

    registerTestSocketHandlers(socketServer)
    socketServer.connect(hostSocket)
    socketServer.connect(guestSocket)
    socketServer.connect(gameSocket)

    hostSocket.trigger("room:create", {
        playerId: "game-join-bag-host",
        nickname: "Host",
    })
    const createResult = hostSocket.lastClientEvent("room:result").payload
    const roomId = createResult.room.roomId

    guestSocket.trigger("room:join", {
        roomId,
        player: {
            playerId: "game-join-bag-guest",
            nickname: "Guest",
        },
    })

    hostSocket.trigger("room:start", {
        roomId,
        playerId: "game-join-bag-host",
    })

    const matchResult = getMatchState(roomId)
    const hostMatchPlayer = matchResult.match.players.find((player) => {
        return player.playerId === "game-join-bag-host"
    })
    hostMatchPlayer.authoritativeState.currentTick = 5
    hostMatchPlayer.authoritativeState.activePiece.row = 4
    hostMatchPlayer.authoritativeState.board[19][0] = "square"

    gameSocket.trigger("game:join", {
        roomId,
        playerId: "game-join-bag-host",
    })

    const joinResult = gameSocket.lastClientEvent("game:join:result").payload

    assert.equal(joinResult.ok, true)
    assert.equal(joinResult.match.roomId, roomId)
    assert.equal(joinResult.match.players.length, 2)

    joinResult.match.players.forEach((player) => {
        assert.equal(player.bagChunks.length, 3)
        assert.equal(Array.isArray(player.snapshot.board), true)
        assert.equal(Object.hasOwn(player, "authoritativeState"), false)
        assert.equal(Object.hasOwn(player.snapshot, "pendingGarbageQueue"), false)
        player.bagChunks.forEach((chunk) => {
            assert.equal(chunk.length, 7)
            assert.deepEqual([...chunk].sort(), expectedPieces)
        })
    })

    const hostJoinPlayer = joinResult.match.players.find((player) => {
        return player.playerId === "game-join-bag-host"
    })
    assert.equal(hostJoinPlayer.snapshot.tick, 5)
    assert.equal(hostJoinPlayer.snapshot.activePiece.row, 4)
    assert.equal(hostJoinPlayer.snapshot.board[19][0], "square")
    assert.equal(hostJoinPlayer.snapshot.lastProcessedClientSequence, 0)
})

test("game:bag:request는 새 server bag chunk를 room에 broadcast한다", () => {
    const socketServer = new FakeSocketServer()
    const hostSocket = new FakeClientSocket("bag-request-host-socket")
    const guestSocket = new FakeClientSocket("bag-request-guest-socket")
    const expectedPieces = ["bar", "eleft", "eright", "ess", "square", "tree", "zee"]

    registerTestSocketHandlers(socketServer)
    socketServer.connect(hostSocket)
    socketServer.connect(guestSocket)

    hostSocket.trigger("room:create", {
        playerId: "bag-request-host",
        nickname: "Host",
    })
    const createResult = hostSocket.lastClientEvent("room:result").payload
    const roomId = createResult.room.roomId

    guestSocket.trigger("room:join", {
        roomId,
        player: {
            playerId: "bag-request-guest",
            nickname: "Guest",
        },
    })

    hostSocket.trigger("room:start", {
        roomId,
        playerId: "bag-request-host",
    })

    const matchResult = getMatchState(roomId)
    const hostMatchPlayer = matchResult.match.players.find(player => player.playerId === "bag-request-host")
    hostMatchPlayer.authoritativeState.pieceQueue = []

    hostSocket.trigger("game:bag:request", {
        roomId,
        playerId: "bag-request-host",
    })

    const bagAppendEvent = socketServer.roomEvents.findLast(event => event.eventName === "game:bag:append")

    assert.equal(bagAppendEvent.roomId, roomId)
    assert.equal(bagAppendEvent.payload.roomId, roomId)
    assert.equal(bagAppendEvent.payload.playerId, "bag-request-host")
    assert.equal(bagAppendEvent.payload.bagChunk.length, 7)
    assert.deepEqual([...bagAppendEvent.payload.bagChunk].sort(), expectedPieces)
    assert.equal(hostMatchPlayer.bagChunks.length, 4)
    assert.deepEqual(hostMatchPlayer.bagChunks[3], bagAppendEvent.payload.bagChunk)
})

test("game:bag:request는 playing 상태가 아니면 bag chunk를 append하지 않는다", () => {
    const socketServer = new FakeSocketServer()
    const hostSocket = new FakeClientSocket("bag-waiting-host-socket")
    const guestSocket = new FakeClientSocket("bag-waiting-guest-socket")

    registerTestSocketHandlers(socketServer)
    socketServer.connect(hostSocket)
    socketServer.connect(guestSocket)

    hostSocket.trigger("room:create", {
        playerId: "bag-waiting-host",
        nickname: "Host",
    })
    const createResult = hostSocket.lastClientEvent("room:result").payload
    const roomId = createResult.room.roomId

    guestSocket.trigger("room:join", {
        roomId,
        player: {
            playerId: "bag-waiting-guest",
            nickname: "Guest",
        },
    })

    hostSocket.trigger("game:bag:request", {
        roomId,
        playerId: "bag-waiting-host",
    })

    const bagResult = hostSocket.lastClientEvent("game:bag:result")?.payload
    const bagAppendEvent = socketServer.roomEvents.findLast(event => event.eventName === "game:bag:append")

    assert.equal(bagResult?.ok, false)
    assert.equal(bagResult?.reason, "GAME_NOT_PLAYING")
    assert.equal(bagAppendEvent, undefined)
})

test("game:bag:request는 queue가 충분하면 state를 늘리지 않고 pending 해제 결과를 보낸다", () => {
    const socketServer = new FakeSocketServer()
    const hostSocket = new FakeClientSocket("bag-sufficient-host-socket")

    registerTestSocketHandlers(socketServer)
    socketServer.connect(hostSocket)
    hostSocket.trigger("room:create", {
        mode: "pve",
        player: { playerId: "bag-sufficient-host", nickname: "Host" },
    })
    const roomId = hostSocket.lastClientEvent("room:result").payload.room.roomId
    hostSocket.trigger("room:start", { roomId })
    const player = getMatchState(roomId).match.players.find(matchPlayer => {
        return matchPlayer.playerId === "bag-sufficient-host"
    })
    const queueLength = player.authoritativeState.pieceQueue.length
    const chunkCount = player.bagChunks.length

    hostSocket.trigger("game:bag:request", { roomId })
    hostSocket.trigger("game:bag:request", { roomId })

    assert.equal(player.authoritativeState.pieceQueue.length, queueLength)
    assert.equal(player.bagChunks.length, chunkCount)
    assert.equal(socketServer.roomEvents.some(event => event.eventName === "game:bag:append"), false)
    assert.equal(hostSocket.lastClientEvent("game:bag:result").payload.reason, "BAG_QUEUE_SUFFICIENT")
})

test("room:sync는 roomService DTO 결과를 요청 socket에 반환한다", () => {
    const socketServer = new FakeSocketServer()
    const lobbySocket = new FakeClientSocket("sync-lobby-socket")
    const reconnectSocket = new FakeClientSocket("sync-reconnect-socket")

    registerTestSocketHandlers(socketServer)
    socketServer.connect(lobbySocket)
    socketServer.connect(reconnectSocket)

    lobbySocket.trigger("room:create", {
        playerId: "sync-player",
        nickname: "Host",
    })
    const createResult = lobbySocket.lastClientEvent("room:result").payload
    const roomId = createResult.room.roomId

    reconnectSocket.trigger("room:sync", {
        roomId,
        playerId: "sync-player",
    })

    const syncResult = reconnectSocket.lastClientEvent("room:result").payload

    assert.equal(syncResult.ok, true)
    assert.equal(syncResult.reason, null)
    assert.equal(syncResult.room.roomId, roomId)
    assert.deepEqual(reconnectSocket.joinedRooms, [roomId])
})

test("room:sync는 권한 없는 player면 NOT_AUTHORIZED 결과를 반환한다", () => {
    const socketServer = new FakeSocketServer()
    const lobbySocket = new FakeClientSocket("sync-auth-lobby-socket")
    const reconnectSocket = new FakeClientSocket("sync-auth-reconnect-socket")

    registerTestSocketHandlers(socketServer)
    socketServer.connect(lobbySocket)
    socketServer.connect(reconnectSocket)

    lobbySocket.trigger("room:create", {
        playerId: "sync-auth-player",
        nickname: "Host",
    })
    const createResult = lobbySocket.lastClientEvent("room:result").payload

    reconnectSocket.trigger("room:sync", {
        roomId: createResult.room.roomId,
        playerId: "missing-player",
    })

    const syncResult = reconnectSocket.lastClientEvent("room:result").payload

    assert.equal(syncResult.ok, false)
    assert.equal(syncResult.room, null)
    assert.equal(syncResult.reason, "NOT_AUTHORIZED")
    assert.deepEqual(reconnectSocket.joinedRooms, [])
})

test("room:sync는 새 lobby socket을 player socketId로 갱신해서 이후 room:start를 허용한다", () => {
    const socketServer = new FakeSocketServer()
    const oldHostSocket = new FakeClientSocket("old-host-lobby-socket")
    const guestSocket = new FakeClientSocket("sync-start-guest-socket")
    const newHostSocket = new FakeClientSocket("new-host-lobby-socket")

    registerTestSocketHandlers(socketServer)
    socketServer.connect(oldHostSocket)
    socketServer.connect(guestSocket)
    socketServer.connect(newHostSocket)

    oldHostSocket.trigger("room:create", {
        playerId: "sync-start-host",
        nickname: "Host",
    })
    const createResult = oldHostSocket.lastClientEvent("room:result").payload
    const roomId = createResult.room.roomId

    guestSocket.trigger("room:join", {
        roomId,
        player: {
            playerId: "sync-start-guest",
            nickname: "Guest",
        },
    })

    newHostSocket.trigger("room:sync", {
        roomId,
        playerId: "sync-start-host",
    })

    newHostSocket.trigger("room:start", {
        roomId,
        playerId: "sync-start-host",
    })

    const startResult = newHostSocket.lastClientEvent("room:result").payload

    assert.equal(startResult.ok, true)
    assert.equal(startResult.reason, null)
    assert.equal(startResult.room.status, "playing")
})

test("playing room에서는 로비 socket disconnect 후에도 game:join을 허용한다", () => {
    const socketServer = new FakeSocketServer()
    const lobbyHostSocket = new FakeClientSocket("lobby-host-socket")
    const lobbyGuestSocket = new FakeClientSocket("lobby-guest-socket")
    const gameHostSocket = new FakeClientSocket("game-host-socket-after-start")

    registerTestSocketHandlers(socketServer)
    socketServer.connect(lobbyHostSocket)
    socketServer.connect(lobbyGuestSocket)
    socketServer.connect(gameHostSocket)

    lobbyHostSocket.trigger("room:create", {
        playerId: "host-player-after-start",
        nickname: "Host",
    })
    const createResult = lobbyHostSocket.lastClientEvent("room:result").payload
    const roomId = createResult.room.roomId

    lobbyGuestSocket.trigger("room:join", {
        roomId,
        player: {
            playerId: "guest-player-after-start",
            nickname: "Guest",
        },
    })

    lobbyHostSocket.trigger("room:start", {
        roomId,
        playerId: "host-player-after-start",
    })

    lobbyHostSocket.trigger("disconnect")
    gameHostSocket.trigger("game:join", {
        roomId,
        playerId: "host-player-after-start",
    })

    const joinResult = gameHostSocket.lastClientEvent("game:join:result")

    assert.equal(joinResult.payload.ok, true)
    assert.equal(joinResult.payload.room.roomId, roomId)
    assert.equal(joinResult.payload.room.players.length, 2)
    assert.deepEqual(gameHostSocket.joinedRooms, [roomId])
})

test("PVE room:create는 heuristic AI player를 만들고 human host가 바로 시작할 수 있다", () => {
    const socketServer = new FakeSocketServer()
    const hostSocket = new FakeClientSocket("pve-host-socket")

    registerTestSocketHandlers(socketServer, {
        saveGameEventLog(log) {
            return Promise.resolve({ ok: true, log, reason: null })
        },
    })
    socketServer.connect(hostSocket)

    hostSocket.trigger("room:create", {
        mode: "pve",
        player: {
            playerId: "pve-host",
            nickname: "Host",
        },
    })
    const createResult = hostSocket.lastClientEvent("room:result").payload
    const aiPlayer = createResult.room.players.find(player => {
        return player.playerType === "heuristic_ai"
    })

    assert.equal(createResult.ok, true)
    assert.equal(createResult.room.mode, "pve")
    assert.equal(createResult.room.aiDifficulty, "normal")
    assert.equal(createResult.room.aiPolicy, "heuristic")
    assert.ok(aiPlayer)

    hostSocket.trigger("room:start", {
        roomId: createResult.room.roomId,
        playerId: "pve-host",
    })
    const startResult = hostSocket.lastClientEvent("room:result").payload
    const match = getMatchState(createResult.room.roomId).match

    assert.equal(startResult.ok, true)
    assert.equal(startResult.room.status, "playing")
    assert.equal(match.mode, "pve")
    assert.equal(match.aiDifficulty, "normal")
    assert.equal(match.aiPolicy, "heuristic")
    assert.equal(match.players[1].playerType, "heuristic_ai")
})

test("PVE room:create는 hard 난이도와 experimental 정책을 match와 log까지 전달한다", async () => {
    const socketServer = new FakeSocketServer()
    const hardSocket = new FakeClientSocket("pve-hard-host-socket")
    const savedLogs = []

    registerTestSocketHandlers(socketServer, {
        saveGameEventLog(log) {
            savedLogs.push(log)
            return Promise.resolve({ ok: true, log, reason: null })
        },
    })
    socketServer.connect(hardSocket)

    hardSocket.trigger("room:create", {
        mode: "pve",
        aiDifficulty: "hard",
        aiPolicy: "placement_v4",
        player: {
            playerId: "pve-hard-host",
            nickname: "Hard Host",
        },
    })
    const hardCreateResult = hardSocket.lastClientEvent("room:result").payload

    assert.equal(hardCreateResult.ok, true)
    assert.equal(hardCreateResult.room.aiDifficulty, "hard")
    assert.equal(hardCreateResult.room.aiPolicy, "placement_v4")
    assert.equal(
        hardCreateResult.room.players[1].nickname,
        "My Imitation AI (Experimental)",
    )

    await hardSocket.triggerAsync("room:start", {
        roomId: hardCreateResult.room.roomId,
        playerId: "pve-hard-host",
    })

    const match = getMatchState(hardCreateResult.room.roomId).match
    const startLog = savedLogs.find(log => log.eventType === "game_start")

    assert.equal(match.aiDifficulty, "hard")
    assert.equal(match.aiPolicy, "placement_v4")
    assert.equal(startLog.aiDifficulty, "hard")
    assert.equal(startLog.aiPolicyRequested, "placement_v4")

    match.aiPolicyRuntime = {
        roomId: hardCreateResult.room.roomId,
        playerId: match.players[1].playerId,
        policyRequested: "placement_v4",
        policyUsed: "heuristic",
        fallbackReason: "MODEL_NOT_FOUND",
        modelSha256: null,
        fallbackCount: 1,
        lastFallbackReason: "MODEL_NOT_FOUND",
    }
    hardSocket.trigger("game:join", {
        roomId: hardCreateResult.room.roomId,
        playerId: "pve-hard-host",
    })
    const joinResult = hardSocket.lastClientEvent("game:join:result").payload

    assert.deepEqual(joinResult.match.aiPolicyRuntime, match.aiPolicyRuntime)
})

test("PVE room:create는 invalid 난이도를 거부하고 room을 만들지 않는다", () => {
    const socketServer = new FakeSocketServer()
    const invalidSocket = new FakeClientSocket("pve-invalid-host-socket")

    registerTestSocketHandlers(socketServer)
    socketServer.connect(invalidSocket)

    invalidSocket.trigger("room:create", {
        mode: "pve",
        aiDifficulty: "expert",
        player: {
            playerId: "pve-invalid-host",
            nickname: "Invalid Host",
        },
    })
    const invalidResult = invalidSocket.lastClientEvent("room:result").payload

    assert.equal(invalidResult.ok, false)
    assert.equal(invalidResult.reason, "INVALID_PAYLOAD")
    assert.equal(invalidResult.room, null)
    assert.deepEqual(invalidSocket.joinedRooms, [])
})

test("PVE room:create는 invalid AI 정책을 거부하고 room을 만들지 않는다", () => {
    const socketServer = new FakeSocketServer()
    const invalidSocket = new FakeClientSocket("pve-policy-invalid-socket")

    registerTestSocketHandlers(socketServer)
    socketServer.connect(invalidSocket)

    invalidSocket.trigger("room:create", {
        mode: "pve",
        aiPolicy: "strong_ai",
        player: {
            playerId: "pve-policy-invalid",
            nickname: "Invalid Policy Host",
        },
    })
    const invalidResult = invalidSocket.lastClientEvent("room:result").payload

    assert.equal(invalidResult.ok, false)
    assert.equal(invalidResult.reason, "INVALID_PAYLOAD")
    assert.equal(invalidResult.room, null)
    assert.deepEqual(invalidSocket.joinedRooms, [])
})

test("game:input은 payload playerId unknown key를 거부한다", async () => {
    const socketServer = new FakeSocketServer()
    const hostSocket = new FakeClientSocket("pve-input-host-socket")

    registerTestSocketHandlers(socketServer, {
        saveGameEventLog(log) {
            return Promise.resolve({ ok: true, log, reason: null })
        },
    })
    socketServer.connect(hostSocket)

    hostSocket.trigger("room:create", {
        mode: "pve",
        player: {
            playerId: "pve-input-host",
            nickname: "Host",
        },
    })
    const createResult = hostSocket.lastClientEvent("room:result").payload
    const roomId = createResult.room.roomId
    const aiPlayer = createResult.room.players.find(player => {
        return player.playerType === "heuristic_ai"
    })
    hostSocket.trigger("room:start", {
        roomId,
        playerId: "pve-input-host",
    })

    hostSocket.triggerRaw("game:input", {
        roomId,
        playerId: aiPlayer.playerId,
        action: "hold",
        tick: 1,
        pieceIndex: 1,
        clientSequence: 1,
    })

    const inputResult = hostSocket.lastClientEvent("game:input:result").payload
    assert.equal(inputResult.ok, false)
    assert.equal(inputResult.reason, "INVALID_PAYLOAD")
})

test("모든 mutation event는 inactive socket session을 거부한다", async () => {
    const socketServer = new FakeSocketServer()
    const socket = new FakeClientSocket("inactive-session-socket")
    socket.setInitialIdentity({ playerId: "inactive-player", nickname: "Player" })
    registerTestSocketHandlers(socketServer, {
        playerSessionService: {
            cleanupExpired() {},
            isActiveSocket() {
                return false
            },
            isDisconnectedSession() {
                return false
            },
            markDisconnected() {
                return false
            },
        },
    })
    socketServer.connect(socket)

    socket.trigger("room:create", { playerId: "victim", nickname: "Victim" })
    assert.equal(socket.lastClientEvent("room:result").payload.reason, "NOT_AUTHORIZED")

    const cases = [
        ["room:join", "room:result", { roomId: "ROOM1234", playerId: "victim" }],
        ["room:sync", "room:result", { roomId: "ROOM1234", playerId: "victim" }],
        ["room:start", "room:result", { roomId: "ROOM1234", playerId: "victim" }],
        ["room:leave", "room:result", { roomId: "ROOM1234", playerId: "victim" }],
        ["game:join", "game:join:result", { roomId: "ROOM1234", playerId: "victim" }],
        ["game:input", "game:input:result", {
            roomId: "ROOM1234",
            playerId: "victim",
            action: "hold",
            tick: 1,
            pieceIndex: 1,
            clientSequence: 1,
        }],
        ["game:bag:request", "game:bag:result", { roomId: "ROOM1234", playerId: "victim" }],
        ["game:leave", "game:leave:result", { roomId: "ROOM1234", playerId: "victim" }],
    ]
    for (const [eventName, resultName, payload] of cases) {
        socket.trigger(eventName, payload)
        assert.equal(socket.lastClientEvent(resultName).payload.reason, "NOT_AUTHORIZED", eventName)
    }

    await socket.triggerAsync("game:log:placement_decision", {
        roomId: "ROOM1234",
        playerId: "victim",
        log: {},
    })
    assert.equal(socket.lastClientEvent("game:log:result").payload.reason, "NOT_AUTHORIZED")

    socket.trigger("global:chat", { playerId: "victim", nickname: "Victim", text: "hello" })
    assert.equal(socket.lastClientEvent("chat:result").payload.reason, "NOT_AUTHORIZED")
    socket.trigger("room:chat", { roomId: "ROOM1234", playerId: "victim", text: "hello" })
    assert.equal(socket.lastClientEvent("chat:result").payload.reason, "NOT_AUTHORIZED")
})

test("queued game input은 session generation이 stale이면 side effect 직전에 중단한다", async () => {
    let active = true
    const queueGate = createDeferred()
    const mutationQueue = {
        enqueueAuthoritativePlayerMutation(roomId, playerId, task) {
            return queueGate.promise.then(task)
        },
    }
    const fixture = await createStartedPvpSocketFixture("stale-input", {
        authoritativePlayerMutationQueue: mutationQueue,
        playerSessionService: {
            cleanupExpired() {},
            isActiveSocket() {
                return active
            },
            isDisconnectedSession() {
                return !active
            },
            markDisconnected() {
                active = false
                return true
            },
        },
    })
    const pieceIndexBefore = fixture.hostPlayer.authoritativeState.pieceIndex
    const inputPromise = fixture.hostSocket.triggerAsync("game:input", {
        roomId: fixture.roomId,
        playerId: fixture.hostPlayerId,
        action: "hold",
        tick: 1,
        pieceIndex: pieceIndexBefore,
        clientSequence: 1,
    })

    active = false
    queueGate.resolve()
    await inputPromise

    assert.equal(fixture.hostPlayer.authoritativeState.pieceIndex, pieceIndexBefore)
    assert.equal(
        fixture.hostSocket.lastClientEvent("game:input:result").payload.reason,
        "NOT_AUTHORIZED",
    )
})

test("disconnect grace timer는 captured generation을 재검증한 뒤 waiting player를 제거한다", async () => {
    const socketServer = new FakeSocketServer()
    const hostSocket = new FakeClientSocket("grace-host-socket")
    const guestSocket = new FakeClientSocket("grace-guest-socket")
    const disconnectedPlayers = new Set()
    let scheduledTask = null
    registerTestSocketHandlers(socketServer, {
        playerSessionService: {
            cleanupExpired() {},
            isActiveSocket(context) {
                return !disconnectedPlayers.has(context.playerId)
            },
            isDisconnectedSession(context) {
                return disconnectedPlayers.has(context.playerId)
            },
            markDisconnected(context) {
                disconnectedPlayers.add(context.playerId)
                return true
            },
        },
        setTimeoutFn(task, delay) {
            assert.equal(delay, 30_000)
            scheduledTask = task
            return { unref() {} }
        },
    })
    socketServer.connect(hostSocket)
    socketServer.connect(guestSocket)
    hostSocket.trigger("room:create", { playerId: "grace-host", nickname: "Host" })
    const roomId = hostSocket.lastClientEvent("room:result").payload.room.roomId
    guestSocket.trigger("room:join", {
        roomId,
        player: { playerId: "grace-guest", nickname: "Guest" },
    })

    guestSocket.trigger("disconnect")
    assert.equal(getRoomState(roomId).players.length, 2)
    await scheduledTask()

    assert.equal(getRoomState(roomId).players.length, 1)
    assert.equal(getRoomState(roomId).players[0].playerId, "grace-host")
})

test("진행 중 session TTL 만료는 기본 game_over JSONL을 한 번 저장한다", async (t) => {
    const fixture = await createStartedPvpSocketFixture("ttl-expired")
    const temporaryDirectory = await mkdtemp(path.join(tmpdir(), "tetris-ttl-log-"))
    const logPath = path.join(temporaryDirectory, "game-events.jsonl")
    const previousLogPath = process.env.GAME_EVENTS_LOG_PATH
    process.env.GAME_EVENTS_LOG_PATH = logPath
    t.after(async () => {
        if (previousLogPath === undefined) delete process.env.GAME_EVENTS_LOG_PATH
        else process.env.GAME_EVENTS_LOG_PATH = previousLogPath
        await rm(temporaryDirectory, { recursive: true, force: true })
    })

    let now = 0
    const playerSessionService = createPlayerSessionService({
        now: () => now,
        sessionTtlMs: 1,
        createPlayerId: () => fixture.guestPlayerId,
    })
    playerSessionService.authenticate({ nickname: "Guest" }, "ttl-expired-socket")
    now = 1
    const [expiredSession] = playerSessionService.cleanupExpired()

    await handleDisconnectGraceExpired({
        socketServer: fixture.socketServer,
        playerId: expiredSession.playerId,
        authoritativeTickerService: createNoopAuthoritativeTickerService(),
    })

    let serializedLogs = ""
    for (let attempt = 0; attempt < 20; attempt += 1) {
        try {
            serializedLogs = await readFile(logPath, "utf8")
            break
        } catch {
            await new Promise(resolve => setTimeout(resolve, 5))
        }
    }
    const logs = serializedLogs
        .trim()
        .split("\n")
        .map(line => JSON.parse(line))
    assert.equal(logs.length, 1)
    assert.equal(logs[0].eventType, "game_over")
    assert.equal(logs[0].reason, "disconnect_timeout")
})

test("socket별 game input은 120개 pending까지만 받고 완료 후 다시 허용한다", async () => {
    const gameCore = await loadGameCore()
    const loadStarted = createDeferred()
    const releaseLoad = createDeferred()
    let loadCount = 0
    const fixture = await createStartedPvpSocketFixture("pending-input-limit", {
        async loadGameCore() {
            loadCount += 1
            if (loadCount === 1) {
                loadStarted.resolve()
                await releaseLoad.promise
            }
            return gameCore
        },
    })
    const pieceIndex = fixture.hostPlayer.authoritativeState.pieceIndex
    const pendingRequests = Array.from({ length: 120 }, (_, index) => {
        return fixture.hostSocket.triggerAsync("game:input", {
            roomId: fixture.roomId,
            action: "hold",
            tick: index + 1,
            pieceIndex,
            clientSequence: index + 1,
        })
    })
    await loadStarted.promise

    await fixture.hostSocket.triggerAsync("game:input", {
        roomId: fixture.roomId,
        action: "hold",
        tick: 121,
        pieceIndex,
        clientSequence: 121,
    })
    assert.equal(
        fixture.hostSocket.lastClientEvent("game:input:result").payload.reason,
        "TOO_MANY_PENDING_INPUTS",
    )
    assert.equal(loadCount, 1)

    releaseLoad.resolve()
    await Promise.all(pendingRequests)
    const currentPieceIndex = fixture.hostPlayer.authoritativeState.pieceIndex
    await fixture.hostSocket.triggerAsync("game:input", {
        roomId: fixture.roomId,
        action: "hold",
        tick: 122,
        pieceIndex: currentPieceIndex,
        clientSequence: 121,
    })
    assert.notEqual(
        fixture.hostSocket.lastClientEvent("game:input:result").payload.reason,
        "TOO_MANY_PENDING_INPUTS",
    )
})

test("playing disconnect timeout은 finish를 먼저 보내고 loser를 room에서 제거한다", async () => {
    const socketServer = new FakeSocketServer()
    const hostSocket = new FakeClientSocket("timeout-cleanup-host-socket")
    const guestSocket = new FakeClientSocket("timeout-cleanup-guest-socket")
    const disconnectedPlayers = new Set()
    let scheduledTask = null
    registerTestSocketHandlers(socketServer, {
        playerSessionService: {
            cleanupExpired() {},
            isActiveSocket(context) {
                return !disconnectedPlayers.has(context.playerId)
            },
            isDisconnectedSession(context) {
                return disconnectedPlayers.has(context.playerId)
            },
            markDisconnected(context) {
                disconnectedPlayers.add(context.playerId)
                return true
            },
        },
        setTimeoutFn(task, delay) {
            assert.equal(delay, 30_000)
            scheduledTask = task
            return { unref() {} }
        },
    })
    socketServer.connect(hostSocket)
    socketServer.connect(guestSocket)
    hostSocket.trigger("room:create", {
        playerId: "timeout-cleanup-host",
        nickname: "Host",
    })
    const roomId = hostSocket.lastClientEvent("room:result").payload.room.roomId
    guestSocket.trigger("room:join", {
        roomId,
        player: { playerId: "timeout-cleanup-guest", nickname: "Guest" },
    })
    await hostSocket.triggerAsync("room:start", { roomId })

    guestSocket.trigger("disconnect")
    assert.equal(getRoomState(roomId).status, "playing")
    assert.equal(getRoomState(roomId).players.length, 2)
    const eventCountBeforeTimeout = socketServer.roomEvents.length

    await scheduledTask()

    const timeoutEvents = socketServer.roomEvents.slice(eventCountBeforeTimeout)
    assert.deepEqual(timeoutEvents.map(event => event.eventName), [
        "match:finish",
        "room:updated",
    ])
    assert.equal(timeoutEvents[0].payload.reason, "disconnect_timeout")
    assert.equal(timeoutEvents[0].payload.room.players.length, 2)
    assert.equal(timeoutEvents[1].payload.status, "waiting")
    assert.deepEqual(
        timeoutEvents[1].payload.players.map(player => player.playerId),
        ["timeout-cleanup-host"],
    )
})

test("모든 C2S app event는 malformed payload를 service/domain 전에 거부한다", () => {
    const socketServer = new FakeSocketServer()
    const socket = new FakeClientSocket("validation-gate-socket")
    socket.setInitialIdentity({ playerId: "validation-player", nickname: "Player" })
    registerTestSocketHandlers(socketServer)
    socketServer.connect(socket)

    const cases = [
        ["global:chat", "chat:result"],
        ["room:chat", "chat:result"],
        ["room:create", "room:result"],
        ["room:join", "room:result"],
        ["room:leave", "room:result"],
        ["room:start", "room:result"],
        ["game:join", "game:join:result"],
        ["game:input", "game:input:result"],
        ["game:log:placement_decision", "game:log:result"],
        ["game:bag:request", "game:bag:result"],
        ["game:leave", "game:leave:result"],
        ["room:sync", "room:result"],
    ]

    for (const [eventName, resultName] of cases) {
        socket.triggerRaw(eventName, null)
        assert.equal(socket.lastClientEvent(resultName).payload.reason, "INVALID_PAYLOAD", eventName)
    }
    assert.equal(findRoomByPlayerId("validation-player"), null)
})

test("stale socket은 validation과 rate bucket보다 먼저 NOT_AUTHORIZED로 종료된다", () => {
    const socketServer = new FakeSocketServer()
    const socket = new FakeClientSocket("stale-validation-socket")
    let rateConsumeCount = 0
    socket.setInitialIdentity({ playerId: "stale-player", nickname: "Player" })
    registerTestSocketHandlers(socketServer, {
        playerSessionService: {
            cleanupExpired() {},
            isActiveSocket() {
                return false
            },
            isDisconnectedSession() {
                return false
            },
            markDisconnected() {
                return false
            },
        },
        socketRateLimitService: {
            cleanupExpired() {},
            consume() {
                rateConsumeCount += 1
                return true
            },
        },
    })
    socketServer.connect(socket)

    socket.triggerRaw("room:create", { mode: "pvp", unknown: true })

    assert.equal(socket.lastClientEvent("room:result").payload.reason, "NOT_AUTHORIZED")
    assert.equal(rateConsumeCount, 0)
    assert.equal(findRoomByPlayerId("stale-player"), null)
})
