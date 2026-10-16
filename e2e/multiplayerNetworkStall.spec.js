const { test, expect } = require("@playwright/test");
const { createPveRoom, startPveMatch } = require("./helpers/pve.js");

test("열린 소켓의 응답이 멈추면 예측을 중지하고 재join 때 단절 중 입력을 버린다", async ({ page }) => {
    const errors = [];
    page.on("pageerror", error => errors.push(error.message));
    let stalled = false;
    await page.route("**/socket.io/**", route => {
        if (stalled && !route.request().url().endsWith("socket.io.js")) {
            return route.abort("internetdisconnected");
        }
        return route.continue();
    });
    await page.routeWebSocket("**/socket.io/**", socket => {
        const server = socket.connectToServer();
        server.onMessage(message => { if (!stalled) socket.send(message); });
        socket.onMessage(message => { if (!stalled) server.send(message); });
    });
    await page.addInitScript(() => {
        let factory;
        Object.defineProperty(window, "io", {
            configurable: true,
            get: () => factory,
            set: value => {
                factory = new Proxy(value, {
                    apply(target, thisArg, args) {
                        const socket = Reflect.apply(target, thisArg, args);
                        window.__stallSocket = socket;
                        window.__stallJoinCount = 0;
                        window.__stallInputCount = 0;
                        socket.on("game:join:result", result => {
                            if (result.ok) window.__stallJoinCount++;
                        });
                        const emit = socket.emit;
                        socket.emit = function (eventName, ...values) {
                            if (eventName === "game:input") window.__stallInputCount++;
                            return emit.call(this, eventName, ...values);
                        };
                        return socket;
                    },
                });
            },
        });
    });
    await createPveRoom(page, "normal");
    await startPveMatch(page);
    // 입력이 없는 정상 구간에서도 중력 snapshot이 재접속 제한 시간을 갱신한다.
    await page.waitForTimeout(5500);
    expect(await page.evaluate(() => window.__stallJoinCount)).toBe(1);
    expect(await page.evaluate(() => window.__stallSocket.connected)).toBe(true);

    stalled = true;
    await page.keyboard.press("Space");
    const ownScore = page.locator('.player-column[data-player="1"] .score');
    await expect(ownScore).not.toHaveText("0");
    const ownOverlay = page.locator('.game-text[data-player="1"] > span');
    await expect(ownOverlay).toHaveText("재연결 중", { timeout: 7000 });
    const inputCount = await page.evaluate(() => window.__stallInputCount);
    const stoppedBoard = await page.locator('.playground[data-player="1"] canvas').evaluate(canvas => canvas.toDataURL());
    await page.keyboard.press("Space");
    await page.keyboard.press("ArrowLeft");
    await page.waitForTimeout(200);
    expect(await page.evaluate(() => window.__stallInputCount)).toBe(inputCount);
    expect(await page.locator('.playground[data-player="1"] canvas').evaluate(canvas => canvas.toDataURL())).toBe(stoppedBoard);
    await expect(page.locator(".combat-projectile, .combat-achievement")).toHaveCount(0);

    stalled = false;
    await expect.poll(() => page.evaluate(() => window.__stallJoinCount), { timeout: 10000 }).toBe(2);
    await expect(page.locator('.game-text[data-player="1"]')).toBeHidden();
    await expect(ownScore).toHaveText("0");
    await page.keyboard.press("ArrowLeft");
    await expect.poll(() => page.evaluate(() => window.__stallInputCount)).toBe(inputCount + 1);
    await page.waitForTimeout(200);
    expect(await page.evaluate(() => window.__stallInputCount)).toBe(inputCount + 1);
    expect(errors).toEqual([]);
});
