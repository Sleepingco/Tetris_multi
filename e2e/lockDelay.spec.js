const { test, expect } = require("@playwright/test");
const { enterTwoPlayerMatch, waitForBoardConvergence, readPlayerSession } = require("./helpers/multiplayer.js");
const { createPveRoom, startPveMatch, createPveSocketMonitor } = require("./helpers/pve.js");

async function readSkyCells(page) {
    return page.locator("#tetrisBoardCanvas").evaluate(canvas => {
        const ctx = canvas.getContext("2d");
        const cells = [];
        const visibleTop = canvas.height - 20 * canvas.width / 10;
        for (let row = 14; row < 20; row++) {
            for (let col = 0; col < 10; col++) {
                const [r, g, b, a] = ctx.getImageData((col + 0.5) * canvas.width / 10,
                    visibleTop + (row + 0.5) * canvas.width / 10, 1, 1).data;
                if (a >= 240 && Math.abs(r - 14) <= 4 && Math.abs(g - 165) <= 4 && Math.abs(b - 233) <= 4) {
                    cells.push({ row, col });
                }
            }
        }
        return cells;
    });
}

test("싱글의 I 벽차기·재낙하는 고정 유예를 복구하지 않는다", async ({ page }) => {
    await page.addInitScript(() => { Math.random = () => 0.4; });
    const time = new Date("2026-10-19T00:00:00Z");
    await page.clock.install({ time });
    await page.clock.pauseAt(time);
    await page.goto("/pages/tetrisSingle.html");
    await expect(page.locator(".next-preview .next-cell")).toHaveCount(64);
    for (let index = 0; index < 19; index++) {
        await page.keyboard.press("ArrowDown");
        await page.clock.runFor(16);
    }
    expect(await readSkyCells(page)).toHaveLength(4);
    for (const key of ["KeyX", "KeyZ"]) {
        await page.keyboard.press(key);
        await page.clock.runFor(16);
    }
    await page.clock.runFor(800);
    const fixed = await readSkyCells(page);
    expect(fixed).toHaveLength(4);
    expect(fixed.every(cell => cell.row === 19)).toBe(true);
    await page.keyboard.press("ArrowLeft");
    await page.clock.runFor(16);
    expect(await readSkyCells(page)).toEqual(fixed);
});

for (const mode of ["pvp", "pve"]) {
    test(`${mode}는 착지 예산을 서버에서 고정하고 보드와 재접속 상태를 동기화한다`, async ({ page, browser }) => {
        const errors = [];
        page.on("pageerror", error => errors.push(error.message));
        await page.addInitScript(() => {
            let factory;
            Object.defineProperty(window, "io", {
                configurable: true, get: () => factory,
                set: value => {
                    factory = new Proxy(value, {
                        apply(target, thisArg, args) {
                            const socket = Reflect.apply(target, thisArg, args);
                            window.__lockSocket = socket;
                            window.__lockJoinCount = 0;
                            socket.on("game:join:result", result => {
                                if (result.ok) {
                                    window.__lockJoinCount++;
                                    window.__lockJoinResult = result;
                                }
                            });
                            return socket;
                        },
                    });
                },
            });
        });
        const monitor = createPveSocketMonitor(page);
        let guestContext;
        let guest;
        try {
            if (mode === "pvp") {
                guestContext = await browser.newContext();
                guest = await guestContext.newPage();
                await enterTwoPlayerMatch(page, guest);
            } else {
                await createPveRoom(page, "normal");
                await startPveMatch(page);
            }
            const { playerId } = await readPlayerSession(page);
            const initial = await page.evaluate(id => window.__lockJoinResult.match.players
                .find(player => player.playerId === id).snapshot, playerId);
            expect(initial.lockDelay.resetCount).toBe(0);
            for (let index = 0; index < 19; index++) {
                await page.keyboard.press("ArrowDown");
                await page.waitForTimeout(20);
            }
            await expect.poll(() => monitor.getSnapshots(playerId).some(snapshot =>
                snapshot.pieceIndex === initial.pieceIndex && snapshot.lockDelay?.hasTouchedGround)).toBe(true);
            const touched = monitor.getSnapshots(playerId).findLast(snapshot =>
                snapshot.pieceIndex === initial.pieceIndex && snapshot.lockDelay?.hasTouchedGround);
            expect(touched.lockDelay.remainingMs).toBeGreaterThan(0);
            expect(touched.lockDelay.remainingMs).toBeLessThanOrEqual(500);
            if (mode === "pve") {
                await page.evaluate(() => { window.__lockSocket.disconnect(); window.__lockSocket.connect(); });
                await expect.poll(() => page.evaluate(() => window.__lockJoinCount)).toBe(2);
                const restored = await page.evaluate(id => window.__lockJoinResult.match.players
                    .find(player => player.playerId === id).snapshot, playerId);
                if (restored.pieceIndex === initial.pieceIndex) {
                    expect(restored.lockDelay.resetCount).toBe(touched.lockDelay.resetCount);
                    expect(restored.lockDelay.remainingMs).toBeLessThanOrEqual(touched.lockDelay.remainingMs);
                } else expect(restored.pieceIndex).toBeGreaterThan(initial.pieceIndex);
            }
            await expect.poll(() => monitor.getSnapshots(playerId).some(snapshot =>
                snapshot.pieceIndex > initial.pieceIndex && snapshot.occupiedCellCount >= 4)).toBe(true);
            if (guest) {
                await waitForBoardConvergence({ sourcePage: page, observerPage: guest,
                    playerNumber: 1, previousFingerprint: Array(60).fill("empty").join("|") });
            }
            expect(errors).toEqual([]);
        } finally {
            monitor.dispose();
            await guestContext?.close();
        }
    });
}
