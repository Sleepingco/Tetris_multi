const { expect } = require("@playwright/test");

const GAME_READY_SELECTOR = '.next-preview[data-player="1"] .next-cell';
const MULTI_GAME_URL = /\/pages\/tetrisMulti\.html\?roomId=[^&]+$/;
const MULTI_LOBBY_URL = /\/pages\/multiLobby\.html$/;

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
 * 지정한 Canvas 하단에서 고정 블록의 색상 fingerprint를 읽는다.
 * - 셀 중앙의 불투명 픽셀만 사용해 반투명 ghost piece를 제외한다.
 *
 * @param {import("@playwright/test").Page} page - fingerprint를 읽을 브라우저 페이지
 * @param {number} playerNumber - 화면에서 읽을 player column 번호
 * @param {number} bottomRows - 아래에서부터 읽을 행 수
 * @returns {Promise<string>}
 */
async function readBottomBoardFingerprint(page, playerNumber, bottomRows = 6) {
    const selector = `.playground[data-player="${playerNumber}"] .tetrisBoardCanvas`;

    return page.locator(selector).evaluate((canvas, rowsToRead) => {
        const context = canvas.getContext("2d");
        const cols = 10;
        const rows = 20;
        const cellWidth = canvas.width / cols;
        const cellHeight = canvas.height / rows;
        const cells = [];

        for (let row = rows - rowsToRead; row < rows; row += 1) {
            for (let col = 0; col < cols; col += 1) {
                const x = Math.floor((col + 0.5) * cellWidth);
                const y = Math.floor((row + 0.5) * cellHeight);
                const [red, green, blue, alpha] = context.getImageData(x, y, 1, 1).data;

                cells.push(alpha >= 240
                    ? `${red}:${green}:${blue}`
                    : "empty");
            }
        }

        return cells.join("|");
    }, bottomRows);
}

async function waitForBoardConvergence({
    sourcePage,
    observerPage,
    playerNumber,
    previousFingerprint,
}) {
    await expect.poll(async () => {
        const [sourceBoard, observerBoard] = await Promise.all([
            readBottomBoardFingerprint(sourcePage, playerNumber),
            readBottomBoardFingerprint(observerPage, playerNumber),
        ]);

        return sourceBoard !== previousFingerprint && sourceBoard === observerBoard;
    }, {
        timeout: 8_000,
    }).toBe(true);

    return readBottomBoardFingerprint(sourcePage, playerNumber);
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
    createPlayerPages,
    createWaitingRoom,
    enterTwoPlayerMatch,
    hardDropUntilMatchFinishes,
    readBottomBoardFingerprint,
    startWaitingMatch,
    waitForBoardConvergence,
};
