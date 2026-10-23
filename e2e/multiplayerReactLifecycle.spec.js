/**
 * React 멀티플레이 shell이 mount·reconnect·BFCache 복귀 중 listener를 중복 생성하지
 * 않는지 검증한다.
 *
 * PVP에서는 두 격리 context의 join/input/HUD를 관찰하고, PVE에서는 terminal session과
 * V4 badge 경계를 확인한다. 생성한 socket monitor와 context는 finally에서 역순으로
 * 정리해 stale 입력이나 listener가 다음 테스트에 남지 않게 한다.
 */
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
    expect(page.url().includes(token)).toBe(false);
    expect((await page.content()).includes(token)).toBe(false);
    expect(consoleMessages.join("\n").includes(token)).toBe(false);
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
                await expect(column.locator(".next-preview .next-cell")).toHaveCount(64);
                await expect(column.locator(".next-preview .next-cell.preview")).toHaveCount(16);
                const nextLayout = await column.evaluate(root => {
                    const next = root.querySelector(".next-preview");
                    const board = root.querySelector("canvas");
                    const slots = [...next.querySelectorAll(".next-slot")]
                        .map(slot => slot.getBoundingClientRect());
                    const nextBounds = next.getBoundingClientRect();
                    const boardBounds = board.getBoundingClientRect();
                    return {
                        vertical: slots.every((slot, index) => index === 0 || slot.top >= slots[index - 1].bottom),
                        onOuterSide: root.dataset.player === "1"
                            ? nextBounds.right <= boardBounds.left
                            : boardBounds.right <= nextBounds.left,
                    };
                });
                expect(nextLayout).toEqual({ vertical: true, onOuterSide: true });
                await expect(column.locator(".hold-preview .next-cell")).toHaveCount(16);
                await expect(column.locator(".incoming-segment")).toHaveCount(20);
                await expect(column.getByRole("meter")).toHaveAttribute("aria-valuenow", "0");
                await expect(column.locator(".incoming-segment.is-filled")).toHaveCount(0);
                const railLayout = await column.evaluate(root => {
                    const meter = root.querySelector(".incoming-meter").getBoundingClientRect();
                    const board = root.querySelector("canvas").getBoundingClientRect();
                    return {
                        vertical: meter.height > meter.width * 4,
                        besideBoard: root.dataset.player === "1" ? meter.right <= board.left : board.right <= meter.left,
                    };
                });
                expect(railLayout).toEqual({ vertical: true, besideBoard: true });
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
                }))).toEqual({ width: 300, height: 720 });
            }
        }

        const desktopGap = await hostPage.evaluate(() => {
            const boards = [...document.querySelectorAll("canvas")].map(canvas => canvas.getBoundingClientRect());
            return boards[1].left - boards[0].right;
        });
        expect(desktopGap).toBeGreaterThan(240);
        await hostPage.setViewportSize({ width: 1280, height: 720 });
        await expect.poll(() => hostPage.evaluate(() => document.documentElement.scrollWidth)).toBe(1280);
        expect(await hostPage.evaluate(() => {
            const boards = [...document.querySelectorAll("canvas")].map(canvas => canvas.getBoundingClientRect());
            return boards[1].left - boards[0].right;
        })).toBeGreaterThan(160);
        await hostPage.setViewportSize({ width: 390, height: 844 });
        await expect.poll(() => hostPage.evaluate(() => document.documentElement.scrollWidth)).toBe(390);
        for (const playerNumber of [1, 2]) {
            const column = hostPage.locator(`.player-column[data-player="${playerNumber}"]`);
            const onOuterSide = await column.evaluate(root => {
                const preview = root.querySelector(".next-preview").getBoundingClientRect();
                const board = root.querySelector("canvas").getBoundingClientRect();
                return root.dataset.player === "1"
                    ? preview.right <= board.left
                    : board.right <= preview.left;
            });
            expect(onOuterSide).toBe(true);
            const meterBesideBoard = await column.evaluate(root => {
                const meter = root.querySelector(".incoming-meter").getBoundingClientRect();
                const board = root.querySelector("canvas").getBoundingClientRect();
                return root.dataset.player === "1" ? meter.right <= board.left : board.right <= meter.left;
            });
            expect(meterBesideBoard).toBe(true);
        }

        const soundToggle = hostPage.locator("#soundToggle");
        const soundPressed = await soundToggle.getAttribute("aria-pressed");
        await soundToggle.click();
        await expect(soundToggle).not.toHaveAttribute("aria-pressed", soundPressed);
        const themeToggle = hostPage.locator("#themeToggle");
        const themePressed = await themeToggle.getAttribute("aria-pressed");
        await themeToggle.click();
        await expect(themeToggle).not.toHaveAttribute("aria-pressed", themePressed);
        await expect(hostPage.locator("#effectsToggle")).toHaveCount(0);

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
        await expect.poll(async () => {
            return (await readPlayerSession(hostPage))?.token === sessionBeforeReconnect.token;
        }).toBe(false);
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
        await expect.poll(async () => {
            return (await readPlayerSession(page))?.token === tokenBeforeRestore;
        }).toBe(false);
        await expect(page.locator('.next-preview[data-player="1"] .next-cell')).toHaveCount(64);
        await expect.poll(() => monitor.getSentEventCount("game:join")).toBe(2);

        const currentSession = await readPlayerSession(page);
        await page.evaluate((session) => new Promise((resolve, reject) => {
            const duplicateSocket = io({
                autoConnect: false,
                forceNew: true,
                reconnection: false,
                auth: {
                    protocolVersion: 2,
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
        expect(JSON.stringify(await readPlayerSession(page)) === JSON.stringify(currentSession)).toBe(true);
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

    await expect(page.locator('.next-preview[data-player="1"] .next-cell')).toHaveCount(64);
    const policyBadge = page.locator("#player2RoleBadge");
    await expect(policyBadge).toContainText("실험 AI · 휴리스틱 전환");
    await expect(policyBadge).toContainText("새 규칙 미지원 · 휴리스틱 사용");
    await expect(policyBadge).toHaveAttribute("title", "새 규칙 미지원 · 휴리스틱 사용");

    if (process.env.PLAYWRIGHT_VITE_DEV !== "1") {
        const modulePath = await page.locator('script[type="module"]').getAttribute("src");
        expect(modulePath).toBeTruthy();
        expect((await page.request.get("/pages/tetrisMulti.tsx")).status()).toBe(404);
        expect((await page.request.get(`${modulePath}.map`)).status()).toBe(404);
    }
    expect(browserErrors.errors).toEqual([]);
});
