/**
 * Socket.IO 연결 입구에서 session 인증과 handler 정리가 올바르게 조립되는지 검증한다.
 *
 * 실제 네트워크 대신 FakeSocketServer/FakeSocket에 등록된 handler와 emit을 기록해 연결을 준비하고,
 * bootstrap·재연결·dispose를 실행한 뒤 newest-socket-wins와 S2C schema 통과 여부를 검증한다.
 */
const test = require("node:test")
const assert = require("node:assert/strict")

const { registerSocketHandlers } = require("../dist/server/server/sockets/index.js")
const { serverToClientSchemas } = require("../dist/server/shared/socketContracts.mjs")
const { createPlayerSessionService } = require("../dist/server/server/services/playerSessionService.js")
const { createSocketRateLimitService } = require("../dist/server/server/services/socketRateLimitService.js")
const { clearRoomsForTest, findRoomByPlayerId } = require("../dist/server/server/services/roomService.js")
const { getMatchState, deleteMatch } = require("../dist/server/server/services/matchService.js")

class FakeSocketServer {
    constructor() {
        this.middleware = null
        this.connectionHandler = null
        this.roomEvents = []
        this.globalEvents = []
        this.sockets = { sockets: new Map() }
    }

    use(handler) {
        this.middleware = handler
    }

    on(eventName, handler) {
        if (eventName === "connection") this.connectionHandler = handler
    }

    connect(socket) {
        let connectionError = null
        this.middleware(socket, error => {
            connectionError = error || null
        })
        if (connectionError) return connectionError

        socket.server = this
        this.sockets.sockets.set(socket.id, socket)
        this.connectionHandler(socket)
        return null
    }

    to(roomId) {
        return {
            emit: (eventName, payload) => {
                this.roomEvents.push({ roomId, eventName, payload })
            },
        }
    }

    emit(eventName, payload) {
        this.globalEvents.push({ eventName, payload })
    }
}

class FakeSocket {
    constructor(id, auth) {
        this.id = id
        this.handshake = { auth, address: "127.0.0.1" }
        this.data = {}
        this.handlers = new Map()
        this.events = []
        this.roomEvents = []
        this.disconnected = false
    }

    on(eventName, handler) {
        const handlers = this.handlers.get(eventName) || []
        handlers.push(handler)
        this.handlers.set(eventName, handlers)
    }

    emit(eventName, payload) {
        this.events.push({ eventName, payload })
    }

    join() {}
    leave() {}
    to(roomId) {
        return {
            emit: (eventName, payload) => {
                this.roomEvents.push({ roomId, eventName, payload })
            },
        }
    }

    disconnect() {
        this.disconnected = true
        this.server?.sockets.sockets.delete(this.id)
        this.trigger("disconnect")
    }

    trigger(eventName, payload) {
        for (const handler of this.handlers.get(eventName) || []) handler(payload)
    }

    async triggerAsync(eventName, payload) {
        await Promise.all((this.handlers.get(eventName) || []).map(handler => handler(payload)))
    }

    lastEvent(eventName) {
        return this.events.findLast(event => event.eventName === eventName)?.payload
    }
}

function registerTestHandlers(socketServer, dependencies = {}) {
    return registerSocketHandlers(socketServer, {
        gameStartCountdownMs: 0,
        authoritativeTickerService: {
            startRoomTicker() {},
            stopRoomTicker() {},
            stopAllRoomTickers() {},
            resetPlayerGravity() {},
        },
        saveGameEventLog: async log => ({ ok: true, log, reason: null }),
        savePlacementDecisionLog: async log => ({ ok: true, log, reason: null }),
        ...dependencies,
    })
}

test("기본 lifecycle 제한은 인증 실패와 구분되고 제한 이후에도 membership을 유지한다", async t => {
    clearRoomsForTest();
    let now = 0;
    const server = new FakeSocketServer();
    const sessions = createPlayerSessionService({ now: () => now });
    const dispose = registerTestHandlers(server, {
        playerSessionService: sessions,
        socketRateLimitService: createSocketRateLimitService({ now: () => now }),
    });
    t.after(() => { dispose(); clearRoomsForTest(); });
    const socket = new FakeSocket("limited-player", { nickname: "Host" });
    assert.equal(server.connect(socket), null);
    socket.trigger("room:create", { mode: "pve" });
    const roomId = socket.lastEvent("room:result").room.roomId;
    t.after(() => deleteMatch(roomId));
    for (let request = 0; request < 8; request++) socket.trigger("room:sync", { roomId });
    await socket.triggerAsync("room:start", { roomId });
    assert.equal(socket.lastEvent("room:result").ok, true);
    socket.trigger("game:join", { roomId });
    assert.equal(socket.lastEvent("game:join:result").reason, "RATE_LIMITED");
    assert.equal(sessions.isActiveSocket(socket.data.playerSession, socket.id), true);
    socket.trigger("room:sync", { roomId });
    assert.equal(socket.lastEvent("room:result").reason, "RATE_LIMITED");
    socket.trigger("room:create", { mode: "pve" });
    assert.equal(socket.lastEvent("room:result").reason, "RATE_LIMITED");
    assert.equal(findRoomByPlayerId(socket.data.playerIdentity.playerId).room.roomId, roomId);
    now = 60_000;
    socket.trigger("game:join", { roomId });
    assert.equal(socket.lastEvent("game:join:result").ok, true);
    socket.trigger("room:create", { mode: "pve" });
    assert.equal(socket.lastEvent("room:result").reason, "PLAYER_ALREADY_IN_ROOM");
});

test("PVP countdown은 두 human 참가 후 시작하고 조기 input을 막으며 재접속으로 다시 준비한다", async t => {
    clearRoomsForTest();
    let now = 1000;
    const server = new FakeSocketServer();
    const dispose = registerTestHandlers(server, {
        gameStartCountdownMs: 3000,
        now: () => now,
        socketRateLimitService: { consume: () => true, cleanupExpired() {} },
    });
    t.after(() => { dispose(); clearRoomsForTest(); });
    const host = new FakeSocket("countdown-host", { nickname: "Host" });
    const guest = new FakeSocket("countdown-guest", { nickname: "Guest" });
    assert.equal(server.connect(host), null);
    assert.equal(server.connect(guest), null);
    host.trigger("room:create", {});
    const roomId = host.lastEvent("room:result").room.roomId;
    t.after(() => deleteMatch(roomId));
    guest.trigger("room:join", { roomId });
    await host.triggerAsync("room:start", { roomId });
    host.trigger("game:join", { roomId });
    assert.equal(host.lastEvent("game:join:result").match.startsAt, null);
    const state = getMatchState(roomId).match.players[0].authoritativeState;
    const before = structuredClone(state);
    await host.triggerAsync("game:input", { roomId, action: "hold", tick: 0, pieceIndex: 1, clientSequence: 1 });
    assert.equal(host.lastEvent("game:input:result").reason, "GAME_NOT_STARTED");
    assert.deepEqual(state, before);
    guest.trigger("game:join", { roomId });
    assert.equal(getMatchState(roomId).match.startsAt, 4000);
    assert.equal(serverToClientSchemas["game:countdown"].safeParse(server.roomEvents.at(-1).payload).success, true);
    now = 1500;
    host.trigger("game:join", { roomId });
    assert.equal(getMatchState(roomId).match.startsAt, 4000);
    const credential = guest.lastEvent("session:ready");
    guest.disconnect();
    assert.equal(getMatchState(roomId).match.startsAt, null);
    const reconnected = new FakeSocket("countdown-guest-reconnected", {
        nickname: "Guest", playerId: credential.playerId, token: credential.token,
    });
    assert.equal(server.connect(reconnected), null);
    reconnected.trigger("game:join", { roomId });
    assert.equal(getMatchState(roomId).match.startsAt, 4500);
    now = 1600;
    const currentCredential = reconnected.lastEvent("session:ready");
    const replacement = new FakeSocket("countdown-guest-replacement", {
        nickname: "Guest", playerId: currentCredential.playerId, token: currentCredential.token,
    });
    assert.equal(server.connect(replacement), null);
    assert.equal(getMatchState(roomId).match.startsAt, null);
    replacement.trigger("game:join", { roomId });
    assert.equal(getMatchState(roomId).match.startsAt, 4600);
    reconnected.trigger("disconnect");
    assert.equal(getMatchState(roomId).match.startsAt, 4600);
    now = 4599;
    await host.triggerAsync("game:input", { roomId, action: "hold", tick: 0, pieceIndex: 1, clientSequence: 1 });
    assert.equal(host.lastEvent("game:input:result").reason, "GAME_NOT_STARTED");
    now = 4600;
    await host.triggerAsync("game:input", { roomId, action: "hold", tick: 0, pieceIndex: 1, clientSequence: 1 });
    assert.equal(host.lastEvent("game:input:result").ok, true);
});

test("PVE countdown은 human 하나로 예약되고 취소 시 match와 ticker를 정리한다", async t => {
    clearRoomsForTest();
    const server = new FakeSocketServer();
    const stopped = [];
    const dispose = registerTestHandlers(server, {
        gameStartCountdownMs: 3000,
        now: () => 1000,
        authoritativeTickerService: {
            startRoomTicker() {}, stopRoomTicker(id) { stopped.push(id); },
            stopAllRoomTickers() {}, resetPlayerGravity() {},
        },
    });
    t.after(() => { dispose(); clearRoomsForTest(); });
    const host = new FakeSocket("pve-countdown-host", { nickname: "Host" });
    server.connect(host);
    host.trigger("room:create", { mode: "pve" });
    const roomId = host.lastEvent("room:result").room.roomId;
    t.after(() => deleteMatch(roomId));
    await host.triggerAsync("room:start", { roomId });
    host.trigger("game:join", { roomId });
    assert.equal(getMatchState(roomId).match.startsAt, 4000);
    host.trigger("game:leave", { roomId });
    assert.equal(host.lastEvent("game:leave:result").ok, true);
    assert.equal(getMatchState(roomId).reason, "MATCH_NOT_FOUND");
    assert.deepEqual(stopped, [roomId]);
    assert.equal(findRoomByPlayerId(host.data.playerIdentity.playerId), null);
});

test("socket handler disposer는 grace timer와 ticker를 한 번만 정리한다", () => {
    const socketServer = new FakeSocketServer()
    const disconnectGraceContexts = new Map()
    disconnectGraceContexts.set("player-1", {
        timer: setTimeout(() => {}, 60_000),
    })
    let stopAllCount = 0
    const dispose = registerTestHandlers(socketServer, {
        disconnectGraceContexts,
        authoritativeTickerService: {
            startRoomTicker() {},
            stopRoomTicker() {},
            stopAllRoomTickers() {
                stopAllCount += 1
            },
            resetPlayerGravity() {},
        },
    })

    dispose()
    dispose()

    assert.equal(stopAllCount, 1)
    assert.equal(disconnectGraceContexts.size, 0)
    const socket = new FakeSocket("socket-after-dispose", { nickname: "Player" })
    assert.equal(socketServer.connect(socket), null)
    assert.equal(socket.events.length, 0)
})

test("bootstrap은 session을 발급·회전하고 newest socket wins를 적용한다", () => {
    const socketServer = new FakeSocketServer()
    registerTestHandlers(socketServer)

    const firstSocket = new FakeSocket("socket-1", { nickname: "Player" })
    assert.equal(socketServer.connect(firstSocket), null)
    const firstReady = firstSocket.lastEvent("session:ready")

    assert.equal(serverToClientSchemas["session:ready"].safeParse(firstReady).success, true)
    assert.equal(firstReady.version, 1)
    assert.equal(firstReady.resumed, false)
    assert.equal(firstReady.token.length, 43)
    firstSocket.trigger("room:create", {})
    const roomId = firstSocket.lastEvent("room:result").room.roomId

    const secondSocket = new FakeSocket("socket-2", {
        nickname: "Player",
        playerId: firstReady.playerId,
        token: firstReady.token,
    })
    assert.equal(socketServer.connect(secondSocket), null)
    const secondReady = secondSocket.lastEvent("session:ready")

    assert.equal(secondReady.resumed, true)
    assert.notEqual(secondReady.token, firstReady.token)
    assert.equal(secondReady.expiresAt, firstReady.expiresAt)
    assert.equal(firstSocket.disconnected, true)

    firstSocket.trigger("room:create", { playerId: firstReady.playerId, nickname: "Forged" })
    assert.equal(firstSocket.lastEvent("room:result").reason, "NOT_AUTHORIZED")
    firstSocket.trigger("game:input", {
        roomId,
        action: "hold",
        tick: 1,
        pieceIndex: 1,
        clientSequence: 1,
    })
    assert.equal(firstSocket.lastEvent("game:input:result").reason, "NOT_AUTHORIZED")

    const replaySocket = new FakeSocket("socket-3", {
        nickname: "Player",
        playerId: firstReady.playerId,
        token: firstReady.token,
    })
    const replayError = socketServer.connect(replaySocket)
    assert.equal(replayError.data.code, "SESSION_REPLAYED")
    assert.equal(JSON.stringify(replayError).includes(firstReady.token), false)
})

test("bootstrap은 partial credential을 인증 오류로 반환한다", () => {
    const socketServer = new FakeSocketServer()
    registerTestHandlers(socketServer)
    const socket = new FakeSocket("socket-partial", {
        nickname: "Player",
        playerId: "00000000-0000-4000-8000-000000000001",
    })

    const error = socketServer.connect(socket)

    assert.equal(error.data.code, "SESSION_CREDENTIALS_INCOMPLETE")
    assert.equal(error.data.terminal, true)
    assert.equal(socket.lastEvent("session:ready"), undefined)
})

test("bootstrap은 strict auth unknown key를 session authenticate 전에 거부한다", () => {
    const socketServer = new FakeSocketServer()
    registerTestHandlers(socketServer)
    const socket = new FakeSocket("socket-unknown-auth", {
        nickname: "Player",
        unknown: true,
    })

    const error = socketServer.connect(socket)

    assert.equal(error.data.code, "SESSION_CREDENTIALS_MALFORMED")
    assert.equal(error.data.terminal, true)
    assert.equal(socket.lastEvent("session:ready"), undefined)
})

test("실제 socket handlers의 PVP emit payload가 S2C 계약을 통과한다", async () => {
    const socketServer = new FakeSocketServer()
    registerTestHandlers(socketServer)
    const hostSocket = new FakeSocket("contract-host-socket", { nickname: "Host" })
    const guestSocket = new FakeSocket("contract-guest-socket", { nickname: "Guest" })
    assert.equal(socketServer.connect(hostSocket), null)
    assert.equal(socketServer.connect(guestSocket), null)

    hostSocket.trigger("room:create", { mode: "pvp" })
    const roomId = hostSocket.lastEvent("room:result").room.roomId
    guestSocket.trigger("room:join", { roomId })
    await hostSocket.triggerAsync("room:start", { roomId })
    hostSocket.trigger("global:chat", { text: "hello" })
    guestSocket.trigger("room:chat", { roomId, text: "hello" })
    hostSocket.trigger("game:join", { roomId })
    guestSocket.trigger("game:join", { roomId })
    await hostSocket.triggerAsync("game:input", {
        roomId,
        action: "hold",
        tick: 1,
        pieceIndex: 1,
        clientSequence: 1,
    })
    hostSocket.trigger("game:bag:request", { roomId })
    await hostSocket.triggerAsync("game:log:placement_decision", {
        roomId,
        log: {
            eventType: "placement_decision",
            schemaVersion: 1,
            gameId: `${roomId}-game`,
            pieceIndex: 1,
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
    hostSocket.trigger("game:leave", { roomId })

    const emitted = [
        ...hostSocket.events,
        ...guestSocket.events,
        ...hostSocket.roomEvents,
        ...guestSocket.roomEvents,
        ...socketServer.globalEvents,
        ...socketServer.roomEvents,
    ]
    const names = new Set(emitted.map(event => event.eventName))
    for (const event of emitted) {
        assert.ok(serverToClientSchemas[event.eventName], `missing schema: ${event.eventName}`)
        assert.equal(
            serverToClientSchemas[event.eventName].safeParse(event.payload).success,
            true,
            event.eventName,
        )
    }
    for (const eventName of [
        "session:ready",
        "global:message",
        "room:message",
        "room:result",
        "room:updated",
        "game:join:result",
        "game:input:result",
        "game:log:result",
        "game:bag:result",
        "game:leave:result",
        "game:opponent-left",
        "game:authoritative:snapshot",
    ]) {
        assert.equal(names.has(eventName), true, eventName)
    }
})
