/**
 * 모든 C2S/S2C Socket.IO payload가 공유 Zod 계약을 통과하는지 검증한다.
 *
 * 정상 event fixture를 준비해 전체 schema map을 순회하고, unknown key·크기 제한·잘못된 board 같은 입력은
 * 거부되는지 확인한다. 실제 authoritative ticker의 emit도 같은 schema로 검사해 타입 선언과 런타임 payload가
 * 따로 변하는 일을 막는다.
 */
const test = require("node:test")
const assert = require("node:assert/strict")

const {
    clientToServerSchemas,
    connectErrorDataSchema,
    handshakeAuthSchema,
    serverToClientSchemas,
} = require("../dist/server/shared/socketContracts.mjs")
const {
    createAuthoritativeTickerService,
} = require("../dist/server/server/services/authoritativeTickerService.js")

const HUMAN_ID = "00000000-0000-4000-8000-000000000001"
const GUEST_ID = "00000000-0000-4000-8000-000000000002"
const ROOM_ID = "ABCDEF12"
const AI_ID = `heuristic-ai-${ROOM_ID}`
const PIECES = ["bar", "eleft", "eright", "ess", "square", "tree", "zee"]

function createBoard() {
    return Array.from({ length: 20 }, () => Array(10).fill(null))
}

function createSnapshot(overrides = {}) {
    return {
        spinRotation: null,
        board: createBoard(),
        activePiece: { pieceType: "bar", rotation: 0, row: -1, col: 3 },
        pieceQueue: ["square", "tree"],
        holdPieceType: null,
        holdUsedThisDrop: false,
        score: 0,
        lines: 0,
        phase: "playing",
        gameOver: false,
        combo: -1,
        backToBack: false,
        tick: 0,
        pieceIndex: 1,
        pendingGarbageLines: 0,
        lastProcessedClientSequence: 0,
        ...overrides,
    }
}

function createHuman(playerId = HUMAN_ID, nickname = "Host") {
    return { playerId, nickname, playerType: "human" }
}

test("고정 유예 snapshot은 공통 상한을 검증하고 client의 유예 변경 요청은 거부한다", () => {
    const lockDelay = { hasTouchedGround: true, remainingMs: 42, resetCount: 15, lowestRow: 18 };
    const envelope = { roomId: ROOM_ID, playerId: HUMAN_ID, snapshot: createSnapshot({ lockDelay }) };
    const schema = serverToClientSchemas["game:authoritative:snapshot"];
    assert.equal(schema.safeParse(envelope).success, true);
    for (const invalid of [{ remainingMs: 501 }, { remainingMs: -1 }, { resetCount: 16 },
        { resetCount: 1.5 }, { lowestRow: 20 }, { hasTouchedGround: "true" }]) {
        assert.equal(schema.safeParse({ ...envelope,
            snapshot: createSnapshot({ lockDelay: { ...lockDelay, ...invalid } }) }).success, false);
    }
    const input = { roomId: ROOM_ID, action: "rotate", tick: 1, pieceIndex: 1, clientSequence: 1,
        expectedTransform: { pieceType: "tree", rotation: 1, col: 3 } };
    assert.equal(clientToServerSchemas["game:input"].safeParse(input).success, true);
    assert.equal(clientToServerSchemas["game:input"].safeParse({ ...input, lockDelay }).success, false);
});

test("회전 이력은 서버 snapshot에서만 전달하고 잘못된 승격·분류 조합을 거부한다", () => {
    const schema = serverToClientSchemas["game:authoritative:snapshot"];
    const base = { roomId: ROOM_ID, playerId: HUMAN_ID, snapshot: createSnapshot() };
    const spinRotation = { lastKickIndex: 0, usedKick5: true };
    assert.equal(schema.safeParse({ ...base, snapshot: createSnapshot({ spinRotation }) }).success, true);
    for (const invalid of [{ lastKickIndex: -1, usedKick5: false },
        { lastKickIndex: 5, usedKick5: true }, { lastKickIndex: 1.5, usedKick5: false },
        { lastKickIndex: 4, usedKick5: false }, { lastKickIndex: 0, usedKick5: "true" },
        { ...spinRotation, extra: true }]) {
        assert.equal(schema.safeParse({ ...base, snapshot: createSnapshot({ spinRotation: invalid }) }).success, false);
    }
    const input = { roomId: ROOM_ID, action: "rotate", tick: 1, pieceIndex: 1, clientSequence: 1,
        expectedTransform: { pieceType: "tree", rotation: 1, col: 3 } };
    for (const metadata of [{ spinRotation }, { tSpinType: "full" }, { usedKick5: true }]) {
        assert.equal(clientToServerSchemas["game:input"].safeParse({ ...input, ...metadata }).success, false);
    }
    const effect = { id: "spin", gameId: "00000000-0000-4000-8000-000000000003", pieceIndex: 1,
        targetPlayerId: null, sentLines: 0, canceledLines: 0, appliedLines: 0,
        linesCleared: 1, isTSpin: true, tSpinType: "mini", combo: 0, backToBackBonus: false };
    assert.equal(schema.safeParse({ ...base, combatEffect: effect }).success, true);
    for (const invalid of [{ tSpinType: "unknown" }, { isTSpin: false }, { linesCleared: 3 },
        { tSpinType: "full", linesCleared: 4 }]) {
        assert.equal(schema.safeParse({ ...base, combatEffect: { ...effect, ...invalid } }).success, false);
    }
});

function createRoom(mode = "pvp") {
    const pve = mode === "pve"
    return {
        roomId: ROOM_ID,
        mode,
        aiDifficulty: pve ? "hard" : null,
        aiPolicy: pve ? "placement_v4" : null,
        hostPlayerId: HUMAN_ID,
        status: "playing",
        createdAt: 1,
        players: pve
            ? [
                createHuman(),
                {
                    playerId: AI_ID,
                    nickname: "My Imitation AI (Experimental)",
                    playerType: "heuristic_ai",
                },
            ]
            : [createHuman(), createHuman(GUEST_ID, "Guest")],
    }
}

function createPolicyRuntime() {
    return {
        roomId: ROOM_ID,
        playerId: AI_ID,
        policyRequested: "placement_v4",
        policyUsed: "heuristic",
        fallbackReason: "MODEL_NOT_FOUND",
        modelSha256: null,
        fallbackCount: 1,
        lastFallbackReason: "MODEL_NOT_FOUND",
    }
}

function createMatch(mode = "pvp") {
    const room = createRoom(mode)
    return {
        roomId: ROOM_ID,
        mode,
        aiPolicy: room.aiPolicy,
        aiPolicyRuntime: mode === "pve" ? createPolicyRuntime() : null,
        status: "playing",
        createdAt: 1,
        players: room.players.map(player => ({
            playerId: player.playerId,
            playerType: player.playerType,
            bagChunks: [PIECES],
            snapshot: createSnapshot(),
        })),
    }
}

const roomRequest = { roomId: ROOM_ID }
const clientFixtures = {
    "global:chat": { text: "hello" },
    "room:chat": { roomId: ROOM_ID, text: "hello" },
    "room:create": { mode: "pve", aiDifficulty: "hard", aiPolicy: "placement_v4" },
    "room:join": roomRequest,
    "room:leave": roomRequest,
    "room:start": roomRequest,
    "game:join": roomRequest,
    "game:input": {
        roomId: ROOM_ID,
        action: "move_left",
        tick: 1,
        pieceIndex: 1,
        clientSequence: 1,
        expectedTransform: { pieceType: "bar", rotation: 0, col: 2 },
    },
    "game:log:placement_decision": {
        roomId: ROOM_ID,
        log: { eventType: "placement_decision", schemaVersion: 1 },
    },
    "game:bag:request": roomRequest,
    "game:leave": roomRequest,
    "room:sync": roomRequest,
}

const roomResult = { ok: true, room: createRoom(), reason: null }
const serverFixtures = {
    "session:ready": {
        version: 1,
        playerId: HUMAN_ID,
        token: "a".repeat(43),
        nickname: "Host",
        expiresAt: 1,
        resumed: false,
    },
    "chat:result": { ok: false, reason: "INVALID_PAYLOAD" },
    "global:message": {
        type: "chat",
        scope: "global",
        playerId: HUMAN_ID,
        nickname: "Host",
        text: "hello",
    },
    "room:message": {
        type: "chat",
        scope: "room",
        roomId: ROOM_ID,
        playerId: HUMAN_ID,
        nickname: "Host",
        text: "hello",
    },
    "room:result": roomResult,
    "room:updated": createRoom(),
    "game:join:result": { ...roomResult, match: createMatch() },
    "game:countdown": {
        roomId: ROOM_ID,
        gameId: "00000000-0000-4000-8000-000000000003",
        startsAt: 3000,
        serverNow: 0,
    },
    "game:input:result": {
        ok: true,
        reason: null,
        clientSequence: 1,
        pieceIndex: 1,
        placementCommitted: false,
    },
    "game:log:result": { ok: true, reason: null, log: { eventType: "placement_decision" } },
    "game:bag:result": { ok: false, room: null, reason: "BAG_QUEUE_SUFFICIENT" },
    "game:bag:append": { roomId: ROOM_ID, playerId: HUMAN_ID, bagChunk: PIECES },
    "game:leave:result": roomResult,
    "game:opponent-left": { room: createRoom(), playerId: GUEST_ID },
    "game:authoritative:snapshot": {
        roomId: ROOM_ID,
        playerId: HUMAN_ID,
        snapshot: createSnapshot(),
        presentationEffect: {
            type: "line_clear",
            id: `${HUMAN_ID}:1:line_clear`,
            pieceIndex: 1,
            rows: [19],
            boardBeforeClear: createBoard(),
        },
    },
    "match:finish": {
        room: { ...createRoom(), status: "finished" },
        winnerPlayerId: HUMAN_ID,
        loserPlayerId: GUEST_ID,
        reason: "top_out",
    },
    "pve:ai-policy": createPolicyRuntime(),
}

test("C2S와 S2C event map의 모든 정상 fixture가 계약을 통과한다", () => {
    assert.deepEqual(Object.keys(clientToServerSchemas), Object.keys(clientFixtures))
    assert.deepEqual(Object.keys(serverToClientSchemas), Object.keys(serverFixtures))

    for (const [eventName, fixture] of Object.entries(clientFixtures)) {
        assert.equal(clientToServerSchemas[eventName].safeParse(fixture).success, true, eventName)
    }
    for (const [eventName, fixture] of Object.entries(serverFixtures)) {
        assert.equal(serverToClientSchemas[eventName].safeParse(fixture).success, true, eventName)
    }
})

test("strict event envelope는 null, array와 unknown key를 거부한다", () => {
    for (const [eventName, schema] of Object.entries(clientToServerSchemas)) {
        assert.equal(schema.safeParse(null).success, false, `${eventName}:null`)
        assert.equal(schema.safeParse([]).success, false, `${eventName}:array`)
        assert.equal(schema.safeParse({ ...clientFixtures[eventName], unknown: true }).success, false, `${eventName}:unknown`)
    }
    for (const [eventName, schema] of Object.entries(serverToClientSchemas)) {
        assert.equal(schema.safeParse(null).success, false, `${eventName}:null`)
        assert.equal(schema.safeParse([]).success, false, `${eventName}:array`)
        assert.equal(schema.safeParse({ ...serverFixtures[eventName], unknown: true }).success, false, `${eventName}:unknown`)
    }
})

test("handshake, 문자열, 숫자와 고정 배열 상한을 검증한다", () => {
    assert.equal(handshakeAuthSchema.safeParse({ nickname: " Host " }).success, true)
    assert.equal(handshakeAuthSchema.safeParse({ nickname: "Host", unknown: true }).success, false)
    assert.equal(handshakeAuthSchema.safeParse({ nickname: "x".repeat(25) }).success, false)
    assert.equal(connectErrorDataSchema.safeParse({
        code: "SESSION_INVALID",
        terminal: true,
    }).success, true)
    assert.equal(connectErrorDataSchema.safeParse({
        code: "SESSION_INVALID",
        terminal: true,
        unknown: true,
    }).success, false)
    assert.equal(clientToServerSchemas["global:chat"].safeParse({ text: "x".repeat(201) }).success, false)
    assert.equal(clientToServerSchemas["game:input"].safeParse({
        ...clientFixtures["game:input"],
        tick: -1,
    }).success, false)
    assert.equal(serverToClientSchemas["game:bag:append"].safeParse({
        ...serverFixtures["game:bag:append"],
        bagChunk: PIECES.slice(0, 6),
    }).success, false)
})

test("authoritative board의 garbage cell만 허용하고 piece queue는 확장하지 않는다", () => {
    const garbageBoard = createBoard()
    garbageBoard[19][0] = "garbage"

    assert.equal(serverToClientSchemas["game:authoritative:snapshot"].safeParse({
        ...serverFixtures["game:authoritative:snapshot"],
        snapshot: createSnapshot({ board: garbageBoard }),
    }).success, true)
    assert.equal(serverToClientSchemas["game:authoritative:snapshot"].safeParse({
        ...serverFixtures["game:authoritative:snapshot"],
        snapshot: createSnapshot({ pieceQueue: ["garbage"] }),
    }).success, false)
})

test("public human과 PVE AI DTO를 분리하고 experimental nickname을 허용한다", () => {
    assert.equal(serverToClientSchemas["room:updated"].safeParse(createRoom("pvp")).success, true)
    assert.equal(serverToClientSchemas["room:updated"].safeParse(createRoom("pve")).success, true)
    assert.equal(serverToClientSchemas["room:updated"].safeParse({
        ...createRoom("pve"),
        players: [
            createHuman(),
            { playerId: AI_ID, nickname: "Unknown AI", playerType: "heuristic_ai" },
        ],
    }).success, false)
})

test("authoritative ticker의 실제 snapshot과 PVE policy emit이 S2C 계약을 통과한다", async () => {
    const roomEvents = []
    const match = createMatch("pve")
    const socketServer = {
        to(roomId) {
            return {
                emit(eventName, payload) {
                    roomEvents.push({ roomId, eventName, payload })
                },
            }
        },
    }
    const ticker = createAuthoritativeTickerService({
        setIntervalFn() {
            return { unref() {} }
        },
        clearIntervalFn() {},
        loadGameCore: async () => ({}),
        getMatchState: () => ({ ok: true, match }),
        pveAiPlayerService: {
            async processAiStep() {
                return {
                    ok: true,
                    skipped: false,
                    stateChanged: true,
                    reason: "AI_PLAN_CREATED",
                    decision: {
                        policyRequested: "placement_v4",
                        policyUsed: "heuristic",
                        fallbackReason: "MODEL_NOT_FOUND",
                        modelSha256: null,
                    },
                }
            },
        },
        getAuthoritativePlayerSnapshotDto: () => ({
            ok: true,
            snapshot: createSnapshot(),
        }),
    })

    ticker.startRoomTicker(ROOM_ID, socketServer)
    await ticker.tickRoom(ROOM_ID, socketServer, 100)

    for (const event of roomEvents) {
        assert.equal(serverToClientSchemas[event.eventName].safeParse(event.payload).success, true, event.eventName)
    }
    assert.equal(roomEvents.some(event => event.eventName === "pve:ai-policy"), true)
    assert.equal(roomEvents.some(event => event.eventName === "game:authoritative:snapshot"), true)
})

test("authoritative ticker의 실제 match:finish emit이 S2C 계약을 통과한다", async () => {
    const roomEvents = []
    const match = createMatch()
    const finishedRoom = { ...createRoom(), status: "finished" }
    const socketServer = {
        to(roomId) {
            return {
                emit(eventName, payload) {
                    roomEvents.push({ roomId, eventName, payload })
                },
            }
        },
    }
    const ticker = createAuthoritativeTickerService({
        setIntervalFn() {
            return { unref() {} }
        },
        clearIntervalFn() {},
        loadGameCore: async () => ({}),
        getMatchState: () => ({ ok: true, match }),
        applyGravityStepToMatchPlayerState(_roomId, playerId) {
            return playerId === HUMAN_ID
                ? {
                    ok: true,
                    stateChanged: true,
                    gravityResult: { kind: "lock" },
                    placementResult: { attackLines: 0, gameOver: true, gameOverReason: "top_out" },
                }
                : { ok: true, skipped: true, stateChanged: false }
        },
        getAuthoritativePlayerSnapshotDto(_roomId, playerId) {
            return {
                ok: true,
                snapshot: createSnapshot(playerId === HUMAN_ID ? { phase: "gameOver", gameOver: true } : {}),
            }
        },
        finishGame: () => ({
            ok: true,
            room: finishedRoom,
            winnerPlayerId: GUEST_ID,
            loserPlayerId: HUMAN_ID,
            finishReason: "top_out",
        }),
        saveGameEventLog: async log => ({ ok: true, log, reason: null }),
        deleteMatch: () => ({ ok: true, match: null, reason: null }),
    })

    ticker.startRoomTicker(ROOM_ID, socketServer)
    await ticker.tickRoom(ROOM_ID, socketServer, 500)

    const finishEvent = roomEvents.find(event => event.eventName === "match:finish")
    assert.ok(finishEvent)
    assert.equal(serverToClientSchemas["match:finish"].safeParse(finishEvent.payload).success, true)
})

module.exports = {
    createBoard,
    createRoom,
    createSnapshot,
    serverFixtures,
}

test("combatEffect는 line clear 없이도 허용하고 누락·잘못된 양·대상 조합을 거부한다", () => {
    const gameId = "00000000-0000-4000-8000-000000000003";
    const effect = {
        id: `${gameId}:${HUMAN_ID}:0:combat`, gameId, pieceIndex: 0,
        targetPlayerId: GUEST_ID, sentLines: 2, canceledLines: 1, appliedLines: 0,
        linesCleared: 2, isTSpin: false, tSpinType: "none", combo: 0, backToBackBonus: false,
    };
    const schema = serverToClientSchemas["game:authoritative:snapshot"];
    const payload = { roomId: ROOM_ID, playerId: HUMAN_ID, snapshot: createSnapshot() };
    assert.equal(schema.safeParse({ ...payload, combatEffect: effect }).success, true);
    assert.equal(schema.safeParse({ ...payload, combatEffect: {
        ...effect, targetPlayerId: null, sentLines: 0, linesCleared: 0, appliedLines: 3,
    } }).success, true);
    for (const invalid of [
        { ...effect, gameId: "not-a-uuid" }, { ...effect, sentLines: -1 },
        { ...effect, appliedLines: 1.5 }, { ...effect, linesCleared: 5 },
        { ...effect, targetPlayerId: null }, { ...effect, sentLines: 0 },
        { ...effect, extra: true }, { ...effect, canceledLines: undefined },
    ]) {
        assert.equal(schema.safeParse({ ...payload, combatEffect: invalid }).success, false);
    }
});
