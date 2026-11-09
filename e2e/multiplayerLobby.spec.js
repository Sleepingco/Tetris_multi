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

test("모바일 로비는 대기실을 먼저 표시하고 탭 전환 중 입력과 채팅 기록을 보존한다", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/pages/multiLobby.html");
    const waiting = page.getByRole("tab", { name: "대기실", exact: true });
    const chat = page.getByRole("tab", { name: "채팅", exact: true });
    await expect(waiting).toHaveAttribute("aria-selected", "true");
    await expect(chat).toHaveAttribute("aria-selected", "false");
    await expect(page.locator(".action-panel")).toBeVisible();
    await expect(page.locator(".chat-panel")).toBeHidden();
    await expect(page.locator("#chatInput")).toHaveCount(1);
    await expect(page.locator("#roomCodeInput")).toBeEnabled();
    await expect(page.locator("#btnCreateRoom")).toBeVisible();
    await expect(page.getByText("Quick Match")).toHaveCount(0);
    await page.locator("#roomCodeInput").fill("AB12CD34");
    await page.locator("#btnOpenPveCreate").click();
    await expect(page.locator("#pveCreateControls")).toBeVisible();
    await chat.click();
    await expect(page.locator(".action-panel")).toBeHidden();
    await expect(page.locator("#roomCodeInput")).toHaveCount(1);
    await expect(page.locator(".chat-panel")).toBeVisible();
    const panel = await page.locator(".chat-panel").boundingBox();
    const messages = await page.locator("#chatMessages").boundingBox();
    expect(panel.height).toBeGreaterThanOrEqual(500);
    expect(messages.height).toBeGreaterThanOrEqual(180);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
    await page.locator("#chatInput").fill("모바일 채팅");
    await page.locator("#chatForm button").click();
    await expect(page.locator("#chatMessages")).toContainText("모바일 채팅");
    await page.locator("#chatInput").fill("아직 보내지 않은 메시지");
    await waiting.click();
    await expect(page.locator("#roomCodeInput")).toHaveValue("AB12CD34");
    await expect(page.locator("#pveCreateControls")).toBeVisible();
    await chat.click();
    await expect(page.locator("#chatInput")).toHaveValue("아직 보내지 않은 메시지");
    await expect(page.locator("#chatMessages")).toContainText("모바일 채팅");
});

test("모바일 로비 탭은 방향키와 Home End로 선택하고 데스크톱에서는 두 패널을 표시한다", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/pages/multiLobby.html");
    const waiting = page.getByRole("tab", { name: "대기실", exact: true });
    const chat = page.getByRole("tab", { name: "채팅", exact: true });
    const assertSelected = async (selected, other) => {
        await expect(selected).toBeFocused();
        await expect(selected).toHaveAttribute("aria-selected", "true");
        await expect(selected).toHaveAttribute("tabindex", "0");
        await expect(other).toHaveAttribute("aria-selected", "false");
        await expect(other).toHaveAttribute("tabindex", "-1");
        const panelId = await selected.getAttribute("aria-controls");
        expect(panelId).toBeTruthy();
        await expect(page.locator(`[id="${panelId}"]`)).toBeVisible();
    };
    await waiting.focus();
    await waiting.press("ArrowRight");
    await assertSelected(chat, waiting);
    await chat.press("ArrowRight");
    await assertSelected(waiting, chat);
    await waiting.press("ArrowLeft");
    await assertSelected(chat, waiting);
    await chat.press("Home");
    await assertSelected(waiting, chat);
    await waiting.press("End");
    await assertSelected(chat, waiting);
    await page.setViewportSize({ width: 1200, height: 900 });
    await expect(page.getByRole("tablist")).toBeHidden();
    await expect(page.locator(".action-panel")).toBeVisible();
    await expect(page.locator(".chat-panel")).toBeVisible();
    await expect(page.locator("#roomCodeInput")).toBeEnabled();
    await expect(page.locator("#chatInput")).toBeEnabled();
});

test("좁은 가로 로비에서도 채팅 입력과 전송이 가능하고 방 상태가 탭 전환 뒤 유지된다", async ({ page }) => {
    await page.setViewportSize({ width: 740, height: 390 });
    await page.goto("/pages/multiLobby.html");
    await expect(page.locator("#btnCreateRoom")).toBeEnabled();
    await page.locator("#btnCreateRoom").click();
    await expect(page.locator("#roomStatus")).toBeVisible();
    const roomId = await page.locator("#roomCodeText").textContent();
    await page.getByRole("tab", { name: "채팅", exact: true }).click();
    await page.getByRole("radio", { name: "방", exact: true }).check();
    await page.locator("#chatInput").fill("가로 화면 채팅");
    await page.locator("#chatForm button").click();
    await expect(page.locator("#chatMessages")).toContainText("가로 화면 채팅");
    expect((await page.locator("#chatMessages").boundingBox()).height).toBeGreaterThanOrEqual(180);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(740);
    await page.getByRole("tab", { name: "대기실", exact: true }).click();
    await expect(page.locator("#roomCodeText")).toHaveText(roomId);
    await expect(page.locator("#roomPlayerCountText")).toHaveText("1");
});

test("모바일 대기실은 채팅이 숨겨져 있어도 방 참가 실패를 상태 안내로 표시한다", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/pages/multiLobby.html");
    await expect(page.locator("#roomCodeInput")).toBeEnabled();
    await expect(page.locator(".chat-panel")).toBeHidden();
    await page.locator("#roomCodeInput").fill("DEADBEEF");
    await page.locator("#btnJoinCode").click();
    const feedback = page.locator(".lobby-feedback");
    await expect(feedback).toHaveAttribute("role", "status");
    await expect(feedback).toBeVisible();
    await expect(feedback).toContainText("ROOM_NOT_FOUND");
    await expect(page.getByRole("tab", { name: "대기실", exact: true })).toHaveAttribute("aria-selected", "true");
    await expect(page.locator(".chat-panel")).toBeHidden();
    await expect(page.locator("#roomCodeInput")).toHaveValue("DEADBEEF");
});

test("숨겨진 모바일 채팅에서 수신한 메시지는 탭을 열면 최신 위치까지 스크롤된다", async ({ browser }) => {
    const players = await createPlayerPages(browser);
    const { hostPage, guestPage } = players;
    try {
        await guestPage.setViewportSize({ width: 390, height: 844 });
        await Promise.all([
            hostPage.goto("/pages/multiLobby.html"),
            guestPage.goto("/pages/multiLobby.html"),
        ]);
        await expect(hostPage.locator("#chatInput")).toBeEnabled();
        await expect(guestPage.locator(".chat-panel")).toBeHidden();
        for (let index = 0; index < 4; index++) {
            const text = `숨김 수신 ${index} ${"메시지 ".repeat(40)}`;
            await hostPage.locator("#chatInput").fill(text);
            await hostPage.locator("#chatForm button").click();
            await expect(guestPage.locator("#chatMessages")).toContainText(`숨김 수신 ${index}`);
            // 운영 채팅의 초당 1개 제한을 지키며 실제 다른 사용자의 메시지를 받는다.
            if (index < 3) await hostPage.waitForTimeout(1050);
        }
        await expect(guestPage.locator(".chat-panel")).toBeHidden();
        await guestPage.getByRole("tab", { name: "채팅", exact: true }).click();
        await expect(guestPage.locator("#chatMessages")).toBeVisible();
        await expect.poll(() => guestPage.locator("#chatMessages").evaluate(element => ({
            overflow: element.scrollHeight > element.clientHeight,
            atBottom: Math.abs(element.scrollHeight - element.clientHeight - element.scrollTop) <= 1,
        }))).toEqual({ overflow: true, atBottom: true });
        await expect(guestPage.locator("#chatMessages")).toContainText("숨김 수신 3");
    } finally {
        await players.close();
    }
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
