const test = require("node:test")
const assert = require("node:assert/strict")

const { registerMultiplayerSocket } = require("../src/server/sockets/multiplayerSocket.js")

class FakeSocketServer {
    constructor() {
        this.handlers = new Map()
        this.roomEvents = []
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

    connect(clientSocket) {
        this.handlers.get("connection")(clientSocket)
    }
}

class FakeClientSocket {
    constructor(id) {
        this.id = id
        this.handlers = new Map()
        this.clientEvents = []
        this.joinedRooms = []
        this.leftRooms = []
    }

    on(eventName, handler) {
        this.handlers.set(eventName, handler)
    }

    emit(eventName, payload) {
        this.clientEvents.push({ eventName, payload })
    }

    join(roomId) {
        this.joinedRooms.push(roomId)
    }

    leave(roomId) {
        this.leftRooms.push(roomId)
    }

    trigger(eventName, payload) {
        this.handlers.get(eventName)(payload)
    }

    lastClientEvent(eventName) {
        return this.clientEvents.findLast(event => event.eventName === eventName)
    }
}

test("room:leave는 퇴장한 socket을 room에서 제거하고 남은 room 상태를 broadcast한다", () => {
    const socketServer = new FakeSocketServer()
    const hostSocket = new FakeClientSocket("host-socket")
    const guestSocket = new FakeClientSocket("guest-socket")

    registerMultiplayerSocket(socketServer)
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

    registerMultiplayerSocket(socketServer)
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

    registerMultiplayerSocket(socketServer)
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

    registerMultiplayerSocket(socketServer)
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
