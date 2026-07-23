/**
 * PVE E2E 테스트의 방 생성·경기 시작·서버 snapshot 관찰 흐름을 모은 도우미다.
 *
 * 화면만 보고 AI 행동을 추측하지 않고 production Socket.IO frame을 기록한 뒤,
 * 조각의 좌표와 pieceIndex 변화를 행동으로 해석한다. monitor를 만든 테스트는
 * finally에서 dispose해 다음 테스트에 WebSocket listener가 남지 않게 해야 한다.
 */
const { expect } = require("@playwright/test");
const {
    MULTI_GAME_URL,
    MULTI_LOBBY_URL,
} = require("./multiplayer.js");

const GAME_JOIN_RESULT_EVENT = "game:join:result";
const AUTHORITATIVE_SNAPSHOT_EVENT = "game:authoritative:snapshot";
const MATCH_FINISH_EVENT = "match:finish";

function parseSocketIoFrame(payload) {
    const frame = typeof payload === "string"
        ? payload
        : Buffer.isBuffer(payload)
            ? payload.toString("utf8")
            : "";
    const jsonStart = frame.indexOf("[");
    if (jsonStart === -1) return null;

    try {
        const parsed = JSON.parse(frame.slice(jsonStart));
        return Array.isArray(parsed) ? parsed : null;
    } catch {
        return null;
    }
}

function createBoardFingerprint(board) {
    if (!Array.isArray(board)) return null;
    return board.flat().map(cell => cell || "empty").join("|");
}

/**
 * PVE production Socket.IO frame에서 join 문맥과 authoritative snapshot을 기록한다.
 *
 * @param {import("@playwright/test").Page} page - PVE 브라우저 페이지
 * @returns {Object} 관찰 결과 조회와 listener 정리 API
 */
function createPveSocketMonitor(page) {
    const snapshots = [];
    const joinResults = [];
    const matchFinishes = [];
    const socketListeners = new Map();
    let sequence = 0;

    const onWebSocket = (webSocket) => {
        const onFrameReceived = ({ payload }) => {
            const parsed = parseSocketIoFrame(payload);
            if (!parsed) return;

            const [eventName, eventPayload] = parsed;
            sequence += 1;

            if (eventName === GAME_JOIN_RESULT_EVENT && eventPayload?.ok) {
                joinResults.push({ sequence, payload: eventPayload });
                return;
            }

            if (eventName === AUTHORITATIVE_SNAPSHOT_EVENT) {
                const snapshot = eventPayload?.snapshot;
                if (!eventPayload?.playerId || !Array.isArray(snapshot?.board)) return;

                snapshots.push({
                    sequence,
                    playerId: eventPayload.playerId,
                    tick: snapshot.tick,
                    pieceIndex: snapshot.pieceIndex,
                    board: snapshot.board.map(row => [...row]),
                    activePiece: snapshot.activePiece
                        ? { ...snapshot.activePiece }
                        : null,
                    holdPieceType: snapshot.holdPieceType,
                    holdUsedThisDrop: snapshot.holdUsedThisDrop,
                    score: snapshot.score,
                    lines: snapshot.lines,
                    backToBack: snapshot.backToBack,
                    boardFingerprint: createBoardFingerprint(snapshot.board),
                    occupiedCellCount: snapshot.board
                        .flat()
                        .filter(cell => cell !== null).length,
                    pendingGarbageLines: snapshot.pendingGarbageLines,
                });
                if (snapshots.length > 500) snapshots.shift();
                return;
            }

            if (eventName === MATCH_FINISH_EVENT) {
                matchFinishes.push({ sequence, payload: eventPayload });
            }
        };

        socketListeners.set(webSocket, onFrameReceived);
        webSocket.on("framereceived", onFrameReceived);
    };

    page.on("websocket", onWebSocket);

    return {
        getLatestJoinResult() {
            return joinResults.at(-1)?.payload || null;
        },
        getInitialSnapshot(playerId) {
            const joinResult = joinResults.at(-1)?.payload;
            const player = joinResult?.match?.players?.find(matchPlayer => {
                return matchPlayer.playerId === playerId;
            });
            return player?.snapshot || snapshots.find(snapshot => {
                return snapshot.playerId === playerId;
            }) || null;
        },
        getPlayerId(playerType) {
            const joinResult = joinResults.at(-1)?.payload;
            const player = joinResult?.match?.players?.find(matchPlayer => {
                return matchPlayer.playerType === playerType;
            });
            return player?.playerId || null;
        },
        getSnapshots(playerId) {
            return snapshots.filter(snapshot => snapshot.playerId === playerId);
        },
        getObservedPlayerIds() {
            return [...new Set(snapshots.map(snapshot => snapshot.playerId))];
        },
        getMatchFinishes() {
            return [...matchFinishes];
        },
        dispose() {
            page.off("websocket", onWebSocket);
            socketListeners.forEach((listener, webSocket) => {
                webSocket.off("framereceived", listener);
            });
            socketListeners.clear();
        },
    };
}

async function createPveRoom(page, difficulty) {
    await page.goto("/pages/multiLobby.html");
    await page.locator("#btnOpenCreateRoom").click();
    await page.locator("#btnOpenPveCreate").click();

    const difficultyInput = page.locator(
        `#aiDifficultySelector input[value="${difficulty}"]`,
    );
    await difficultyInput.check();
    await expect(difficultyInput).toBeChecked();
    await page.locator("#btnCreatePveRoom").click();

    await expect(page.locator("#roomStatus")).toBeVisible();
    await expect(page.locator("#roomStateText")).toHaveText("waiting");
    await expect(page.locator("#roomPlayerCountText")).toHaveText("2");
    await expect(page.locator("#primaryActionDesc")).toContainText("휴리스틱 AI 상대");
    await expect(page.locator("#btnPrimaryAction")).toBeEnabled();

    const roomId = (await page.locator("#roomCodeText").textContent())?.trim();
    expect(roomId).toBeTruthy();
    return roomId;
}

async function startPveMatch(page) {
    await Promise.all([
        page.waitForURL(MULTI_GAME_URL),
        page.locator("#btnPrimaryAction").click(),
    ]);

    await expect(page.locator('.next-preview[data-player="1"] .next-cell')).toHaveCount(32);
    await expect(page.locator("#player2Name")).toHaveText("Heuristic AI");
    await expect(page.locator("#player1RoleBadge")).toHaveText("내 보드");
    await expect(page.locator("#player2RoleBadge")).toHaveText("AI 상대 · 휴리스틱");
}

async function hardDropHumanUntilResult(page, maxDrops = 30) {
    const lobbyButton = page.locator(
        '.game-text[data-player="1"] .match-lobby-btn',
    );
    let dropCount = 0;

    await expect.poll(async () => {
        if (await lobbyButton.isVisible()) return true;
        if (dropCount >= maxDrops) return false;

        await page.keyboard.press("Space");
        dropCount += 1;
        return lobbyButton.isVisible();
    }, {
        timeout: 15_000,
        intervals: [100, 120, 150],
    }).toBe(true);

    return dropCount;
}

async function returnPveMatchToLobby(page) {
    const lobbyButton = page.locator(
        '.game-text[data-player="1"] .match-lobby-btn',
    );

    await Promise.all([
        page.waitForURL(MULTI_LOBBY_URL),
        lobbyButton.click(),
    ]);

    await expect(page.locator("#roomStateText")).toHaveText("waiting");
    await expect(page.locator("#roomPlayerCountText")).toHaveText("2");
    await expect(page.locator("#btnPrimaryAction")).toBeEnabled();
}

module.exports = {
    createPveRoom,
    createPveSocketMonitor,
    hardDropHumanUntilResult,
    returnPveMatchToLobby,
    startPveMatch,
};
