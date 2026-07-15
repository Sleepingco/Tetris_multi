const { expect } = require("@playwright/test");

const GAME_READY_SELECTOR = '.next-preview[data-player="1"] .next-cell';
const MULTI_GAME_URL = /\/pages\/tetrisMulti\.html\?roomId=[^&]+$/;
const MULTI_LOBBY_URL = /\/pages\/multiLobby\.html$/;
const AUTHORITATIVE_SNAPSHOT_EVENT = "game:authoritative:snapshot";

function getBoardCanvasSelector(playerNumber) {
    return `.playground[data-player="${playerNumber}"] .tetrisBoardCanvas`;
}

async function createPlayerPages(browser) {
    const hostContext = await browser.newContext();
    const guestContext = await browser.newContext();
    const hostPage = await hostContext.newPage();
    const guestPage = await guestContext.newPage();

    return {
        hostContext,
        guestContext,
        hostPage,
        guestPage,
        async close() {
            await Promise.allSettled([
                hostContext.close(),
                guestContext.close(),
            ]);
        },
    };
}

/**
 * 두 브라우저를 로비에 진입시키고 Host가 만든 PVP 방에 Guest를 참가시킨다.
 *
 * @param {import("@playwright/test").Page} hostPage - Host 브라우저 페이지
 * @param {import("@playwright/test").Page} guestPage - Guest 브라우저 페이지
 * @returns {Promise<string>} 생성된 room id
 */
async function createWaitingRoom(hostPage, guestPage) {
    await Promise.all([
        hostPage.goto("/pages/multiLobby.html"),
        guestPage.goto("/pages/multiLobby.html"),
    ]);

    await hostPage.locator("#btnOpenCreateRoom").click();
    await hostPage.locator("#btnCreateRoom").click();
    await expect(hostPage.locator("#roomStatus")).toBeVisible();

    const roomId = (await hostPage.locator("#roomCodeText").textContent())?.trim();
    expect(roomId).toBeTruthy();
    expect(roomId).not.toBe("-");

    await guestPage.locator("#roomCodeInput").fill(roomId);
    await guestPage.locator("#btnJoinCode").click();

    await expect(hostPage.locator("#roomPlayerCountText")).toHaveText("2");
    await expect(guestPage.locator("#roomPlayerCountText")).toHaveText("2");

    return roomId;
}

/**
 * 대기 중인 2인 방을 Host가 시작하고 양쪽 runtime 준비를 기다린다.
 *
 * @param {import("@playwright/test").Page} hostPage - Host 브라우저 페이지
 * @param {import("@playwright/test").Page} guestPage - Guest 브라우저 페이지
 * @returns {Promise<void>}
 */
async function startWaitingMatch(hostPage, guestPage) {
    await expect(hostPage.locator("#btnPrimaryAction")).toBeEnabled();
    await expect(guestPage.locator("#btnPrimaryAction")).toBeDisabled();

    await Promise.all([
        hostPage.waitForURL(MULTI_GAME_URL),
        guestPage.waitForURL(MULTI_GAME_URL),
        hostPage.locator("#btnPrimaryAction").click(),
    ]);

    await expect(hostPage.locator(GAME_READY_SELECTOR)).toHaveCount(32);
    await expect(guestPage.locator(GAME_READY_SELECTOR)).toHaveCount(32);
}

async function enterTwoPlayerMatch(hostPage, guestPage) {
    const roomId = await createWaitingRoom(hostPage, guestPage);
    await startWaitingMatch(hostPage, guestPage);
    return roomId;
}

/**
 * 지정한 Canvas 하단에서 고정 블록의 cell 상태와 색상 fingerprint를 읽는다.
 * - 셀 중앙의 불투명 픽셀만 사용해 반투명 ghost piece를 제외한다.
 *
 * @param {import("@playwright/test").Page} page - fingerprint를 읽을 브라우저 페이지
 * @param {number} playerNumber - 화면에서 읽을 player column 번호
 * @param {number} bottomRows - 아래에서부터 읽을 행 수
 * @returns {Promise<{bottomRows: number, fingerprint: string, occupiedCellCount: number, cells: Array<Object>}>}
 */
async function readBottomBoardState(page, playerNumber, bottomRows = 6) {
    const selector = getBoardCanvasSelector(playerNumber);

    return page.locator(selector).evaluate((canvas, rowsToRead) => {
        const context = canvas.getContext("2d");
        const cols = 10;
        const rows = 20;
        const cellWidth = canvas.width / cols;
        const cellHeight = canvas.height / rows;
        const cells = [];
        let occupiedCellCount = 0;

        for (let row = rows - rowsToRead; row < rows; row += 1) {
            for (let col = 0; col < cols; col += 1) {
                const x = Math.floor((col + 0.5) * cellWidth);
                const y = Math.floor((row + 0.5) * cellHeight);
                const [red, green, blue, alpha] = context.getImageData(x, y, 1, 1).data;

                const color = alpha >= 240
                    ? `${red}:${green}:${blue}`
                    : "empty";
                if (color !== "empty") occupiedCellCount += 1;
                cells.push({ row, col, color });
            }
        }

        return {
            bottomRows: rowsToRead,
            fingerprint: cells.map(cell => cell.color).join("|"),
            occupiedCellCount,
            cells,
        };
    }, bottomRows);
}

async function readBottomBoardFingerprint(page, playerNumber, bottomRows = 6) {
    const state = await readBottomBoardState(page, playerNumber, bottomRows);
    return state.fingerprint;
}

async function waitForBoardConvergence({
    sourcePage,
    observerPage,
    playerNumber,
    previousFingerprint,
    bottomRows = 6,
}) {
    await expect.poll(async () => {
        const [sourceBoard, observerBoard] = await Promise.all([
            readBottomBoardFingerprint(sourcePage, playerNumber, bottomRows),
            readBottomBoardFingerprint(observerPage, playerNumber, bottomRows),
        ]);

        return sourceBoard !== previousFingerprint && sourceBoard === observerBoard;
    }, {
        timeout: 8_000,
    }).toBe(true);

    return readBottomBoardFingerprint(sourcePage, playerNumber, bottomRows);
}

function parseAuthoritativeSnapshotFrame(payload) {
    const frame = typeof payload === "string"
        ? payload
        : Buffer.isBuffer(payload)
            ? payload.toString("utf8")
            : "";
    const jsonStart = frame.indexOf("[");
    if (jsonStart === -1) return null;

    try {
        const [eventName, eventPayload] = JSON.parse(frame.slice(jsonStart));
        if (eventName !== AUTHORITATIVE_SNAPSHOT_EVENT) return null;

        const snapshot = eventPayload?.snapshot;
        if (!eventPayload?.playerId || !Array.isArray(snapshot?.board)) return null;

        return {
            playerId: eventPayload.playerId,
            tick: snapshot.tick,
            pieceIndex: snapshot.pieceIndex,
            lastProcessedClientSequence: snapshot.lastProcessedClientSequence,
            boardFingerprint: snapshot.board
                .flat()
                .map(cell => cell || "empty")
                .join("|"),
        };
    } catch {
        return null;
    }
}

/**
 * production Socket.IO WebSocket frame에서 authoritative snapshot metadata를 관찰한다.
 * production 코드나 브라우저 전역 상태를 추가하지 않고 tick 진행만 기록한다.
 *
 * @param {import("@playwright/test").Page} page - 관찰할 브라우저 페이지
 * @returns {Object} snapshot 조회와 listener 정리 API
 */
function createAuthoritativeSnapshotMonitor(page) {
    const events = [];
    const socketListeners = new Map();

    const onWebSocket = (webSocket) => {
        const onFrameReceived = ({ payload }) => {
            const snapshotEvent = parseAuthoritativeSnapshotFrame(payload);
            if (!snapshotEvent) return;

            events.push(snapshotEvent);
            if (events.length > 100) events.shift();
        };

        socketListeners.set(webSocket, onFrameReceived);
        webSocket.on("framereceived", onFrameReceived);
    };

    page.on("websocket", onWebSocket);

    return {
        getLatestTick(playerId) {
            const latestEvent = events.findLast(event => event.playerId === playerId);
            return Number.isInteger(latestEvent?.tick) ? latestEvent.tick : null;
        },
        getDistinctTicksAfter(playerId, baselineTick) {
            const ticks = events
                .filter(event => event.playerId === playerId)
                .map(event => event.tick)
                .filter(tick => Number.isInteger(tick) && tick > baselineTick);
            return [...new Set(ticks)];
        },
        getRecentEvents(playerId, limit = 12) {
            return events
                .filter(event => !playerId || event.playerId === playerId)
                .slice(-limit);
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

/**
 * 한 입력 tick의 최대 4개 제한을 넘기지 않도록 두 animation frame 구간에 키 입력을 나눈다.
 *
 * @param {import("@playwright/test").Page} page - 입력을 보낼 플레이어 페이지
 * @param {string[]} keys - 실제 브라우저 key 이름 목록
 * @param {Function|null} onInput - key press 완료 직후 호출할 선택 callback
 * @returns {Promise<void>}
 */
async function pressRapidInputCombination(page, keys, onInput = null) {
    const firstBurst = keys.slice(0, 4);
    const secondBurst = keys.slice(4);

    for (let index = 0; index < firstBurst.length; index += 1) {
        const key = firstBurst[index];
        await page.keyboard.press(key);
        onInput?.(key, index);
    }

    if (secondBurst.length > 0) {
        await page.evaluate(() => {
            return new Promise(resolve => {
                requestAnimationFrame(() => requestAnimationFrame(resolve));
            });
        });
    }

    for (let index = 0; index < secondBurst.length; index += 1) {
        const key = secondBurst[index];
        await page.keyboard.press(key);
        onInput?.(key, firstBurst.length + index);
    }
}

/**
 * 수렴한 board가 서로 다른 authoritative tick 두 번 이상 유지되는지 polling한다.
 * 한 번이라도 이전 또는 다른 fingerprint가 보이면 이후 다시 수렴해도 실패 상태를 유지한다.
 *
 * @param {Object} params - 양쪽 페이지, player, fingerprint와 snapshot 관찰 정보
 * @returns {Promise<{baselineTick: number, observedTicks: number[]}>}
 */
async function waitForBoardStabilityAcrossSnapshots({
    sourcePage,
    observerPage,
    playerNumber,
    playerId,
    committedFingerprint,
    previousFingerprint,
    snapshotMonitor,
    bottomRows = 6,
    requiredSnapshotCycles = 2,
    observations = [],
}) {
    const baselineTick = snapshotMonitor.getLatestTick(playerId);
    expect(baselineTick, "수렴 시점의 authoritative snapshot tick이 필요하다").not.toBeNull();
    let firstViolation = null;

    await expect.poll(async () => {
        const [sourceFingerprint, observerFingerprint] = await Promise.all([
            readBottomBoardFingerprint(sourcePage, playerNumber, bottomRows),
            readBottomBoardFingerprint(observerPage, playerNumber, bottomRows),
        ]);
        const observedTicks = snapshotMonitor.getDistinctTicksAfter(playerId, baselineTick);

        if (!firstViolation && (
            sourceFingerprint !== committedFingerprint ||
            observerFingerprint !== committedFingerprint ||
            sourceFingerprint === previousFingerprint ||
            observerFingerprint === previousFingerprint
        )) {
            firstViolation = {
                sourceFingerprint,
                observerFingerprint,
                observedTicks,
            };
        }

        observations.push({
            sourceFingerprint,
            observerFingerprint,
            observedTicks,
            firstViolation,
        });
        if (observations.length > 30) observations.shift();

        return {
            stable: firstViolation === null,
            snapshotCycles: Math.min(observedTicks.length, requiredSnapshotCycles),
        };
    }, {
        timeout: 5_000,
        intervals: [100, 100, 150, 250],
    }).toEqual({
        stable: true,
        snapshotCycles: requiredSnapshotCycles,
    });

    return {
        baselineTick,
        observedTicks: snapshotMonitor.getDistinctTicksAfter(playerId, baselineTick),
    };
}

/**
 * rollback assertion 실패 시 입력, snapshot, 양쪽 canvas cell/이미지를 test artifact로 남긴다.
 *
 * @param {Object} params - 실패 시점의 테스트와 양쪽 board 문맥
 * @returns {Promise<void>}
 */
async function attachRollbackDiagnostics({
    testInfo,
    sourcePage,
    observerPage,
    playerNumber,
    playerId,
    direction,
    inputHistory,
    observations,
    snapshotMonitor,
    error,
}) {
    const [sourceStateResult, observerStateResult] = await Promise.allSettled([
        readBottomBoardState(sourcePage, playerNumber, 20),
        readBottomBoardState(observerPage, playerNumber, 20),
    ]);
    const getResultValue = result => result.status === "fulfilled"
        ? result.value
        : { error: result.reason?.message || String(result.reason) };
    const diagnostics = {
        error: error?.message || String(error),
        direction,
        playerNumber,
        playerId,
        lastInput: inputHistory.at(-1) || null,
        inputHistory,
        sourceCanvasState: getResultValue(sourceStateResult),
        observerCanvasState: getResultValue(observerStateResult),
        observations,
        recentAuthoritativeSnapshots: snapshotMonitor.getRecentEvents(playerId),
    };

    await testInfo.attach("rollback-diagnostics.json", {
        body: Buffer.from(JSON.stringify(diagnostics, null, 2)),
        contentType: "application/json",
    });

    const canvasAttachments = [
        ["rollback-source-canvas.png", sourcePage],
        ["rollback-observer-canvas.png", observerPage],
    ];
    for (const [name, page] of canvasAttachments) {
        try {
            const screenshot = await page.locator(getBoardCanvasSelector(playerNumber)).screenshot();
            await testInfo.attach(name, {
                body: screenshot,
                contentType: "image/png",
            });
        } catch {
            // 원래 assertion 오류를 유지한다.
        }
    }
}

async function hardDropUntilMatchFinishes(page, ownPlayerNumber, maxDrops = 30) {
    const lobbyButton = page.locator(
        `.game-text[data-player="${ownPlayerNumber}"] .match-lobby-btn`,
    );

    for (let drop = 0; drop < maxDrops; drop += 1) {
        if (await lobbyButton.isVisible()) return;

        await page.keyboard.press("Space");
        await page.waitForTimeout(120);
    }

    await expect(lobbyButton).toBeVisible({ timeout: 5_000 });
}

module.exports = {
    MULTI_GAME_URL,
    MULTI_LOBBY_URL,
    attachRollbackDiagnostics,
    createAuthoritativeSnapshotMonitor,
    createPlayerPages,
    createWaitingRoom,
    enterTwoPlayerMatch,
    hardDropUntilMatchFinishes,
    pressRapidInputCombination,
    readBottomBoardFingerprint,
    readBottomBoardState,
    startWaitingMatch,
    waitForBoardConvergence,
    waitForBoardStabilityAcrossSnapshots,
};
