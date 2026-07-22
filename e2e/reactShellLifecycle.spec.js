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
    const consoleMessages = [];
    const errors = [];
    page.on("console", message => {
        consoleMessages.push(message.text());
        if (message.type() === "error") errors.push(message.text());
    });
    page.on("pageerror", error => errors.push(error.message));
    return { consoleMessages, errors };
}

test("React lobby lifecycle은 listener와 초기 room sync를 한 세트만 유지한다", async ({ browser }) => {
    const hostContext = await browser.newContext();
    const guestContext = await browser.newContext();
    const hostPage = await hostContext.newPage();
    const guestPage = await guestContext.newPage();
    const hostEvents = monitorSentSocketEvents(hostPage);
    const hostErrors = captureBrowserErrors(hostPage);
    const guestErrors = captureBrowserErrors(guestPage);

    try {
        await hostPage.goto("/pages/multiLobby.html");
        await expect(hostPage.locator("#btnOpenCreateRoom")).toBeEnabled();
        await hostPage.locator("#btnOpenCreateRoom").click();
        await hostPage.locator("#btnCreateRoom").click();
        await expect(hostPage.locator("#roomStatus")).toBeVisible();
        await expect(hostPage.locator("#chatMessages .chat-msg").filter({
            hasText: "방이 생성되었습니다.",
        })).toHaveCount(1);
        const roomId = (await hostPage.locator("#roomCodeText").textContent()).trim();

        hostEvents.length = 0;
        await hostPage.reload();
        await expect(hostPage.locator("#roomCodeText")).toHaveText(roomId);
        await expect.poll(() => hostEvents.filter(event => event === "room:sync").length).toBe(1);
        await hostPage.waitForTimeout(200);
        expect(hostEvents.filter(event => event === "room:sync")).toHaveLength(1);

        await guestPage.goto("/pages/multiLobby.html");
        await guestPage.locator("#roomCodeInput").fill(roomId);
        await guestPage.locator("#btnJoinCode").click();
        await expect(hostPage.locator("#roomPlayerCountText")).toHaveText("2");
        await guestPage.locator("#chatScope").selectOption("room");
        await guestPage.locator("#chatInput").fill("react-lifecycle-message");
        await guestPage.locator("#chatForm").getByRole("button", { name: "전송" }).click();
        await expect(hostPage.locator("#chatMessages .chat-msg").filter({
            hasText: "react-lifecycle-message",
        })).toHaveCount(1);

        const hostToken = await hostPage.evaluate(() => {
            return JSON.parse(sessionStorage.getItem("tetris:playerSession")).token;
        });
        const guestToken = await guestPage.evaluate(() => {
            return JSON.parse(sessionStorage.getItem("tetris:playerSession")).token;
        });
        expect(hostPage.url()).not.toContain(hostToken);
        expect(await hostPage.content()).not.toContain(hostToken);
        expect(hostErrors.consoleMessages.join("\n")).not.toContain(hostToken);
        expect(guestPage.url()).not.toContain(guestToken);
        expect(await guestPage.content()).not.toContain(guestToken);
        expect(guestErrors.consoleMessages.join("\n")).not.toContain(guestToken);
        expect(hostErrors.errors).toEqual([]);
        expect(guestErrors.errors).toEqual([]);
    } finally {
        await Promise.allSettled([hostContext.close(), guestContext.close()]);
    }
});

test("index BFCache 복귀는 reload 후 sound toggle listener를 복원한다", async ({ page }) => {
    await page.goto("/pages/index.html");
    const soundToggle = page.locator("#soundToggle");
    const initialPressed = await soundToggle.getAttribute("aria-pressed");

    await page.evaluate(() => {
        window.dispatchEvent(new PageTransitionEvent("pagehide", { persisted: true }));
    });
    await Promise.all([
        page.waitForNavigation(),
        page.evaluate(() => {
            window.dispatchEvent(new PageTransitionEvent("pageshow", { persisted: true }));
        }),
    ]);

    await soundToggle.click();
    await expect(soundToggle).not.toHaveAttribute("aria-pressed", initialPressed);
});

test("index는 자동재생 차단 뒤 첫 사용자 상호작용에서 BGM을 한 번 재시도한다", async ({ page }) => {
    await page.addInitScript(() => {
        window.__musicPlayAttempts = [];
        HTMLMediaElement.prototype.play = function play() {
            const userActivated = navigator.userActivation.isActive;
            window.__musicPlayAttempts.push({ src: this.src, userActivated });
            if (userActivated) return Promise.resolve();
            return Promise.reject(new DOMException("Autoplay blocked", "NotAllowedError"));
        };
    });
    await page.goto("/pages/index.html");

    await expect.poll(() => page.evaluate(() => {
        return window.__musicPlayAttempts.filter(attempt => {
            return attempt.src.includes("tetris_lobby_music") && !attempt.userActivated;
        }).length;
    })).toBeGreaterThan(0);

    const attemptsBeforeSyntheticEvent = await page.evaluate(() => window.__musicPlayAttempts.length);
    await page.evaluate(() => document.dispatchEvent(new MouseEvent("click", { bubbles: true })));
    expect(await page.evaluate(() => window.__musicPlayAttempts.length))
        .toBe(attemptsBeforeSyntheticEvent);

    const attemptsBeforeInteraction = await page.evaluate(() => window.__musicPlayAttempts.length);
    await page.locator("#nicknameInput").click();
    await expect.poll(() => page.evaluate(() => window.__musicPlayAttempts.length))
        .toBe(attemptsBeforeInteraction + 1);
    expect(await page.evaluate(() => window.__musicPlayAttempts.at(-1))).toMatchObject({
        userActivated: true,
    });
});

test("production React artifact는 TSX source와 source map을 제공하지 않는다", async ({ page }) => {
    test.skip(process.env.PLAYWRIGHT_VITE_DEV === "1", "production artifact 전용 검증");
    await page.goto("/pages/multiLobby.html");
    const modulePath = await page.locator('script[type="module"]').getAttribute("src");
    expect(modulePath).toBeTruthy();
    expect((await page.request.get("/pages/multiLobby.tsx")).status()).toBe(404);
    expect((await page.request.get(`${modulePath}.map`)).status()).toBe(404);
});
