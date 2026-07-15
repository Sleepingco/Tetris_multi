const { test, expect } = require("@playwright/test");
const {
    MULTI_LOBBY_URL,
    createPlayerPages,
    enterTwoPlayerMatch,
    hardDropUntilMatchFinishes,
} = require("./helpers/multiplayer.js");

test("server game over 이후 두 플레이어가 로비로 돌아오면 재시작할 수 있다", async ({ browser }) => {
    const players = await createPlayerPages(browser);
    const { hostPage, guestPage } = players;

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
        await players.close();
    }
});
