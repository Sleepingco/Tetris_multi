const test = require("node:test")
const assert = require("node:assert/strict")

const { registerSocketHandlers } = require("../src/server/sockets/index.js")

class FakeSocketServer {
    constructor() {
        this.middleware = null
        this.connectionHandler = null
        this.roomEvents = []
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

    emit() {}
}

class FakeSocket {
    constructor(id, auth) {
        this.id = id
        this.handshake = { auth, address: "127.0.0.1" }
        this.data = {}
        this.handlers = new Map()
        this.events = []
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
    to() {
        return { emit() {} }
    }

    disconnect() {
        this.disconnected = true
        this.server?.sockets.sockets.delete(this.id)
        this.trigger("disconnect")
    }

    trigger(eventName, payload) {
        for (const handler of this.handlers.get(eventName) || []) handler(payload)
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
