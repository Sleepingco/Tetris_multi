const { test, expect } = require("@playwright/test");
const {
    MULTI_LOBBY_URL,
    createPlayerPages,
    enterTwoPlayerMatch,
    readBottomBoardFingerprint,
    waitForBoardConvergence,
} = require("./helpers/multiplayer.js");

test("유효한 room session 없이 게임 화면에 접근하면 로비로 돌아간다", async ({ page }) => {
    await page.goto("/pages/tetrisMulti.html?roomId=missing");
    await expect(page).toHaveURL(MULTI_LOBBY_URL);
});

test("Host와 Guest의 sessionStorage와 게임 역할이 서로 격리된다", async ({ browser }) => {
    const players = await createPlayerPages(browser);
    const { hostPage, guestPage } = players;

    try {
        const roomId = await enterTwoPlayerMatch(hostPage, guestPage);
        const [hostSession, guestSession] = await Promise.all([
            hostPage.evaluate(() => ({
                playerId: sessionStorage.getItem("tetris:playerId"),
                roomId: sessionStorage.getItem("tetris:roomId"),
            })),
            guestPage.evaluate(() => ({
                playerId: sessionStorage.getItem("tetris:playerId"),
                roomId: sessionStorage.getItem("tetris:roomId"),
            })),
        ]);

        expect(hostSession.playerId).not.toBe(guestSession.playerId);
        expect(hostSession.roomId).toBe(roomId);
        expect(guestSession.roomId).toBe(roomId);
        await expect(hostPage.locator("#player1RoleBadge")).toHaveText("내 보드");
        await expect(hostPage.locator("#player2RoleBadge")).toHaveText("상대 보드");
        await expect(guestPage.locator("#player1RoleBadge")).toHaveText("상대 보드");
        await expect(guestPage.locator("#player2RoleBadge")).toHaveText("내 보드");
    } finally {
        await players.close();
    }
});

test("Guest의 빠른 입력과 연속 placement가 Host의 상대 보드로 수렴한다", async ({ browser }) => {
    const players = await createPlayerPages(browser);
    const { hostPage, guestPage } = players;

    try {
        await enterTwoPlayerMatch(hostPage, guestPage);

        const baseline = await readBottomBoardFingerprint(guestPage, 2);
        await guestPage.keyboard.press("ArrowRight");
        await guestPage.keyboard.press("ArrowRight");
        await guestPage.keyboard.press("ArrowUp");
        await guestPage.keyboard.press("Space");

        const firstPlacement = await waitForBoardConvergence({
            sourcePage: guestPage,
            observerPage: hostPage,
            playerNumber: 2,
            previousFingerprint: baseline,
        });

        await guestPage.keyboard.press("ArrowLeft");
        await guestPage.keyboard.press("ArrowUp");
        await guestPage.keyboard.press("Space");

        await waitForBoardConvergence({
            sourcePage: guestPage,
            observerPage: hostPage,
            playerNumber: 2,
            previousFingerprint: firstPlacement,
        });
    } finally {
        await players.close();
    }
});

test("게임 중 Guest가 홈으로 나가면 Host는 1인 로비로 복귀한다", async ({ browser }) => {
    const players = await createPlayerPages(browser);
    const { hostPage, guestPage } = players;

    try {
        await enterTwoPlayerMatch(hostPage, guestPage);

        await Promise.all([
            hostPage.waitForURL(MULTI_LOBBY_URL),
            guestPage.waitForURL("**/pages/index.html"),
            guestPage.locator(".home-btn").click(),
        ]);

        await expect(hostPage.locator("#roomPlayerCountText")).toHaveText("1");
        await expect(hostPage.locator("#roomStateText")).toHaveText("waiting");
        await expect(hostPage.locator("#btnPrimaryAction")).toBeDisabled();
    } finally {
        await players.close();
    }
});
