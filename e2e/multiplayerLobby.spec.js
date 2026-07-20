const { test, expect } = require("@playwright/test");
const {
    createPlayerPages,
    createWaitingRoom,
} = require("./helpers/multiplayer.js");

test("존재하지 않는 방 코드는 오류를 표시하고 로비 상태를 유지한다", async ({ page }) => {
    await page.goto("/pages/multiLobby.html");
    await page.locator("#roomCodeInput").fill("DEADBEEF");
    await page.locator("#btnJoinCode").click();

    await expect(page.locator("#chatMessages")).toContainText("ROOM_NOT_FOUND");
    await expect(page.locator("#joinByCodeControls")).toBeVisible();
    await expect(page.locator("#roomStatus")).toBeHidden();
    await expect(page.locator("#btnPrimaryAction")).toBeDisabled();
});

test("Host 권한과 Guest 퇴장이 양쪽 로비 상태에 반영된다", async ({ browser }) => {
    const players = await createPlayerPages(browser);
    const { hostPage, guestPage } = players;

    try {
        await createWaitingRoom(hostPage, guestPage);

        await expect(hostPage.locator("#playerHostBadge")).toBeVisible();
        await expect(hostPage.locator("#btnPrimaryAction")).toBeEnabled();
        await expect(guestPage.locator("#playerHostBadge")).toBeHidden();
        await expect(guestPage.locator("#btnPrimaryAction")).toBeDisabled();
        await expect(guestPage.locator("#btnPrimaryAction")).toHaveText("방장 대기중");

        await guestPage.locator("#btnLeaveRoom").click();

        await expect(guestPage.locator("#chatMessages")).toContainText("방에서 퇴장했습니다.");
        await expect(guestPage.locator("#joinByCodeControls")).toBeVisible();
        await expect(hostPage.locator("#roomPlayerCountText")).toHaveText("1");
        await expect(hostPage.locator("#btnPrimaryAction")).toBeDisabled();
    } finally {
        await players.close();
    }
});

test("전체 채팅과 방 채팅이 독립 Context 사이에 전달된다", async ({ browser }) => {
    const players = await createPlayerPages(browser);
    const { hostPage, guestPage } = players;

    try {
        await Promise.all([
            hostPage.goto("/pages/multiLobby.html"),
            guestPage.goto("/pages/multiLobby.html"),
        ]);

        await hostPage.locator("#chatInput").fill("global-e2e-message");
        await hostPage.locator("#chatForm").getByRole("button", { name: "전송" }).click();
        await expect(guestPage.locator("#chatMessages")).toContainText("global-e2e-message");

        await createWaitingRoom(hostPage, guestPage);
        await guestPage.locator("#chatScope").selectOption("room");
        await guestPage.locator("#chatInput").fill("room-e2e-message");
        await guestPage.locator("#chatForm").getByRole("button", { name: "전송" }).click();

        await expect(hostPage.locator("#chatMessages")).toContainText("room-e2e-message");
    } finally {
        await players.close();
    }
});
