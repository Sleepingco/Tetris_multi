/**
 * 멀티플레이 로비의 오류 처리, Host 권한, 퇴장과 채팅 범위를 브라우저 관점에서 검증한다.
 *
 * 두 사용자가 필요한 경우 독립 BrowserContext를 준비해 sessionStorage를 격리한다.
 * 버튼 하나만 확인하지 않고 양쪽 화면의 서버 room 상태가 함께 바뀌는지 검증하고,
 * finally에서 공통 player context를 정리한다.
 */
const { test, expect } = require("@playwright/test");
const {
    createPlayerPages,
    createWaitingRoom,
} = require("./helpers/multiplayer.js");

test("로비는 방 조작을 채팅보다 먼저 표시하고 모바일에서 입력할 수 있다", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/pages/multiLobby.html");
    await expect(page.locator("#roomCodeInput")).toBeEnabled();
    await expect(page.locator("#btnCreateRoom")).toBeVisible();
    await expect(page.locator("#btnOpenPveCreate")).toBeVisible();
    await expect(page.getByText("Quick Match")).toHaveCount(0);
    await page.locator("#btnOpenPveCreate").click();
    await expect(page.locator("#pveCreateControls")).toBeVisible();
    await expect(page.locator("#roomCodeInput")).toBeVisible();
    await page.locator("#btnOpenPveCreate").click();
    await expect(page.locator("#pveCreateControls")).toBeHidden();
    expect(await page.locator(".lobby-grid").evaluate(root => ({
        first: root.firstElementChild.className,
        ordered: root.querySelector(".action-panel").getBoundingClientRect().bottom
            <= root.querySelector(".chat-panel").getBoundingClientRect().top,
        width: document.documentElement.scrollWidth,
    }))).toEqual({ first: "action-panel", ordered: true, width: 390 });
    await page.locator("#chatInput").fill("모바일 채팅");
    await page.locator("#chatForm button").click();
    await expect(page.locator("#chatMessages")).toContainText("모바일 채팅");
});

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
        await expect(hostPage.locator(".room-players li")).toHaveCount(2);
        await expect(hostPage.locator(".room-players")).toContainText("방장");
        await expect(hostPage.locator("#btnPrimaryAction")).toBeEnabled();
        await expect(guestPage.locator("#playerHostBadge")).toBeHidden();
        await expect(guestPage.locator("#btnPrimaryAction")).toBeDisabled();
        await expect(guestPage.locator("#btnPrimaryAction")).toHaveText("방장 대기중");

        await guestPage.locator("#btnLeaveRoom").click();

        await expect(guestPage.locator("#chatMessages")).toContainText("방에서 퇴장했습니다.");
        await expect(guestPage.locator("#joinByCodeControls")).toBeVisible();
        await expect(hostPage.locator("#roomPlayerCountText")).toHaveText("1");
        await expect(hostPage.locator("#btnPrimaryAction")).toBeDisabled();
        await expect(hostPage.locator("#btnPrimaryAction")).toHaveText("상대 입장 대기 중");
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
        await expect(hostPage.locator(".chat-msg.is-mine .chat-bubble").filter({ hasText: "global-e2e-message" })).toHaveCount(1);
        await expect(guestPage.locator(".chat-msg.is-mine").filter({ hasText: "global-e2e-message" })).toHaveCount(0);
        expect(await hostPage.locator(".chat-msg.is-mine").filter({ hasText: "global-e2e-message" }).evaluate(node => {
            const bubble = node.getBoundingClientRect();
            const container = node.parentElement.getBoundingClientRect();
            return Math.abs(bubble.right - container.right) < 2;
        })).toBe(true);

        await createWaitingRoom(hostPage, guestPage);
        await guestPage.getByRole("radio", { name: "방", exact: true }).check();
        await guestPage.locator("#chatInput").fill("room-e2e-message");
        await guestPage.locator("#chatForm").getByRole("button", { name: "전송" }).click();

        await expect(hostPage.locator("#chatMessages")).toContainText("room-e2e-message");
    } finally {
        await players.close();
    }
});
