const { test, expect } = require("@playwright/test");
const { createWaitingRoom, startWaitingMatch, createAuthoritativeSnapshotMonitor } = require("./helpers/multiplayer.js");

const actions = ["왼쪽 이동", "오른쪽 이동", "소프트 드롭", "시계 회전", "반시계 회전", "하드 드롭", "홀드"];

const touches = new WeakMap();
async function touchState(page) {
    if (!touches.has(page)) touches.set(page, { session: await page.context().newCDPSession(page), points: new Map() });
    return touches.get(page);
}
async function touchDown(page, name, pointerId) {
    const state = await touchState(page);
    const button = page.getByRole("button", { name, exact: true });
    await button.scrollIntoViewIfNeeded();
    const box = await button.boundingBox();
    state.points.set(pointerId, { id: pointerId, x: box.x + box.width / 2, y: box.y + box.height / 2 });
    await state.session.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [...state.points.values()] });
}
async function touchUp(page, name, pointerId, type = "pointerup") {
    const state = await touchState(page);
    if (type === "pointercancel") {
        state.points.clear();
        await state.session.send("Input.dispatchTouchEvent", { type: "touchCancel", touchPoints: [] });
        return;
    }
    state.points.delete(pointerId);
    await state.session.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [...state.points.values()] });
}
async function canvasData(page) {
    return page.locator("#tetrisBoardCanvas").evaluate(canvas => canvas.toDataURL());
}

for (const viewport of [{ width: 390, height: 844 }, { width: 844, height: 390 }]) {
    test(`B01 touch ${viewport.width}x${viewport.height} 싱글 7개 버튼으로 이동·회전·홀드·drop·재시작`, async ({ browser }) => {
        const context = await browser.newContext({ viewport, hasTouch: true, isMobile: true });
        const page = await context.newPage();
        try {
            await page.addInitScript(() => { Math.random = () => 0; });
            await page.clock.install({ time: new Date("2026-11-03T00:00:00Z") });
            await page.clock.pauseAt(new Date("2026-11-03T00:00:00Z"));
            await page.goto("/pages/tetrisSingle.html");
            for (const name of actions) {
                const button = page.getByRole("button", { name, exact: true });
                await expect(button).toBeVisible();
                const box = await button.boundingBox();
                expect(box.width).toBeGreaterThanOrEqual(40);
                expect(box.height).toBeGreaterThanOrEqual(40);
                expect(box.y).toBeGreaterThanOrEqual(0);
                expect(box.y + box.height).toBeLessThanOrEqual(viewport.height + 1);
                expect(box.x).toBeGreaterThanOrEqual(0);
                expect(box.x + box.width).toBeLessThanOrEqual(viewport.width + 1);
            }
            const board = await page.locator("#tetrisBoardCanvas").boundingBox();
            expect(board.y).toBeGreaterThanOrEqual(0);
            expect(board.y + board.height).toBeLessThanOrEqual(viewport.height + 1);
            const before = await canvasData(page);
            await touchDown(page, "왼쪽 이동", 1);
            await page.clock.runFor(16);
            const moved = await canvasData(page);
            expect(moved).not.toBe(before);
            await touchDown(page, "시계 회전", 2);
            await page.clock.runFor(16);
            expect(await canvasData(page)).not.toBe(moved);
            await touchUp(page, "시계 회전", 2);
            await page.clock.runFor(130);
            await touchUp(page, "왼쪽 이동", 1, "pointercancel");
            const stopped = await canvasData(page);
            await page.clock.runFor(150);
            expect(await canvasData(page)).toBe(stopped);
            await touchDown(page, "홀드", 3);
            await touchUp(page, "홀드", 3);
            await page.clock.runFor(16);
            await expect(page.locator(".hold-preview .preview")).toHaveCount(4);
            for (let count = 0; count < 30 && !(await page.locator(".game-text").isVisible()); count++) {
                await touchDown(page, "하드 드롭", 4);
                await touchUp(page, "하드 드롭", 4);
                await page.clock.runFor(40);
            }
            await expect(page.locator(".game-text")).toBeVisible();
            await page.locator(".game-text > button").click();
            await expect(page.locator(".game-text")).toBeHidden();
            await touchDown(page, "오른쪽 이동", 5);
            await touchUp(page, "오른쪽 이동", 5);
            await page.clock.runFor(16);
            await expect(page.locator(".score")).toHaveText("0");
        } finally {
            await context.close();
        }
    });
}

test("B01 입력 장치 탐지와 무관하게 터치 컨트롤을 수동으로 열 수 있다", async ({ page }) => {
    await page.goto("/pages/tetrisSingle.html");
    const toggle = page.getByRole("button", { name: /터치 조작/ });
    await expect(toggle).toBeVisible();
    await toggle.click();
    await expect(page.getByRole("button", { name: "왼쪽 이동", exact: true })).toBeVisible();
});

for (const viewport of [{ width: 390, height: 844 }, { width: 844, height: 390 }]) {
test(`B01 멀티 guest ${viewport.width}x${viewport.height} 터치 입력은 자기 보드 authoritative 입력으로 전달되고 취소된다`, async ({ browser }) => {
    const hostContext = await browser.newContext();
    const guestContext = await browser.newContext({ viewport, hasTouch: true, isMobile: true });
    const players = { hostPage: await hostContext.newPage(), guestPage: await guestContext.newPage(),
        close: () => Promise.all([hostContext.close(), guestContext.close()]) };
    const monitor = createAuthoritativeSnapshotMonitor(players.guestPage);
    try {
        await createWaitingRoom(players.hostPage, players.guestPage);
        await startWaitingMatch(players.hostPage, players.guestPage);
        const ownBoard = await players.guestPage.locator(".player-column.is-mine canvas").boundingBox();
        expect(ownBoard.width).toBeGreaterThanOrEqual(60);
        expect(ownBoard.y).toBeGreaterThanOrEqual(0);
        expect(ownBoard.y + ownBoard.height).toBeLessThanOrEqual(viewport.height + 1);
        const controls = await players.guestPage.locator(".touch-controls-buttons").boundingBox();
        expect(controls.y).toBeGreaterThanOrEqual(0);
        expect(controls.y + controls.height).toBeLessThanOrEqual(viewport.height + 1);
        expect(ownBoard.y + ownBoard.height <= controls.y || ownBoard.x + ownBoard.width <= controls.x).toBe(true);
        await touchDown(players.guestPage, "왼쪽 이동", 1);
        await touchDown(players.guestPage, "시계 회전", 2);
        await touchUp(players.guestPage, "시계 회전", 2);
        await expect.poll(() => monitor.getSentGameInputs().map(input => input.action)).toEqual(expect.arrayContaining(["move_left", "rotate"]));
        await touchUp(players.guestPage, "왼쪽 이동", 1, "pointercancel");
        await players.guestPage.waitForTimeout(100);
        const count = monitor.getSentGameInputCount();
        await players.guestPage.waitForTimeout(200);
        expect(monitor.getSentGameInputCount()).toBe(count);
    } finally {
        monitor.dispose();
        await players.close();
    }
});

}

test("B01 PVE에서도 키보드 없이 홀드와 하드 드롭이 서버에 전달된다", async ({ browser }) => {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
    const page = await context.newPage();
    const monitor = createAuthoritativeSnapshotMonitor(page);
    try {
        await page.goto("/pages/multiLobby.html");
        await expect(page.locator("#btnOpenPveCreate")).toBeEnabled();
        await page.locator("#btnOpenPveCreate").click();
        await page.locator("#btnCreatePveRoom").click();
        await expect(page.locator("#btnPrimaryAction")).toBeEnabled();
        await page.locator("#btnPrimaryAction").click();
        await page.waitForURL(/tetrisMulti\.html/);
        await expect(page.locator('.next-preview[data-player="1"] .next-cell')).toHaveCount(64);
        await expect(page.locator('.game-text[data-player="1"]')).toBeHidden();
        const geometry = await page.evaluate(() => {
            const board = document.querySelector(".player-column.is-mine canvas").getBoundingClientRect();
            const controls = document.querySelector(".touch-controls-buttons").getBoundingClientRect();
            return { boardVisible: board.top >= 0 && board.bottom <= innerHeight,
                controlsVisible: controls.top >= 0 && controls.bottom <= innerHeight,
                separated: board.bottom <= controls.top || controls.right <= board.left || controls.left >= board.right };
        });
        expect(geometry).toEqual({ boardVisible: true, controlsVisible: true, separated: true });
        await touchDown(page, "홀드", 1);
        await touchUp(page, "홀드", 1);
        await expect.poll(() => monitor.getSentGameInputs().map(input => input.action)).toContain("hold");
        await touchDown(page, "하드 드롭", 2);
        await touchUp(page, "하드 드롭", 2);
        await expect.poll(() => monitor.getSentGameInputs().map(input => input.action)).toContain("hard_drop");
    } finally {
        monitor.dispose();
        await context.close();
    }
});
