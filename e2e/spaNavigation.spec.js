const { test, expect } = require("@playwright/test");
const { parseSocketIoFrame } = require("./helpers/multiplayer.js");

function monitorSentSocketEvents(page) {
    const events = [];
    const record = payload => {
        const [eventName] = parseSocketIoFrame(payload) || [];
        if (eventName) events.push(eventName);
    };
    page.on("request", request => {
        if (request.method() !== "POST" || !request.url().includes("/socket.io/")) return;
        request.postData()?.split("\x1e").forEach(record);
    });
    page.on("websocket", webSocket => {
        webSocket.on("framesent", ({ payload }) => record(payload));
    });
    return events;
}

function captureBrowserErrors(page) {
    const errors = [];
    page.on("console", message => {
        if (message.type() === "error") errors.push(message.text());
    });
    page.on("pageerror", error => errors.push(error.message));
    return errors;
}

async function expectActiveStyle(page, expected) {
    await expect.poll(() => page.evaluate(() => ({
        shell: document.getElementById("shellStyles").media === "all",
        game: document.getElementById("gameStyles").media === "all",
    }))).toEqual(expected === "game"
        ? { shell: false, game: true }
        : { shell: true, game: false });
}

async function startPveMatch(page) {
    await page.goto("/pages/multiLobby.html");
    await expect(page.locator("#btnOpenCreateRoom")).toBeEnabled();
    await page.locator("#btnOpenCreateRoom").click();
    await page.locator("#btnOpenPveCreate").click();
    await page.locator("#btnCreatePveRoom").click();
    await expect(page.locator("#btnPrimaryAction")).toBeEnabled();
    await page.locator("#btnPrimaryAction").click();
    await expect(page).toHaveURL(/\/pages\/tetrisMulti\.html\?roomId=/);
    await expect(page.locator('.next-preview[data-player="1"] .next-cell')).toHaveCount(32);
}

test("승인된 legacy URL만 단일 shell을 제공하고 route별 title과 style을 유지한다", async ({ page }) => {
    const routes = [
        ["/", "Tetris Multi", ".hero-title", "shell"],
        ["/pages/index.html", "Tetris Multi", ".hero-title", "shell"],
        ["/pages/multiLobby.html", "멀티플레이 로비 - Tetris Multi", "#playerNicknameText", "shell"],
        ["/pages/tetrisSingle.html", "Single Player Tetris", "#tetrisBoardCanvas", "game"],
    ];

    for (const [url, title, selector, style] of routes) {
        await page.goto(url);
        await expect(page).toHaveTitle(title);
        await expect(page.locator(selector)).toBeVisible();
        await expectActiveStyle(page, style);
        await page.reload();
        await expect(page.locator(selector)).toBeVisible();
    }

    expect((await page.request.get("/pages/tetrisMulti.html?roomId=missing")).status()).toBe(200);
    expect((await page.request.get("/unknown-route")).status()).toBe(404);
    expect((await page.request.get("/assets/unknown.js")).status()).toBe(404);
    expect((await page.request.get("/socket.io/socket.io.js")).status()).toBe(200);

    if (process.env.PLAYWRIGHT_VITE_DEV !== "1") {
        const modulePath = await page.locator('script[type="module"]').getAttribute("src");
        expect((await page.request.get("/pages/spa.tsx")).status()).toBe(404);
        expect((await page.request.get("/pages/tetrisSingle.tsx")).status()).toBe(404);
        expect((await page.request.get(`${modulePath}.map`)).status()).toBe(404);
    }
});

test("index와 single 최초 진입은 Socket transport를 열지 않는다", async ({ browser }) => {
    for (const url of ["/", "/pages/tetrisSingle.html"]) {
        const context = await browser.newContext();
        const page = await context.newPage();
        const transports = [];
        page.on("websocket", socket => {
            if (socket.url().includes("/socket.io/")) transports.push(socket.url());
        });
        page.on("request", request => {
            if (request.url().includes("/socket.io/?")) transports.push(request.url());
        });
        await page.goto(url);
        await page.waitForTimeout(250);
        expect(transports).toEqual([]);
        await context.close();
    }
});

test("내부 link와 history back/forward는 document reload 없이 route를 정리하고 다시 mount한다", async ({ page }) => {
    const errors = captureBrowserErrors(page);
    await page.goto("/");
    const timeOrigin = await page.evaluate(() => performance.timeOrigin);

    await page.locator("#btnSingle").click();
    await expect(page).toHaveURL(/\/pages\/tetrisSingle\.html$/);
    await expect(page.locator("#tetrisBoardCanvas")).toBeVisible();
    await expectActiveStyle(page, "game");
    await expect.poll(() => page.evaluate(() => document.activeElement?.id)).toBe("appRoot");
    await expect(page.locator(".route-announcement")).toHaveText("Single Player Tetris 화면");
    expect(await page.evaluate(() => performance.timeOrigin)).toBe(timeOrigin);

    await page.locator(".home-btn").click();
    await expect(page).toHaveURL(/\/pages\/index\.html$/);
    await expect(page.locator(".hero-title")).toBeVisible();
    await expectActiveStyle(page, "shell");

    await page.evaluate(() => history.back());
    await expect(page).toHaveURL(/\/pages\/tetrisSingle\.html$/);
    await expect(page.locator("#tetrisBoardCanvas")).toBeVisible();
    await page.evaluate(() => history.forward());
    await expect(page).toHaveURL(/\/pages\/index\.html$/);
    await expect(page.locator(".hero-title")).toBeVisible();
    expect(await page.evaluate(() => performance.timeOrigin)).toBe(timeOrigin);
    expect(errors).toEqual([]);
});

test("waiting lobby 이탈은 room leave를 한 번 보내고 같은 Socket을 재사용한다", async ({ page }) => {
    const events = monitorSentSocketEvents(page);
    const sockets = [];
    page.on("websocket", socket => {
        if (socket.url().includes("/socket.io/")) sockets.push(socket.url());
    });
    await page.goto("/");
    await page.locator("[data-multi-lobby-link]").click();
    await expect(page.locator("#btnOpenCreateRoom")).toBeEnabled();
    await page.locator("#btnOpenCreateRoom").click();
    await page.locator("#btnCreateRoom").click();
    await expect(page.locator("#roomStatus")).toBeVisible();
    const securityState = await page.evaluate(() => {
        const token = JSON.parse(sessionStorage.getItem("tetris:playerSession")).token;
        return {
            token,
            url: window.location.href,
            html: document.documentElement.outerHTML,
            history: JSON.stringify(history.state),
        };
    });
    expect(securityState.url).not.toContain(securityState.token);
    expect(securityState.html).not.toContain(securityState.token);
    expect(securityState.history).not.toContain(securityState.token);

    events.length = 0;
    await page.locator(".nav .btn", { hasText: "홈으로" }).click();
    await expect(page).toHaveURL(/\/pages\/index\.html$/);
    await expect.poll(() => events.filter(event => event === "room:leave").length).toBe(1);
    await page.waitForTimeout(200);
    expect(events.filter(event => event === "room:leave")).toHaveLength(1);

    await page.locator("[data-multi-lobby-link]").click();
    await expect(page.locator("#btnOpenCreateRoom")).toBeEnabled();
    await expect(page.locator("#roomStatus")).toBeHidden();
    expect(sockets).toHaveLength(1);
});

test("disconnect 중 lobby 이탈은 reconnect ready에서 leave만 한 번 replay한다", async ({ context, page }) => {
    const events = monitorSentSocketEvents(page);
    await page.goto("/pages/multiLobby.html");
    await expect(page.locator("#btnOpenCreateRoom")).toBeEnabled();
    await page.locator("#btnOpenCreateRoom").click();
    await page.locator("#btnCreateRoom").click();
    await expect(page.locator("#roomStatus")).toBeVisible();

    await context.setOffline(true);
    await expect(page.locator("#chatMessages")).toContainText("재연결 중");
    events.length = 0;
    await page.locator(".nav .btn", { hasText: "홈으로" }).click();
    await expect(page).toHaveURL(/\/pages\/index\.html$/);
    expect(events.filter(event => event === "room:leave")).toHaveLength(0);

    await context.setOffline(false);
    await expect.poll(() => events.filter(event => event === "room:leave").length, {
        timeout: 10_000,
    }).toBe(1);
    await page.waitForTimeout(300);
    expect(events.filter(event => event === "room:leave")).toHaveLength(1);
    expect(events.filter(event => event === "room:sync")).toHaveLength(0);
    expect(events.filter(event => event === "game:join")).toHaveLength(0);
});

test("active PVE의 browser back은 game leave를 한 번 보내고 lobby로 돌아간다", async ({ page }) => {
    const events = monitorSentSocketEvents(page);
    await startPveMatch(page);

    events.length = 0;
    await page.evaluate(() => history.back());
    await expect(page).toHaveURL(/\/pages\/multiLobby\.html$/);
    await expect.poll(() => events.filter(event => event === "game:leave").length).toBe(1);
    await page.waitForTimeout(200);
    expect(events.filter(event => event === "game:leave")).toHaveLength(1);
});

test("disconnect 중 active game back은 reconnect ready에서 game leave만 replay한다", async ({ context, page }) => {
    const events = monitorSentSocketEvents(page);
    await startPveMatch(page);

    await context.setOffline(true);
    await expect(page.locator('.game-text[data-player="1"]')).toContainText("재연결 중");
    events.length = 0;
    await page.evaluate(() => history.back());
    await expect(page).toHaveURL(/\/pages\/multiLobby\.html$/);
    expect(events.filter(event => event === "game:leave")).toHaveLength(0);

    await context.setOffline(false);
    await expect.poll(() => events.filter(event => event === "game:leave").length, {
        timeout: 10_000,
    }).toBe(1);
    await page.waitForTimeout(300);
    expect(events.filter(event => event === "game:leave")).toHaveLength(1);
    expect(events.filter(event => event === "game:join")).toHaveLength(0);
    expect(events.filter(event => event === "room:sync")).toHaveLength(0);
});
