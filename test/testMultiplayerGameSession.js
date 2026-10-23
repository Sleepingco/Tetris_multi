/**
 * client multiplayer session이 local prediction을 서버 authoritative 결과에 안전하게 수렴시키는지 검증한다.
 *
 * 준비: 실제 DOM·Socket.IO·Canvas 대신 event와 호출을 기록하는 fake socket/runtime/element를 만든다.
 * 실행: join snapshot, keyboard input, input result, 반복 snapshot, disconnect와 destroy 순서를 재현한다.
 * 검증: 내 입력은 빠르게 예측하되 sequence acknowledgment 전에는 되감지 않고, divergence 때만
 * 강제 보정하며, 상대 runtime은 snapshot-only replica로 동작해야 한다.
 *
 * placement log는 local 판단과 서버 lock commit이 모두 확인된 뒤 정확히 한 번만 보내는 것이 핵심 불변식이다.
 */
const test = require("node:test");
const assert = require("node:assert/strict");

/**
 * 브라우저 socket의 최소 event API를 흉내 내며 client emit과 server emit을 분리해 기록한다.
 * 실제 네트워크 없이도 event 순서, payload, handler 정리 여부를 결정적으로 확인할 수 있다.
 */
class FakeSocket {
    constructor() {
        this.handlers = new Map();
        this.emitted = [];
        this.connected = false;
        this.id = "game-session-test-socket";
    }

    on(eventName, handler) {
        if (!this.handlers.has(eventName)) {
            this.handlers.set(eventName, new Set());
        }

        this.handlers.get(eventName).add(handler);
    }

    off(eventName, handler) {
        this.handlers.get(eventName)?.delete(handler);
    }

    emit(eventName, payload) {
        this.emitted.push({ eventName, payload });
    }

    get volatile() {
        return this;
    }

    emitServer(eventName, payload) {
        const wirePayload = createServerWirePayload(eventName, payload);
        this.handlers.get(eventName)?.forEach(handler => {
            handler(wirePayload);
        });
    }

    emitRawServer(eventName, payload) {
        this.handlers.get(eventName)?.forEach(handler => {
            handler(payload);
        });
    }

    connect() {
        this.connectCount = (this.connectCount || 0) + 1;
        this.connected = true;
        this.emitServer("connect");
        this.emitServer("session:ready", {
            version: 1,
            playerId: "00000000-0000-4000-8000-000000000001",
            token: "a".repeat(43),
            nickname: "Player",
            expiresAt: Date.now() + 60_000,
            resumed: false,
        });
    }

    disconnect() {
        const wasConnected = this.connected;
        this.connected = false;
        if (wasConnected) this.emitServer("disconnect", "io client disconnect");
    }
}

const sharedFakeSocket = new FakeSocket();

function createServerWirePayload(eventName, payload) {
    if (eventName === "game:input:result") {
        return {
            ...payload,
            placementCommitted: payload.placementCommitted === true,
            ...(payload.snapshot ? { snapshot: createWireSnapshot(payload.snapshot) } : {}),
        };
    }
    if (eventName === "game:authoritative:snapshot") {
        return {
            roomId: "ABCDEF12",
            ...payload,
            snapshot: createWireSnapshot(payload.snapshot),
        };
    }
    return payload;
}

function createWireSnapshot(snapshot) {
    return {
        spinRotation: snapshot.spinRotation ? { ...snapshot.spinRotation } : null,
        board: snapshot.board,
        activePiece: snapshot.activePiece ?? null,
        pieceQueue: snapshot.pieceQueue ?? [],
        holdPieceType: snapshot.holdPieceType ?? null,
        holdUsedThisDrop: snapshot.holdUsedThisDrop === true,
        score: snapshot.score ?? 0,
        lines: snapshot.lines ?? 0,
        phase: snapshot.phase ?? "playing",
        gameOver: snapshot.gameOver === true,
        combo: snapshot.combo ?? -1,
        backToBack: snapshot.backToBack === true,
        tick: snapshot.tick ?? 0,
        pieceIndex: snapshot.pieceIndex ?? 0,
        pendingGarbageLines: snapshot.pendingGarbageLines ?? 0,
        lastProcessedClientSequence: snapshot.lastProcessedClientSequence ?? 0,
    };
}

function createFakeElement(tagName = "div") {
    const element = {
        tagName,
        children: [],
        textContent: "",
        _className: "",
        append(...nodes) {
            nodes.forEach(node => {
                if (node && typeof node === "object") {
                    node.parentElement = this;
                }
            });
            this.children.push(...nodes);
        },
        addEventListener() {},
        removeEventListener() {},
        get offsetWidth() {
            return 0;
        },
    };

    Object.defineProperty(element, "className", {
        get() {
            return this._className;
        },
        set(value) {
            this._className = value;
        },
    });

    Object.defineProperty(element, "innerHTML", {
        get() {
            return "";
        },
        set() {
            this.children = [];
        },
    });

    element.classList = {
        add(...classNames) {
            const current = new Set(element.className.split(" ").filter(Boolean));
            classNames.forEach(className => current.add(className));
            element.className = [...current].join(" ");
        },
        remove(...classNames) {
            const removed = new Set(classNames);
            const current = element.className.split(" ").filter(Boolean);
            element.className = current.filter(className => !removed.has(className)).join(" ");
        },
        contains(className) {
            return element.className.split(" ").filter(Boolean).includes(className);
        },
    };

    return element;
}

function createFakeCanvas() {
    const canvas = createFakeElement("canvas");
    const context = {
        canvas,
        fillStyle: "",
        strokeStyle: "",
        lineWidth: 1,
        globalAlpha: 1,
        beginPath() {},
        clearRect() {},
        fill() {},
        fillRect() {},
        lineTo() {},
        moveTo() {},
        restore() {},
        roundRect() {},
        save() {},
        scale() {},
        stroke() {},
        translate() {},
    };

    canvas.getContext = () => context;

    return canvas;
}

function installBrowserStubs(fakeSocket) {
    const documentHandlers = new Map();

    globalThis.io = () => fakeSocket;
    globalThis.Audio = class {
        constructor(src) {
            this.src = src;
            this.loop = false;
            this.volume = 1;
            this.currentTime = 0;
        }

        play() {
            return Promise.resolve();
        }

        pause() {}
    };
    globalThis.__documentHandlers = documentHandlers;
    globalThis.document = {
        addEventListener(eventName, handler) {
            if (!documentHandlers.has(eventName)) {
                documentHandlers.set(eventName, new Set());
            }

            documentHandlers.get(eventName).add(handler);
        },
        removeEventListener(eventName, handler) {
            documentHandlers.get(eventName)?.delete(handler);
        },
        createElement: createFakeElement,
    };
    globalThis.getComputedStyle = () => ({
        getPropertyValue() {
            return "";
        },
    });
    globalThis.localStorage = {
        getItem() {
            return null;
        },
        setItem() {},
    };
    const sessionValues = new Map([["tetris:nickname", "Player"]]);
    globalThis.sessionStorage = {
        getItem(key) {
            return sessionValues.get(key) ?? null;
        },
        setItem(key, value) {
            sessionValues.set(key, value);
        },
        removeItem(key) {
            sessionValues.delete(key);
        },
    };
    globalThis.requestAnimationFrame = () => 0;
    globalThis.cancelAnimationFrame = () => {};
}

function emitDocumentEvent(eventName, payload) {
    globalThis.__documentHandlers?.get(eventName)?.forEach(handler => {
        handler(payload);
    });
}

async function loadSession() {
    installBrowserStubs(sharedFakeSocket);
    return import("../src/client/game/entry/multiplayerGameSession.ts");
}

function createSessionParams(overrides = {}) {
    return {
        roomId: "ABCDEF12",
        playerId: "00000000-0000-4000-8000-000000000001",
        opponentPlayerId: "00000000-0000-4000-8000-000000000002",
        match: {
            createdAt: 1,
            players: [
                { playerId: "00000000-0000-4000-8000-000000000001", bagChunks: [["tree", "bar", "square", "zee", "eleft", "eright", "ess"]] },
                { playerId: "00000000-0000-4000-8000-000000000002", bagChunks: [["tree", "bar", "square", "zee", "eleft", "eright", "ess"]] },
            ],
        },
        myCanvas: createFakeCanvas(),
        opponentCanvas: createFakeCanvas(),
        myNextPreviewEl: createFakeElement(),
        myHoldPreviewEl: createFakeElement(),
        myScoreEl: createFakeElement(),
        myLinesEl: createFakeElement(),
        myPendingGarbageEl: createFakeElement(),
        opponentNextPreviewEl: createFakeElement(),
        opponentHoldPreviewEl: createFakeElement(),
        opponentScoreEl: createFakeElement(),
        opponentLinesEl: createFakeElement(),
        opponentPendingGarbageEl: createFakeElement(),
        ...overrides,
    };
}

function cleanupSession(session) {
    session.destroy();
}

function waitForLocalInputTick() {
    return new Promise(resolve => setTimeout(resolve, 30));
}

function snapshotWithScore(baseSnapshot, score) {
    return {
        ...baseSnapshot,
        board: baseSnapshot.board.map(row => [...row]),
        activePiece: { ...baseSnapshot.activePiece },
        pendingPiece: baseSnapshot.pendingPiece ? { ...baseSnapshot.pendingPiece } : null,
        pieceQueue: [...baseSnapshot.pieceQueue],
        inputQueue: [],
        score,
    };
}

function cloneBoardWithGarbageCell(baseSnapshot) {
    const board = baseSnapshot.board.map(row => [...row]);
    board[board.length - 1][0] = "zee";
    return board;
}

function installMonotonicClock(t, initialNowMs = 0) {
    const originalPerformance = globalThis.performance;
    let nowMs = initialNowMs;

    globalThis.performance = {
        now() {
            return nowMs;
        },
    };
    t.after(() => {
        globalThis.performance = originalPerformance;
    });

    return {
        set(value) {
            nowMs = value;
        },
    };
}

function createAuthoritativeSnapshot(overrides = {}) {
    return {
        spinRotation: null,
        board: Array.from({ length: 40 }, () => Array(10).fill(null)),
        activePiece: {
            pieceType: "tree",
            rotation: 0,
            row: 19,
            col: 3,
        },
        pieceQueue: ["bar", "square", "zee"],
        holdPieceType: null,
        holdUsedThisDrop: false,
        score: 0,
        lines: 0,
        phase: "playing",
        gameOver: false,
        combo: -1,
        backToBack: false,
        tick: 0,
        pieceIndex: 1,
        pendingGarbageLines: 0,
        lastProcessedClientSequence: 0,
        ...overrides,
    };
}

test("서버 snapshot이 멈추면 countdown 뒤 5초에 예측을 정리하고 한 번 재인증한다", async (t) => {
    const { startMultiplayerGame } = await loadSession();
    const clock = installMonotonicClock(t);
    const originalSetInterval = globalThis.setInterval;
    const originalClearInterval = globalThis.clearInterval;
    const callbacks = new Map();
    let nextTimer = 1;
    globalThis.setInterval = (callback, delay) => {
        const timer = nextTimer++;
        callbacks.set(timer, { callback, delay });
        return timer;
    };
    globalThis.clearInterval = timer => callbacks.delete(timer);
    const session = startMultiplayerGame(createSessionParams({ deferStart: true }));
    t.after(() => {
        session.destroy();
        globalThis.setInterval = originalSetInterval;
        globalThis.clearInterval = originalClearInterval;
    });
    const heartbeat = callbacks.get(session.heartbeatTimer).callback;
    const connectCount = sharedFakeSocket.connectCount;
    clock.set(10_000);
    heartbeat();
    assert.equal(sharedFakeSocket.connectCount, connectCount);
    session.start();
    clock.set(14_999);
    heartbeat();
    sharedFakeSocket.emitServer("game:authoritative:snapshot", {
        playerId: "00000000-0000-4000-8000-000000000002",
        snapshot: createAuthoritativeSnapshot(),
    });
    clock.set(18_000);
    sharedFakeSocket.emitServer("game:authoritative:snapshot", {
        roomId: "FEDCBA98",
        playerId: "00000000-0000-4000-8000-000000000001",
        snapshot: createAuthoritativeSnapshot(),
    });
    sharedFakeSocket.emitServer("game:authoritative:snapshot", {
        playerId: "00000000-0000-4000-8000-000000000003",
        snapshot: createAuthoritativeSnapshot(),
    });
    clock.set(19_000);
    heartbeat();
    assert.equal(sharedFakeSocket.connectCount, connectCount);
    clock.set(19_999);
    heartbeat();
    assert.equal(sharedFakeSocket.connectCount, connectCount + 1);
    assert.equal(session.myGame.runtime.inputTimer, undefined);
    assert.equal(session.opponentGame.runtime.inputTimer, undefined);
    assert.equal(callbacks.has(session.heartbeatTimer), false);
    const inputCount = sharedFakeSocket.emitted.length;
    emitDocumentEvent("keydown", { key: " ", code: "Space", preventDefault() {} });
    heartbeat();
    assert.equal(sharedFakeSocket.emitted.length, inputCount);
    assert.equal(sharedFakeSocket.connectCount, connectCount + 1);
});

function installAnimationFrameQueue() {
    const callbacks = new Map();
    let nextFrameId = 1;
    globalThis.requestAnimationFrame = (callback) => {
        const frameId = nextFrameId;
        nextFrameId += 1;
        callbacks.set(frameId, callback);
        return frameId;
    };
    globalThis.cancelAnimationFrame = frameId => callbacks.delete(frameId);
    return callbacks;
}

function applySingleLineClearFixture(session) {
    const snapshot = session.myGame.getSnapshot();
    const board = Array.from({ length: 40 }, () => Array(10).fill(null));
    board[39].fill("square");
    board[39][4] = null;
    board[39][5] = null;
    session.myGame.applySnapshot({
        ...snapshot,
        board,
        activePiece: {
            pieceType: "square",
            rotation: 0,
            row: 38,
            col: 4,
        },
        pieceQueue: ["bar", "tree"],
        phase: "playing",
    }, { resumeGravity: true });
    return snapshot;
}

test("game join 초기 authoritative snapshot으로 내 보드와 상대 보드를 정렬한다", async (t) => {
    const { startMultiplayerGame } = await loadSession();
    const params = createSessionParams();
    const myBoard = Array.from({ length: 40 }, () => Array(10).fill(null));
    myBoard[39][0] = "square";
    const opponentBoard = Array.from({ length: 40 }, () => Array(10).fill(null));
    opponentBoard[39][9] = "bar";
    params.match.players[0].snapshot = createAuthoritativeSnapshot({
        board: myBoard,
        score: 40,
        tick: 5,
        pieceIndex: 3,
    });
    params.match.players[1].snapshot = createAuthoritativeSnapshot({
        board: opponentBoard,
        score: 20,
        tick: 5,
        pieceIndex: 2,
    });

    const session = startMultiplayerGame(params);
    t.after(() => cleanupSession(session));

    assert.deepEqual(session.myGame.getSnapshot().board, myBoard);
    assert.equal(session.myGame.getSnapshot().pieceIndex, 3);
    assert.equal(session.myGame.runtime.gravityRunning, true);
    assert.deepEqual(session.opponentGame.getSnapshot().board, opponentBoard);
    assert.equal(session.opponentGame.getSnapshot().pieceIndex, 2);
    assert.equal(session.opponentGame.runtime.gravityRunning, false);
    assert.equal(session.myGame.getServerBagRemainingCount(), 3);
});

test("재join·동일 좌표 보정은 회전 이력을 복원하고 미확정 입력·늦은 ack는 덮어쓰지 않는다", async (t) => {
    const { startMultiplayerGame } = await loadSession();
    const params = createSessionParams();
    params.match.players[0].snapshot = createAuthoritativeSnapshot({
        activePiece: { pieceType: "tree", rotation: 0, row: 24, col: 3 },
        spinRotation: { lastKickIndex: 0, usedKick5: true },
    });
    const session = startMultiplayerGame(params);
    t.after(() => cleanupSession(session));
    const actor = params.playerId;
    assert.deepEqual(session.myGame.getSnapshot().spinRotation, { lastKickIndex: 0, usedKick5: true });
    sharedFakeSocket.emitted = [];
    emitDocumentEvent("keydown", { key: "ArrowUp", code: "ArrowUp", repeat: false, preventDefault() {} });
    await waitForLocalInputTick();
    const input = sharedFakeSocket.emitted.find(event => event.eventName === "game:input").payload;
    const predicted = session.myGame.getSnapshot();
    assert.deepEqual(predicted.spinRotation, { lastKickIndex: 0, usedKick5: true });
    const deliver = (lastProcessedClientSequence, spinRotation, tick = predicted.tick) => {
        sharedFakeSocket.emitServer("game:authoritative:snapshot", {
            playerId: actor,
            snapshot: { ...predicted, spinRotation, tick, lastProcessedClientSequence },
        });
    };
    deliver(input.clientSequence - 1, null);
    assert.deepEqual(session.myGame.getSnapshot().spinRotation, predicted.spinRotation);
    deliver(input.clientSequence, null);
    assert.equal(session.myGame.getSnapshot().spinRotation, null);
    const restored = { lastKickIndex: 4, usedKick5: true };
    deliver(input.clientSequence, restored, predicted.tick + 1);
    restored.usedKick5 = false;
    assert.deepEqual(session.myGame.getSnapshot().spinRotation, { lastKickIndex: 4, usedKick5: true });
    deliver(input.clientSequence - 1, null, predicted.tick + 2);
    deliver(input.clientSequence, null, predicted.tick);
    assert.deepEqual(session.myGame.getSnapshot().spinRotation, { lastKickIndex: 4, usedKick5: true });
});

test("countdown session은 초기 보드만 표시하고 start 후 입력과 중력을 한 번 시작한다", async t => {
    const { startMultiplayerGame } = await loadSession();
    const params = createSessionParams({ deferStart: true });
    params.match.players.forEach(player => { player.snapshot = createAuthoritativeSnapshot(); });
    const session = startMultiplayerGame(params);
    t.after(() => cleanupSession(session));
    sharedFakeSocket.emitted = [];
    const before = session.myGame.getSnapshot();
    assert.equal(session.myGame.runtime.gravityRunning, false);
    assert.equal(session.myGame.runtime.inputTimer, undefined);
    emitDocumentEvent("keydown", { code: "Space", key: " ", preventDefault() {} });
    await waitForLocalInputTick();
    assert.deepEqual(session.myGame.getSnapshot(), before);
    assert.equal(sharedFakeSocket.emitted.some(event => event.eventName === "game:input"), false);
    session.start();
    const inputTimer = session.myGame.runtime.inputTimer;
    assert.equal(session.myGame.runtime.gravityRunning, true);
    assert.equal(session.opponentGame.runtime.gravityRunning, false);
    session.start();
    assert.equal(session.myGame.runtime.inputTimer, inputTimer);
    assert.deepEqual(session.myGame.getSnapshot().board, before.board);
    emitDocumentEvent("keydown", { code: "ArrowLeft", key: "ArrowLeft", preventDefault() {} });
    await waitForLocalInputTick();
    assert.equal(sharedFakeSocket.emitted.filter(event => event.eventName === "game:input").length, 1);
    session.destroy();
    session.start();
    assert.equal(session.myGame.runtime.gravityRunning, false);
});

test("heartbeatTimer는 game:snapshot과 game:over 없이 bag 요청만 유지한다", async (t) => {
    const originalSetInterval = globalThis.setInterval;
    const originalClearInterval = globalThis.clearInterval;
    const intervals = [];
    let nextTimerId = 1;

    globalThis.setInterval = (callback, delayMs) => {
        const timer = { id: nextTimerId, callback, delayMs };
        nextTimerId += 1;
        intervals.push(timer);
        return timer.id;
    };
    globalThis.clearInterval = (timerId) => {
        const index = intervals.findIndex(timer => timer.id === timerId);
        if (index !== -1) {
            intervals.splice(index, 1);
        }
    };

    const { startMultiplayerGame } = await loadSession();
    const session = startMultiplayerGame(createSessionParams());
    t.after(() => {
        cleanupSession(session);
        globalThis.setInterval = originalSetInterval;
        globalThis.clearInterval = originalClearInterval;
    });

    const heartbeatTimer = intervals.find(timer => timer.delayMs === 500);
    assert.equal(session.heartbeatTimer, heartbeatTimer.id);

    sharedFakeSocket.emitted = [];
    heartbeatTimer.callback();

    assert.equal(sharedFakeSocket.emitted.some(event => event.eventName === "game:snapshot"), false);
    assert.equal(sharedFakeSocket.emitted.some(event => event.eventName === "game:bag:request"), true);

    const countBagRequests = () => sharedFakeSocket.emitted.filter(
        event => event.eventName === "game:bag:request",
    ).length;
    heartbeatTimer.callback();
    assert.equal(countBagRequests(), 1);

    sharedFakeSocket.emitServer("game:bag:result", {
        ok: false,
        room: null,
        reason: "BAG_QUEUE_SUFFICIENT",
    });
    heartbeatTimer.callback();
    assert.equal(countBagRequests(), 2);

    const gameOverSnapshot = {
        ...session.myGame.getSnapshot(),
        board: session.myGame.getSnapshot().board.map(row => [...row]),
        activePiece: { ...session.myGame.getSnapshot().activePiece },
        pieceQueue: [...session.myGame.getSnapshot().pieceQueue],
        phase: "gameOver",
    };
    session.myGame.applySnapshot(gameOverSnapshot);
    sharedFakeSocket.emitted = [];
    heartbeatTimer.callback();

    assert.equal(sharedFakeSocket.emitted.some(event => event.eventName === "game:snapshot"), false);
    assert.equal(sharedFakeSocket.emitted.some(event => event.eventName === "game:over"), false);
});

test("game session destroy는 timer와 handler를 한 번만 정리하고 stale callback을 무시한다", async (t) => {
    const originalSetInterval = globalThis.setInterval;
    const originalClearInterval = globalThis.clearInterval;
    const originalRequestAnimationFrame = globalThis.requestAnimationFrame;
    const originalCancelAnimationFrame = globalThis.cancelAnimationFrame;
    const intervals = new Map();
    const animationCallbacks = new Map();
    let nextTimerId = 1;
    let nextAnimationFrameId = 1;
    globalThis.setInterval = (callback, delayMs) => {
        const id = nextTimerId++;
        intervals.set(id, { callback, delayMs });
        return id;
    };
    globalThis.clearInterval = id => intervals.delete(id);
    t.after(() => {
        globalThis.setInterval = originalSetInterval;
        globalThis.clearInterval = originalClearInterval;
        globalThis.requestAnimationFrame = originalRequestAnimationFrame;
        globalThis.cancelAnimationFrame = originalCancelAnimationFrame;
    });

    const { startMultiplayerGame } = await loadSession();
    globalThis.requestAnimationFrame = callback => {
        const id = nextAnimationFrameId++;
        animationCallbacks.set(id, callback);
        return id;
    };
    globalThis.cancelAnimationFrame = id => animationCallbacks.delete(id);
    const session = startMultiplayerGame(createSessionParams());
    t.after(() => session.destroy());
    const heartbeat = [...intervals.values()].find(timer => timer.delayMs === 500);
    const inputTimer = [...intervals.values()].find(timer => timer.delayMs === 16);
    const keyboardHandler = [...globalThis.__documentHandlers.get("keydown")][0];
    const gameHandlerEvents = [
        "game:authoritative:snapshot",
        "game:input:result",
        "game:bag:append",
        "game:bag:result",
    ];
    const authoritativeHandler = [
        ...sharedFakeSocket.handlers.get("game:authoritative:snapshot"),
    ][0];
    const opponentSnapshot = session.opponentGame.getSnapshot();
    assert.equal(session.opponentGame.playLineClearPresentation({
        rows: [39],
        board: opponentSnapshot.board,
    }), true);
    const animationCallback = [...animationCallbacks.values()][0];
    assert.equal([...intervals.values()].filter(timer => timer.delayMs === 500).length, 1);
    assert.equal(typeof heartbeat?.callback, "function");
    assert.equal(typeof inputTimer?.callback, "function");
    assert.equal(typeof keyboardHandler, "function");
    assert.equal(typeof authoritativeHandler, "function");
    assert.equal(typeof animationCallback, "function");
    assert.deepEqual(
        gameHandlerEvents.map(eventName => sharedFakeSocket.handlers.get(eventName)?.size ?? 0),
        [1, 1, 1, 1],
    );

    let displayCalls = 0;
    session.myGame.subscribeDisplay(() => {
        displayCalls += 1;
    });
    sharedFakeSocket.emitted = [];
    session.destroy();
    session.destroy();
    const snapshotAfterDestroy = JSON.stringify(session.myGame.getSnapshot());
    const logCountAfterDestroy = session.myGame.getPlacementDecisionLog().length;

    keyboardHandler({
        key: "ArrowLeft",
        code: "ArrowLeft",
        repeat: false,
        preventDefault() {},
    });
    inputTimer.callback();
    heartbeat.callback();
    animationCallback(performance.now() + 400);
    authoritativeHandler(createServerWirePayload("game:authoritative:snapshot", {
        playerId: "00000000-0000-4000-8000-000000000001",
        snapshot: createAuthoritativeSnapshot({ score: 100, pendingGarbageLines: 4 }),
    }));

    assert.equal(intervals.size, 0);
    assert.equal(globalThis.__documentHandlers.get("keydown")?.size ?? 0, 0);
    assert.deepEqual(
        gameHandlerEvents.map(eventName => sharedFakeSocket.handlers.get(eventName)?.size ?? 0),
        [0, 0, 0, 0],
    );
    assert.equal(JSON.stringify(session.myGame.getSnapshot()), snapshotAfterDestroy);
    assert.equal(session.myGame.getPendingInputCount(), 0);
    assert.equal(session.myGame.getPlacementDecisionLog().length, logCountAfterDestroy);
    assert.equal(sharedFakeSocket.emitted.length, 0);
    assert.equal(displayCalls, 0);
});

test("내 키보드 입력은 game:input으로 서버에 전송된다", async (t) => {
    const { startMultiplayerGame } = await loadSession();
    let userInteractionCount = 0;
    const session = startMultiplayerGame(createSessionParams({
        onUserInteract() {
            userInteractionCount += 1;
        },
    }));
    t.after(() => cleanupSession(session));

    sharedFakeSocket.emitted = [];
    emitDocumentEvent("keydown", {
        key: "ArrowLeft",
        code: "ArrowLeft",
        repeat: false,
        preventDefault() {},
    });

    assert.equal(
        sharedFakeSocket.emitted.some(event => event.eventName === "game:input"),
        false,
    );
    await waitForLocalInputTick();

    const inputEvent = sharedFakeSocket.emitted.find(event => {
        return event.eventName === "game:input";
    });

    assert.equal(userInteractionCount, 1);
    assert.equal(inputEvent.payload.roomId, "ABCDEF12");
    assert.equal(inputEvent.payload.playerId, undefined);
    assert.equal(inputEvent.payload.action, "move_left");
    assert.deepEqual(inputEvent.payload.expectedTransform, {
        pieceType: "tree",
        rotation: 0,
        col: 2,
    });
    assert.equal("row" in inputEvent.payload.expectedTransform, false);
    assert.equal(Number.isInteger(inputEvent.payload.tick), true);
    assert.equal(Number.isInteger(inputEvent.payload.pieceIndex), true);
    assert.equal(inputEvent.payload.clientSequence, 1);
});

test("reconnect 초기 snapshot ack 다음 값부터 clientSequence를 재개한다", async (t) => {
    const { startMultiplayerGame } = await loadSession();
    const params = createSessionParams();
    params.match.players[0].snapshot = createAuthoritativeSnapshot({
        lastProcessedClientSequence: 7,
    });
    const session = startMultiplayerGame(params);
    t.after(() => cleanupSession(session));

    sharedFakeSocket.emitted = [];
    emitDocumentEvent("keydown", {
        key: "ArrowLeft",
        code: "ArrowLeft",
        repeat: false,
        preventDefault() {},
    });
    await waitForLocalInputTick();

    const inputEvent = sharedFakeSocket.emitted.find(event => {
        return event.eventName === "game:input";
    });
    assert.equal(inputEvent.payload.clientSequence, 8);
});

test("실패한 wall input은 전송하지 않고 성공 입력 sequence는 gap 없이 증가한다", async (t) => {
    const { startMultiplayerGame } = await loadSession();
    const session = startMultiplayerGame(createSessionParams());
    t.after(() => cleanupSession(session));

    const initialSnapshot = session.myGame.getSnapshot();
    const pieceIndex = initialSnapshot.pieceIndex;
    session.myGame.applySnapshot({
        ...initialSnapshot,
        board: Array.from({ length: 40 }, () => Array(10).fill(null)),
        activePiece: {
            pieceType: "square",
            rotation: 0,
            row: 20,
            col: 0,
        },
        pieceQueue: ["bar", "tree", "zee"],
        phase: "playing",
    }, { resumeGravity: true });
    sharedFakeSocket.emitted = [];

    for (const input of [
        { key: "ArrowLeft", code: "ArrowLeft" },
        { key: "ArrowRight", code: "ArrowRight" },
        { key: " ", code: "Space" },
    ]) {
        emitDocumentEvent("keydown", {
            ...input,
            repeat: false,
            preventDefault() {},
        });
    }

    assert.equal(
        sharedFakeSocket.emitted.some(event => event.eventName === "game:input"),
        false,
    );
    await waitForLocalInputTick();

    const inputEvents = sharedFakeSocket.emitted.filter(event => {
        return event.eventName === "game:input";
    });
    assert.deepEqual(inputEvents.map(event => event.payload.action), [
        "move_right",
        "hard_drop",
    ]);
    assert.deepEqual(inputEvents.map(event => event.payload.clientSequence), [1, 2]);
    assert.deepEqual(inputEvents.map(event => event.payload.pieceIndex), [
        pieceIndex,
        pieceIndex,
    ]);
    assert.equal(inputEvents[0].payload.tick, inputEvents[1].payload.tick);
});

test("같은 local drain의 성공 move와 hard_drop은 원래 pieceIndex 순서로 전송된다", async (t) => {
    const { startMultiplayerGame } = await loadSession();
    const session = startMultiplayerGame(createSessionParams());
    t.after(() => cleanupSession(session));

    const pieceIndex = session.myGame.runtime.pieceIndex;
    sharedFakeSocket.emitted = [];
    for (const input of [
        { key: "ArrowLeft", code: "ArrowLeft" },
        { key: " ", code: "Space" },
    ]) {
        emitDocumentEvent("keydown", {
            ...input,
            repeat: false,
            preventDefault() {},
        });
    }

    await waitForLocalInputTick();

    const inputEvents = sharedFakeSocket.emitted.filter(event => {
        return event.eventName === "game:input";
    });
    assert.deepEqual(inputEvents.map(event => ({
        action: event.payload.action,
        pieceIndex: event.payload.pieceIndex,
        clientSequence: event.payload.clientSequence,
        expectedTransform: event.payload.expectedTransform,
    })), [
        {
            action: "move_left",
            pieceIndex,
            clientSequence: 1,
            expectedTransform: { pieceType: "tree", rotation: 0, col: 2 },
        },
        {
            action: "hard_drop",
            pieceIndex,
            clientSequence: 2,
            expectedTransform: { pieceType: "tree", rotation: 0, col: 2 },
        },
    ]);
});

test("human hard_drop 로그는 authoritative commit 뒤 정확히 한 번 전송된다", async (t) => {
    const { startMultiplayerGame } = await loadSession();
    const session = startMultiplayerGame(createSessionParams());
    t.after(() => cleanupSession(session));

    const pieceIndex = session.myGame.runtime.pieceIndex;
    sharedFakeSocket.emitted = [];
    emitDocumentEvent("keydown", {
        key: " ",
        code: "Space",
        repeat: false,
        preventDefault() {},
    });
    await waitForLocalInputTick();

    const inputEvent = sharedFakeSocket.emitted.find(event => {
        return event.eventName === "game:input";
    });
    assert.equal(inputEvent.payload.action, "hard_drop");
    assert.equal(
        sharedFakeSocket.emitted.some(event => event.eventName === "game:log:placement_decision"),
        false,
    );

    const result = {
        ok: true,
        reason: null,
        clientSequence: inputEvent.payload.clientSequence,
        pieceIndex,
        placementCommitted: true,
    };
    sharedFakeSocket.emitServer("game:input:result", result);
    sharedFakeSocket.emitServer("game:input:result", result);

    const logEvents = sharedFakeSocket.emitted.filter(event => {
        return event.eventName === "game:log:placement_decision";
    });
    assert.equal(logEvents.length, 1);
    assert.equal(logEvents[0].payload.log.authoritativeClientSequence, inputEvent.payload.clientSequence);
    assert.equal(logEvents[0].payload.log.authoritativePieceIndex, pieceIndex);
});

test("terminal input 실패는 human placement 로그를 폐기한다", async (t) => {
    const { startMultiplayerGame } = await loadSession();

    for (const reason of ["PREDICTION_DIVERGED", "PIECE_INDEX_MISMATCH"]) {
        await t.test(reason, async () => {
            const session = startMultiplayerGame(createSessionParams());
            try {
                const pieceIndex = session.myGame.runtime.pieceIndex;
                sharedFakeSocket.emitted = [];
                emitDocumentEvent("keydown", {
                    key: " ",
                    code: "Space",
                    repeat: false,
                    preventDefault() {},
                });
                await waitForLocalInputTick();
                const inputEvent = sharedFakeSocket.emitted.find(event => {
                    return event.eventName === "game:input";
                });
                const result = {
                    ok: false,
                    reason,
                    clientSequence: inputEvent.payload.clientSequence,
                    pieceIndex,
                    placementCommitted: false,
                };
                if (reason === "PREDICTION_DIVERGED") {
                    result.snapshot = createAuthoritativeSnapshot({
                        pieceIndex,
                        lastProcessedClientSequence: inputEvent.payload.clientSequence,
                    });
                }

                sharedFakeSocket.emitServer("game:input:result", result);
                sharedFakeSocket.emitServer("game:input:result", result);

                assert.equal(
                    sharedFakeSocket.emitted.some(event => {
                        return event.eventName === "game:log:placement_decision";
                    }),
                    false,
                );
            } finally {
                cleanupSession(session);
            }
        });
    }
});

test("line clear는 authoritative result가 local log보다 먼저 와도 한 번만 전송된다", async (t) => {
    const { startMultiplayerGame } = await loadSession();
    const frameCallbacks = installAnimationFrameQueue();

    const session = startMultiplayerGame(createSessionParams());
    t.after(() => cleanupSession(session));
    const snapshot = applySingleLineClearFixture(session);

    sharedFakeSocket.emitted = [];
    emitDocumentEvent("keydown", {
        key: " ",
        code: "Space",
        repeat: false,
        preventDefault() {},
    });
    await waitForLocalInputTick();
    const inputEvent = sharedFakeSocket.emitted.find(event => {
        return event.eventName === "game:input";
    });
    sharedFakeSocket.emitServer("game:input:result", {
        ok: true,
        reason: null,
        clientSequence: inputEvent.payload.clientSequence,
        pieceIndex: snapshot.pieceIndex,
        placementCommitted: true,
    });
    assert.equal(
        sharedFakeSocket.emitted.some(event => event.eventName === "game:log:placement_decision"),
        false,
    );

    const animationCallback = frameCallbacks.get(session.myGame.runtime.animationFrameId);
    animationCallback(globalThis.performance.now() + 400);

    const logEvents = sharedFakeSocket.emitted.filter(event => {
        return event.eventName === "game:log:placement_decision";
    });
    assert.equal(logEvents.length, 1);
    assert.equal(logEvents[0].payload.log.authoritativeClientSequence, inputEvent.payload.clientSequence);
    assert.equal(logEvents[0].payload.log.authoritativePieceIndex, snapshot.pieceIndex);
});

test("실패한 line clear terminal input은 늦은 local log도 전송하지 않는다", async (t) => {
    const { startMultiplayerGame } = await loadSession();
    const frameCallbacks = installAnimationFrameQueue();
    const session = startMultiplayerGame(createSessionParams());
    t.after(() => cleanupSession(session));
    const snapshot = applySingleLineClearFixture(session);

    sharedFakeSocket.emitted = [];
    emitDocumentEvent("keydown", {
        key: " ",
        code: "Space",
        repeat: false,
        preventDefault() {},
    });
    await waitForLocalInputTick();
    const inputEvent = sharedFakeSocket.emitted.find(event => {
        return event.eventName === "game:input";
    });
    sharedFakeSocket.emitServer("game:input:result", {
        ok: false,
        reason: "PIECE_INDEX_MISMATCH",
        clientSequence: inputEvent.payload.clientSequence,
        pieceIndex: snapshot.pieceIndex,
        placementCommitted: false,
    });

    const animationCallback = frameCallbacks.get(session.myGame.runtime.animationFrameId);
    animationCallback(globalThis.performance.now() + 400);

    assert.equal(
        sharedFakeSocket.emitted.some(event => event.eventName === "game:log:placement_decision"),
        false,
    );
});

test("rotate와 hard_drop expectedTransform은 각각 after와 before 조각을 사용한다", async (t) => {
    const { startMultiplayerGame } = await loadSession();
    const session = startMultiplayerGame(createSessionParams());
    t.after(() => cleanupSession(session));

    sharedFakeSocket.emitted = [];
    for (const input of [
        { key: "ArrowUp", code: "ArrowUp" },
        { key: " ", code: "Space" },
    ]) {
        emitDocumentEvent("keydown", {
            ...input,
            repeat: false,
            preventDefault() {},
        });
    }
    await waitForLocalInputTick();

    const inputEvents = sharedFakeSocket.emitted.filter(event => {
        return event.eventName === "game:input";
    });
    assert.deepEqual(inputEvents.map(event => ({
        action: event.payload.action,
        clientSequence: event.payload.clientSequence,
        expectedTransform: event.payload.expectedTransform,
    })), [
        {
            action: "rotate",
            clientSequence: 1,
            expectedTransform: { pieceType: "tree", rotation: 1, col: 3 },
        },
        {
            action: "hard_drop",
            clientSequence: 2,
            expectedTransform: { pieceType: "tree", rotation: 1, col: 3 },
        },
    ]);
    assert.equal(inputEvents.some(event => "row" in event.payload.expectedTransform), false);
});

test("Z 입력은 rotate_ccw와 after expectedTransform을 전송한다", async (t) => {
    const { startMultiplayerGame } = await loadSession();
    const session = startMultiplayerGame(createSessionParams());
    t.after(() => cleanupSession(session));

    sharedFakeSocket.emitted = [];
    emitDocumentEvent("keydown", {
        key: "z",
        code: "KeyZ",
        repeat: false,
        preventDefault() {},
    });
    await waitForLocalInputTick();

    const inputEvent = sharedFakeSocket.emitted.find(event => {
        return event.eventName === "game:input";
    });
    assert.deepEqual({
        action: inputEvent.payload.action,
        tick: inputEvent.payload.tick,
        pieceIndex: inputEvent.payload.pieceIndex,
        clientSequence: inputEvent.payload.clientSequence,
        expectedTransform: inputEvent.payload.expectedTransform,
    }, {
        action: "rotate_ccw",
        tick: 1,
        pieceIndex: 1,
        clientSequence: 1,
        expectedTransform: { pieceType: "tree", rotation: 3, col: 3 },
    });
});

test("막힌 soft_drop은 현재 조각 transform을 보내고 고정 유예를 유지한다", async (t) => {
    const { startMultiplayerGame } = await loadSession();
    const session = startMultiplayerGame(createSessionParams());
    t.after(() => cleanupSession(session));

    const snapshot = session.myGame.getSnapshot();
    const pieceIndex = snapshot.pieceIndex;
    session.myGame.applySnapshot({
        ...snapshot,
        board: Array.from({ length: 40 }, () => Array(10).fill(null)),
        activePiece: {
            pieceType: "tree",
            rotation: 0,
            row: 38,
            col: 3,
        },
        pieceQueue: ["square", "bar"],
        phase: "playing",
    }, { resumeGravity: true });
    sharedFakeSocket.emitted = [];

    emitDocumentEvent("keydown", {
        key: "ArrowDown",
        code: "ArrowDown",
        repeat: false,
        preventDefault() {},
    });
    await waitForLocalInputTick();

    const inputEvent = sharedFakeSocket.emitted.find(event => {
        return event.eventName === "game:input";
    });
    assert.deepEqual(inputEvent.payload, {
        roomId: "ABCDEF12",
        action: "soft_drop",
        tick: inputEvent.payload.tick,
        pieceIndex,
        clientSequence: 1,
        expectedTransform: { pieceType: "tree", rotation: 0, col: 3 },
    });
    assert.equal(session.myGame.getSnapshot().activePiece.pieceType, "tree");
    assert.equal("row" in inputEvent.payload.expectedTransform, false);
    assert.equal(
        sharedFakeSocket.emitted.some(event => event.eventName === "game:log:placement_decision"),
        false,
    );
    sharedFakeSocket.emitServer("game:input:result", {
        ok: true,
        reason: null,
        clientSequence: inputEvent.payload.clientSequence,
        pieceIndex,
        placementCommitted: false,
    });
    assert.equal(
        sharedFakeSocket.emitted.filter(event => {
            return event.eventName === "game:log:placement_decision";
        }).length,
        0,
    );
});

test("이동만 한 soft_drop은 authoritative result 후에도 placement 로그를 전송하지 않는다", async (t) => {
    const { startMultiplayerGame } = await loadSession();
    const session = startMultiplayerGame(createSessionParams());
    t.after(() => cleanupSession(session));

    const pieceIndex = session.myGame.runtime.pieceIndex;
    sharedFakeSocket.emitted = [];
    emitDocumentEvent("keydown", {
        key: "ArrowDown",
        code: "ArrowDown",
        repeat: false,
        preventDefault() {},
    });
    await waitForLocalInputTick();
    const inputEvent = sharedFakeSocket.emitted.find(event => {
        return event.eventName === "game:input";
    });
    assert.equal(inputEvent.payload.action, "soft_drop");

    sharedFakeSocket.emitServer("game:input:result", {
        ok: true,
        reason: null,
        clientSequence: inputEvent.payload.clientSequence,
        pieceIndex,
        placementCommitted: false,
    });

    assert.equal(
        sharedFakeSocket.emitted.some(event => event.eventName === "game:log:placement_decision"),
        false,
    );
});

test("더 높은 acknowledgment 뒤 오래된 divergence result는 현재 prediction을 덮지 않는다", async (t) => {
    const { startMultiplayerGame } = await loadSession();
    const session = startMultiplayerGame(createSessionParams());
    t.after(() => cleanupSession(session));

    sharedFakeSocket.emitted = [];
    for (const input of [
        { key: "ArrowLeft", code: "ArrowLeft" },
        { key: "ArrowRight", code: "ArrowRight" },
    ]) {
        emitDocumentEvent("keydown", {
            ...input,
            repeat: false,
            preventDefault() {},
        });
    }
    await waitForLocalInputTick();

    sharedFakeSocket.emitServer("game:input:result", {
        ok: true,
        reason: null,
        clientSequence: 2,
        pieceIndex: session.myGame.runtime.pieceIndex,
    });
    const currentBoard = session.myGame.getSnapshot().board.map(row => [...row]);
    const staleBoard = Array.from({ length: 40 }, () => Array(10).fill(null));
    staleBoard[39][0] = "zee";

    sharedFakeSocket.emitServer("game:input:result", {
        ok: false,
        reason: "PREDICTION_DIVERGED",
        clientSequence: 1,
        pieceIndex: session.myGame.runtime.pieceIndex,
        snapshot: {
            ...session.myGame.getSnapshot(),
            board: staleBoard,
            lastProcessedClientSequence: 1,
        },
    });

    assert.deepEqual(session.myGame.getSnapshot().board, currentBoard);
});

test("PREDICTION_DIVERGED result snapshot은 pending prediction을 버리고 즉시 적용한다", async (t) => {
    const { startMultiplayerGame } = await loadSession();
    const session = startMultiplayerGame(createSessionParams());
    t.after(() => cleanupSession(session));

    sharedFakeSocket.emitted = [];
    emitDocumentEvent("keydown", {
        key: "ArrowLeft",
        code: "ArrowLeft",
        repeat: false,
        preventDefault() {},
    });
    await waitForLocalInputTick();
    const divergedSequence = sharedFakeSocket.emitted.find(event => {
        return event.eventName === "game:input";
    }).payload.clientSequence;

    session.myGame.enqueueInput(
        "move_right",
        session.myGame.runtime.currentTick + 100,
        session.myGame.runtime.pieceIndex,
    );
    assert.equal(session.myGame.getPendingInputCount(), 1);

    const authoritativeBoard = Array.from({ length: 40 }, () => Array(10).fill(null));
    authoritativeBoard[39][8] = "zee";
    const authoritativeSnapshot = createAuthoritativeSnapshot({
        board: authoritativeBoard,
        activePiece: {
            pieceType: "tree",
            rotation: 0,
            row: 21,
            col: 3,
        },
        tick: 20,
        pieceIndex: 1,
        pendingGarbageLines: 3,
        lastProcessedClientSequence: divergedSequence,
    });
    let displayCalls = 0;
    session.myGame.subscribeDisplay(() => {
        displayCalls += 1;
    });

    sharedFakeSocket.emitServer("game:input:result", {
        ok: false,
        reason: "PREDICTION_DIVERGED",
        clientSequence: divergedSequence,
        pieceIndex: 1,
        snapshot: authoritativeSnapshot,
    });

    assert.deepEqual(session.myGame.getSnapshot().board, authoritativeBoard);
    assert.equal(session.myGame.getSnapshot().activePiece.col, 3);
    assert.equal(session.myGame.getPendingInputCount(), 0);
    assert.equal(session.myGame.runtime.gravityRunning, true);
    assert.equal(displayCalls, 1);

    const duplicateBoard = Array.from({ length: 40 }, () => Array(10).fill(null));
    duplicateBoard[39][0] = "bar";
    sharedFakeSocket.emitServer("game:input:result", {
        ok: false,
        reason: "PREDICTION_DIVERGED",
        clientSequence: divergedSequence,
        pieceIndex: 1,
        snapshot: {
            ...authoritativeSnapshot,
            board: duplicateBoard,
        },
    });
    assert.deepEqual(session.myGame.getSnapshot().board, authoritativeBoard);
});

test("gameOver divergence correction은 gravity를 재개하지 않는다", async (t) => {
    const { startMultiplayerGame } = await loadSession();
    const session = startMultiplayerGame(createSessionParams());
    t.after(() => cleanupSession(session));

    sharedFakeSocket.emitted = [];
    emitDocumentEvent("keydown", {
        key: "ArrowLeft",
        code: "ArrowLeft",
        repeat: false,
        preventDefault() {},
    });
    await waitForLocalInputTick();
    const clientSequence = sharedFakeSocket.emitted.find(event => {
        return event.eventName === "game:input";
    }).payload.clientSequence;
    const snapshot = createAuthoritativeSnapshot({
        phase: "gameOver",
        lastProcessedClientSequence: clientSequence,
    });
    sharedFakeSocket.emitServer("game:input:result", {
        ok: false,
        reason: "PREDICTION_DIVERGED",
        clientSequence,
        pieceIndex: 1,
        snapshot,
    });

    assert.equal(session.myGame.getSnapshot().phase, "gameOver");
    assert.equal(session.myGame.runtime.gravityRunning, false);
});

test("local queue가 비어도 server ack 전 stale own snapshot은 prediction을 되감지 않는다", async (t) => {
    const { startMultiplayerGame } = await loadSession();
    const session = startMultiplayerGame(createSessionParams());
    t.after(() => cleanupSession(session));

    sharedFakeSocket.emitted = [];
    emitDocumentEvent("keydown", {
        key: "ArrowLeft",
        code: "ArrowLeft",
        repeat: false,
        preventDefault() {},
    });
    await waitForLocalInputTick();

    const beforePrediction = session.myGame.getSnapshot();
    const predictedBoard = beforePrediction.board.map(row => [...row]);
    predictedBoard[39][0] = "tree";
    session.myGame.applySnapshot({
        ...beforePrediction,
        board: predictedBoard,
        activePiece: {
            ...beforePrediction.activePiece,
            col: beforePrediction.activePiece.col - 1,
        },
        inputQueue: [],
    }, { resumeGravity: true });
    assert.equal(session.myGame.getPendingInputCount(), 0);

    let applySnapshotCallCount = 0;
    const originalApplySnapshot = session.myGame.applySnapshot;
    session.myGame.applySnapshot = (snapshot, options) => {
        applySnapshotCallCount += 1;
        originalApplySnapshot(snapshot, options);
    };

    sharedFakeSocket.emitServer("game:authoritative:snapshot", {
        playerId: "00000000-0000-4000-8000-000000000001",
        snapshot: {
            ...beforePrediction,
            board: beforePrediction.board.map(row => [...row]),
            pendingGarbageLines: 4,
            lastProcessedClientSequence: 0,
        },
    });

    assert.equal(applySnapshotCallCount, 0);
    assert.deepEqual(session.myGame.getSnapshot().board, predictedBoard);
    assert.equal(session.myGame.getSnapshot().activePiece.col, beforePrediction.activePiece.col - 1);
    assert.equal(session.myGame.getSnapshot().pendingGarbageLines, 4);
});

test("최신 ack snapshot은 pending을 해소한 뒤 hidden board를 보정하고 오래된 ack를 버린다", async (t) => {
    const { startMultiplayerGame } = await loadSession();
    const session = startMultiplayerGame(createSessionParams());
    t.after(() => cleanupSession(session));

    sharedFakeSocket.emitted = [];
    emitDocumentEvent("keydown", {
        key: "ArrowLeft",
        code: "ArrowLeft",
        repeat: false,
        preventDefault() {},
    });
    await waitForLocalInputTick();
    const localSnapshot = session.myGame.getSnapshot();
    session.myGame.applySnapshot({
        ...localSnapshot,
        inputQueue: [],
    }, { resumeGravity: true });

    let applySnapshotCallCount = 0;
    const originalApplySnapshot = session.myGame.applySnapshot;
    session.myGame.applySnapshot = (snapshot, options) => {
        applySnapshotCallCount += 1;
        originalApplySnapshot(snapshot, options);
    };

    sharedFakeSocket.emitServer("game:authoritative:snapshot", {
        playerId: "00000000-0000-4000-8000-000000000001",
        snapshot: {
            ...session.myGame.getSnapshot(),
            board: session.myGame.getSnapshot().board.map(row => [...row]),
            lastProcessedClientSequence: 1,
        },
    });
    assert.equal(applySnapshotCallCount, 0);

    sharedFakeSocket.emitted = [];
    emitDocumentEvent("keydown", {
        key: "ArrowRight",
        code: "ArrowRight",
        repeat: false,
        preventDefault() {},
    });
    await waitForLocalInputTick();
    const beforeMismatch = session.myGame.getSnapshot();
    const authoritativeBoard = beforeMismatch.board.map(row => [...row]);
    authoritativeBoard[3][2] = "square";

    sharedFakeSocket.emitServer("game:authoritative:snapshot", {
        playerId: "00000000-0000-4000-8000-000000000001",
        snapshot: {
            ...beforeMismatch,
            board: authoritativeBoard,
            lastProcessedClientSequence: 2,
        },
    });

    assert.equal(applySnapshotCallCount, 1);
    assert.deepEqual(session.myGame.getSnapshot().board, authoritativeBoard);

    const staleBoard = beforeMismatch.board.map(row => [...row]);
    staleBoard[2][3] = "bar";
    sharedFakeSocket.emitServer("game:authoritative:snapshot", {
        playerId: "00000000-0000-4000-8000-000000000001",
        snapshot: {
            ...beforeMismatch,
            board: staleBoard,
            lastProcessedClientSequence: 1,
        },
    });

    assert.equal(applySnapshotCallCount, 1);
    assert.deepEqual(session.myGame.getSnapshot().board, authoritativeBoard);
});

test("최신 ack보다 뒤처진 deferred own snapshot은 폐기하고 다음 snapshot을 기다린다", async (t) => {
    const { startMultiplayerGame } = await loadSession();
    const session = startMultiplayerGame(createSessionParams());
    t.after(() => cleanupSession(session));

    sharedFakeSocket.emitted = [];
    for (const key of ["ArrowLeft", "ArrowRight"]) {
        emitDocumentEvent("keydown", {
            key,
            code: key,
            repeat: false,
            preventDefault() {},
        });
    }
    await waitForLocalInputTick();
    const localSnapshot = session.myGame.getSnapshot();
    session.myGame.applySnapshot({
        ...localSnapshot,
        inputQueue: [],
    }, { resumeGravity: true });

    let applySnapshotCallCount = 0;
    const originalApplySnapshot = session.myGame.applySnapshot;
    session.myGame.applySnapshot = (snapshot, options) => {
        applySnapshotCallCount += 1;
        originalApplySnapshot(snapshot, options);
    };
    const newerBoard = localSnapshot.board.map(row => [...row]);
    newerBoard[39][1] = "square";
    const olderBoard = localSnapshot.board.map(row => [...row]);
    olderBoard[39][2] = "bar";

    sharedFakeSocket.emitServer("game:authoritative:snapshot", {
        playerId: "00000000-0000-4000-8000-000000000001",
        snapshot: {
            ...localSnapshot,
            board: newerBoard,
            lastProcessedClientSequence: 1,
        },
    });
    sharedFakeSocket.emitServer("game:authoritative:snapshot", {
        playerId: "00000000-0000-4000-8000-000000000001",
        snapshot: {
            ...localSnapshot,
            board: olderBoard,
            lastProcessedClientSequence: 0,
        },
    });
    sharedFakeSocket.emitServer("game:input:result", {
        ok: true,
        reason: null,
        clientSequence: 2,
        pieceIndex: localSnapshot.pieceIndex,
    });

    assert.equal(applySnapshotCallCount, 0);
    assert.deepEqual(session.myGame.getSnapshot().board, localSnapshot.board);

    const latestBoard = localSnapshot.board.map(row => [...row]);
    latestBoard[39][3] = "tree";
    sharedFakeSocket.emitServer("game:authoritative:snapshot", {
        playerId: "00000000-0000-4000-8000-000000000001",
        snapshot: {
            ...localSnapshot,
            board: latestBoard,
            lastProcessedClientSequence: 2,
        },
    });

    assert.equal(applySnapshotCallCount, 1);
    assert.deepEqual(session.myGame.getSnapshot().board, latestBoard);
});

test("상대 authoritative snapshot은 full apply 후 line clear presentation을 정확히 1회 재생한다", async (t) => {
    const { startMultiplayerGame } = await loadSession();
    const session = startMultiplayerGame(createSessionParams());
    t.after(() => cleanupSession(session));

    const callOrder = [];
    const presentations = [];
    const originalApplySnapshot = session.opponentGame.applySnapshot;
    session.opponentGame.applySnapshot = (snapshot, options) => {
        callOrder.push("applySnapshot");
        originalApplySnapshot(snapshot, options);
    };
    session.opponentGame.playLineClearPresentation = (effect) => {
        callOrder.push("playLineClearPresentation");
        presentations.push(effect);
        return true;
    };
    const snapshot = createAuthoritativeSnapshot({
        pieceIndex: 8,
        tick: 20,
    });
    const boardBeforeClear = snapshot.board.map(row => [...row]);
    boardBeforeClear[39] = Array(10).fill("bar");
    const presentationEffect = {
        id: "00000000-0000-4000-8000-000000000002:7:line_clear",
        type: "line_clear",
        pieceIndex: 7,
        rows: [39],
        boardBeforeClear,
    };

    sharedFakeSocket.emitServer("game:authoritative:snapshot", {
        playerId: "00000000-0000-4000-8000-000000000002",
        snapshot,
        presentationEffect,
    });
    sharedFakeSocket.emitServer("game:authoritative:snapshot", {
        playerId: "00000000-0000-4000-8000-000000000002",
        snapshot,
        presentationEffect,
    });

    assert.deepEqual(callOrder, [
        "applySnapshot",
        "playLineClearPresentation",
        "applySnapshot",
    ]);
    assert.deepEqual(presentations, [{ rows: [39], board: boardBeforeClear }]);
    assert.deepEqual(session.opponentGame.getSnapshot().board, snapshot.board);
    assert.equal(session.opponentGame.runtime.gravityRunning, false);
});

test("상대 presentation은 오래된 pieceIndex를 거부하고 own player effect를 무시한다", async (t) => {
    const { startMultiplayerGame } = await loadSession();
    const session = startMultiplayerGame(createSessionParams());
    t.after(() => cleanupSession(session));

    let opponentPresentationCount = 0;
    let ownPresentationCount = 0;
    session.opponentGame.playLineClearPresentation = () => {
        opponentPresentationCount += 1;
        return true;
    };
    session.myGame.playLineClearPresentation = () => {
        ownPresentationCount += 1;
        return true;
    };
    const opponentSnapshot = createAuthoritativeSnapshot({ pieceIndex: 10, tick: 30 });
    const boardBeforeClear = opponentSnapshot.board.map(row => [...row]);
    boardBeforeClear[38] = Array(10).fill("square");

    sharedFakeSocket.emitServer("game:authoritative:snapshot", {
        playerId: "00000000-0000-4000-8000-000000000002",
        snapshot: opponentSnapshot,
        presentationEffect: {
            id: "00000000-0000-4000-8000-000000000002:9:line_clear",
            type: "line_clear",
            pieceIndex: 9,
            rows: [38],
            boardBeforeClear,
        },
    });
    sharedFakeSocket.emitServer("game:authoritative:snapshot", {
        playerId: "00000000-0000-4000-8000-000000000002",
        snapshot: opponentSnapshot,
        presentationEffect: {
            id: "00000000-0000-4000-8000-000000000002:8:line_clear",
            type: "line_clear",
            pieceIndex: 8,
            rows: [38],
            boardBeforeClear,
        },
    });
    sharedFakeSocket.emitServer("game:authoritative:snapshot", {
        playerId: "00000000-0000-4000-8000-000000000001",
        snapshot: createAuthoritativeSnapshot({ pieceIndex: 9, tick: 30 }),
        presentationEffect: {
            id: "00000000-0000-4000-8000-000000000001:8:line_clear",
            type: "line_clear",
            pieceIndex: 8,
            rows: [38],
            boardBeforeClear,
        },
    });

    assert.equal(opponentPresentationCount, 1);
    assert.equal(ownPresentationCount, 0);
    assert.equal(session.opponentGame.runtime.gravityRunning, false);
});

test("effect 없는 authoritative snapshot은 presentation 호출 없이 기존처럼 적용한다", async (t) => {
    const { startMultiplayerGame } = await loadSession();
    const session = startMultiplayerGame(createSessionParams());
    t.after(() => cleanupSession(session));

    let presentationCount = 0;
    session.opponentGame.playLineClearPresentation = () => {
        presentationCount += 1;
        return true;
    };
    const snapshot = createAuthoritativeSnapshot({ score: 30, tick: 4 });

    sharedFakeSocket.emitServer("game:authoritative:snapshot", {
        playerId: "00000000-0000-4000-8000-000000000002",
        snapshot,
    });

    assert.equal(presentationCount, 0);
    assert.equal(session.opponentGame.getSnapshot().score, 30);
    assert.equal(session.opponentGame.runtime.gravityRunning, false);
});

test("같은 pieceIndex의 board drift는 A local과 B의 A 보드를 같은 snapshot으로 수렴시킨다", async (t) => {
    const { startMultiplayerGame } = await loadSession();
    const sessionA = startMultiplayerGame(createSessionParams());
    const sessionB = startMultiplayerGame(createSessionParams({
        playerId: "00000000-0000-4000-8000-000000000002",
        opponentPlayerId: "00000000-0000-4000-8000-000000000001",
    }));
    t.after(() => {
        cleanupSession(sessionA);
        cleanupSession(sessionB);
    });

    const localSnapshot = sessionA.myGame.getSnapshot();
    const authoritativeBoard = localSnapshot.board.map(row => [...row]);
    authoritativeBoard[authoritativeBoard.length - 1][4] = "square";
    const authoritativeSnapshot = {
        ...snapshotWithScore(localSnapshot, localSnapshot.score),
        board: authoritativeBoard,
        pendingGarbageLines: localSnapshot.pendingGarbageLines,
    };

    sharedFakeSocket.emitServer("game:authoritative:snapshot", {
        playerId: "00000000-0000-4000-8000-000000000001",
        snapshot: authoritativeSnapshot,
    });

    assert.deepEqual(sessionA.myGame.getSnapshot().board, authoritativeBoard);
    assert.deepEqual(
        sessionA.myGame.getSnapshot().board,
        sessionB.opponentGame.getSnapshot().board,
    );
    assert.equal(sessionA.myGame.runtime.gravityRunning, true);
    assert.equal(sessionB.opponentGame.runtime.gravityRunning, false);
});

test("game:garbage:append listener를 session에 연결하지 않는다", async (t) => {
    const { startMultiplayerGame } = await loadSession();
    const session = startMultiplayerGame(createSessionParams());
    t.after(() => cleanupSession(session));

    assert.equal(sharedFakeSocket.handlers.get("game:garbage:append")?.size ?? 0, 0);
    assert.equal(Object.hasOwn(session, "detachGarbageAppend"), false);
});

test("authoritative snapshot의 pendingGarbageLines가 상대 pending garbage 표시 원천이 된다", async (t) => {
    const { startMultiplayerGame } = await loadSession();
    const params = createSessionParams();
    const session = startMultiplayerGame(params);
    t.after(() => cleanupSession(session));

    const opponentBaseSnapshot = session.opponentGame.getSnapshot();
    let displayCalls = 0;
    session.opponentGame.subscribeDisplay(() => {
        displayCalls += 1;
    });

    sharedFakeSocket.emitServer("game:authoritative:snapshot", {
        playerId: "00000000-0000-4000-8000-000000000002",
        snapshot: {
            ...snapshotWithScore(opponentBaseSnapshot, 20),
            pendingGarbageLines: 3,
        },
    });

    assert.equal(session.opponentGame.getSnapshot().pendingGarbageLines, 3);
    assert.equal(Object.hasOwn(session.opponentGame.getSnapshot(), "pendingGarbageQueue"), false);
    assert.equal(params.opponentPendingGarbageEl.innerText, 3);
    assert.equal(displayCalls, 1);
});

test("내 authoritative snapshot의 pendingGarbageLines는 표시만 갱신하고 activePiece만으로 full correction하지 않는다", async (t) => {
    const { startMultiplayerGame } = await loadSession();
    const params = createSessionParams();
    const session = startMultiplayerGame(params);
    t.after(() => cleanupSession(session));

    const myBaseSnapshot = session.myGame.getSnapshot();
    const displayOnlySnapshot = {
        ...myBaseSnapshot,
        board: myBaseSnapshot.board.map(row => [...row]),
        activePiece: {
            ...myBaseSnapshot.activePiece,
            col: myBaseSnapshot.activePiece.col + 1,
        },
        pieceQueue: [...myBaseSnapshot.pieceQueue],
        pendingGarbageLines: 4,
    };

    sharedFakeSocket.emitServer("game:authoritative:snapshot", {
        playerId: "00000000-0000-4000-8000-000000000001",
        snapshot: displayOnlySnapshot,
    });

    assert.deepEqual(session.myGame.getSnapshot().activePiece, myBaseSnapshot.activePiece);
    assert.equal(session.myGame.getSnapshot().pendingGarbageLines, 4);
    assert.equal(params.myPendingGarbageEl.innerText, 4);
});

test("내 playerId의 authoritative snapshot은 pendingGarbageLines가 증가하면 표시만 갱신한다", async (t) => {
    const { startMultiplayerGame } = await loadSession();
    const session = startMultiplayerGame(createSessionParams());
    t.after(() => cleanupSession(session));

    const myBaseSnapshot = session.myGame.getSnapshot();
    let applySnapshotCallCount = 0;
    const originalApplySnapshot = session.myGame.applySnapshot;
    session.myGame.applySnapshot = (snapshot, options) => {
        applySnapshotCallCount += 1;
        originalApplySnapshot(snapshot, options);
    };
    let displayCalls = 0;
    session.myGame.subscribeDisplay(() => {
        displayCalls += 1;
    });
    const serverSnapshot = {
        ...myBaseSnapshot,
        board: myBaseSnapshot.board.map(row => [...row]),
        activePiece: { ...myBaseSnapshot.activePiece },
        pieceQueue: [...myBaseSnapshot.pieceQueue],
        pendingGarbageLines: 5,
    };

    sharedFakeSocket.emitServer("game:authoritative:snapshot", {
        playerId: "00000000-0000-4000-8000-000000000001",
        snapshot: serverSnapshot,
    });

    assert.equal(applySnapshotCallCount, 0);
    assert.equal(session.myGame.getSnapshot().pendingGarbageLines, 5);
    assert.equal(displayCalls, 1);
});

test("내 playerId의 authoritative snapshot은 pendingGarbageLines가 감소하고 board가 다르면 full apply한다", async (t) => {
    const { startMultiplayerGame } = await loadSession();
    const session = startMultiplayerGame(createSessionParams());
    t.after(() => cleanupSession(session));

    session.myGame.setAuthoritativePendingGarbageLines(4);
    const myBaseSnapshot = session.myGame.getSnapshot();
    const serverBoard = cloneBoardWithGarbageCell(myBaseSnapshot);
    let applySnapshotCallCount = 0;
    const originalApplySnapshot = session.myGame.applySnapshot;
    session.myGame.applySnapshot = (snapshot, options) => {
        applySnapshotCallCount += 1;
        originalApplySnapshot(snapshot, options);
    };
    let displayCalls = 0;
    session.myGame.subscribeDisplay(() => {
        displayCalls += 1;
    });

    sharedFakeSocket.emitServer("game:authoritative:snapshot", {
        playerId: "00000000-0000-4000-8000-000000000001",
        snapshot: {
            ...myBaseSnapshot,
            board: serverBoard,
            activePiece: { ...myBaseSnapshot.activePiece },
            pieceQueue: [...myBaseSnapshot.pieceQueue],
            phase: "playing",
            pendingGarbageLines: 0,
        },
    });

    assert.equal(applySnapshotCallCount, 1);
    assert.deepEqual(session.myGame.getSnapshot().board, serverBoard);
    assert.equal(session.myGame.getSnapshot().pendingGarbageLines, 0);
    assert.equal(session.myGame.runtime.gravityRunning, true);
    assert.equal(displayCalls, 1);
});

test("대기 중인 local input이 있으면 own full correction을 다음 snapshot까지 미룬다", async (t) => {
    const { startMultiplayerGame } = await loadSession();
    const session = startMultiplayerGame(createSessionParams());
    t.after(() => cleanupSession(session));

    const myBaseSnapshot = session.myGame.getSnapshot();
    session.myGame.enqueueInput("move_left", null, myBaseSnapshot.pieceIndex);
    let applySnapshotCallCount = 0;
    const originalApplySnapshot = session.myGame.applySnapshot;
    session.myGame.applySnapshot = (snapshot, options) => {
        applySnapshotCallCount += 1;
        originalApplySnapshot(snapshot, options);
    };

    sharedFakeSocket.emitServer("game:authoritative:snapshot", {
        playerId: "00000000-0000-4000-8000-000000000001",
        snapshot: {
            ...myBaseSnapshot,
            board: cloneBoardWithGarbageCell(myBaseSnapshot),
            pendingGarbageLines: 0,
        },
    });

    assert.equal(applySnapshotCallCount, 0);
    assert.equal(session.myGame.getPendingInputCount(), 1);
});

test("내 playerId의 authoritative snapshot은 pendingGarbageLines가 감소해도 board가 같으면 full apply하지 않는다", async (t) => {
    const { startMultiplayerGame } = await loadSession();
    const session = startMultiplayerGame(createSessionParams());
    t.after(() => cleanupSession(session));

    session.myGame.setAuthoritativePendingGarbageLines(4);
    const myBaseSnapshot = session.myGame.getSnapshot();
    let applySnapshotCallCount = 0;
    const originalApplySnapshot = session.myGame.applySnapshot;
    session.myGame.applySnapshot = (snapshot, options) => {
        applySnapshotCallCount += 1;
        originalApplySnapshot(snapshot, options);
    };

    sharedFakeSocket.emitServer("game:authoritative:snapshot", {
        playerId: "00000000-0000-4000-8000-000000000001",
        snapshot: {
            ...myBaseSnapshot,
            board: myBaseSnapshot.board.map(row => [...row]),
            activePiece: { ...myBaseSnapshot.activePiece },
            pieceQueue: [...myBaseSnapshot.pieceQueue],
            phase: "playing",
            pendingGarbageLines: 0,
        },
    });

    assert.equal(applySnapshotCallCount, 0);
    assert.equal(session.myGame.getSnapshot().pendingGarbageLines, 0);
});

test("내 playerId의 gameOver authoritative snapshot은 myGame에 full apply한다", async (t) => {
    const { startMultiplayerGame } = await loadSession();
    const session = startMultiplayerGame(createSessionParams());
    t.after(() => cleanupSession(session));

    emitDocumentEvent("keydown", {
        key: "ArrowLeft",
        code: "ArrowLeft",
        repeat: false,
        preventDefault() {},
    });

    const myBaseSnapshot = session.myGame.getSnapshot();
    let applySnapshotCallCount = 0;
    const originalApplySnapshot = session.myGame.applySnapshot;
    session.myGame.applySnapshot = (snapshot, options) => {
        applySnapshotCallCount += 1;
        originalApplySnapshot(snapshot, options);
    };
    const serverSnapshot = {
        ...snapshotWithScore(myBaseSnapshot, myBaseSnapshot.score + 40),
        phase: "gameOver",
    };

    sharedFakeSocket.emitServer("game:authoritative:snapshot", {
        playerId: "00000000-0000-4000-8000-000000000001",
        snapshot: serverSnapshot,
    });

    assert.equal(applySnapshotCallCount, 1);
    assert.equal(session.myGame.getSnapshot().phase, "gameOver");
    assert.equal(session.myGame.getSnapshot().score, serverSnapshot.score);
    assert.equal(session.myGame.runtime.gravityRunning, false);
});

test("내 playerId snapshot의 pieceIndex 1 차이는 750ms 유지될 때만 full apply한다", async (t) => {
    const { startMultiplayerGame } = await loadSession();
    const clock = installMonotonicClock(t, 100);
    const session = startMultiplayerGame(createSessionParams());
    t.after(() => cleanupSession(session));

    const myBaseSnapshot = session.myGame.getSnapshot();
    let applySnapshotCallCount = 0;
    const originalApplySnapshot = session.myGame.applySnapshot;
    session.myGame.applySnapshot = (snapshot, options) => {
        applySnapshotCallCount += 1;
        originalApplySnapshot(snapshot, options);
    };

    const serverSnapshot = {
        ...snapshotWithScore(myBaseSnapshot, myBaseSnapshot.score + 40),
        pieceIndex: myBaseSnapshot.pieceIndex + 1,
        phase: "playing",
        pendingGarbageLines: 6,
    };

    sharedFakeSocket.emitServer("game:authoritative:snapshot", {
        playerId: "00000000-0000-4000-8000-000000000001",
        snapshot: serverSnapshot,
    });

    clock.set(849);
    sharedFakeSocket.emitServer("game:authoritative:snapshot", {
        playerId: "00000000-0000-4000-8000-000000000001",
        snapshot: serverSnapshot,
    });

    assert.equal(applySnapshotCallCount, 0);
    assert.equal(session.myGame.getSnapshot().score, myBaseSnapshot.score);
    assert.equal(session.myGame.getSnapshot().pieceIndex, myBaseSnapshot.pieceIndex);
    assert.equal(session.myGame.getSnapshot().pendingGarbageLines, 6);

    clock.set(850);
    sharedFakeSocket.emitServer("game:authoritative:snapshot", {
        playerId: "00000000-0000-4000-8000-000000000001",
        snapshot: serverSnapshot,
    });

    assert.equal(applySnapshotCallCount, 1);
    assert.equal(session.myGame.getSnapshot().score, serverSnapshot.score);
    assert.equal(session.myGame.getSnapshot().pieceIndex, serverSnapshot.pieceIndex);
    assert.equal(session.myGame.runtime.gravityRunning, true);
});

test("내 local phase가 lineClearing이면 앞선 snapshot도 full apply하지 않는다", async (t) => {
    const { startMultiplayerGame } = await loadSession();
    const session = startMultiplayerGame(createSessionParams());
    t.after(() => cleanupSession(session));

    const myBaseSnapshot = session.myGame.getSnapshot();
    session.myGame.applySnapshot({
        ...myBaseSnapshot,
        board: myBaseSnapshot.board.map(row => [...row]),
        activePiece: { ...myBaseSnapshot.activePiece },
        pieceQueue: [...myBaseSnapshot.pieceQueue],
        phase: "lineClearing",
    });
    session.myGame.setAuthoritativePendingGarbageLines(4);

    let applySnapshotCallCount = 0;
    const originalApplySnapshot = session.myGame.applySnapshot;
    session.myGame.applySnapshot = (snapshot, options) => {
        applySnapshotCallCount += 1;
        originalApplySnapshot(snapshot, options);
    };

    sharedFakeSocket.emitServer("game:authoritative:snapshot", {
        playerId: "00000000-0000-4000-8000-000000000001",
        snapshot: {
            ...snapshotWithScore(myBaseSnapshot, myBaseSnapshot.score + 40),
            board: cloneBoardWithGarbageCell(myBaseSnapshot),
            pieceIndex: myBaseSnapshot.pieceIndex + 1,
            phase: "playing",
            pendingGarbageLines: 0,
        },
    });
    sharedFakeSocket.emitServer("game:authoritative:snapshot", {
        playerId: "00000000-0000-4000-8000-000000000001",
        snapshot: {
            ...snapshotWithScore(myBaseSnapshot, myBaseSnapshot.score + 40),
            board: cloneBoardWithGarbageCell(myBaseSnapshot),
            pieceIndex: myBaseSnapshot.pieceIndex + 1,
            phase: "playing",
            pendingGarbageLines: 0,
        },
    });

    assert.equal(applySnapshotCallCount, 0);
    assert.equal(session.myGame.getSnapshot().phase, "lineClearing");
    assert.notEqual(session.myGame.getSnapshot().score, myBaseSnapshot.score + 40);
    assert.equal(session.myGame.getSnapshot().pendingGarbageLines, 0);
});

test("빠른 col 차이 snapshot은 반복되어도 local prediction과 gravity를 유지한다", async (t) => {
    const { startMultiplayerGame } = await loadSession();
    const session = startMultiplayerGame(createSessionParams());
    t.after(() => cleanupSession(session));

    const myBaseSnapshot = session.myGame.getSnapshot();
    session.myGame.applySnapshot({
        ...myBaseSnapshot,
        board: myBaseSnapshot.board.map(row => [...row]),
        activePiece: {
            ...myBaseSnapshot.activePiece,
            col: myBaseSnapshot.activePiece.col + 1,
        },
        pieceQueue: [...myBaseSnapshot.pieceQueue],
    }, { resumeGravity: true });
    const predictedSnapshot = session.myGame.getSnapshot();
    let applySnapshotCallCount = 0;
    const originalApplySnapshot = session.myGame.applySnapshot;
    session.myGame.applySnapshot = (snapshot, options) => {
        applySnapshotCallCount += 1;
        originalApplySnapshot(snapshot, options);
    };
    const serverSnapshot = snapshotWithScore(myBaseSnapshot, myBaseSnapshot.score);

    for (let index = 0; index < 4; index += 1) {
        sharedFakeSocket.emitServer("game:authoritative:snapshot", {
            playerId: "00000000-0000-4000-8000-000000000001",
            snapshot: serverSnapshot,
        });
    }

    assert.equal(applySnapshotCallCount, 0);
    assert.deepEqual(session.myGame.getSnapshot().activePiece, predictedSnapshot.activePiece);
    assert.equal(session.myGame.runtime.gravityRunning, true);
});

test("빠른 rotation 차이 snapshot은 반복되어도 local prediction을 덮지 않는다", async (t) => {
    const { startMultiplayerGame } = await loadSession();
    const session = startMultiplayerGame(createSessionParams());
    t.after(() => cleanupSession(session));

    const myBaseSnapshot = session.myGame.getSnapshot();
    session.myGame.applySnapshot({
        ...myBaseSnapshot,
        activePiece: {
            ...myBaseSnapshot.activePiece,
            rotation: myBaseSnapshot.activePiece.rotation + 1,
        },
    }, { resumeGravity: true });
    const predictedSnapshot = session.myGame.getSnapshot();
    let applySnapshotCallCount = 0;
    const originalApplySnapshot = session.myGame.applySnapshot;
    session.myGame.applySnapshot = (snapshot, options) => {
        applySnapshotCallCount += 1;
        originalApplySnapshot(snapshot, options);
    };
    const serverSnapshot = snapshotWithScore(myBaseSnapshot, myBaseSnapshot.score);

    for (let index = 0; index < 4; index += 1) {
        sharedFakeSocket.emitServer("game:authoritative:snapshot", {
            playerId: "00000000-0000-4000-8000-000000000001",
            snapshot: serverSnapshot,
        });
    }

    assert.equal(applySnapshotCallCount, 0);
    assert.deepEqual(session.myGame.getSnapshot().activePiece, predictedSnapshot.activePiece);
});

test("내 playerId의 activePiece row와 tick만 다른 snapshot은 반복되어도 full apply하지 않는다", async (t) => {
    const { startMultiplayerGame } = await loadSession();
    const session = startMultiplayerGame(createSessionParams());
    t.after(() => cleanupSession(session));

    const myBaseSnapshot = session.myGame.getSnapshot();
    let applySnapshotCallCount = 0;
    const originalApplySnapshot = session.myGame.applySnapshot;
    session.myGame.applySnapshot = (snapshot, options) => {
        applySnapshotCallCount += 1;
        originalApplySnapshot(snapshot, options);
    };
    const rowOnlySnapshot = {
        ...snapshotWithScore(myBaseSnapshot, myBaseSnapshot.score),
        tick: myBaseSnapshot.tick + 100,
        activePiece: {
            ...myBaseSnapshot.activePiece,
            row: myBaseSnapshot.activePiece.row + 2,
        },
    };

    sharedFakeSocket.emitServer("game:authoritative:snapshot", {
        playerId: "00000000-0000-4000-8000-000000000001",
        snapshot: rowOnlySnapshot,
    });
    sharedFakeSocket.emitServer("game:authoritative:snapshot", {
        playerId: "00000000-0000-4000-8000-000000000001",
        snapshot: rowOnlySnapshot,
    });

    assert.equal(applySnapshotCallCount, 0);
    assert.equal(session.myGame.getSnapshot().activePiece.row, myBaseSnapshot.activePiece.row);
});

test("내 playerId와 일치하는 authoritative snapshot은 full apply하지 않는다", async (t) => {
    const { startMultiplayerGame } = await loadSession();
    const session = startMultiplayerGame(createSessionParams());
    t.after(() => cleanupSession(session));

    const myBaseSnapshot = session.myGame.getSnapshot();
    let applySnapshotCallCount = 0;
    const originalApplySnapshot = session.myGame.applySnapshot;
    session.myGame.applySnapshot = (snapshot, options) => {
        applySnapshotCallCount += 1;
        originalApplySnapshot(snapshot, options);
    };

    sharedFakeSocket.emitServer("game:authoritative:snapshot", {
        playerId: "00000000-0000-4000-8000-000000000001",
        snapshot: snapshotWithScore(myBaseSnapshot, myBaseSnapshot.score),
    });

    assert.equal(applySnapshotCallCount, 0);
});

test("전투 표시는 현재 match 결과만 한 번 소비하며 이전·잘못된·disconnect 후 결과를 버린다", async (t) => {
    const { startMultiplayerGame } = await loadSession();
    const seen = [];
    const params = createSessionParams({ onCombatEffect: event => seen.push(event) });
    const gameId = "00000000-0000-4000-8000-000000000003";
    params.match.gameId = gameId;
    params.match.players.forEach(player => { player.snapshot = createAuthoritativeSnapshot({ pieceIndex: 10 }); });
    const session = startMultiplayerGame(params);
    t.after(() => cleanupSession(session));
    const emit = (index, actor = params.opponentPlayerId, overrides = {}, roomId = params.roomId) => {
        sharedFakeSocket.emitServer("game:authoritative:snapshot", {
            gameId, roomId, playerId: actor, snapshot: createAuthoritativeSnapshot({ pieceIndex: index + 1 }),
            combatEffect: {
                id: `${gameId}:${actor}:${index}:combat`, gameId, pieceIndex: index,
                targetPlayerId: actor === params.playerId ? params.opponentPlayerId : params.playerId,
                sentLines: 2, canceledLines: 0, appliedLines: 0,
                linesCleared: 2, isTSpin: false, tSpinType: "none", combo: 0, backToBackBonus: false,
                ...overrides,
            },
        });
    };
    emit(9);
    emit(10);
    emit(10);
    emit(10, params.playerId);
    assert.deepEqual(seen.map(event => event.playerId), [params.opponentPlayerId, params.playerId]);
    emit(11, params.opponentPlayerId, { gameId: "00000000-0000-4000-8000-000000000004" });
    emit(11, params.opponentPlayerId, { id: "wrong-id" });
    emit(11, params.opponentPlayerId, { targetPlayerId: params.opponentPlayerId });
    emit(11, params.opponentPlayerId, {}, "ABCDEF13");
    emit(11, params.opponentPlayerId, { sentLines: -1 });
    assert.equal(seen.length, 2);
    sharedFakeSocket.emitServer("game:authoritative:snapshot", {
        gameId, playerId: params.opponentPlayerId, snapshot: createAuthoritativeSnapshot({ pieceIndex: 15 }),
    });
    emit(12);
    assert.equal(seen.length, 2);
    emit(15, params.opponentPlayerId, { sentLines: 0, targetPlayerId: null, appliedLines: 3, linesCleared: 0 });
    assert.equal(seen.at(-1).effect.appliedLines, 3);
    assert.equal(seen.length, 3);
    sharedFakeSocket.emitServer("disconnect", "transport close");
    emit(16);
    assert.equal(seen.length, 3);
});

test("서버 playing은 같은 board·pieceIndex에서도 잘못된 로컬 gameOver를 복구하고 hidden cell을 동기화한다", async t => {
    const { startMultiplayerGame } = await loadSession();
    const params = createSessionParams();
    params.match.gameId = "00000000-0000-4000-8000-000000000003";
    const session = startMultiplayerGame(params);
    t.after(() => cleanupSession(session));
    const playing = createAuthoritativeSnapshot({ pieceIndex: session.myGame.runtime.pieceIndex, tick: 100 });
    session.myGame.applySnapshot({ ...playing, phase: "gameOver" });
    assert.equal(session.myGame.getSnapshot().phase, "gameOver");
    sharedFakeSocket.emitServer("game:authoritative:snapshot", {
        gameId: params.match.gameId, roomId: params.roomId, playerId: params.playerId, snapshot: playing,
    });
    assert.equal(session.myGame.getSnapshot().phase, "playing");
    assert.equal(session.myGame.runtime.gravityRunning, true);
    const hidden = structuredClone(playing);
    hidden.tick++;
    hidden.board[3][0] = "bar";
    sharedFakeSocket.emitServer("game:authoritative:snapshot", {
        gameId: params.match.gameId, roomId: params.roomId, playerId: params.playerId, snapshot: hidden,
    });
    assert.equal(session.myGame.getSnapshot().board[3][0], "bar");
    sharedFakeSocket.emitServer("game:authoritative:snapshot", {
        gameId: params.match.gameId, roomId: params.roomId, playerId: params.opponentPlayerId, snapshot: hidden,
    });
    assert.equal(session.opponentGame.getSnapshot().board[3][0], "bar");
});

test("같은 room의 이전 경기 snapshot·ack는 현재 경기와 입력을 되감지 않는다", async t => {
    const { startMultiplayerGame } = await loadSession();
    const params = createSessionParams();
    params.match.gameId = "00000000-0000-4000-8000-000000000003";
    const session = startMultiplayerGame(params);
    t.after(() => cleanupSession(session));
    const before = session.myGame.getSnapshot();
    const previousGameId = "00000000-0000-4000-8000-000000000004";
    sharedFakeSocket.emitServer("game:authoritative:snapshot", {
        gameId: previousGameId, roomId: params.roomId, playerId: params.playerId,
        snapshot: createAuthoritativeSnapshot({ phase: "gameOver", gameOver: true, pieceIndex: 99, tick: 999 }),
    });
    sharedFakeSocket.emitServer("game:input:result", {
        gameId: previousGameId, ok: false, reason: "PREDICTION_DIVERGED", clientSequence: 1,
        snapshot: createAuthoritativeSnapshot({ phase: "gameOver", gameOver: true, pieceIndex: 99, tick: 999 }),
    });
    assert.deepEqual(session.myGame.getSnapshot(), before);
});
