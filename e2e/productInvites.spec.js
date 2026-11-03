const { test, expect } = require("@playwright/test");
const { createPlayerPages, createAuthoritativeSnapshotMonitor } = require("./helpers/multiplayer.js");

async function createRoom(page) {
    await page.goto("/pages/multiLobby.html");
    await expect(page.locator("#btnCreateRoom")).toBeEnabled();
    await page.locator("#btnCreateRoom").click();
    await expect(page.locator("#roomStatus")).toBeVisible();
    return (await page.locator("#roomCodeText").textContent()).trim();
}

test("B03 로비는 실제 친구 대전 기능을 안내한다", async ({ page }) => {
    await page.goto("/pages/multiLobby.html");
    await expect(page.locator(".action-panel")).toContainText("친구와 대전");
    await expect(page.getByText("Quick Match", { exact: true })).toHaveCount(0);
    await expect(page.locator("#btnPrimaryAction")).toBeDisabled();
});

test("B04 초대 링크 복사와 첫 방문 참가 후 새로고침은 중복 참가하지 않는다", async ({ browser }) => {
    const players = await createPlayerPages(browser);
    const monitor = createAuthoritativeSnapshotMonitor(players.guestPage);
    try {
        await players.hostPage.addInitScript(() => {
            Object.defineProperty(navigator, "clipboard", { value: {
                writeText: async value => { window.__copiedInvite = value; },
            } });
        });
        const roomId = await createRoom(players.hostPage);
        await players.hostPage.getByRole("button", { name: "초대 링크 복사", exact: true }).click();
        const link = await players.hostPage.evaluate(() => window.__copiedInvite);
        const url = new URL(link);
        expect(url.origin).toBe(new URL(players.hostPage.url()).origin);
        expect(url.pathname).toBe("/pages/multiLobby.html");
        expect([...url.searchParams.keys()]).toEqual(["join"]);
        expect(url.searchParams.get("join")).toBe(roomId);
        await players.guestPage.goto(link);
        await expect(players.guestPage.locator("#roomPlayerCountText")).toHaveText("2");
        await expect(players.hostPage.locator("#roomPlayerCountText")).toHaveText("2");
        expect(new URL(players.guestPage.url()).searchParams.has("join")).toBe(false);
        expect(monitor.getSentEventCount("room:join")).toBe(1);
        await players.guestPage.reload();
        await expect(players.guestPage.locator("#roomPlayerCountText")).toHaveText("2");
        expect(monitor.getSentEventCount("room:join")).toBe(1);
        await players.guestPage.goto(`/pages/multiLobby.html?join=${roomId}`);
        await expect(players.guestPage.locator("#roomPlayerCountText")).toHaveText("2");
        expect(monitor.getSentEventCount("room:join")).toBe(1);
    } finally {
        monitor.dispose();
        await players.close();
    }
});

test("B04 잘못된 초대와 존재하지 않는 방은 자동 시작 없이 수동 참가를 유지한다", async ({ page }) => {
    const monitor = createAuthoritativeSnapshotMonitor(page);
    try {
        for (const query of ["join=oops", "join=ABCDEF12&join=12345678"]) {
            await page.goto(`/pages/multiLobby.html?${query}`);
            await expect(page.locator("#chatMessages")).toContainText(/초대|코드/);
            await expect(page.locator("#roomCodeInput")).toBeEnabled();
            expect(monitor.getSentEventCount("room:join")).toBe(0);
        }
        await page.goto("/pages/multiLobby.html?join=DEADBEEF");
        await expect(page.locator("#chatMessages")).toContainText("ROOM_NOT_FOUND");
        await expect(page.locator("#roomCodeInput")).toBeEnabled();
        await page.locator("#roomCodeInput").fill("ABCDEF12");
        await page.locator("#btnJoinCode").click();
        await expect(page.locator("#chatMessages")).toContainText("ROOM_NOT_FOUND");
        expect(monitor.getSentEventCount("room:start")).toBe(0);
    } finally {
        monitor.dispose();
    }
});

test("B04 다른 방 초대는 현재 방을 자동으로 떠나지 않는다", async ({ browser }) => {
    const players = await createPlayerPages(browser);
    const monitor = createAuthoritativeSnapshotMonitor(players.guestPage);
    try {
        const existingRoom = await createRoom(players.guestPage);
        const invitationRoom = await createRoom(players.hostPage);
        await players.guestPage.goto(`/pages/multiLobby.html?join=${invitationRoom}`);
        await expect(players.guestPage.locator("#roomCodeText")).toHaveText(existingRoom);
        await expect(players.guestPage.getByRole("button", { name: "현재 방 유지", exact: true })).toBeVisible();
        expect(monitor.getSentEventCount("room:leave")).toBe(0);
        expect(monitor.getSentEventCount("room:join")).toBe(0);
        await expect(players.hostPage.locator("#roomPlayerCountText")).toHaveText("1");
        await players.guestPage.getByRole("button", { name: "현재 방 나가고 초대 참가", exact: true }).click();
        await expect(players.guestPage.locator("#roomCodeText")).toHaveText(invitationRoom);
        await expect(players.hostPage.locator("#roomPlayerCountText")).toHaveText("2");
    } finally {
        monitor.dispose();
        await players.close();
    }
});

test("B04 세션 준비가 늦어도 초대 요청은 한 번만 전송한다", async ({ browser }) => {
    const players = await createPlayerPages(browser);
    const monitor = createAuthoritativeSnapshotMonitor(players.guestPage);
    try {
        const roomId = await createRoom(players.hostPage);
        await players.guestPage.route("**/socket.io/socket.io.js", async route => {
            await new Promise(resolve => setTimeout(resolve, 300));
            await route.continue();
        });
        await players.guestPage.goto(`/pages/multiLobby.html?join=${roomId}`);
        await expect(players.guestPage.locator("#roomPlayerCountText")).toHaveText("2");
        expect(monitor.getSentEventCount("room:join")).toBe(1);
    } finally {
        monitor.dispose();
        await players.close();
    }
});

test("B04 복사 실패는 방 코드를 남기고 현재 방을 보존한다", async ({ page }) => {
    await page.addInitScript(() => {
        Object.defineProperty(navigator, "clipboard", { value: { writeText: async () => { throw new Error("denied"); } } });
    });
    const roomId = await createRoom(page);
    await page.getByRole("button", { name: "초대 링크 복사", exact: true }).click();
    await expect(page.locator("#chatMessages")).toContainText(/복사.*실패/);
    await expect(page.locator("#chatMessages")).toContainText(roomId);
    await expect(page.locator("#roomCodeText")).toHaveText(roomId);
});

test("B04 진행 중인 기존 방도 초대 충돌 선택 전에는 자동 복귀·퇴장하지 않는다", async ({ browser }) => {
    const players = await createPlayerPages(browser);
    const monitor = createAuthoritativeSnapshotMonitor(players.guestPage);
    try {
        const inviteRoom = await createRoom(players.hostPage);
        await players.guestPage.goto("/pages/multiLobby.html");
        await expect(players.guestPage.locator("#btnOpenPveCreate")).toBeEnabled();
        await players.guestPage.locator("#btnOpenPveCreate").click();
        await players.guestPage.locator("#btnCreatePveRoom").click();
        await expect(players.guestPage.locator("#roomStatus")).toBeVisible();
        const originalRoom = (await players.guestPage.locator("#roomCodeText").textContent()).trim();
        await players.guestPage.locator("#btnPrimaryAction").click();
        await players.guestPage.waitForURL(/tetrisMulti\.html/);
        await players.guestPage.goto(`/pages/multiLobby.html?join=${inviteRoom}`);
        await expect(players.guestPage.getByRole("button", { name: "현재 방 유지", exact: true })).toBeVisible();
        await expect(players.guestPage.locator("#roomCodeText")).toHaveText(originalRoom);
        expect(new URL(players.guestPage.url()).pathname).toBe("/pages/multiLobby.html");
        expect(monitor.getSentEventCount("room:leave")).toBe(0);
        expect(monitor.getSentEventCount("room:join")).toBe(0);
        await players.guestPage.getByRole("button", { name: "현재 방 유지", exact: true }).click();
        await players.guestPage.waitForURL(new RegExp(`tetrisMulti\\.html\\?roomId=${originalRoom}`));
    } finally {
        monitor.dispose();
        await players.close();
    }
});
