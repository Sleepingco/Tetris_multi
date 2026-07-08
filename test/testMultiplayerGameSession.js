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
    globalThis.document = {
        addEventListener() {},
        removeEventListener() {},
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
    clearInterval(session.snapshotTimer);
    session.detachSnapshotResult();
    session.detachReceiveSnapshot();
    session.detachAuthoritativeSnapshot();
    session.detachGameOverResult();
    session.detachGameInput();
    session.detachGameInputResult();
    session.detachGarbageAppend();
    session.detachGarbageResult();
    session.detachGameBagAppend();
    session.detachGameBagResult();
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

test("상대 authoritative snapshot을 받은 뒤에는 relayed snapshot이 상대 보드를 덮지 않는다", async (t) => {
    const { startMultiplayerGame } = await loadSession();
    const session = startMultiplayerGame(createSessionParams());
    t.after(() => cleanupSession(session));

    const opponentBaseSnapshot = session.opponentGame.getSnapshot();

    sharedFakeSocket.emitServer("game:snapshot", {
        playerId: "player-opponent",
        snapshot: snapshotWithScore(opponentBaseSnapshot, 10),
    });

    assert.equal(session.opponentGame.getSnapshot().score, 10);

    sharedFakeSocket.emitServer("game:authoritative:snapshot", {
        playerId: "player-opponent",
        snapshot: snapshotWithScore(session.opponentGame.getSnapshot(), 20),
    });

    assert.equal(session.opponentGame.getSnapshot().score, 20);

    sharedFakeSocket.emitServer("game:snapshot", {
        playerId: "player-opponent",
        snapshot: snapshotWithScore(session.opponentGame.getSnapshot(), 30),
    });

    assert.equal(session.opponentGame.getSnapshot().score, 20);
});

test("내 playerId의 authoritative snapshot은 myGame에 적용하지 않는다", async (t) => {
    const { startMultiplayerGame } = await loadSession();
    const session = startMultiplayerGame(createSessionParams());
    t.after(() => cleanupSession(session));

    const myBaseSnapshot = session.myGame.getSnapshot();

    sharedFakeSocket.emitServer("game:authoritative:snapshot", {
        playerId: "player-me",
        snapshot: snapshotWithScore(myBaseSnapshot, 40),
    });

    assert.notEqual(session.myGame.getSnapshot().score, 40);
    assert.notEqual(session.opponentGame.getSnapshot().score, 40);
});
