const { test, expect } = require("@playwright/test");
const {
    MULTI_GAME_URL,
    createAuthoritativeSnapshotMonitor,
    createPlayerPages,
    enterTwoPlayerMatch,
    readPlayerSession,
} = require("./helpers/multiplayer.js");
const {
    createPveRoom,
    startPveMatch,
} = require("./helpers/pve.js");

const TERMINAL_MESSAGE = "세션이 만료되었거나 다른 탭으로 이동했습니다. 새로고침해 주세요.";

function captureBrowserErrors(page) {
    const consoleMessages = [];
    const errors = [];
    page.on("console", message => {
        consoleMessages.push(message.text());
        if (message.type() === "error") errors.push(message.text());
    });
    page.on("pageerror", error => errors.push(error.message));
    return { consoleMessages, errors };
}

async function expectTokenHidden(page, token, consoleMessages) {
    expect(page.url()).not.toContain(token);
    expect(await page.content()).not.toContain(token);
    expect(consoleMessages.join("\n")).not.toContain(token);
}

test("multiplayer StrictMode는 join, input과 HUD lifecycle을 한 세트만 유지한다", async ({ browser }) => {
    const players = await createPlayerPages(browser);
    const { hostContext, hostPage, guestPage } = players;
    const hostMonitor = createAuthoritativeSnapshotMonitor(hostPage);
    const guestMonitor = createAuthoritativeSnapshotMonitor(guestPage);
    const hostErrors = captureBrowserErrors(hostPage);
    const guestErrors = captureBrowserErrors(guestPage);

    try {
        await enterTwoPlayerMatch(hostPage, guestPage);
        await expect.poll(() => hostMonitor.getSentEventCount("game:join")).toBe(1);
        await expect.poll(() => guestMonitor.getSentEventCount("game:join")).toBe(1);
        await hostPage.waitForTimeout(200);
        expect(hostMonitor.getSentEventCount("game:join")).toBe(1);
        expect(guestMonitor.getSentEventCount("game:join")).toBe(1);

        for (const { page, myPlayer } of [
            { page: hostPage, myPlayer: 1 },
            { page: guestPage, myPlayer: 2 },
        ]) {
            for (const playerNumber of [1, 2]) {
                const column = page.locator(`.player-column[data-player="${playerNumber}"]`);
                await expect(column.locator(".next-preview .next-cell")).toHaveCount(32);
                await expect(column.locator(".next-preview .next-cell.preview")).toHaveCount(8);
                await expect(column.locator(".hold-preview .next-cell")).toHaveCount(16);
                await expect(column.locator(".stat--incoming")).toHaveAttribute("aria-live", "polite");
                await expect(column.locator(".stat--incoming")).toHaveAttribute("aria-atomic", "true");
                const overlay = column.locator(".game-text");
                if (playerNumber === myPlayer) {
                    await expect(overlay).toHaveAttribute("aria-live", "polite");
                    await expect(overlay).toHaveAttribute("aria-atomic", "true");
                } else {
                    await expect(overlay).not.toHaveAttribute("aria-live");
                    await expect(overlay).not.toHaveAttribute("aria-atomic");
                }
                expect(await column.locator("canvas").evaluate(canvas => ({
                    width: canvas.width,
                    height: canvas.height,
                }))).toEqual({ width: 300, height: 600 });
            }
        }

        const soundToggle = hostPage.locator("#soundToggle");
        const soundPressed = await soundToggle.getAttribute("aria-pressed");
        await soundToggle.click();
        await expect(soundToggle).not.toHaveAttribute("aria-pressed", soundPressed);
        const themeToggle = hostPage.locator("#themeToggle");
        const themePressed = await themeToggle.getAttribute("aria-pressed");
        await themeToggle.click();
        await expect(themeToggle).not.toHaveAttribute("aria-pressed", themePressed);

        const guestPlayerId = (await readPlayerSession(guestPage)).playerId;
        const inputCount = guestMonitor.getSentGameInputCount();
        await guestPage.keyboard.press("KeyC");
        await expect.poll(() => guestMonitor.getSentGameInputCount()).toBe(inputCount + 1);
        const inputSequence = guestMonitor.getSentGameInputs().at(-1).clientSequence;
        await expect.poll(() => guestMonitor.getRecentEvents(guestPlayerId).some(event => {
            return event.lastProcessedClientSequence >= inputSequence;
        })).toBe(true);
        await guestPage.waitForTimeout(200);
        expect(guestMonitor.getSentGameInputCount()).toBe(inputCount + 1);
        await expect(
            guestPage.locator('.hold-preview[data-player="2"] .next-cell.preview'),
        ).toHaveCount(4);
        await expect(
            hostPage.locator('.hold-preview[data-player="2"] .next-cell.preview'),
        ).toHaveCount(4);

        const sessionBeforeReconnect = await readPlayerSession(hostPage);
        await hostContext.setOffline(true);
        await expect(hostPage.locator('.game-text[data-player="1"] > span')).toHaveText(
            "재연결 중",
        );
        await expect(
            hostPage.locator('.hold-preview[data-player="2"] .next-cell.preview'),
        ).toHaveCount(4);
        await hostContext.setOffline(false);
        await expect.poll(async () => (await readPlayerSession(hostPage))?.token).not.toBe(
            sessionBeforeReconnect.token,
        );
        await expect.poll(() => hostMonitor.getSentEventCount("game:join")).toBe(2);
        await expect(hostPage.locator('.game-text[data-player="1"]')).not.toBeVisible();
        await expect(hostPage.locator('.game-text[data-player="2"]')).not.toBeVisible();
        await hostPage.waitForTimeout(200);
        expect(hostMonitor.getSentEventCount("game:join")).toBe(2);

        const hostSession = await readPlayerSession(hostPage);
        const guestSession = await readPlayerSession(guestPage);
        await expectTokenHidden(hostPage, hostSession.token, hostErrors.consoleMessages);
        await expectTokenHidden(guestPage, guestSession.token, guestErrors.consoleMessages);
        expect(hostErrors.errors).toEqual([]);
        expect(guestErrors.errors).toEqual([]);
    } finally {
        hostMonitor.dispose();
        guestMonitor.dispose();
        await players.close();
    }
});

test("multiplayer BFCache 복귀와 terminal replacement는 stale 입력을 남기지 않는다", async ({ browser }) => {
    const context = await browser.newContext();
    const page = await context.newPage();
    const monitor = createAuthoritativeSnapshotMonitor(page);
    const browserErrors = captureBrowserErrors(page);

    try {
        await createPveRoom(page, "normal");
        await startPveMatch(page);
        await expect.poll(() => monitor.getSentEventCount("game:join")).toBe(1);
        const tokenBeforeRestore = (await readPlayerSession(page)).token;

        await page.evaluate(() => {
            window.dispatchEvent(new PageTransitionEvent("pagehide", { persisted: true }));
        });
        await Promise.all([
            page.waitForNavigation(),
            page.evaluate(() => {
                window.dispatchEvent(new PageTransitionEvent("pageshow", { persisted: true }));
            }),
        ]);
        await expect.poll(async () => (await readPlayerSession(page))?.token).not.toBe(
            tokenBeforeRestore,
        );
        await expect(page.locator('.next-preview[data-player="1"] .next-cell')).toHaveCount(32);
        await expect.poll(() => monitor.getSentEventCount("game:join")).toBe(2);

        const currentSession = await readPlayerSession(page);
        await page.evaluate((session) => new Promise((resolve, reject) => {
            const duplicateSocket = io({
                autoConnect: false,
                forceNew: true,
                reconnection: false,
                auth: {
                    playerId: session.playerId,
                    token: session.token,
                    nickname: session.nickname,
                },
            });
            duplicateSocket.on("session:ready", resolve);
            duplicateSocket.on("connect_error", reject);
            duplicateSocket.connect();
        }), currentSession);

        await expect(page.locator('.game-text[data-player="1"] > span')).toHaveText(
            TERMINAL_MESSAGE,
        );
        const inputCount = monitor.getSentGameInputCount();
        await page.keyboard.press("Space");
        await page.waitForTimeout(200);
        expect(monitor.getSentGameInputCount()).toBe(inputCount);
        expect(await readPlayerSession(page)).toEqual(currentSession);
        expect(browserErrors.errors).toEqual([]);
    } finally {
        monitor.dispose();
        await context.close();
    }
});

test("placement V4 badge와 production artifact 경계를 유지한다", async ({ page }) => {
    const browserErrors = captureBrowserErrors(page);
    await page.goto("/pages/multiLobby.html");
    await page.locator("#btnOpenCreateRoom").click();
    await page.locator("#btnOpenPveCreate").click();
    await page.locator('#aiPolicySelector input[value="placement_v4"]').check();
    await page.locator("#btnCreatePveRoom").click();
    await expect(page.locator("#btnPrimaryAction")).toBeEnabled();
    await Promise.all([
        page.waitForURL(MULTI_GAME_URL),
        page.locator("#btnPrimaryAction").click(),
    ]);

    await expect(page.locator('.next-preview[data-player="1"] .next-cell')).toHaveCount(32);
    const policyBadge = page.locator("#player2RoleBadge");
    await expect(policyBadge).toHaveText(
        /^(실험 AI · 동작 중|실험 AI · 휴리스틱 전환)$/,
    );
    const policyText = await policyBadge.textContent();
    if (policyText?.includes("전환")) {
        await expect(policyBadge).toHaveAttribute("title", /^모델 전환 사유: .+/);
    } else {
        await expect(policyBadge).not.toHaveAttribute("title");
    }

    if (process.env.PLAYWRIGHT_VITE_DEV !== "1") {
        const modulePath = await page.locator('script[type="module"]').getAttribute("src");
        expect(modulePath).toBeTruthy();
        expect((await page.request.get("/pages/tetrisMulti.tsx")).status()).toBe(404);
        expect((await page.request.get(`${modulePath}.map`)).status()).toBe(404);
    }
    expect(browserErrors.errors).toEqual([]);
});
