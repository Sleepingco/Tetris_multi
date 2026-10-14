const { test, expect } = require("@playwright/test");
const { createPlayerPages, createWaitingRoom, MULTI_GAME_URL, MULTI_LOBBY_URL } = require("./helpers/multiplayer.js");
const { createPveRoom, createPveSocketMonitor } = require("./helpers/pve.js");

// 일시적 실패 응답만 대체하고 room/match 상태는 실제 서버에서 관리한다.
async function rejectFirstRequest(page, eventName, resultEvent) {
    await page.route("**/socket.io/socket.io.js", async route => {
        const response = await route.fetch();
        const body = await response.text();
        await route.fulfill({ response, body: `${body}
            (() => {
                const originalIo = window.io;
                window.io = (...args) => {
                    const socket = originalIo(...args);
                    const emit = socket.emit;
                    let rejected = false;
                    socket.emit = function(event, ...payload) {
                        if (event === ${JSON.stringify(eventName)} && !rejected) {
                            rejected = true;
                            window.__rejectedRequestCount = (window.__rejectedRequestCount || 0) + 1;
                            window.setTimeout(() => {
                                const result = { ok: false, room: null, reason: "RATE_LIMITED" };
                                if (${JSON.stringify(resultEvent)} === "game:join:result") result.match = null;
                                socket.listeners(${JSON.stringify(resultEvent)}).slice().forEach(handler => handler(result));
                            }, 200);
                            return socket;
                        }
                        return emit.call(this, event, ...payload);
                    };
                    return socket;
                };
            })();` });
    });
}

test("중복 시작 클릭은 한 번만 전송하고 제한 실패 후 같은 방에서 재시작한다", async ({ page }) => {
    await rejectFirstRequest(page, "room:start", "room:result");
    const roomId = await createPveRoom(page, "normal");
    await page.locator("#btnPrimaryAction").evaluate(button => {
        button.click(); button.click(); button.click();
    });
    await expect(page.locator("#btnPrimaryAction")).toBeDisabled();
    await expect(page.locator("#chatMessages")).toContainText("요청이 너무 잦습니다.");
    expect(await page.evaluate(() => window.__rejectedRequestCount)).toBe(1);
    await expect(page.locator("#btnPrimaryAction")).toBeEnabled();
    expect(await page.evaluate(() => sessionStorage.getItem("tetris:roomId"))).toBe(roomId);
    await page.locator("#btnPrimaryAction").click();
    await expect(page).toHaveURL(MULTI_GAME_URL);
    await expect(page.locator('.game-text[data-player="1"]')).toHaveText(/3|2|1/);
    await expect(page.locator('.game-text[data-player="1"]')).toBeHidden();
});

test("로비 sync 제한 실패는 저장된 방을 유지하고 수동 확인 후 시작을 허용한다", async ({ page }) => {
    const roomId = await createPveRoom(page, "normal");
    await rejectFirstRequest(page, "room:sync", "room:result");
    await page.reload();
    await expect(page.locator("#chatMessages")).toContainText("요청이 너무 잦습니다.");
    await expect(page.locator("#roomCodeText")).toHaveText(roomId);
    await expect(page.locator("#btnPrimaryAction")).toBeDisabled();
    expect(await page.evaluate(() => sessionStorage.getItem("tetris:roomId"))).toBe(roomId);
    await page.locator("#btnRetryRoomSync").click();
    await expect(page.locator("#btnPrimaryAction")).toBeEnabled();
    await expect(page.locator("#btnRetryRoomSync")).toHaveCount(0);
});

test("game join 제한 실패는 게임을 실행하지 않고 같은 match 참가를 재시도한다", async ({ page }) => {
    await rejectFirstRequest(page, "game:join", "game:join:result");
    const roomId = await createPveRoom(page, "normal");
    const monitor = createPveSocketMonitor(page);
    try {
        await page.locator("#btnPrimaryAction").click();
        await expect(page).toHaveURL(MULTI_GAME_URL);
        const retry = page.getByRole("button", { name: "참가 다시 시도", exact: true });
        await expect(retry).toBeVisible();
        expect(await page.evaluate(() => sessionStorage.getItem("tetris:roomId"))).toBe(roomId);
        expect(monitor.getObservedPlayerIds()).toEqual([]);
        await retry.click();
        await expect(page.locator('.game-text[data-player="1"]')).toHaveText(/3|2|1/);
        await expect(page.locator('.game-text[data-player="1"]')).toBeHidden();
        await expect.poll(() => monitor.getObservedPlayerIds().length).toBe(2);
    } finally { monitor.dispose(); }
});

test("양쪽 참가 후 3초 countdown 동안 입력과 중력이 멈추고 함께 시작한다", async ({ browser }) => {
    const players = await createPlayerPages(browser);
    const { hostPage, guestPage } = players;
    const monitor = createPveSocketMonitor(hostPage);
    try {
        await createWaitingRoom(hostPage, guestPage);
        await hostPage.locator("#btnPrimaryAction").click();
        await Promise.all([expect(hostPage).toHaveURL(MULTI_GAME_URL), expect(guestPage).toHaveURL(MULTI_GAME_URL)]);
        const hostOverlay = hostPage.locator('.game-text[data-player="1"]');
        const guestOverlay = guestPage.locator('.game-text[data-player="2"]');
        await expect(hostOverlay).toHaveText("3");
        await expect(guestOverlay).toHaveText("3");
        const hostId = await hostPage.evaluate(() => JSON.parse(sessionStorage.getItem("tetris:playerSession")).playerId);
        await hostPage.keyboard.press("Space");
        await guestPage.keyboard.press("Space");
        await expect(hostOverlay).toHaveText("2");
        expect(monitor.getSnapshots(hostId)).toHaveLength(0);
        await expect(hostOverlay).toHaveText("1");
        await expect(hostOverlay).toBeHidden();
        await expect(guestOverlay).toBeHidden();
        await hostPage.keyboard.press("Space");
        await expect.poll(() => monitor.getSnapshots(hostId).some(snapshot => snapshot.pieceIndex === 2)).toBe(true);
    } finally { monitor.dispose(); await players.close(); }
});

test("countdown 중 상대의 명시적 퇴장은 시작을 취소하고 남은 player를 로비로 돌린다", async ({ browser }) => {
    const players = await createPlayerPages(browser);
    try {
        await createWaitingRoom(players.hostPage, players.guestPage);
        await players.hostPage.locator("#btnPrimaryAction").click();
        await expect(players.guestPage).toHaveURL(MULTI_GAME_URL);
        await expect(players.guestPage.locator('.game-text[data-player="2"]')).toHaveText(/3|2|1/);
        await players.guestPage.locator(".home-btn").click();
        await expect(players.hostPage).toHaveURL(MULTI_LOBBY_URL);
        await expect(players.hostPage.locator("#roomPlayerCountText")).toHaveText("1");
        await expect(players.hostPage.locator("#roomStateText")).toHaveText("waiting");
        await players.hostPage.waitForTimeout(3200);
        await expect(players.hostPage).toHaveURL(MULTI_LOBBY_URL);
        await expect(players.hostPage.locator("#btnPrimaryAction")).toBeDisabled();
    } finally { await players.close(); }
});
