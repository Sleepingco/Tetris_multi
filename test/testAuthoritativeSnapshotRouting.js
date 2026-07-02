const test = require("node:test");
const assert = require("node:assert/strict");
const { pathToFileURL } = require("node:url");

async function loadRoutingHelpers() {
    const moduleUrl = pathToFileURL(
        `${process.cwd()}/src/client/game/runtime/authoritativeSnapshotRouting.js`,
    );
    moduleUrl.searchParams.set("test", `${Date.now()}-${Math.random()}`);

    return import(moduleUrl.href);
}

test("resolveAuthoritativeSnapshotTarget은 현재 player snapshot을 local target으로 분류한다", async () => {
    const { resolveAuthoritativeSnapshotTarget } = await loadRoutingHelpers();
    const snapshot = {
        board: [],
        tick: 10,
    };

    const result = resolveAuthoritativeSnapshotTarget(
        {
            ok: true,
            roomId: "ROOM001",
            playerId: "player-local",
            updateReason: "input",
            updateSequence: 3,
            snapshot,
            reason: null,
        },
        "player-local",
    );

    assert.deepEqual(result, {
        ok: true,
        target: "local",
        roomId: "ROOM001",
        playerId: "player-local",
        snapshot,
        updateReason: "input",
        updateSequence: 3,
        reason: null,
    });
});

test("resolveAuthoritativeSnapshotTarget은 다른 player snapshot을 opponent target으로 분류한다", async () => {
    const { resolveAuthoritativeSnapshotTarget } = await loadRoutingHelpers();
    const snapshot = {
        board: [],
        tick: 11,
    };

    const result = resolveAuthoritativeSnapshotTarget(
        {
            ok: true,
            roomId: "ROOM001",
            playerId: "player-opponent",
            snapshot,
            reason: null,
        },
        "player-local",
    );

    assert.equal(result.ok, true);
    assert.equal(result.target, "opponent");
    assert.equal(result.playerId, "player-opponent");
    assert.equal(result.snapshot, snapshot);
    assert.equal(result.updateReason, null);
    assert.equal(result.updateSequence, null);
});

test("resolveAuthoritativeSnapshotTarget은 실패 응답을 적용 대상으로 분류하지 않는다", async () => {
    const { resolveAuthoritativeSnapshotTarget } = await loadRoutingHelpers();

    const result = resolveAuthoritativeSnapshotTarget(
        {
            ok: false,
            roomId: "ROOM001",
            playerId: "player-local",
            snapshot: null,
            reason: "NOT_AUTHORIZED",
        },
        "player-local",
    );

    assert.deepEqual(result, {
        ok: false,
        target: null,
        roomId: "ROOM001",
        playerId: "player-local",
        snapshot: null,
        updateReason: null,
        updateSequence: null,
        reason: "NOT_AUTHORIZED",
    });
});

test("resolveAuthoritativeSnapshotTarget은 비교할 playerId가 없으면 실패한다", async () => {
    const { resolveAuthoritativeSnapshotTarget } = await loadRoutingHelpers();

    const result = resolveAuthoritativeSnapshotTarget(
        {
            ok: true,
            roomId: "ROOM001",
            playerId: "player-local",
            snapshot: { board: [] },
            reason: null,
        },
        null,
    );

    assert.deepEqual(result, {
        ok: false,
        target: null,
        roomId: "ROOM001",
        playerId: "player-local",
        snapshot: null,
        updateReason: null,
        updateSequence: null,
        reason: "PLAYER_ID_REQUIRED",
    });
});

test("applyResolvedAuthoritativeSnapshotTarget은 local target을 localGame에만 적용한다", async () => {
    const { applyResolvedAuthoritativeSnapshotTarget } = await loadRoutingHelpers();
    const snapshot = { board: [], tick: 10 };
    const localSnapshots = [];
    const opponentSnapshots = [];

    const result = applyResolvedAuthoritativeSnapshotTarget(
        {
            ok: true,
            target: "local",
            roomId: "ROOM001",
            playerId: "player-local",
            snapshot,
            updateReason: "input",
            updateSequence: 3,
            reason: null,
        },
        {
            localGame: {
                applySnapshot(snapshot) {
                    localSnapshots.push(snapshot);
                },
            },
            opponentGame: {
                applySnapshot(snapshot) {
                    opponentSnapshots.push(snapshot);
                },
            },
        },
    );

    assert.deepEqual(result, {
        ok: true,
        applied: true,
        target: "local",
        roomId: "ROOM001",
        playerId: "player-local",
        updateReason: "input",
        updateSequence: 3,
        reason: null,
    });
    assert.deepEqual(localSnapshots, [snapshot]);
    assert.deepEqual(opponentSnapshots, []);
});

test("applyResolvedAuthoritativeSnapshotTarget은 opponent target을 opponentGame에만 적용한다", async () => {
    const { applyResolvedAuthoritativeSnapshotTarget } = await loadRoutingHelpers();
    const snapshot = { board: [], tick: 11 };
    const localSnapshots = [];
    const opponentSnapshots = [];

    const result = applyResolvedAuthoritativeSnapshotTarget(
        {
            ok: true,
            target: "opponent",
            roomId: "ROOM001",
            playerId: "player-opponent",
            snapshot,
            updateReason: "shadow_tick",
            updateSequence: 4,
            reason: null,
        },
        {
            localGame: {
                applySnapshot(snapshot) {
                    localSnapshots.push(snapshot);
                },
            },
            opponentGame: {
                applySnapshot(snapshot) {
                    opponentSnapshots.push(snapshot);
                },
            },
        },
    );

    assert.equal(result.ok, true);
    assert.equal(result.applied, true);
    assert.equal(result.target, "opponent");
    assert.deepEqual(localSnapshots, []);
    assert.deepEqual(opponentSnapshots, [snapshot]);
});

test("applyResolvedAuthoritativeSnapshotTarget은 실패 result를 적용하지 않는다", async () => {
    const { applyResolvedAuthoritativeSnapshotTarget } = await loadRoutingHelpers();
    const localSnapshots = [];
    const opponentSnapshots = [];

    const result = applyResolvedAuthoritativeSnapshotTarget(
        {
            ok: false,
            target: null,
            roomId: "ROOM001",
            playerId: "player-local",
            snapshot: null,
            updateReason: null,
            updateSequence: null,
            reason: "PLAYER_ID_REQUIRED",
        },
        {
            localGame: {
                applySnapshot(snapshot) {
                    localSnapshots.push(snapshot);
                },
            },
            opponentGame: {
                applySnapshot(snapshot) {
                    opponentSnapshots.push(snapshot);
                },
            },
        },
    );

    assert.deepEqual(result, {
        ok: false,
        applied: false,
        target: null,
        roomId: "ROOM001",
        playerId: "player-local",
        updateReason: null,
        updateSequence: null,
        reason: "PLAYER_ID_REQUIRED",
    });
    assert.deepEqual(localSnapshots, []);
    assert.deepEqual(opponentSnapshots, []);
});

test("getAuthoritativeSnapshotApplyMode는 opponent 명시일 때만 opponent mode를 반환한다", async () => {
    const { getAuthoritativeSnapshotApplyMode } = await loadRoutingHelpers();

    assert.equal(getAuthoritativeSnapshotApplyMode(""), "off");
    assert.equal(getAuthoritativeSnapshotApplyMode("?debug=1"), "off");
    assert.equal(
        getAuthoritativeSnapshotApplyMode("?debug=1&authoritativeApply=opponent"),
        "opponent",
    );
    assert.equal(
        getAuthoritativeSnapshotApplyMode("?debug=1&authoritativeApply=local"),
        "off",
    );
});

test("applyResolvedAuthoritativeSnapshotTarget은 allowedTargets 밖의 target은 적용하지 않는다", async () => {
    const { applyResolvedAuthoritativeSnapshotTarget } = await loadRoutingHelpers();
    const snapshot = { board: [], tick: 12 };
    const localSnapshots = [];
    const opponentSnapshots = [];

    const result = applyResolvedAuthoritativeSnapshotTarget(
        {
            ok: true,
            target: "local",
            roomId: "ROOM001",
            playerId: "player-local",
            snapshot,
            updateReason: "input",
            updateSequence: 5,
            reason: null,
        },
        {
            localGame: {
                applySnapshot(snapshot) {
                    localSnapshots.push(snapshot);
                },
            },
            opponentGame: {
                applySnapshot(snapshot) {
                    opponentSnapshots.push(snapshot);
                },
            },
        },
        {
            allowedTargets: ["opponent"],
        },
    );

    assert.deepEqual(result, {
        ok: false,
        applied: false,
        target: "local",
        roomId: "ROOM001",
        playerId: "player-local",
        updateReason: "input",
        updateSequence: 5,
        reason: "TARGET_NOT_ALLOWED",
    });
    assert.deepEqual(localSnapshots, []);
    assert.deepEqual(opponentSnapshots, []);
});

test("shouldApplyClientSnapshotCorrection은 opponent authoritative apply mode에서 client snapshot 보정을 끈다", async () => {
    const { shouldApplyClientSnapshotCorrection } = await loadRoutingHelpers();

    assert.equal(shouldApplyClientSnapshotCorrection("off"), true);
    assert.equal(shouldApplyClientSnapshotCorrection("opponent"), false);
});

test("shouldApplyOpponentInputPrediction은 opponent authoritative apply mode에서 상대 입력 예측을 끈다", async () => {
    const { shouldApplyOpponentInputPrediction } = await loadRoutingHelpers();

    assert.equal(shouldApplyOpponentInputPrediction("off"), true);
    assert.equal(shouldApplyOpponentInputPrediction("opponent"), false);
});

test("shouldAutoStartOpponentRuntime은 opponent authoritative apply mode에서 상대 runtime 자동 진행을 끈다", async () => {
    const { shouldAutoStartOpponentRuntime } = await loadRoutingHelpers();

    assert.equal(shouldAutoStartOpponentRuntime("off"), true);
    assert.equal(shouldAutoStartOpponentRuntime("opponent"), false);
});

test("shouldApplyOpponentGarbagePrediction은 opponent authoritative apply mode에서 상대 garbage 예측을 끈다", async () => {
    const { shouldApplyOpponentGarbagePrediction } = await loadRoutingHelpers();

    assert.equal(shouldApplyOpponentGarbagePrediction("off"), true);
    assert.equal(shouldApplyOpponentGarbagePrediction("opponent"), false);
});

test("shouldApplyOpponentBagPrediction은 opponent authoritative apply mode에서 상대 bag append를 끈다", async () => {
    const { shouldApplyOpponentBagPrediction } = await loadRoutingHelpers();

    assert.equal(shouldApplyOpponentBagPrediction("off"), true);
    assert.equal(shouldApplyOpponentBagPrediction("opponent"), false);
});
