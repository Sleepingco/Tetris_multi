const test = require("node:test")
const assert = require("node:assert/strict")

const { registerSocketHandlers } = require("../src/server/sockets/index.js")
const { getMatchState } = require("../src/server/services/matchService.js")

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

test("game:garbage:attack은 상대 player를 target으로 garbage append를 broadcast한다", () => {
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
