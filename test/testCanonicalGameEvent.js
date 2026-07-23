/**
 * CanonicalGameEvent의 identity, serialization, size와 event별 shape 계약을 검증한다.
 *
 * 실행: `npm run build:server && node --test test/testCanonicalGameEvent.js`
 * 기대: exact digest가 고정되고 JSON이 아닌 값과 잘못된 trust/time 조합이 거부된다.
 */
const test = require("node:test");
const assert = require("node:assert/strict");

const {
    MAX_CANONICAL_EVENT_BYTES,
    MAX_GAME_ID_BYTES,
    MAX_PLAYER_ID_BYTES,
    canonicalJson,
    createCanonicalGameEvent,
    prepareCanonicalGameEvent,
} = require("../dist/server/server/db/canonicalGameEvent.js");

function createPlacementEvent(overrides = {}) {
    return {
        identityVersion: "identity-v1",
        eventType: "placement_decision",
        schemaVersion: 2,
        gameId: "game-fixture-001",
        playerId: "player-fixture-001",
        pieceIndex: 7,
        trustLevel: "client_reported",
        occurredAt: "2026-07-23T07:08:09Z",
        payload: {
            placement: {
                rotation: 1,
                col: 4,
                row: 17,
                pieceType: "tree",
            },
            metrics: {
                holes: 0,
                aggregateHeight: 12,
            },
            nextQueue: ["square", "line"],
        },
        ...overrides,
    };
}

function createLifecycleEvent(eventType, overrides = {}) {
    return {
        identityVersion: "identity-v1",
        eventType,
        schemaVersion: 1,
        gameId: `game-${eventType}`,
        playerId: null,
        pieceIndex: null,
        trustLevel: "server_authoritative",
        occurredAt: "2026-07-23T07:08:09.123Z",
        payload: { mode: "pvp" },
        ...overrides,
    };
}

test("canonical fixture는 exact event_id와 event_sha256을 재현한다", () => {
    const prepared = prepareCanonicalGameEvent(createPlacementEvent());

    assert.equal(
        canonicalJson(prepared.identityTuple),
        '["identity-v1","placement_decision","game-fixture-001","player-fixture-001",7]',
    );
    assert.equal(
        prepared.eventId,
        "bb8998c4e521febabe3a70e49719b064198c92c20e804fdc78987bc2bb20ab0e",
    );
    assert.equal(
        prepared.eventSha256,
        "097f1d07881be55143bec234992f6d78821f4b972d64d4ca32faaa3649c34c78",
    );
    assert.equal(prepared.snapshot.occurredAt, "2026-07-23T07:08:09.000Z");
    assert.equal(Object.isFrozen(prepared.snapshot), true);
    assert.equal(Object.isFrozen(prepared.snapshot.payload), true);
    assert.equal(Object.isFrozen(prepared.snapshot.payload.placement), true);
});

test("중첩 object key 순서가 달라도 canonical hash는 같다", () => {
    const left = prepareCanonicalGameEvent(createPlacementEvent());
    const right = prepareCanonicalGameEvent(createPlacementEvent({
        payload: {
            nextQueue: ["square", "line"],
            metrics: {
                aggregateHeight: 12,
                holes: 0,
            },
            placement: {
                pieceType: "tree",
                row: 17,
                col: 4,
                rotation: 1,
            },
        },
    }));

    assert.equal(left.eventId, right.eventId);
    assert.equal(left.eventSha256, right.eventSha256);
    assert.equal(left.canonicalEnvelope, right.canonicalEnvelope);
});

test("같은 identity의 payload 변경은 event_id만 보존한다", () => {
    const original = prepareCanonicalGameEvent(createPlacementEvent());
    const changed = prepareCanonicalGameEvent(createPlacementEvent({
        payload: {
            ...createPlacementEvent().payload,
            metrics: { aggregateHeight: 13, holes: 0 },
        },
    }));

    assert.equal(original.eventId, changed.eventId);
    assert.notEqual(original.eventSha256, changed.eventSha256);
});

test("identity tuple은 event type별 원래 semantic field만 포함한다", () => {
    const cases = [
        [
            createLifecycleEvent("game_start"),
            ["identity-v1", "game_start", "game-game_start"],
        ],
        [
            createPlacementEvent(),
            ["identity-v1", "placement_decision", "game-fixture-001", "player-fixture-001", 7],
        ],
        [
            createLifecycleEvent("game_over"),
            ["identity-v1", "game_over", "game-game_over"],
        ],
    ];

    for (const [event, expectedTuple] of cases) {
        assert.deepEqual(prepareCanonicalGameEvent(event).identityTuple, expectedTuple);
    }
});

test("array 순서는 보존하고 Unicode normalization은 적용하지 않는다", () => {
    assert.notEqual(canonicalJson(["line", "square"]), canonicalJson(["square", "line"]));
    assert.notEqual(canonicalJson({ value: "\u00e9" }), canonicalJson({ value: "e\u0301" }));
    assert.equal(canonicalJson({ z: 1, a: 2 }), '{"a":2,"z":1}');
});

test("canonical JSON은 own __proto__와 code-unit key 순서를 손실 없이 직렬화한다", () => {
    const nested = {};
    Object.defineProperty(nested, "__proto__", {
        configurable: true,
        enumerable: true,
        value: { safe: true },
        writable: true,
    });
    const value = {
        nested,
        2: "two",
        10: "ten",
    };

    assert.equal(canonicalJson(null), "null");
    assert.equal(canonicalJson(false), "false");
    assert.equal(canonicalJson(7), "7");
    assert.equal(canonicalJson("seven"), '"seven"');
    assert.equal(
        canonicalJson(value),
        '{"10":"ten","2":"two","nested":{"__proto__":{"safe":true}}}',
    );
    assert.notEqual(canonicalJson(nested), canonicalJson({}));
});

test("array의 length와 실제 index 밖 own key는 canonical 값으로 허용하지 않는다", () => {
    const maximumProperty = ["line"];
    Object.defineProperty(maximumProperty, "4294967295", {
        configurable: true,
        enumerable: true,
        value: "outside",
        writable: true,
    });
    const nonIndexProperty = ["line"];
    Object.defineProperty(nonIndexProperty, "01", {
        configurable: true,
        enumerable: true,
        value: "outside",
        writable: true,
    });

    for (const value of [maximumProperty, nonIndexProperty]) {
        assert.throws(
            () => canonicalJson(value),
            { message: "CANONICAL_JSON_INVALID" },
        );
    }
});

test("JSON primitive, array와 plain object 밖의 값은 table-driven으로 거부한다", () => {
    const circular = {};
    circular.self = circular;
    const sparse = [];
    sparse.length = 1;
    const getterPayload = {};
    let getterCalled = false;
    Object.defineProperty(getterPayload, "secret", {
        enumerable: true,
        get() {
            getterCalled = true;
            return "must-not-run";
        },
    });
    const customPrototype = Object.create({ inherited: true });
    customPrototype.value = 1;

    const invalidPayloads = [
        { value: BigInt(1) },
        { value: undefined },
        { value: Symbol("invalid") },
        { value: Number.POSITIVE_INFINITY },
        { value: () => true },
        { value: sparse },
        { value: circular },
        { value: customPrototype },
        { value: { toJSON() { return {}; } } },
        { value: -0 },
        getterPayload,
    ];

    for (const payload of invalidPayloads) {
        assert.throws(
            () => prepareCanonicalGameEvent(createPlacementEvent({ payload })),
            { message: "CANONICAL_EVENT_INVALID" },
        );
    }
    assert.equal(getterCalled, false);
});

test("PostgreSQL text에 저장할 수 없는 문자열과 identity byte 초과를 거부한다", () => {
    const invalidPayloads = [
        { value: "\u0000" },
        { value: "\ud800" },
        { value: "\udc00" },
    ];
    for (const payload of invalidPayloads) {
        assert.throws(
            () => prepareCanonicalGameEvent(createPlacementEvent({ payload })),
            { message: "CANONICAL_EVENT_INVALID" },
        );
    }

    for (const key of ["bad\u0000key", "bad\ud800key", "bad\udc00key"]) {
        const payload = {};
        Object.defineProperty(payload, key, {
            configurable: true,
            enumerable: true,
            value: true,
            writable: true,
        });
        assert.throws(
            () => prepareCanonicalGameEvent(createPlacementEvent({ payload })),
            { message: "CANONICAL_EVENT_INVALID" },
        );
    }

    assert.equal(MAX_GAME_ID_BYTES, 64);
    assert.equal(MAX_PLAYER_ID_BYTES, 64);
    const exactBytes = "\u00e9".repeat(32);
    const accepted = createCanonicalGameEvent(createPlacementEvent({
        gameId: exactBytes,
        playerId: exactBytes,
        payload: { emoji: "\ud83d\ude80" },
    }));
    assert.equal(Buffer.byteLength(accepted.gameId, "utf8"), MAX_GAME_ID_BYTES);
    assert.equal(Buffer.byteLength(accepted.playerId, "utf8"), MAX_PLAYER_ID_BYTES);

    const invalidIdentities = [
        { gameId: "\u0000" },
        { gameId: "\ud800" },
        { playerId: "\udc00" },
        { gameId: `${exactBytes}x` },
        { playerId: `${exactBytes}x` },
    ];
    for (const overrides of invalidIdentities) {
        assert.throws(
            () => createCanonicalGameEvent(createPlacementEvent(overrides)),
            { message: "CANONICAL_EVENT_INVALID" },
        );
    }
});

test("event/schema/trust/nullability shape를 table-driven으로 강제한다", () => {
    const invalidEvents = [
        createLifecycleEvent("game_start", { trustLevel: "client_reported" }),
        createLifecycleEvent("game_over", { occurredAt: null }),
        createLifecycleEvent("game_start", { playerId: "player-not-allowed" }),
        createLifecycleEvent("game_start", { schemaVersion: 2 }),
        createPlacementEvent({ playerId: null }),
        createPlacementEvent({ pieceIndex: null }),
        createPlacementEvent({ schemaVersion: 2, occurredAt: null }),
        createPlacementEvent({ schemaVersion: 3 }),
        createPlacementEvent({ occurredAt: "2026-07-23T07:08:09" }),
        createPlacementEvent({ occurredAt: "2026-02-30T07:08:09Z" }),
        createPlacementEvent({ occurredAt: "0000-01-01T00:00:00Z" }),
        createPlacementEvent({ identityVersion: "identity-v2" }),
        { ...createPlacementEvent(), unknown: true },
    ];

    for (const event of invalidEvents) {
        assert.throws(
            () => createCanonicalGameEvent(event),
            { message: "CANONICAL_EVENT_INVALID" },
        );
    }

    const legacy = createCanonicalGameEvent(createPlacementEvent({
        schemaVersion: 1,
        occurredAt: null,
    }));
    assert.equal(legacy.occurredAt, null);
    assert.equal(
        createCanonicalGameEvent(createPlacementEvent({
            trustLevel: "server_authoritative",
        })).trustLevel,
        "server_authoritative",
    );
});

test("256 KiB 상한은 serialized canonical envelope 전체에 적용한다", () => {
    const empty = createPlacementEvent({ payload: { value: "" } });
    const emptyBytes = Buffer.byteLength(
        prepareCanonicalGameEvent(empty).canonicalEnvelope,
        "utf8",
    );
    const exactValue = "x".repeat(MAX_CANONICAL_EVENT_BYTES - emptyBytes);

    const exact = prepareCanonicalGameEvent(createPlacementEvent({
        payload: { value: exactValue },
    }));
    assert.equal(
        Buffer.byteLength(exact.canonicalEnvelope, "utf8"),
        MAX_CANONICAL_EVENT_BYTES,
    );
    assert.throws(
        () => prepareCanonicalGameEvent(createPlacementEvent({
            payload: { value: `${exactValue}x` },
        })),
        { message: "CANONICAL_EVENT_TOO_LARGE" },
    );
});

test("canonical snapshot은 입력 변경과 분리된 immutable copy다", () => {
    const input = createPlacementEvent();
    const prepared = prepareCanonicalGameEvent(input);
    input.payload.metrics.holes = 99;
    input.payload.nextQueue.push("tee");

    assert.equal(prepared.snapshot.payload.metrics.holes, 0);
    assert.deepEqual(prepared.snapshot.payload.nextQueue, ["square", "line"]);
    assert.equal(Reflect.set(prepared.snapshot.payload.metrics, "holes", 2), false);
    assert.equal(prepared.snapshot.payload.metrics.holes, 0);
});
