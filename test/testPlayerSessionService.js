const test = require("node:test")
const assert = require("node:assert/strict")

const {
    createPlayerSessionService,
} = require("../src/server/services/playerSessionService.js")

const PLAYER_ID = "00000000-0000-4000-8000-000000000001"

function createFixture() {
    let currentTime = 1_000
    let tokenByte = 1
    const service = createPlayerSessionService({
        now: () => currentTime,
        createPlayerId: () => PLAYER_ID,
        createTokenBytes: () => Buffer.alloc(32, tokenByte++),
    })

    return {
        service,
        advance(milliseconds) {
            currentTime += milliseconds
        },
    }
}

test("session은 256-bit token과 8시간 절대 만료를 발급한다", () => {
    const { service } = createFixture()
    const result = service.authenticate({ nickname: " Player " }, "socket-1")

    assert.equal(result.ok, true)
    assert.equal(result.ready.playerId, PLAYER_ID)
    assert.equal(result.ready.token.length, 43)
    assert.equal(result.ready.nickname, "Player")
    assert.equal(result.ready.expiresAt, 1_000 + 8 * 60 * 60 * 1_000)
    assert.equal(result.context.generation, 1)
    assert.equal(service.isActiveSocket(result.context, "socket-1"), true)
})

test("일부·malformed·invalid credential은 신규 session으로 대체하지 않는다", () => {
    const { service } = createFixture()

    assert.equal(service.authenticate({ nickname: "Player", playerId: PLAYER_ID }, "socket-1").reason, "SESSION_CREDENTIALS_INCOMPLETE")
    assert.equal(service.authenticate({ nickname: "Player", credentialError: "MALFORMED" }, "socket-1").reason, "SESSION_CREDENTIALS_MALFORMED")
    assert.equal(service.authenticate({ nickname: "Player", playerId: "bad", token: "bad" }, "socket-1").reason, "SESSION_CREDENTIALS_MALFORMED")
    assert.equal(service.authenticate({
        nickname: "Player",
        playerId: PLAYER_ID,
        token: "a".repeat(43),
    }, "socket-1").reason, "SESSION_INVALID")
})

test("reconnect는 token을 회전하고 newest socket만 active로 만든다", () => {
    const { service } = createFixture()
    const issued = service.authenticate({ nickname: "Player" }, "socket-1")
    const resumed = service.authenticate({
        nickname: "Player",
        playerId: issued.ready.playerId,
        token: issued.ready.token,
    }, "socket-2")

    assert.equal(resumed.ok, true)
    assert.notEqual(resumed.ready.token, issued.ready.token)
    assert.equal(resumed.ready.expiresAt, issued.ready.expiresAt)
    assert.equal(resumed.context.generation, 2)
    assert.equal(resumed.replacedSocketId, "socket-1")
    assert.equal(service.isActiveSocket(issued.context, "socket-1"), false)
    assert.equal(service.isActiveSocket(resumed.context, "socket-2"), true)

    const replay = service.authenticate({
        nickname: "Player",
        playerId: issued.ready.playerId,
        token: issued.ready.token,
    }, "socket-3")
    assert.equal(replay.ok, false)
    assert.equal(replay.reason, "SESSION_REPLAYED")
})

test("previous token은 active socket이 없을 때 60초 안에 한 번만 recovery된다", () => {
    const { service, advance } = createFixture()
    const issued = service.authenticate({ nickname: "Player" }, "socket-1")
    const resumed = service.authenticate({
        nickname: "Player",
        playerId: issued.ready.playerId,
        token: issued.ready.token,
    }, "socket-2")

    assert.equal(service.markDisconnected(resumed.context, "socket-2"), true)
    advance(59_999)
    const recovered = service.authenticate({
        nickname: "Player",
        playerId: issued.ready.playerId,
        token: issued.ready.token,
    }, "socket-3")
    assert.equal(recovered.ok, true)
    assert.equal(recovered.context.generation, 3)

    assert.equal(service.markDisconnected(recovered.context, "socket-3"), true)
    const replay = service.authenticate({
        nickname: "Player",
        playerId: issued.ready.playerId,
        token: issued.ready.token,
    }, "socket-4")
    assert.equal(replay.ok, false)
    assert.equal(replay.reason, "SESSION_INVALID")
})

test("expired session과 stale disconnect는 권한을 유지하지 못한다", () => {
    const { service, advance } = createFixture()
    const issued = service.authenticate({ nickname: "Player" }, "socket-1")
    const resumed = service.authenticate({
        nickname: "Player",
        playerId: issued.ready.playerId,
        token: issued.ready.token,
    }, "socket-2")

    assert.equal(service.markDisconnected(issued.context, "socket-1"), false)
    assert.equal(service.isActiveSocket(resumed.context, "socket-2"), true)

    advance(8 * 60 * 60 * 1_000)
    assert.equal(service.isActiveSocket(resumed.context, "socket-2"), false)
    const expired = service.authenticate({
        nickname: "Player",
        playerId: resumed.ready.playerId,
        token: resumed.ready.token,
    }, "socket-3")
    assert.equal(expired.ok, false)
    assert.equal(expired.reason, "SESSION_EXPIRED")
})

test("cleanup은 만료된 active session의 socket 문맥을 반환한다", () => {
    const { service, advance } = createFixture()
    const issued = service.authenticate({ nickname: "Player" }, "socket-1")

    advance(8 * 60 * 60 * 1_000)

    assert.deepEqual(service.cleanupExpired(), [{
        playerId: issued.ready.playerId,
        generation: 1,
        activeSocketId: "socket-1",
    }])
    assert.deepEqual(service.cleanupExpired(), [])
})
