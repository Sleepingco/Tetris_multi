const test = require("node:test")
const assert = require("node:assert/strict")

const { registerSocketHandlers } = require("../src/server/sockets/index.js")
const {
    getMatchState,
    getPlayerShadowState,
    recordShadowSnapshot,
} = require("../src/server/services/matchService.js")
const {
    AUTHORITATIVE_SNAPSHOT_FIELDS,
} = require("../src/server/validators/gameSnapshotValidator.js")

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

class FakeClientSocket {
    constructor(id) {
        this.id = id
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
        const handlers = this.handlers.get(eventName) || []
        handlers.forEach(handler => handler(payload))
    }

    async triggerAsync(eventName, payload) {
        const handlers = this.handlers.get(eventName) || []
        await Promise.all(handlers.map(handler => handler(payload)))
    }

    lastClientEvent(eventName) {
        return this.clientEvents.findLast(event => event.eventName === eventName)
    }
}

function getAuthoritativeSnapshotUpdateEvents(clientSocket) {
    return clientSocket.clientEvents.filter((event) => {
        return event.eventName === "game:authoritative:snapshot:update"
    })
}

test("room:leave는 퇴장한 socket을 room에서 제거하고 남은 room 상태를 broadcast한다", () => {
    const socketServer = new FakeSocketServer()
    const hostSocket = new FakeClientSocket("host-socket")
    const guestSocket = new FakeClientSocket("guest-socket")

    registerSocketHandlers(socketServer)
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

    registerSocketHandlers(socketServer)
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

test("disconnect는 끊어진 socket의 player를 room에서 제거하고 남은 참가자에게 알린다", () => {
    const socketServer = new FakeSocketServer()
    const hostSocket = new FakeClientSocket("disconnect-host-socket")
    const guestSocket = new FakeClientSocket("disconnect-guest-socket")

    registerSocketHandlers(socketServer)
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

    assert.deepEqual(guestSocket.leftRooms, [roomId])
    assert.equal(socketServer.roomEvents.at(-2).eventName, "room:updated")
    assert.equal(socketServer.roomEvents.at(-2).payload.players.length, 1)
    assert.equal(socketServer.roomEvents.at(-2).payload.players[0].playerId, "disconnect-p1")
    assert.equal(socketServer.roomEvents.at(-1).eventName, "room:message")
    assert.equal(socketServer.roomEvents.at(-1).payload.text, "Guest님이 퇴장하였습니다.")
})

test("room:start는 방장만 실행 가능하며, 성공 시 게임 시작 이벤트와 룸 정보를 broadcast한다", () => {
    const socketServer = new FakeSocketServer()
    const hostSocket = new FakeClientSocket("host-socket")
    const guestSocket = new FakeClientSocket("guest-socket")

    registerSocketHandlers(socketServer)
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

test("room:start는 host playerId를 보내도 다른 socket이면 NOT_AUTHORIZED를 반환한다", () => {
    const socketServer = new FakeSocketServer()
    const hostSocket = new FakeClientSocket("start-host-socket")
    const guestSocket = new FakeClientSocket("start-guest-socket")

    registerSocketHandlers(socketServer)
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

    registerSocketHandlers(socketServer)
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

    registerSocketHandlers(socketServer)
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

    registerSocketHandlers(socketServer)
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

    registerSocketHandlers(socketServer)
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

    assert.deepEqual(results, ["EMPTY_CHAT_MESSAGE", "CHAT_MESSAGE_TOO_LONG"])
})

test("chat은 같은 socket의 1초 내 연속 전송을 CHAT_RATE_LIMITED로 차단한다", () => {
    const socketServer = new FakeSocketServer()
    const chatClientSocket = new FakeClientSocket("chat-rate-limit-socket")
    const originalNow = Date.now

    try {
        let now = 100000
        Date.now = () => now

        registerSocketHandlers(socketServer)
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

        registerSocketHandlers(socketServer)
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

test("game:snapshot은 game:join으로 같은 room에 들어간 상대 socket에게 전달된다", () => {
    const socketServer = new FakeSocketServer()
    const hostSocket = new FakeClientSocket("game-host-socket")
    const guestSocket = new FakeClientSocket("game-guest-socket")
    const snapshot = {
        tick: 10,
        board: [["I"]],
        activePiece: {
            pieceType: "I",
            rotation: 0,
            row: 1,
            col: 4,
        },
    }

    registerSocketHandlers(socketServer)
    socketServer.connect(hostSocket)
    socketServer.connect(guestSocket)

    hostSocket.trigger("room:create", {
        playerId: "host-player",
        nickname: "Host",
    })
    const createResult = hostSocket.lastClientEvent("room:result").payload
    const roomId = createResult.room.roomId

    guestSocket.trigger("room:join", {
        roomId,
        player: {
            playerId: "guest-player",
            nickname: "Guest",
        },
    })

    hostSocket.trigger("room:start", {
        roomId,
        playerId: "host-player",
    })
    hostSocket.trigger("game:join", {
        roomId,
        playerId: "host-player",
    })
    guestSocket.trigger("game:join", {
        roomId,
        playerId: "guest-player",
    })

    hostSocket.trigger("game:snapshot", {
        roomId,
        playerId: "host-player",
        snapshot,
    })

    const guestSnapshotEvent = guestSocket.lastClientEvent("game:snapshot")

    assert.deepEqual(hostSocket.joinedRooms, [roomId])
    assert.deepEqual(guestSocket.joinedRooms, [roomId])
    assert.equal(guestSnapshotEvent.eventName, "game:snapshot")
    assert.equal(guestSnapshotEvent.payload.playerId, "host-player")
    assert.deepEqual(guestSnapshotEvent.payload.snapshot, snapshot)
})

test("game:input은 game:join으로 같은 room에 들어간 상대 socket에게 전달된다", () => {
    const socketServer = new FakeSocketServer()
    const hostSocket = new FakeClientSocket("input-host-socket")
    const guestSocket = new FakeClientSocket("input-guest-socket")

    registerSocketHandlers(socketServer)
    socketServer.connect(hostSocket)
    socketServer.connect(guestSocket)

    hostSocket.trigger("room:create", {
        playerId: "input-host-player",
        nickname: "Host",
    })
    const createResult = hostSocket.lastClientEvent("room:result").payload
    const roomId = createResult.room.roomId

    guestSocket.trigger("room:join", {
        roomId,
        player: {
            playerId: "input-guest-player",
            nickname: "Guest",
        },
    })

    hostSocket.trigger("room:start", {
        roomId,
        playerId: "input-host-player",
    })

    hostSocket.trigger("game:join", {
        roomId,
        playerId: "input-host-player",
    })
    guestSocket.trigger("game:join", {
        roomId,
        playerId: "input-guest-player",
    })

    hostSocket.trigger("game:input", {
        roomId,
        playerId: "input-host-player",
        action: "move_left",
        tick: 12,
        pieceIndex: 4,
    })

    const guestInputEvent = guestSocket.lastClientEvent("game:input")

    assert.equal(guestInputEvent.eventName, "game:input")
    assert.equal(guestInputEvent.payload.roomId, roomId)
    assert.equal(guestInputEvent.payload.playerId, "input-host-player")
    assert.equal(guestInputEvent.payload.action, "move_left")
    assert.equal(guestInputEvent.payload.tick, 12)
    assert.equal(guestInputEvent.payload.pieceIndex, 4)

    const matchResult = getMatchState(roomId)
    assert.equal(matchResult.ok, true)
    assert.equal(matchResult.match.players[0].inputLog[0].action, "move_left")
    assert.equal(matchResult.match.players[0].inputLog[0].tick, 12)
    assert.equal(matchResult.match.players[0].inputLog[0].pieceIndex, 4)
})

test("game:snapshot은 match shadow state에 client snapshot을 기록하고 기존 broadcast를 유지한다", () => {
    const socketServer = new FakeSocketServer()
    const hostSocket = new FakeClientSocket("shadow-snapshot-host-socket")
    const guestSocket = new FakeClientSocket("shadow-snapshot-guest-socket")
    const snapshot = {
        board: [["tree"]],
        activePiece: {
            pieceType: "tree",
            rotation: 0,
            row: 1,
            col: 4,
        },
        score: 100,
        linesClearedTotal: 2,
        phase: "playing",
        pendingGarbageQueue: [{ lines: 2, holeCol: 4 }],
        tick: 30,
        pieceIndex: 8,
    }

    registerSocketHandlers(socketServer)
    socketServer.connect(hostSocket)
    socketServer.connect(guestSocket)

    hostSocket.trigger("room:create", {
        playerId: "shadow-snapshot-host",
        nickname: "Host",
    })
    const createResult = hostSocket.lastClientEvent("room:result").payload
    const roomId = createResult.room.roomId

    guestSocket.trigger("room:join", {
        roomId,
        player: {
            playerId: "shadow-snapshot-guest",
            nickname: "Guest",
        },
    })
    hostSocket.trigger("room:start", {
        roomId,
        playerId: "shadow-snapshot-host",
    })
    hostSocket.trigger("game:join", {
        roomId,
        playerId: "shadow-snapshot-host",
    })
    guestSocket.trigger("game:join", {
        roomId,
        playerId: "shadow-snapshot-guest",
    })

    hostSocket.trigger("game:snapshot", {
        roomId,
        playerId: "shadow-snapshot-host",
        snapshot,
    })

    const guestSnapshotEvent = guestSocket.lastClientEvent("game:snapshot")
    const matchResult = getMatchState(roomId)
    const hostMatchPlayer = matchResult.match.players.find(player => {
        return player.playerId === "shadow-snapshot-host"
    })

    assert.equal(guestSnapshotEvent.eventName, "game:snapshot")
    assert.deepEqual(guestSnapshotEvent.payload.snapshot, snapshot)
    assert.deepEqual(hostMatchPlayer.lastClientSnapshot, snapshot)
})

test("game:snapshot은 활성 match가 없으면 상대에게 전달하지 않는다", () => {
    const socketServer = new FakeSocketServer()
    const hostSocket = new FakeClientSocket("snapshot-missing-match-host-socket")
    const guestSocket = new FakeClientSocket("snapshot-missing-match-guest-socket")
    const snapshot = {
        board: [["tree"]],
        activePiece: {
            pieceType: "tree",
            rotation: 0,
            row: 1,
            col: 4,
        },
        score: 100,
        linesClearedTotal: 2,
        phase: "playing",
        pendingGarbageQueue: [],
        tick: 30,
        pieceIndex: 8,
    }

    registerSocketHandlers(socketServer)
    socketServer.connect(hostSocket)
    socketServer.connect(guestSocket)

    hostSocket.trigger("room:create", {
        playerId: "snapshot-missing-match-host",
        nickname: "Host",
    })
    const createResult = hostSocket.lastClientEvent("room:result").payload
    const roomId = createResult.room.roomId

    guestSocket.trigger("room:join", {
        roomId,
        player: {
            playerId: "snapshot-missing-match-guest",
            nickname: "Guest",
        },
    })
    hostSocket.trigger("game:join", {
        roomId,
        playerId: "snapshot-missing-match-host",
    })
    guestSocket.trigger("game:join", {
        roomId,
        playerId: "snapshot-missing-match-guest",
    })

    hostSocket.trigger("game:snapshot", {
        roomId,
        playerId: "snapshot-missing-match-host",
        snapshot,
    })

    const snapshotResult = hostSocket.lastClientEvent("game:snapshot:result")?.payload
    const guestSnapshotEvent = guestSocket.lastClientEvent("game:snapshot")

    assert.equal(snapshotResult?.ok, false)
    assert.equal(snapshotResult?.reason, "MATCH_NOT_FOUND")
    assert.equal(guestSnapshotEvent, undefined)
})

test("game:shadow:state는 room 참가자에게 shadow 상태를 반환한다", () => {
    const socketServer = new FakeSocketServer()
    const hostSocket = new FakeClientSocket("shadow-state-host-socket")
    const guestSocket = new FakeClientSocket("shadow-state-guest-socket")

    registerSocketHandlers(socketServer)
    socketServer.connect(hostSocket)
    socketServer.connect(guestSocket)

    hostSocket.trigger("room:create", {
        playerId: "shadow-state-host",
        nickname: "Host",
    })
    const createResult = hostSocket.lastClientEvent("room:result").payload
    const roomId = createResult.room.roomId

    guestSocket.trigger("room:join", {
        roomId,
        player: {
            playerId: "shadow-state-guest",
            nickname: "Guest",
        },
    })
    hostSocket.trigger("room:start", {
        roomId,
        playerId: "shadow-state-host",
    })
    hostSocket.trigger("game:shadow:state", {
        roomId,
        playerId: "shadow-state-host",
    })

    const shadowResult = hostSocket.lastClientEvent("game:shadow:state:result").payload

    assert.equal(shadowResult.ok, true)
    assert.equal(shadowResult.reason, null)
    assert.equal(shadowResult.shadow.roomId, roomId)
    assert.equal(shadowResult.shadow.playerId, "shadow-state-host")
    assert.deepEqual(shadowResult.shadow.desyncLog, [])
})

test("game:shadow:state는 room 참가자가 아닌 playerId면 NOT_AUTHORIZED를 반환한다", () => {
    const socketServer = new FakeSocketServer()
    const hostSocket = new FakeClientSocket("shadow-auth-host-socket")
    const intruderSocket = new FakeClientSocket("shadow-auth-intruder-socket")

    registerSocketHandlers(socketServer)
    socketServer.connect(hostSocket)
    socketServer.connect(intruderSocket)

    hostSocket.trigger("room:create", {
        playerId: "shadow-auth-host",
        nickname: "Host",
    })
    const createResult = hostSocket.lastClientEvent("room:result").payload
    const roomId = createResult.room.roomId

    intruderSocket.trigger("game:shadow:state", {
        roomId,
        playerId: "shadow-auth-intruder",
    })

    const shadowResult = intruderSocket.lastClientEvent("game:shadow:state:result").payload

    assert.equal(shadowResult.ok, false)
    assert.equal(shadowResult.shadow, null)
    assert.equal(shadowResult.reason, "NOT_AUTHORIZED")
})

test("game:authoritative:snapshot은 room 참가자에게 서버 snapshot 후보를 반환한다", () => {
    const socketServer = new FakeSocketServer()
    const hostSocket = new FakeClientSocket("authoritative-snapshot-host-socket")
    const guestSocket = new FakeClientSocket("authoritative-snapshot-guest-socket")

    registerSocketHandlers(socketServer)
    socketServer.connect(hostSocket)
    socketServer.connect(guestSocket)

    hostSocket.trigger("room:create", {
        playerId: "authoritative-snapshot-host",
        nickname: "Host",
    })
    const createResult = hostSocket.lastClientEvent("room:result").payload
    const roomId = createResult.room.roomId

    guestSocket.trigger("room:join", {
        roomId,
        player: {
            playerId: "authoritative-snapshot-guest",
            nickname: "Guest",
        },
    })
    hostSocket.trigger("room:start", {
        roomId,
        playerId: "authoritative-snapshot-host",
    })
    hostSocket.trigger("game:authoritative:snapshot", {
        roomId,
        playerId: "authoritative-snapshot-host",
    })

    const result = hostSocket.lastClientEvent("game:authoritative:snapshot:result").payload

    assert.equal(result.ok, true)
    assert.equal(result.reason, null)
    assert.equal(result.roomId, roomId)
    assert.equal(result.playerId, "authoritative-snapshot-host")
    assert.equal(result.source, "server_shadow")
    assert.equal(typeof result.createdAt, "number")
    assert.deepEqual(Object.keys(result.snapshot), AUTHORITATIVE_SNAPSHOT_FIELDS)
    assert.equal(result.snapshot.lastClientInputTick, undefined)
    assert.equal(result.snapshot.lastClientInputPieceIndex, undefined)
})

test("game:authoritative:snapshot은 room 참가자가 아닌 playerId면 NOT_AUTHORIZED를 반환한다", () => {
    const socketServer = new FakeSocketServer()
    const hostSocket = new FakeClientSocket("authoritative-auth-host-socket")
    const intruderSocket = new FakeClientSocket("authoritative-auth-intruder-socket")

    registerSocketHandlers(socketServer)
    socketServer.connect(hostSocket)
    socketServer.connect(intruderSocket)

    hostSocket.trigger("room:create", {
        playerId: "authoritative-auth-host",
        nickname: "Host",
    })
    const createResult = hostSocket.lastClientEvent("room:result").payload

    intruderSocket.trigger("game:authoritative:snapshot", {
        roomId: createResult.room.roomId,
        playerId: "authoritative-auth-intruder",
    })

    const result = intruderSocket.lastClientEvent("game:authoritative:snapshot:result").payload

    assert.equal(result.ok, false)
    assert.equal(result.snapshot, null)
    assert.equal(result.roomId, createResult.room.roomId)
    assert.equal(result.playerId, "authoritative-auth-intruder")
    assert.equal(result.source, "server_shadow")
    assert.equal(typeof result.createdAt, "number")
    assert.equal(result.reason, "NOT_AUTHORIZED")
})

test("game:authoritative:snapshot:subscribe는 현재 authoritative snapshot update를 즉시 보낸다", () => {
    const socketServer = new FakeSocketServer()
    const hostSocket = new FakeClientSocket("authoritative-subscribe-initial-host-socket")
    const guestSocket = new FakeClientSocket("authoritative-subscribe-initial-guest-socket")

    registerSocketHandlers(socketServer)
    socketServer.connect(hostSocket)
    socketServer.connect(guestSocket)

    hostSocket.trigger("room:create", {
        playerId: "authoritative-subscribe-initial-host",
        nickname: "Host",
    })
    const createResult = hostSocket.lastClientEvent("room:result").payload
    const roomId = createResult.room.roomId

    guestSocket.trigger("room:join", {
        roomId,
        player: {
            playerId: "authoritative-subscribe-initial-guest",
            nickname: "Guest",
        },
    })
    hostSocket.trigger("room:start", {
        roomId,
        playerId: "authoritative-subscribe-initial-host",
    })

    hostSocket.trigger("game:authoritative:snapshot:subscribe", {
        roomId,
        playerId: "authoritative-subscribe-initial-host",
    })

    const subscribeResult = hostSocket.lastClientEvent("game:authoritative:snapshot:subscribe:result").payload
    const hostUpdateEvents = getAuthoritativeSnapshotUpdateEvents(hostSocket)
    const guestUpdateEvents = getAuthoritativeSnapshotUpdateEvents(guestSocket)

    assert.equal(subscribeResult.ok, true)
    assert.equal(hostUpdateEvents.length, 2)
    assert.equal(guestUpdateEvents.length, 0)
    assert.deepEqual(
        hostUpdateEvents.map(event => event.payload.playerId).sort(),
        ["authoritative-subscribe-initial-guest", "authoritative-subscribe-initial-host"],
    )
    hostUpdateEvents.forEach((event) => {
        assert.equal(event.payload.ok, true)
        assert.equal(event.payload.roomId, roomId)
        assert.equal(event.payload.source, "server_shadow")
        assert.equal(event.payload.updateReason, "subscribe_initial")
        assert.equal(Number.isInteger(event.payload.updateSequence), true)
        assert.deepEqual(Object.keys(event.payload.snapshot), AUTHORITATIVE_SNAPSHOT_FIELDS)
    })
    assert.equal(hostUpdateEvents[0].payload.updateSequence, hostUpdateEvents[1].payload.updateSequence)
})

test("room:start는 shadow loop tick 후 authoritative snapshot update를 구독 socket에만 보낸다", () => {
    const socketServer = new FakeSocketServer()
    const hostSocket = new FakeClientSocket("authoritative-update-host-socket")
    const guestSocket = new FakeClientSocket("authoritative-update-guest-socket")
    let onShadowAdvance = null

    registerSocketHandlers(socketServer, {
        startShadowMatchLoop(roomId, intervalMs, callback) {
            onShadowAdvance = callback
            return getMatchState(roomId)
        },
    })
    socketServer.connect(hostSocket)
    socketServer.connect(guestSocket)

    hostSocket.trigger("room:create", {
        playerId: "authoritative-update-host",
        nickname: "Host",
    })
    const createResult = hostSocket.lastClientEvent("room:result").payload
    const roomId = createResult.room.roomId

    guestSocket.trigger("room:join", {
        roomId,
        player: {
            playerId: "authoritative-update-guest",
            nickname: "Guest",
        },
    })
    hostSocket.trigger("room:start", {
        roomId,
        playerId: "authoritative-update-host",
    })
    hostSocket.trigger("game:authoritative:snapshot:subscribe", {
        roomId,
        playerId: "authoritative-update-host",
    })

    assert.equal(typeof onShadowAdvance, "function")

    const hostUpdateCountBeforeAdvance = getAuthoritativeSnapshotUpdateEvents(hostSocket).length
    onShadowAdvance(getMatchState(roomId))

    const hostUpdateEvents = getAuthoritativeSnapshotUpdateEvents(hostSocket)
        .slice(hostUpdateCountBeforeAdvance)
    const guestUpdateEvents = getAuthoritativeSnapshotUpdateEvents(guestSocket)

    assert.equal(hostUpdateEvents.length, 2)
    assert.equal(guestUpdateEvents.length, 0)
    assert.deepEqual(
        hostUpdateEvents.map(event => event.payload.playerId).sort(),
        ["authoritative-update-guest", "authoritative-update-host"],
    )
    hostUpdateEvents.forEach((event) => {
        assert.equal(event.payload.ok, true)
        assert.equal(event.payload.roomId, roomId)
        assert.equal(event.payload.source, "server_shadow")
        assert.equal(typeof event.payload.createdAt, "number")
        assert.deepEqual(Object.keys(event.payload.snapshot), AUTHORITATIVE_SNAPSHOT_FIELDS)
    })
})

test("game:input은 shadow 적용 후 authoritative snapshot update를 구독 socket에만 보낸다", () => {
    const socketServer = new FakeSocketServer()
    const hostSocket = new FakeClientSocket("authoritative-input-host-socket")
    const guestSocket = new FakeClientSocket("authoritative-input-guest-socket")

    registerSocketHandlers(socketServer)
    socketServer.connect(hostSocket)
    socketServer.connect(guestSocket)

    hostSocket.trigger("room:create", {
        playerId: "authoritative-input-host",
        nickname: "Host",
    })
    const createResult = hostSocket.lastClientEvent("room:result").payload
    const roomId = createResult.room.roomId

    guestSocket.trigger("room:join", {
        roomId,
        player: {
            playerId: "authoritative-input-guest",
            nickname: "Guest",
        },
    })
    hostSocket.trigger("room:start", {
        roomId,
        playerId: "authoritative-input-host",
    })
    hostSocket.trigger("game:join", {
        roomId,
        playerId: "authoritative-input-host",
    })
    guestSocket.trigger("game:join", {
        roomId,
        playerId: "authoritative-input-guest",
    })
    hostSocket.trigger("game:authoritative:snapshot:subscribe", {
        roomId,
        playerId: "authoritative-input-host",
    })

    const hostUpdateCountBeforeInput = getAuthoritativeSnapshotUpdateEvents(hostSocket).length
    const initialUpdateEvents = getAuthoritativeSnapshotUpdateEvents(hostSocket)
    const initialUpdateSequence = initialUpdateEvents.at(-1).payload.updateSequence
    hostSocket.trigger("game:input", {
        roomId,
        playerId: "authoritative-input-host",
        action: "move_left",
        tick: 12,
        pieceIndex: 1,
    })

    const hostUpdateEvents = getAuthoritativeSnapshotUpdateEvents(hostSocket)
        .slice(hostUpdateCountBeforeInput)
    const guestUpdateEvents = getAuthoritativeSnapshotUpdateEvents(guestSocket)
    const guestInputEvent = guestSocket.lastClientEvent("game:input")

    assert.equal(guestInputEvent.payload.action, "move_left")
    assert.equal(hostUpdateEvents.length, 2)
    assert.equal(guestUpdateEvents.length, 0)
    assert.deepEqual(
        hostUpdateEvents.map(event => event.payload.playerId).sort(),
        ["authoritative-input-guest", "authoritative-input-host"],
    )
    hostUpdateEvents.forEach((event) => {
        assert.equal(event.payload.ok, true)
        assert.equal(event.payload.roomId, roomId)
        assert.equal(event.payload.source, "server_shadow")
        assert.equal(event.payload.updateReason, "input")
        assert.equal(Number.isInteger(event.payload.updateSequence), true)
        assert.equal(event.payload.updateSequence > initialUpdateSequence, true)
        assert.deepEqual(Object.keys(event.payload.snapshot), AUTHORITATIVE_SNAPSHOT_FIELDS)
    })
    assert.equal(hostUpdateEvents[0].payload.updateSequence, hostUpdateEvents[1].payload.updateSequence)
})

test("game:authoritative:snapshot:unsubscribe 이후에는 authoritative snapshot update를 받지 않는다", () => {
    const socketServer = new FakeSocketServer()
    const hostSocket = new FakeClientSocket("authoritative-unsubscribe-host-socket")
    const guestSocket = new FakeClientSocket("authoritative-unsubscribe-guest-socket")
    let onShadowAdvance = null

    registerSocketHandlers(socketServer, {
        startShadowMatchLoop(roomId, intervalMs, callback) {
            onShadowAdvance = callback
            return getMatchState(roomId)
        },
    })
    socketServer.connect(hostSocket)
    socketServer.connect(guestSocket)

    hostSocket.trigger("room:create", {
        playerId: "authoritative-unsubscribe-host",
        nickname: "Host",
    })
    const createResult = hostSocket.lastClientEvent("room:result").payload
    const roomId = createResult.room.roomId

    guestSocket.trigger("room:join", {
        roomId,
        player: {
            playerId: "authoritative-unsubscribe-guest",
            nickname: "Guest",
        },
    })
    hostSocket.trigger("room:start", {
        roomId,
        playerId: "authoritative-unsubscribe-host",
    })
    hostSocket.trigger("game:authoritative:snapshot:subscribe", {
        roomId,
        playerId: "authoritative-unsubscribe-host",
    })
    const hostUpdateCountAfterSubscribe = getAuthoritativeSnapshotUpdateEvents(hostSocket).length
    hostSocket.trigger("game:authoritative:snapshot:unsubscribe", {
        roomId,
        playerId: "authoritative-unsubscribe-host",
    })

    onShadowAdvance(getMatchState(roomId))

    const updateEvents = getAuthoritativeSnapshotUpdateEvents(hostSocket)
    const unsubscribeResult = hostSocket.lastClientEvent("game:authoritative:snapshot:unsubscribe:result").payload

    assert.equal(unsubscribeResult.ok, true)
    assert.equal(updateEvents.length, hostUpdateCountAfterSubscribe)
})

test("game:leave는 authoritative snapshot debug 구독을 정리한다", () => {
    const socketServer = new FakeSocketServer()
    const hostSocket = new FakeClientSocket("authoritative-leave-host-socket")
    const guestSocket = new FakeClientSocket("authoritative-leave-guest-socket")
    let onShadowAdvance = null

    registerSocketHandlers(socketServer, {
        startShadowMatchLoop(roomId, intervalMs, callback) {
            onShadowAdvance = callback
            return getMatchState(roomId)
        },
    })
    socketServer.connect(hostSocket)
    socketServer.connect(guestSocket)

    hostSocket.trigger("room:create", {
        playerId: "authoritative-leave-host",
        nickname: "Host",
    })
    const createResult = hostSocket.lastClientEvent("room:result").payload
    const roomId = createResult.room.roomId

    guestSocket.trigger("room:join", {
        roomId,
        player: {
            playerId: "authoritative-leave-guest",
            nickname: "Guest",
        },
    })
    hostSocket.trigger("room:start", {
        roomId,
        playerId: "authoritative-leave-host",
    })
    hostSocket.trigger("game:authoritative:snapshot:subscribe", {
        roomId,
        playerId: "authoritative-leave-host",
    })
    const hostUpdateCountAfterSubscribe = getAuthoritativeSnapshotUpdateEvents(hostSocket).length
    hostSocket.trigger("game:leave", {
        roomId,
        playerId: "authoritative-leave-host",
    })

    onShadowAdvance(getMatchState(roomId))

    const updateEvents = getAuthoritativeSnapshotUpdateEvents(hostSocket)
    const leaveResult = hostSocket.lastClientEvent("game:leave:result").payload
    const matchResult = getMatchState(roomId)

    assert.equal(leaveResult.ok, true)
    assert.equal(updateEvents.length, hostUpdateCountAfterSubscribe)
    assert.equal(matchResult.ok, false)
    assert.equal(matchResult.reason, "MATCH_NOT_FOUND")
})

test("game:over는 authoritative snapshot debug 구독을 정리한다", async () => {
    const socketServer = new FakeSocketServer()
    const hostSocket = new FakeClientSocket("authoritative-over-host-socket")
    const guestSocket = new FakeClientSocket("authoritative-over-guest-socket")
    let onShadowAdvance = null

    registerSocketHandlers(socketServer, {
        startShadowMatchLoop(roomId, intervalMs, callback) {
            onShadowAdvance = callback
            return getMatchState(roomId)
        },
    })
    socketServer.connect(hostSocket)
    socketServer.connect(guestSocket)

    hostSocket.trigger("room:create", {
        playerId: "authoritative-over-host",
        nickname: "Host",
    })
    const createResult = hostSocket.lastClientEvent("room:result").payload
    const roomId = createResult.room.roomId

    guestSocket.trigger("room:join", {
        roomId,
        player: {
            playerId: "authoritative-over-guest",
            nickname: "Guest",
        },
    })
    hostSocket.trigger("room:start", {
        roomId,
        playerId: "authoritative-over-host",
    })
    hostSocket.trigger("game:authoritative:snapshot:subscribe", {
        roomId,
        playerId: "authoritative-over-host",
    })
    const hostUpdateCountAfterSubscribe = getAuthoritativeSnapshotUpdateEvents(hostSocket).length
    await guestSocket.triggerAsync("game:over", {
        roomId,
        playerId: "authoritative-over-guest",
        reason: "top_out",
    })

    onShadowAdvance(getMatchState(roomId))

    const updateEvents = getAuthoritativeSnapshotUpdateEvents(hostSocket)
    const finishEvent = socketServer.roomEvents.findLast(event => event.eventName === "match:finish")
    const matchResult = getMatchState(roomId)

    assert.equal(finishEvent.payload.room.status, "finished")
    assert.equal(updateEvents.length, hostUpdateCountAfterSubscribe)
    assert.equal(matchResult.ok, false)
    assert.equal(matchResult.reason, "MATCH_NOT_FOUND")
})

test("game:authoritative:snapshot:subscribe는 room 참가자가 아닌 playerId면 NOT_AUTHORIZED를 반환한다", () => {
    const socketServer = new FakeSocketServer()
    const hostSocket = new FakeClientSocket("authoritative-subscribe-auth-host-socket")
    const intruderSocket = new FakeClientSocket("authoritative-subscribe-auth-intruder-socket")

    registerSocketHandlers(socketServer)
    socketServer.connect(hostSocket)
    socketServer.connect(intruderSocket)

    hostSocket.trigger("room:create", {
        playerId: "authoritative-subscribe-auth-host",
        nickname: "Host",
    })
    const createResult = hostSocket.lastClientEvent("room:result").payload

    intruderSocket.trigger("game:authoritative:snapshot:subscribe", {
        roomId: createResult.room.roomId,
        playerId: "authoritative-subscribe-auth-intruder",
    })

    const result = intruderSocket.lastClientEvent("game:authoritative:snapshot:subscribe:result").payload

    assert.equal(result.ok, false)
    assert.equal(result.reason, "NOT_AUTHORIZED")
})

test("game:authoritative:snapshot:subscribe는 활성 match가 없으면 MATCH_NOT_FOUND를 반환한다", () => {
    const socketServer = new FakeSocketServer()
    const hostSocket = new FakeClientSocket("authoritative-subscribe-missing-match-host-socket")

    registerSocketHandlers(socketServer)
    socketServer.connect(hostSocket)

    hostSocket.trigger("room:create", {
        playerId: "authoritative-subscribe-missing-match-host",
        nickname: "Host",
    })
    const createResult = hostSocket.lastClientEvent("room:result").payload

    hostSocket.trigger("game:authoritative:snapshot:subscribe", {
        roomId: createResult.room.roomId,
        playerId: "authoritative-subscribe-missing-match-host",
    })

    const result = hostSocket.lastClientEvent("game:authoritative:snapshot:subscribe:result").payload

    assert.equal(result.ok, false)
    assert.equal(result.reason, "MATCH_NOT_FOUND")
})

test("game:log:placement_decision은 유효한 로그를 저장하고 결과를 반환한다", async () => {
    const socketServer = new FakeSocketServer()
    const hostSocket = new FakeClientSocket("log-host-socket")
    const guestSocket = new FakeClientSocket("log-guest-socket")

    registerSocketHandlers(socketServer, {
        savePlacementDecisionLog(log) {
            savedLogs.push(log)
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

    await hostSocket.triggerAsync("game:log:placement_decision", {
        roomId,
        playerId: "log-host-player",
        log: {
            eventType: "placement_decision",
            schemaVersion: 1,
            playerId: "log-host-player",
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

    const logResult = hostSocket.lastClientEvent("game:log:result")?.payload

    assert.equal(savedLogs.length, 1)
    assert.equal(savedLogs[0].eventType, "placement_decision")
    assert.equal(logResult.ok, true)
    assert.equal(logResult.reason, null)
})

test("game:log:placement_decision은 placementResult를 shadow placement 결과와 비교해 기록한다", async () => {
    const socketServer = new FakeSocketServer()
    const hostSocket = new FakeClientSocket("log-placement-compare-host-socket")
    const guestSocket = new FakeClientSocket("log-placement-compare-guest-socket")
    const savedLogs = []

    registerSocketHandlers(socketServer, {
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
        playerId: "log-placement-compare-host",
        nickname: "Host",
    })
    const createResult = hostSocket.lastClientEvent("room:result").payload
    const roomId = createResult.room.roomId

    guestSocket.trigger("room:join", {
        roomId,
        player: {
            playerId: "log-placement-compare-guest",
            nickname: "Guest",
        },
    })

    await hostSocket.triggerAsync("room:start", {
        roomId,
        playerId: "log-placement-compare-host",
    })
    recordShadowSnapshot(roomId, "log-placement-compare-host", {
        board: [["tree"]],
        activePiece: { pieceType: "tree", rotation: 0, row: 1, col: 4 },
        score: 100,
        linesClearedTotal: 2,
        phase: "playing",
        pendingGarbageQueue: [],
        tick: 30,
        pieceIndex: 8,
        lastPlacementResult: {
            linesCleared: 4,
            rawAttackLines: 4,
            attackLines: 2,
            canceledGarbageLines: 2,
            incomingGarbageLines: 2,
            appliedGarbageLines: 0,
            gameOver: false,
        },
    })

    await hostSocket.triggerAsync("game:log:placement_decision", {
        roomId,
        playerId: "log-placement-compare-host",
        log: {
            eventType: "placement_decision",
            schemaVersion: 1,
            playerId: "log-placement-compare-host",
            gameId: `${roomId}-game`,
            pieceIndex: 8,
            boardBefore: [[null]],
            boardAfter: [["tree"]],
            selectedPlacement: {
                pieceType: "tree",
                rotation: 0,
                row: 18,
                col: 4,
            },
            placementResult: {
                linesCleared: 4,
                rawAttackLines: 4,
                attackLines: 4,
                canceledGarbageLines: 0,
                incomingGarbageLines: 2,
                appliedGarbageLines: 0,
                gameOver: false,
            },
        },
    })

    const logResult = hostSocket.lastClientEvent("game:log:result")?.payload
    const shadowResult = getPlayerShadowState(roomId, "log-placement-compare-host")

    assert.equal(savedLogs.length, 1)
    assert.equal(logResult.ok, true)
    assert.equal(shadowResult.shadow.summary.lastPlacementResultMismatch, true)
    assert.deepEqual(shadowResult.shadow.summary.lastPlacementResultMismatchFields, [
        "attackLines",
        "canceledGarbageLines",
    ])
    assert.equal(shadowResult.shadow.summary.lastClientPlacementAttackLines, 4)
    assert.equal(shadowResult.shadow.summary.lastShadowPlacementAttackLines, 2)
    assert.equal(shadowResult.shadow.summary.lastPlacementAttackLinesDelta, 2)
})

test("game:log:placement_decision은 shadow placement 비교 후 authoritative snapshot update를 구독 socket에만 보낸다", async () => {
    const socketServer = new FakeSocketServer()
    const hostSocket = new FakeClientSocket("authoritative-placement-log-host-socket")
    const guestSocket = new FakeClientSocket("authoritative-placement-log-guest-socket")
    const savedLogs = []

    registerSocketHandlers(socketServer, {
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
        playerId: "authoritative-placement-log-host",
        nickname: "Host",
    })
    const createResult = hostSocket.lastClientEvent("room:result").payload
    const roomId = createResult.room.roomId

    guestSocket.trigger("room:join", {
        roomId,
        player: {
            playerId: "authoritative-placement-log-guest",
            nickname: "Guest",
        },
    })
    await hostSocket.triggerAsync("room:start", {
        roomId,
        playerId: "authoritative-placement-log-host",
    })
    hostSocket.trigger("game:authoritative:snapshot:subscribe", {
        roomId,
        playerId: "authoritative-placement-log-host",
    })
    const hostUpdateCountBeforePlacementLog = getAuthoritativeSnapshotUpdateEvents(hostSocket).length
    recordShadowSnapshot(roomId, "authoritative-placement-log-host", {
        board: [["tree"]],
        activePiece: { pieceType: "tree", rotation: 0, row: 1, col: 4 },
        score: 100,
        linesClearedTotal: 2,
        phase: "playing",
        pendingGarbageQueue: [],
        tick: 30,
        pieceIndex: 8,
        lastPlacementResult: {
            linesCleared: 4,
            rawAttackLines: 4,
            attackLines: 2,
            canceledGarbageLines: 2,
            incomingGarbageLines: 2,
            appliedGarbageLines: 0,
            gameOver: false,
        },
    })

    await hostSocket.triggerAsync("game:log:placement_decision", {
        roomId,
        playerId: "authoritative-placement-log-host",
        log: {
            eventType: "placement_decision",
            schemaVersion: 1,
            playerId: "authoritative-placement-log-host",
            gameId: `${roomId}-game`,
            pieceIndex: 8,
            boardBefore: [[null]],
            boardAfter: [["tree"]],
            selectedPlacement: {
                pieceType: "tree",
                rotation: 0,
                row: 18,
                col: 4,
            },
            placementResult: {
                linesCleared: 4,
                rawAttackLines: 4,
                attackLines: 4,
                canceledGarbageLines: 0,
                incomingGarbageLines: 2,
                appliedGarbageLines: 0,
                gameOver: false,
            },
        },
    })

    const hostUpdateEvents = getAuthoritativeSnapshotUpdateEvents(hostSocket)
        .slice(hostUpdateCountBeforePlacementLog)
    const guestUpdateEvents = getAuthoritativeSnapshotUpdateEvents(guestSocket)

    assert.equal(savedLogs.length, 1)
    assert.equal(hostUpdateEvents.length, 2)
    assert.equal(guestUpdateEvents.length, 0)
    assert.deepEqual(
        hostUpdateEvents.map(event => event.payload.playerId).sort(),
        ["authoritative-placement-log-guest", "authoritative-placement-log-host"],
    )
    hostUpdateEvents.forEach((event) => {
        assert.equal(event.payload.ok, true)
        assert.equal(event.payload.roomId, roomId)
        assert.equal(event.payload.source, "server_shadow")
        assert.deepEqual(Object.keys(event.payload.snapshot), AUTHORITATIVE_SNAPSHOT_FIELDS)
    })
})

test("game:log:placement_decision은 room 참가자가 아닌 playerId면 저장하지 않는다", async () => {
    const socketServer = new FakeSocketServer()
    const hostSocket = new FakeClientSocket("log-auth-host-socket")
    const intruderSocket = new FakeClientSocket("log-auth-intruder-socket")
    const savedLogs = []

    registerSocketHandlers(socketServer, {
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

    registerSocketHandlers(socketServer, {
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

test("game:over는 game_over 로그를 저장한다", async () => {
    const socketServer = new FakeSocketServer()
    const hostSocket = new FakeClientSocket("over-log-host-socket")
    const guestSocket = new FakeClientSocket("over-log-guest-socket")
    const savedLogs = []

    registerSocketHandlers(socketServer, {
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
    await guestSocket.triggerAsync("game:over", {
        roomId,
        playerId: "over-log-guest",
        reason: "top_out",
    })

    const overLog = savedLogs.find(log => log.eventType === "game_over")

    assert.equal(overLog.roomId, roomId)
    assert.equal(overLog.mode, "multi")
    assert.equal(overLog.winnerPlayerId, "over-log-host")
    assert.equal(overLog.loserPlayerId, "over-log-guest")
    assert.equal(overLog.reason, "top_out")
    assert.equal(overLog.finishType, "normal")
    assert.equal(typeof overLog.endedAt, "number")
})

test("game:garbage:attack은 상대 player를 target으로 garbage append를 broadcast하고 shadow pending queue를 갱신한다", async () => {
    const socketServer = new FakeSocketServer()
    const hostSocket = new FakeClientSocket("garbage-host-socket")
    const guestSocket = new FakeClientSocket("garbage-guest-socket")

    registerSocketHandlers(socketServer, {
        createGarbageHoleCol() {
            return 4
        },
    })
    socketServer.connect(hostSocket)
    socketServer.connect(guestSocket)

    hostSocket.trigger("room:create", {
        playerId: "garbage-host",
        nickname: "Host",
    })
    const createResult = hostSocket.lastClientEvent("room:result").payload
    const roomId = createResult.room.roomId

    guestSocket.trigger("room:join", {
        roomId,
        player: {
            playerId: "garbage-guest",
            nickname: "Guest",
        },
    })

    await hostSocket.triggerAsync("room:start", {
        roomId,
        playerId: "garbage-host",
    })

    hostSocket.trigger("game:garbage:attack", {
        roomId,
        playerId: "garbage-host",
        lines: 2,
    })

    const hostGarbageEvent = hostSocket.lastClientEvent("game:garbage:append")
    const guestGarbageEvent = guestSocket.lastClientEvent("game:garbage:append")

    assert.equal(hostGarbageEvent.payload.fromPlayerId, "garbage-host")
    assert.equal(hostGarbageEvent.payload.targetPlayerId, "garbage-guest")
    assert.equal(hostGarbageEvent.payload.lines, 2)
    assert.equal(hostGarbageEvent.payload.holeCol, 4)
    assert.deepEqual(guestGarbageEvent.payload, hostGarbageEvent.payload)

    const hostShadow = getPlayerShadowState(roomId, "garbage-host").shadow
    const guestShadow = getPlayerShadowState(roomId, "garbage-guest").shadow

    assert.deepEqual(hostShadow.shadowState.pendingGarbageQueue, [])
    assert.deepEqual(guestShadow.shadowState.pendingGarbageQueue, [
        { lines: 2, holeCol: 4 },
    ])
})

test("game:garbage:attack은 shadow garbage 적용 후 authoritative snapshot update를 구독 socket에만 보낸다", async () => {
    const socketServer = new FakeSocketServer()
    const hostSocket = new FakeClientSocket("authoritative-garbage-host-socket")
    const guestSocket = new FakeClientSocket("authoritative-garbage-guest-socket")

    registerSocketHandlers(socketServer, {
        createGarbageHoleCol() {
            return 3
        },
    })
    socketServer.connect(hostSocket)
    socketServer.connect(guestSocket)

    hostSocket.trigger("room:create", {
        playerId: "authoritative-garbage-host",
        nickname: "Host",
    })
    const createResult = hostSocket.lastClientEvent("room:result").payload
    const roomId = createResult.room.roomId

    guestSocket.trigger("room:join", {
        roomId,
        player: {
            playerId: "authoritative-garbage-guest",
            nickname: "Guest",
        },
    })
    await hostSocket.triggerAsync("room:start", {
        roomId,
        playerId: "authoritative-garbage-host",
    })
    hostSocket.trigger("game:join", {
        roomId,
        playerId: "authoritative-garbage-host",
    })
    guestSocket.trigger("game:join", {
        roomId,
        playerId: "authoritative-garbage-guest",
    })
    hostSocket.trigger("game:authoritative:snapshot:subscribe", {
        roomId,
        playerId: "authoritative-garbage-host",
    })

    const hostUpdateCountBeforeGarbage = getAuthoritativeSnapshotUpdateEvents(hostSocket).length
    hostSocket.trigger("game:garbage:attack", {
        roomId,
        playerId: "authoritative-garbage-host",
        lines: 3,
    })

    const hostUpdateEvents = getAuthoritativeSnapshotUpdateEvents(hostSocket)
        .slice(hostUpdateCountBeforeGarbage)
    const guestUpdateEvents = getAuthoritativeSnapshotUpdateEvents(guestSocket)
    const guestSnapshotUpdate = hostUpdateEvents.find((event) => {
        return event.payload.playerId === "authoritative-garbage-guest"
    })

    assert.equal(hostUpdateEvents.length, 2)
    assert.equal(guestUpdateEvents.length, 0)
    assert.equal(guestSnapshotUpdate.payload.ok, true)
    assert.equal(guestSnapshotUpdate.payload.roomId, roomId)
    assert.equal(guestSnapshotUpdate.payload.source, "server_shadow")
    assert.deepEqual(Object.keys(guestSnapshotUpdate.payload.snapshot), AUTHORITATIVE_SNAPSHOT_FIELDS)
    assert.deepEqual(guestSnapshotUpdate.payload.snapshot.pendingGarbageQueue, [
        { lines: 3, holeCol: 3 },
    ])
})

test("game:input은 room 참가자가 아닌 playerId면 상대에게 전달하지 않는다", () => {
    const socketServer = new FakeSocketServer()
    const hostSocket = new FakeClientSocket("input-auth-host-socket")
    const guestSocket = new FakeClientSocket("input-auth-guest-socket")
    const intruderSocket = new FakeClientSocket("input-auth-intruder-socket")

    registerSocketHandlers(socketServer)
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
    })

    const inputResult = intruderSocket.lastClientEvent("game:input:result")?.payload
    const guestInputEvent = guestSocket.lastClientEvent("game:input")

    assert.equal(inputResult?.ok, false)
    assert.equal(inputResult?.reason, "NOT_AUTHORIZED")
    assert.equal(guestInputEvent, undefined)
})

test("game:input은 허용되지 않은 action이면 상대에게 전달하지 않는다", () => {
    const socketServer = new FakeSocketServer()
    const hostSocket = new FakeClientSocket("input-invalid-host-socket")
    const guestSocket = new FakeClientSocket("input-invalid-guest-socket")

    registerSocketHandlers(socketServer)
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

    hostSocket.trigger("game:input", {
        roomId,
        playerId: "input-invalid-host",
        action: "delete_board",
        tick: 12,
    })

    const inputResult = hostSocket.lastClientEvent("game:input:result")?.payload
    const guestInputEvent = guestSocket.lastClientEvent("game:input")

    assert.equal(inputResult?.ok, false)
    assert.equal(inputResult?.reason, "INVALID_ACTION")
    assert.equal(guestInputEvent, undefined)
})

test("game:snapshot은 room 참가자가 아닌 playerId면 상대에게 전달하지 않는다", () => {
    const socketServer = new FakeSocketServer()
    const hostSocket = new FakeClientSocket("snapshot-auth-host-socket")
    const guestSocket = new FakeClientSocket("snapshot-auth-guest-socket")
    const intruderSocket = new FakeClientSocket("snapshot-auth-intruder-socket")
    const snapshot = {
        tick: 20,
        board: [["T"]],
        activePiece: {
            pieceType: "T",
            rotation: 0,
            row: 1,
            col: 4,
        },
    }

    registerSocketHandlers(socketServer)
    socketServer.connect(hostSocket)
    socketServer.connect(guestSocket)
    socketServer.connect(intruderSocket)

    hostSocket.trigger("room:create", {
        playerId: "snapshot-auth-host",
        nickname: "Host",
    })
    const createResult = hostSocket.lastClientEvent("room:result").payload
    const roomId = createResult.room.roomId

    guestSocket.trigger("room:join", {
        roomId,
        player: {
            playerId: "snapshot-auth-guest",
            nickname: "Guest",
        },
    })

    hostSocket.trigger("game:join", {
        roomId,
        playerId: "snapshot-auth-host",
    })
    guestSocket.trigger("game:join", {
        roomId,
        playerId: "snapshot-auth-guest",
    })

    intruderSocket.trigger("game:snapshot", {
        roomId,
        playerId: "snapshot-auth-intruder",
        snapshot,
    })

    const intruderResult = intruderSocket.lastClientEvent("game:snapshot:result")?.payload
    const guestSnapshotEvent = guestSocket.lastClientEvent("game:snapshot")

    assert.equal(intruderResult?.ok, false)
    assert.equal(intruderResult?.reason, "NOT_AUTHORIZED")
    assert.equal(guestSnapshotEvent, undefined)
})

test("game:snapshot은 snapshot board가 배열이 아니면 상대에게 전달하지 않는다", () => {
    const socketServer = new FakeSocketServer()
    const hostSocket = new FakeClientSocket("snapshot-payload-host-socket")
    const guestSocket = new FakeClientSocket("snapshot-payload-guest-socket")
    const invalidSnapshot = {
        tick: 30,
        board: null,
        activePiece: {
            pieceType: "L",
            rotation: 0,
            row: 1,
            col: 4,
        },
    }

    registerSocketHandlers(socketServer)
    socketServer.connect(hostSocket)
    socketServer.connect(guestSocket)

    hostSocket.trigger("room:create", {
        playerId: "snapshot-payload-host",
        nickname: "Host",
    })
    const createResult = hostSocket.lastClientEvent("room:result").payload
    const roomId = createResult.room.roomId

    guestSocket.trigger("room:join", {
        roomId,
        player: {
            playerId: "snapshot-payload-guest",
            nickname: "Guest",
        },
    })

    hostSocket.trigger("game:join", {
        roomId,
        playerId: "snapshot-payload-host",
    })
    guestSocket.trigger("game:join", {
        roomId,
        playerId: "snapshot-payload-guest",
    })

    hostSocket.trigger("game:snapshot", {
        roomId,
        playerId: "snapshot-payload-host",
        snapshot: invalidSnapshot,
    })

    const snapshotResult = hostSocket.lastClientEvent("game:snapshot:result")?.payload
    const guestSnapshotEvent = guestSocket.lastClientEvent("game:snapshot")

    assert.equal(snapshotResult?.ok, false)
    assert.equal(snapshotResult?.reason, "INVALID_SNAPSHOT")
    assert.equal(guestSnapshotEvent, undefined)
})

test("game:snapshot은 snapshot field 타입이 잘못되면 상대에게 전달하지 않는다", () => {
    const socketServer = new FakeSocketServer()
    const hostSocket = new FakeClientSocket("snapshot-field-host-socket")
    const guestSocket = new FakeClientSocket("snapshot-field-guest-socket")
    const invalidSnapshot = {
        tick: 30,
        board: [[null]],
        activePiece: "not-a-piece",
        score: "100",
    }

    registerSocketHandlers(socketServer)
    socketServer.connect(hostSocket)
    socketServer.connect(guestSocket)

    hostSocket.trigger("room:create", {
        playerId: "snapshot-field-host",
        nickname: "Host",
    })
    const createResult = hostSocket.lastClientEvent("room:result").payload
    const roomId = createResult.room.roomId

    guestSocket.trigger("room:join", {
        roomId,
        player: {
            playerId: "snapshot-field-guest",
            nickname: "Guest",
        },
    })

    hostSocket.trigger("game:join", {
        roomId,
        playerId: "snapshot-field-host",
    })
    guestSocket.trigger("game:join", {
        roomId,
        playerId: "snapshot-field-guest",
    })

    hostSocket.trigger("game:snapshot", {
        roomId,
        playerId: "snapshot-field-host",
        snapshot: invalidSnapshot,
    })

    const snapshotResult = hostSocket.lastClientEvent("game:snapshot:result")?.payload
    const guestSnapshotEvent = guestSocket.lastClientEvent("game:snapshot")

    assert.equal(snapshotResult?.ok, false)
    assert.equal(snapshotResult?.reason, "INVALID_SNAPSHOT")
    assert.equal(guestSnapshotEvent, undefined)
})

test("game:over는 finishGame 결과를 match:finish로 room에 broadcast한다", () => {
    const socketServer = new FakeSocketServer()
    const hostSocket = new FakeClientSocket("finish-host-socket")
    const guestSocket = new FakeClientSocket("finish-guest-socket")

    registerSocketHandlers(socketServer)
    socketServer.connect(hostSocket)
    socketServer.connect(guestSocket)

    hostSocket.trigger("room:create", {
        playerId: "finish-host-player",
        nickname: "Host",
    })
    const createResult = hostSocket.lastClientEvent("room:result").payload
    const roomId = createResult.room.roomId

    guestSocket.trigger("room:join", {
        roomId,
        player: {
            playerId: "finish-guest-player",
            nickname: "Guest",
        },
    })

    hostSocket.trigger("room:start", {
        roomId,
        playerId: "finish-host-player",
    })

    guestSocket.trigger("game:over", {
        roomId,
        playerId: "finish-guest-player",
        reason: "top_out",
    })

    const finishEvent = socketServer.roomEvents.findLast(event => event.eventName === "match:finish")

    assert.equal(finishEvent.roomId, roomId)
    assert.equal(finishEvent.payload.room.status, "finished")
    assert.equal(finishEvent.payload.winnerPlayerId, "finish-host-player")
    assert.equal(finishEvent.payload.loserPlayerId, "finish-guest-player")
    assert.equal(finishEvent.payload.reason, "top_out")
})

test("game:over 이후 한 명만 로비로 돌아오면 room:start를 허용하지 않는다", () => {
    const socketServer = new FakeSocketServer()
    const hostSocket = new FakeClientSocket("finish-restart-host-socket")
    const guestSocket = new FakeClientSocket("finish-restart-guest-socket")
    const hostLobbySocket = new FakeClientSocket("finish-restart-host-lobby-socket")

    registerSocketHandlers(socketServer)
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

    guestSocket.trigger("game:over", {
        roomId,
        playerId: "finish-restart-guest-player",
        reason: "top_out",
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

test("game:over는 finishGame 실패 시 요청자에게 game:over:result를 반환한다", () => {
    const socketServer = new FakeSocketServer()
    const hostSocket = new FakeClientSocket("finish-fail-host-socket")
    const guestSocket = new FakeClientSocket("finish-fail-guest-socket")

    registerSocketHandlers(socketServer)
    socketServer.connect(hostSocket)
    socketServer.connect(guestSocket)

    hostSocket.trigger("room:create", {
        playerId: "finish-fail-host-player",
        nickname: "Host",
    })
    const createResult = hostSocket.lastClientEvent("room:result").payload
    const roomId = createResult.room.roomId

    guestSocket.trigger("room:join", {
        roomId,
        player: {
            playerId: "finish-fail-guest-player",
            nickname: "Guest",
        },
    })

    guestSocket.trigger("game:over", {
        roomId,
        playerId: "finish-fail-guest-player",
        reason: "top_out",
    })

    const finishResult = guestSocket.lastClientEvent("game:over:result").payload
    const finishEvent = socketServer.roomEvents.findLast(event => event.eventName === "match:finish")

    assert.equal(finishResult.ok, false)
    assert.equal(finishResult.reason, "GAME_NOT_PLAYING")
    assert.equal(finishEvent, undefined)
})

test("game:join은 서버에 없는 room이면 실패 결과를 돌려준다", () => {
    const socketServer = new FakeSocketServer()
    const gameSocket = new FakeClientSocket("missing-game-socket")

    registerSocketHandlers(socketServer)
    socketServer.connect(gameSocket)

    gameSocket.trigger("game:join", {
        roomId: "MISSING1",
        playerId: "missing-player",
    })

    const joinResult = gameSocket.lastClientEvent("game:join:result")

    assert.equal(joinResult.payload.ok, false)
    assert.equal(joinResult.payload.room, null)
    assert.equal(joinResult.payload.reason, "ROOM_NOT_FOUND")
    assert.deepEqual(gameSocket.joinedRooms, [])
})

test("game:join은 roomService DTO 결과를 반환하고 성공 시 socket을 room에 참가시킨다", () => {
    const socketServer = new FakeSocketServer()
    const lobbySocket = new FakeClientSocket("game-join-lobby-socket")
    const gameSocket = new FakeClientSocket("game-join-game-socket")

    registerSocketHandlers(socketServer)
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

    assert.equal(joinResult.ok, true)
    assert.equal(joinResult.reason, null)
    assert.equal(joinResult.room.roomId, roomId)
    assert.deepEqual(gameSocket.joinedRooms, [roomId])
})

test("game:join은 시작된 match의 player별 server bag chunks를 반환한다", () => {
    const socketServer = new FakeSocketServer()
    const hostSocket = new FakeClientSocket("game-join-bag-host-socket")
    const guestSocket = new FakeClientSocket("game-join-bag-guest-socket")
    const gameSocket = new FakeClientSocket("game-join-bag-game-socket")
    const expectedPieces = ["bar", "eleft", "eright", "ess", "square", "tree", "zee"]

    registerSocketHandlers(socketServer)
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
        player.bagChunks.forEach((chunk) => {
            assert.equal(chunk.length, 7)
            assert.deepEqual([...chunk].sort(), expectedPieces)
        })
    })
})

test("game:bag:request는 새 server bag chunk를 room에 broadcast한다", () => {
    const socketServer = new FakeSocketServer()
    const hostSocket = new FakeClientSocket("bag-request-host-socket")
    const guestSocket = new FakeClientSocket("bag-request-guest-socket")
    const expectedPieces = ["bar", "eleft", "eright", "ess", "square", "tree", "zee"]

    registerSocketHandlers(socketServer)
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

    hostSocket.trigger("game:bag:request", {
        roomId,
        playerId: "bag-request-host",
    })

    const bagAppendEvent = socketServer.roomEvents.findLast(event => event.eventName === "game:bag:append")
    const matchResult = getMatchState(roomId)
    const hostMatchPlayer = matchResult.match.players.find(player => player.playerId === "bag-request-host")

    assert.equal(bagAppendEvent.roomId, roomId)
    assert.equal(bagAppendEvent.payload.roomId, roomId)
    assert.equal(bagAppendEvent.payload.playerId, "bag-request-host")
    assert.equal(bagAppendEvent.payload.bagChunk.length, 7)
    assert.deepEqual([...bagAppendEvent.payload.bagChunk].sort(), expectedPieces)
    assert.equal(hostMatchPlayer.bagChunks.length, 4)
    assert.deepEqual(hostMatchPlayer.bagChunks[3], bagAppendEvent.payload.bagChunk)
})

test("game:bag:request는 shadow bag 갱신 후 authoritative snapshot update를 구독 socket에만 보낸다", () => {
    const socketServer = new FakeSocketServer()
    const hostSocket = new FakeClientSocket("authoritative-bag-host-socket")
    const guestSocket = new FakeClientSocket("authoritative-bag-guest-socket")

    registerSocketHandlers(socketServer)
    socketServer.connect(hostSocket)
    socketServer.connect(guestSocket)

    hostSocket.trigger("room:create", {
        playerId: "authoritative-bag-host",
        nickname: "Host",
    })
    const createResult = hostSocket.lastClientEvent("room:result").payload
    const roomId = createResult.room.roomId

    guestSocket.trigger("room:join", {
        roomId,
        player: {
            playerId: "authoritative-bag-guest",
            nickname: "Guest",
        },
    })
    hostSocket.trigger("room:start", {
        roomId,
        playerId: "authoritative-bag-host",
    })
    hostSocket.trigger("game:join", {
        roomId,
        playerId: "authoritative-bag-host",
    })
    guestSocket.trigger("game:join", {
        roomId,
        playerId: "authoritative-bag-guest",
    })
    hostSocket.trigger("game:authoritative:snapshot:subscribe", {
        roomId,
        playerId: "authoritative-bag-host",
    })

    const hostUpdateCountBeforeBagRequest = getAuthoritativeSnapshotUpdateEvents(hostSocket).length
    hostSocket.trigger("game:bag:request", {
        roomId,
        playerId: "authoritative-bag-host",
    })

    const hostUpdateEvents = getAuthoritativeSnapshotUpdateEvents(hostSocket)
        .slice(hostUpdateCountBeforeBagRequest)
    const guestUpdateEvents = getAuthoritativeSnapshotUpdateEvents(guestSocket)
    const bagAppendEvent = socketServer.roomEvents.findLast(event => event.eventName === "game:bag:append")

    assert.equal(bagAppendEvent.payload.playerId, "authoritative-bag-host")
    assert.equal(hostUpdateEvents.length, 2)
    assert.equal(guestUpdateEvents.length, 0)
    assert.deepEqual(
        hostUpdateEvents.map(event => event.payload.playerId).sort(),
        ["authoritative-bag-guest", "authoritative-bag-host"],
    )
    hostUpdateEvents.forEach((event) => {
        assert.equal(event.payload.ok, true)
        assert.equal(event.payload.roomId, roomId)
        assert.equal(event.payload.source, "server_shadow")
        assert.deepEqual(Object.keys(event.payload.snapshot), AUTHORITATIVE_SNAPSHOT_FIELDS)
    })
})

test("room:sync는 roomService DTO 결과를 요청 socket에 반환한다", () => {
    const socketServer = new FakeSocketServer()
    const lobbySocket = new FakeClientSocket("sync-lobby-socket")
    const reconnectSocket = new FakeClientSocket("sync-reconnect-socket")

    registerSocketHandlers(socketServer)
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

    registerSocketHandlers(socketServer)
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

    registerSocketHandlers(socketServer)
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

    registerSocketHandlers(socketServer)
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
