const test = require("node:test");
const assert = require("node:assert/strict");

class FakeSocket {
    constructor() {
        this.handlers = new Map();
        this.emitted = [];
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

    emitServer(eventName, payload) {
        this.handlers.get(eventName)?.forEach(handler => {
            handler(payload);
        });
    }
}

const sharedFakeSocket = new FakeSocket();

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
        stroke() {},
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
    return import("../src/client/game/entry/multiplayerGameSession.js");
}

function createSessionParams() {
    return {
        roomId: "room-1",
        playerId: "player-me",
        opponentPlayerId: "player-opponent",
        match: {
            createdAt: 1,
            players: [
                { playerId: "player-me", bagChunks: [["tree", "bar", "square", "zee", "eleft", "eright", "ess"]] },
                { playerId: "player-opponent", bagChunks: [["tree", "bar", "square", "zee", "eleft", "eright", "ess"]] },
            ],
        },
        myCanvas: createFakeCanvas(),
        opponentCanvas: createFakeCanvas(),
        myNextPreviewEl: createFakeElement(),
        myHoldPreviewEl: createFakeElement(),
        myScoreEl: createFakeElement(),
        myLinesEl: createFakeElement(),
        myPendingGarbageEl: createFakeElement(),
        myGarbageLogEl: createFakeElement(),
        opponentNextPreviewEl: createFakeElement(),
        opponentHoldPreviewEl: createFakeElement(),
        opponentScoreEl: createFakeElement(),
        opponentLinesEl: createFakeElement(),
        opponentPendingGarbageEl: createFakeElement(),
        opponentGarbageLogEl: createFakeElement(),
    };
}

function cleanupSession(session) {
    clearInterval(session.heartbeatTimer ?? session.snapshotTimer);
    session.detachAuthoritativeSnapshot?.();
    session.detachGameInputResult?.();
    session.detachGameBagAppend?.();
    session.detachGameBagResult?.();
    session.myGame.destroy();
    session.opponentGame.destroy();
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
    board[board.length - 1][0] = "garbage";
    return board;
}

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

test("내 키보드 입력은 game:input으로 서버에 전송된다", async (t) => {
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

    const inputEvent = sharedFakeSocket.emitted.find(event => {
        return event.eventName === "game:input";
    });

    assert.equal(inputEvent.payload.roomId, "room-1");
    assert.equal(inputEvent.payload.playerId, "player-me");
    assert.equal(inputEvent.payload.action, "move_left");
    assert.equal(Number.isInteger(inputEvent.payload.tick), true);
    assert.equal(Number.isInteger(inputEvent.payload.pieceIndex), true);
});

test("legacy game:snapshot은 상대 보드를 덮지 않고 authoritative snapshot만 적용된다", async (t) => {
    const { startMultiplayerGame } = await loadSession();
    const session = startMultiplayerGame(createSessionParams());
    t.after(() => cleanupSession(session));

    const opponentBaseSnapshot = session.opponentGame.getSnapshot();

    sharedFakeSocket.emitServer("game:snapshot", {
        playerId: "player-opponent",
        snapshot: snapshotWithScore(opponentBaseSnapshot, 10),
    });

    assert.equal(session.opponentGame.getSnapshot().score, opponentBaseSnapshot.score);

    sharedFakeSocket.emitServer("game:authoritative:snapshot", {
        playerId: "player-opponent",
        snapshot: snapshotWithScore(opponentBaseSnapshot, 20),
    });

    assert.equal(session.opponentGame.getSnapshot().score, 20);

    sharedFakeSocket.emitServer("game:snapshot", {
        playerId: "player-opponent",
        snapshot: snapshotWithScore(session.opponentGame.getSnapshot(), 30),
    });

    assert.equal(session.opponentGame.getSnapshot().score, 20);
});

test("상대 game:input relay 수신은 opponentGame 상태를 바꾸지 않는다", async (t) => {
    const { startMultiplayerGame } = await loadSession();
    const session = startMultiplayerGame(createSessionParams());
    t.after(() => cleanupSession(session));

    const opponentBaseSnapshot = session.opponentGame.getSnapshot();
    let enqueueInputCallCount = 0;
    session.opponentGame.enqueueInput = () => {
        enqueueInputCallCount += 1;
        return null;
    };

    sharedFakeSocket.emitServer("game:input", {
        playerId: "player-opponent",
        action: "move_left",
        tick: opponentBaseSnapshot.tick + 1,
        pieceIndex: opponentBaseSnapshot.pieceIndex,
    });

    const opponentSnapshot = session.opponentGame.getSnapshot();

    assert.equal(enqueueInputCallCount, 0);
    assert.deepEqual(opponentSnapshot.inputQueue, opponentBaseSnapshot.inputQueue);
    assert.deepEqual(opponentSnapshot.activePiece, opponentBaseSnapshot.activePiece);
    assert.equal(opponentSnapshot.score, opponentBaseSnapshot.score);
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

    sharedFakeSocket.emitServer("game:authoritative:snapshot", {
        playerId: "player-opponent",
        snapshot: {
            ...snapshotWithScore(opponentBaseSnapshot, 20),
            pendingGarbageLines: 3,
        },
    });

    assert.equal(session.opponentGame.getSnapshot().pendingGarbageLines, 3);
    assert.equal(Object.hasOwn(session.opponentGame.getSnapshot(), "pendingGarbageQueue"), false);
    assert.equal(params.opponentPendingGarbageEl.innerText, 3);
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
        playerId: "player-me",
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
    session.myGame.applySnapshot = (snapshot) => {
        applySnapshotCallCount += 1;
        originalApplySnapshot(snapshot);
    };
    const serverSnapshot = {
        ...myBaseSnapshot,
        board: myBaseSnapshot.board.map(row => [...row]),
        activePiece: { ...myBaseSnapshot.activePiece },
        pieceQueue: [...myBaseSnapshot.pieceQueue],
        pendingGarbageLines: 5,
    };

    sharedFakeSocket.emitServer("game:authoritative:snapshot", {
        playerId: "player-me",
        snapshot: serverSnapshot,
    });

    assert.equal(applySnapshotCallCount, 0);
    assert.equal(session.myGame.getSnapshot().pendingGarbageLines, 5);
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
    session.myGame.applySnapshot = (snapshot) => {
        applySnapshotCallCount += 1;
        originalApplySnapshot(snapshot);
    };

    sharedFakeSocket.emitServer("game:authoritative:snapshot", {
        playerId: "player-me",
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
});

test("내 playerId의 authoritative snapshot은 pendingGarbageLines가 감소해도 board가 같으면 full apply하지 않는다", async (t) => {
    const { startMultiplayerGame } = await loadSession();
    const session = startMultiplayerGame(createSessionParams());
    t.after(() => cleanupSession(session));

    session.myGame.setAuthoritativePendingGarbageLines(4);
    const myBaseSnapshot = session.myGame.getSnapshot();
    let applySnapshotCallCount = 0;
    const originalApplySnapshot = session.myGame.applySnapshot;
    session.myGame.applySnapshot = (snapshot) => {
        applySnapshotCallCount += 1;
        originalApplySnapshot(snapshot);
    };

    sharedFakeSocket.emitServer("game:authoritative:snapshot", {
        playerId: "player-me",
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

    const myBaseSnapshot = session.myGame.getSnapshot();
    let applySnapshotCallCount = 0;
    const originalApplySnapshot = session.myGame.applySnapshot;
    session.myGame.applySnapshot = (snapshot) => {
        applySnapshotCallCount += 1;
        originalApplySnapshot(snapshot);
    };
    const serverSnapshot = {
        ...snapshotWithScore(myBaseSnapshot, myBaseSnapshot.score + 40),
        phase: "gameOver",
    };

    sharedFakeSocket.emitServer("game:authoritative:snapshot", {
        playerId: "player-me",
        snapshot: serverSnapshot,
    });

    assert.equal(applySnapshotCallCount, 1);
    assert.equal(session.myGame.getSnapshot().phase, "gameOver");
    assert.equal(session.myGame.getSnapshot().score, serverSnapshot.score);
});

test("내 playerId snapshot이 local보다 앞서도 gameOver가 아니면 full apply하지 않는다", async (t) => {
    const { startMultiplayerGame } = await loadSession();
    const session = startMultiplayerGame(createSessionParams());
    t.after(() => cleanupSession(session));

    const myBaseSnapshot = session.myGame.getSnapshot();
    let applySnapshotCallCount = 0;
    const originalApplySnapshot = session.myGame.applySnapshot;
    session.myGame.applySnapshot = (snapshot) => {
        applySnapshotCallCount += 1;
        originalApplySnapshot(snapshot);
    };

    sharedFakeSocket.emitServer("game:authoritative:snapshot", {
        playerId: "player-me",
        snapshot: {
            ...snapshotWithScore(myBaseSnapshot, myBaseSnapshot.score + 40),
            pieceIndex: myBaseSnapshot.pieceIndex + 1,
            phase: "playing",
            pendingGarbageLines: 6,
        },
    });

    assert.equal(applySnapshotCallCount, 0);
    assert.equal(session.myGame.getSnapshot().score, myBaseSnapshot.score);
    assert.equal(session.myGame.getSnapshot().pieceIndex, myBaseSnapshot.pieceIndex);
    assert.equal(session.myGame.getSnapshot().pendingGarbageLines, 6);
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
    session.myGame.applySnapshot = (snapshot) => {
        applySnapshotCallCount += 1;
        originalApplySnapshot(snapshot);
    };

    sharedFakeSocket.emitServer("game:authoritative:snapshot", {
        playerId: "player-me",
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

test("내 playerId의 authoritative snapshot은 activePiece만 다르면 myGame에 적용하지 않는다", async (t) => {
    const { startMultiplayerGame } = await loadSession();
    const session = startMultiplayerGame(createSessionParams());
    t.after(() => cleanupSession(session));

    const myBaseSnapshot = session.myGame.getSnapshot();
    const activePieceOnlySnapshot = {
        ...myBaseSnapshot,
        board: myBaseSnapshot.board.map(row => [...row]),
        activePiece: {
            ...myBaseSnapshot.activePiece,
            col: myBaseSnapshot.activePiece.col + 1,
        },
        pieceQueue: [...myBaseSnapshot.pieceQueue],
    };

    sharedFakeSocket.emitServer("game:authoritative:snapshot", {
        playerId: "player-me",
        snapshot: activePieceOnlySnapshot,
    });

    assert.deepEqual(session.myGame.getSnapshot().activePiece, myBaseSnapshot.activePiece);
});
