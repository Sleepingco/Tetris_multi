const { test, expect } = require("@playwright/test");

const INPUT_TICK_MS = 16;
const TREE_COLOR = [139, 92, 246];

function captureBrowserErrors(page) {
    const errors = [];
    page.on("console", message => {
        if (message.type() === "error") errors.push(message.text());
    });
    page.on("pageerror", error => errors.push(error.message));
    return errors;
}

async function readTopTreeCells(page) {
    return page.locator("#tetrisBoardCanvas").evaluate((canvas, treeColor) => {
        const context = canvas.getContext("2d");
        const cells = [];
        for (let row = 0; row < 4; row += 1) {
            for (let col = 0; col < 10; col += 1) {
                const [red, green, blue, alpha] = context.getImageData(
                    col * 30 + 15,
                    row * 30 + 15,
                    1,
                    1,
                ).data;
                const matches = [red, green, blue].every((channel, index) => {
                    return Math.abs(channel - treeColor[index]) <= 4;
                });
                if (alpha >= 240 && matches) cells.push({ row, col });
            }
        }
        return cells.sort((left, right) => left.row - right.row || left.col - right.col);
    }, TREE_COLOR);
}

async function pressGameKey(page, key) {
    await page.keyboard.press(key);
    await page.clock.runFor(INPUT_TICK_MS);
}

async function reachGameOver(page) {
    for (let attempt = 0; attempt < 20; attempt += 1) {
        if (await page.locator(".game-text").isVisible()) return;
        await pressGameKey(page, "Space");
    }
    await expect(page.locator(".game-text")).toBeVisible();
}

test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
        Math.random = () => 0;
    });
    const pausedTime = new Date("2026-07-21T00:00:00.000Z");
    await page.clock.install({ time: pausedTime });
    await page.clock.pauseAt(pausedTime);
});

test("single StrictMode lifecycle은 입력·sound listener와 preview를 한 세트만 유지한다", async ({ page }) => {
    const errors = captureBrowserErrors(page);
    await page.goto("/pages/tetrisSingle.html");

    await expect(page.locator(".next-slot")).toHaveCount(2);
    await expect(page.locator(".next-preview .next-cell")).toHaveCount(32);
    await expect(page.locator(".hold-preview .next-cell")).toHaveCount(16);
    const soundToggle = page.locator("#soundToggle");
    const initialPressed = await soundToggle.getAttribute("aria-pressed");
    await soundToggle.click();
    await expect(soundToggle).not.toHaveAttribute("aria-pressed", initialPressed);

    const before = await readTopTreeCells(page);
    await pressGameKey(page, "ArrowLeft");
    const after = await readTopTreeCells(page);
    expect(after).toEqual(before.map(cell => ({ row: cell.row, col: cell.col - 1 })));

    await pressGameKey(page, "KeyC");
    await expect(page.locator(".hold-preview .next-cell.tree.preview")).toHaveCount(4);
    expect(errors).toEqual([]);
});

test("single 첫 키 입력은 차단된 BGM을 중복 없이 한 번 재시도한다", async ({ page }) => {
    await page.addInitScript(() => {
        window.__musicPlayAttempts = [];
        HTMLMediaElement.prototype.play = function play() {
            const userActivated = navigator.userActivation.isActive;
            window.__musicPlayAttempts.push({ src: this.src, userActivated });
            if (userActivated) return Promise.resolve();
            return Promise.reject(new DOMException("Autoplay blocked", "NotAllowedError"));
        };
    });
    await page.goto("/pages/tetrisSingle.html");

    await expect.poll(() => page.evaluate(() => window.__musicPlayAttempts.length))
        .toBeGreaterThan(0);
    const attemptsBeforeInteraction = await page.evaluate(() => window.__musicPlayAttempts.length);
    await page.keyboard.press("ArrowLeft");
    await expect.poll(() => page.evaluate(() => window.__musicPlayAttempts.length))
        .toBe(attemptsBeforeInteraction + 1);
    expect(await page.evaluate(() => window.__musicPlayAttempts.at(-1))).toMatchObject({
        userActivated: true,
    });
});

test("single game-over와 반복 restart는 HUD와 input lifecycle을 복원한다", async ({ page }) => {
    const errors = captureBrowserErrors(page);
    await page.goto("/pages/tetrisSingle.html");

    for (let restartCount = 0; restartCount < 2; restartCount += 1) {
        await reachGameOver(page);
        await expect(page.locator(".game-text")).toBeVisible();
        await page.locator(".game-text > button").click();
        await expect(page.locator(".game-text")).not.toBeVisible();
        await expect(page.locator(".score")).toHaveText("0");
    }

    const before = await readTopTreeCells(page);
    await pressGameKey(page, "ArrowLeft");
    const after = await readTopTreeCells(page);
    expect(after).toEqual(before.map(cell => ({ row: cell.row, col: cell.col - 1 })));
    expect(errors).toEqual([]);
});

test("single BFCache 복귀는 pagehide cleanup 뒤 reload로 lifecycle을 복원한다", async ({ page }) => {
    const errors = captureBrowserErrors(page);
    await page.goto("/pages/tetrisSingle.html");
    await page.evaluate(() => {
        window.dispatchEvent(new PageTransitionEvent("pagehide", { persisted: true }));
    });
    await Promise.all([
        page.waitForNavigation(),
        page.evaluate(() => {
            window.dispatchEvent(new PageTransitionEvent("pageshow", { persisted: true }));
        }),
    ]);

    const before = await readTopTreeCells(page);
    await pressGameKey(page, "ArrowLeft");
    const after = await readTopTreeCells(page);
    expect(after).toEqual(before.map(cell => ({ row: cell.row, col: cell.col - 1 })));
    expect(errors).toEqual([]);
});

test("production single artifact는 TSX source와 source map을 제공하지 않는다", async ({ page }) => {
    test.skip(process.env.PLAYWRIGHT_VITE_DEV === "1", "production artifact 전용 검증");
    await page.goto("/pages/tetrisSingle.html");
    const modulePath = await page.locator('script[type="module"]').getAttribute("src");
    expect(modulePath).toBeTruthy();
    expect((await page.request.get("/pages/tetrisSingle.tsx")).status()).toBe(404);
    expect((await page.request.get(`${modulePath}.map`)).status()).toBe(404);
});
