const test = require("node:test")
const assert = require("node:assert/strict")

const { registerSocketHandlers } = require("../src/server/sockets/index.js")
const { serverToClientSchemas } = require("../src/shared/socketContracts.mjs")

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

function registerTestHandlers(socketServer) {
    registerSocketHandlers(socketServer, {
        authoritativeTickerService: {
            startRoomTicker() {},
            stopRoomTicker() {},
            resetPlayerGravity() {},
        },
        saveGameEventLog: async log => ({ ok: true, log, reason: null }),
        savePlacementDecisionLog: async log => ({ ok: true, log, reason: null }),
    })
}

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
