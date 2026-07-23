/**
 * Socket 연결 trust boundary의 origin, 공개 DTO, rate-limit 정책을 검증한다.
 *
 * production 설정과 private field가 섞인 room을 준비해 허용/거부 결과를 실행하고 정확한 whitelist만 통과하는지
 * 확인한다. 보안 경계이므로 origin 설정이 없을 때 fail closed하고, 내부 식별자는 중첩 객체에서도 노출하지 않는다.
 */
const test = require("node:test")
const assert = require("node:assert/strict")

const {
    createSocketServerOptions,
    readAllowedOrigins,
} = require("../dist/server/server/socketSecurity.js")
const {
    createRoomPublicDto,
} = require("../dist/server/server/services/roomPublicDto.js")
const {
    RATE_LIMITS,
    TEST_RATE_LIMITS,
    createSocketRateLimitService,
} = require("../dist/server/server/services/socketRateLimitService.js")

test("production은 exact origin allowlist가 없으면 fail closed한다", () => {
    assert.throws(
        () => readAllowedOrigins({ NODE_ENV: "production" }),
        /SOCKET_ALLOWED_ORIGINS/,
    )
})

test("cors와 allowRequest는 exact origin과 allowlisted same-origin browser만 허용한다", () => {
    const options = createSocketServerOptions({
        NODE_ENV: "production",
        SOCKET_ALLOWED_ORIGINS: "https://game.example.com",
    })

    let corsAllowed = null
    options.cors.origin("https://game.example.com", (error, allowed) => {
        corsAllowed = !error && allowed
    })
    assert.equal(corsAllowed, true)

    options.cors.origin("https://evil.example.com", (error) => {
        corsAllowed = !error
    })
    assert.equal(corsAllowed, false)
    options.cors.origin(undefined, (error, allowed) => {
        corsAllowed = !error && allowed
    })
    assert.equal(corsAllowed, true)

    let requestAllowed = null
    options.allowRequest({ headers: { origin: "https://game.example.com" } }, (_, allowed) => {
        requestAllowed = allowed
    })
    assert.equal(requestAllowed, true)
    options.allowRequest({ headers: {} }, (_, allowed) => {
        requestAllowed = allowed
    })
    assert.equal(requestAllowed, false)
    options.allowRequest({
        headers: {
            host: "game.example.com",
            "sec-fetch-site": "same-origin",
        },
    }, (_, allowed) => {
        requestAllowed = allowed
    })
    assert.equal(requestAllowed, true)
    options.allowRequest({
        headers: {
            host: "evil.example.com",
            "sec-fetch-site": "same-origin",
        },
    }, (_, allowed) => {
        requestAllowed = allowed
    })
    assert.equal(requestAllowed, false)
    options.allowRequest({
        headers: {
            origin: "https://evil.example.com",
            host: "game.example.com",
            "sec-fetch-site": "same-origin",
        },
    }, (_, allowed) => {
        requestAllowed = allowed
    })
    assert.equal(requestAllowed, false)
    assert.equal(options.maxHttpBufferSize, 512 * 1024)
})

test("roomPublicDto는 whitelist 외 private 식별자를 재귀적으로 제외한다", () => {
    const dto = createRoomPublicDto({
        roomId: "ROOM1234",
        mode: "pvp",
        aiDifficulty: null,
        aiPolicy: null,
        hostPlayerId: "player-1",
        status: "waiting",
        createdAt: 1,
        token: "secret",
        generation: 7,
        expiresAt: 999,
        players: [{
            playerId: "player-1",
            nickname: "Player",
            playerType: "human",
            socketId: "socket-1",
            tokenDigest: "digest",
        }],
    })
    const serialized = JSON.stringify(dto)

    assert.deepEqual(Object.keys(dto), [
        "roomId",
        "mode",
        "aiDifficulty",
        "aiPolicy",
        "hostPlayerId",
        "status",
        "createdAt",
        "players",
    ])
    assert.equal(serialized.includes("socket-1"), false)
    assert.equal(serialized.includes("secret"), false)
    assert.equal(serialized.includes("digest"), false)
    assert.deepEqual(Object.keys(dto.players[0]), ["playerId", "nickname", "playerType"])
})

test("독립 rate bucket은 window 종료 후 만료 항목을 재사용한다", () => {
    let currentTime = 0
    const limiter = createSocketRateLimitService({
        now: () => currentTime,
        limits: {
            input: { limit: 2, windowMs: 1_000 },
            chat: { limit: 1, windowMs: 1_000 },
        },
    })

    assert.equal(limiter.consume("input", "player"), true)
    assert.equal(limiter.consume("input", "player"), true)
    assert.equal(limiter.consume("input", "player"), false)
    assert.equal(limiter.consume("chat", "player"), true)
    assert.equal(limiter.consume("chat", "player"), false)

    currentTime = 1_000
    limiter.cleanupExpired()
    assert.equal(limiter.consume("input", "player"), true)
    assert.equal(limiter.consume("chat", "player"), true)
})

test("production rate 기본값과 명시적 E2E profile을 분리한다", () => {
    assert.equal(RATE_LIMITS.newSession.limit, 20)
    assert.equal(RATE_LIMITS.lifecycle.limit, 10)
    assert.equal(RATE_LIMITS.bag.limit, 2)
    assert.equal(TEST_RATE_LIMITS.newSession.limit, 120)
    assert.equal(TEST_RATE_LIMITS.lifecycle.limit, 100)
    assert.equal(TEST_RATE_LIMITS.bag.limit, 20)
    assert.equal(TEST_RATE_LIMITS.invalidResume, RATE_LIMITS.invalidResume)
})
