/**
 * 서버가 결정한 game-over 이후 같은 두 플레이어가 방을 재사용할 수 있는지 검증한다.
 *
 * 두 BrowserContext로 PVP 경기를 준비하고 Host를 빠르게 top-out시킨 뒤, 양쪽 결과 화면과
 * 로비 복귀 상태를 확인한다. 중간 assertion이 실패해도 finally에서 두 context를 닫는다.
 */
const { test, expect } = require("@playwright/test");
const { monitorPlacementLogs } = require("./helpers/placementLogs.js");
const {
    MULTI_LOBBY_URL,
    createPlayerPages,
    enterTwoPlayerMatch,
    hardDropUntilMatchFinishes,
} = require("./helpers/multiplayer.js");

test("server game over 이후 두 플레이어가 로비로 돌아오면 재시작할 수 있다", async ({ browser }, testInfo) => {
    const players = await createPlayerPages(browser);
    const { hostPage, guestPage } = players;
    const logs = monitorPlacementLogs(hostPage);

    try {
        await enterTwoPlayerMatch(hostPage, guestPage);
        await hardDropUntilMatchFinishes(hostPage, 1);

        const hostLobbyButton = hostPage.locator(
            '.game-text[data-player="1"] .match-lobby-btn',
        );
        const guestLobbyButton = guestPage.locator(
            '.game-text[data-player="2"] .match-lobby-btn',
        );

        await expect(hostPage.locator('.game-text[data-player="1"] > span')).toHaveText("패배");
        await expect(hostPage.locator('.game-text[data-player="2"] > span')).toHaveText("승리");
        await expect(guestPage.locator('.game-text[data-player="1"] > span')).toHaveText("패배");
        await expect(guestPage.locator('.game-text[data-player="2"] > span')).toHaveText("승리");
        await expect(hostLobbyButton).toBeVisible();
        await expect(guestLobbyButton).toBeVisible();
        await logs.verifyAndWrite(testInfo, "multi");

        await Promise.all([
            hostPage.waitForURL(MULTI_LOBBY_URL),
            guestPage.waitForURL(MULTI_LOBBY_URL),
            hostLobbyButton.click(),
            guestLobbyButton.click(),
        ]);

        await expect(hostPage.locator("#roomStateText")).toHaveText("waiting");
        await expect(guestPage.locator("#roomStateText")).toHaveText("waiting");
        await expect(hostPage.locator("#roomPlayerCountText")).toHaveText("2");
        await expect(hostPage.locator("#btnPrimaryAction")).toBeEnabled();
        await expect(guestPage.locator("#btnPrimaryAction")).toBeDisabled();
    } finally {
        logs.dispose();
        await players.close();
    }
});
