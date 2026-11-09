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
            await expect(page.locator(".controls-details")).toBeHidden();
            await expect(page.locator(".touch-controls-buttons button")).toHaveText(["←", "↓", "→", "HOLD", "DROP", "↺", "↻"]);
            const left = await page.getByRole("button", { name: "왼쪽 이동", exact: true }).boundingBox();
            const drop = await page.getByRole("button", { name: "하드 드롭", exact: true }).boundingBox();
            const ccw = await page.getByRole("button", { name: "반시계 회전", exact: true }).boundingBox();
            const cw = await page.getByRole("button", { name: "시계 회전", exact: true }).boundingBox();
            expect(drop.width).toBeCloseTo(left.width * 2 + 8, 0);
            expect(drop.y).toBe(ccw.y);
            expect(ccw.y).toBe(cw.y);
            expect(cw.x).toBeGreaterThan(ccw.x);
            expect(drop.y).toBeGreaterThan(left.y);
            expect(await page.locator(".touch-controls-buttons").evaluate(element => getComputedStyle(element).userSelect)).toBe("none");
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
            await page.clock.runFor(180);
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

for (const viewport of [{ width: 1600, height: 900 }, { width: 390, height: 844 }]) {
    test(`B01 마우스 PC ${viewport.width}px에서는 터치 UI를 표시하지 않는다`, async ({ browser }) => {
        const context = await browser.newContext({ viewport, hasTouch: false });
        try {
            const page = await context.newPage();
            await page.goto("/pages/tetrisSingle.html");
            await expect(page.locator("#tetrisBoardCanvas")).toBeVisible();
            await expect(page.locator(".controls-details")).toBeVisible();
            await expect(page.getByRole("region", { name: "터치 조작", exact: true })).toHaveCount(0);
            await expect(page.getByRole("button", { name: /터치 조작/ })).toHaveCount(0);
        } finally {
            await context.close();
        }
    });
}

for (const errorName of ["NotFoundError", "InvalidStateError"]) {
    test(`B01 포인터 캡처 ${errorName} 발생 시 해당 터치만 취소하고 다음 입력을 받는다`, async ({ browser }) => {
        const context = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
        try {
            const page = await context.newPage();
            const errors = [];
            page.on("pageerror", error => errors.push(error.message));
            await page.addInitScript(name => {
                Math.random = () => 0;
                const capture = Element.prototype.setPointerCapture;
                Element.prototype.setPointerCapture = function (id) {
                    if (this.dataset.action === "soft_drop") throw new DOMException("capture unavailable", name);
                    return capture.call(this, id);
                };
            }, errorName);
            await page.clock.install({ time: new Date("2026-11-09T00:00:00Z") });
            await page.clock.pauseAt(new Date("2026-11-09T00:00:00Z"));
            await page.goto("/pages/tetrisSingle.html");
            await touchDown(page, "왼쪽 이동", 1);
            await page.clock.runFor(16);
            const moved = await canvasData(page);
            await touchDown(page, "소프트 드롭", 2);
            await expect(page.getByRole("button", { name: "소프트 드롭", exact: true })).toHaveAttribute("aria-pressed", "false");
            await expect(page.getByRole("button", { name: "왼쪽 이동", exact: true })).toHaveAttribute("aria-pressed", "true");
            await page.clock.runFor(16);
            expect(await canvasData(page)).toBe(moved);
            await page.clock.runFor(180);
            expect(await canvasData(page)).not.toBe(moved);
            await touchUp(page, "소프트 드롭", 2);
            await touchUp(page, "왼쪽 이동", 1);
            await page.clock.runFor(16);
            const stopped = await canvasData(page);
            await page.clock.runFor(240);
            expect(await canvasData(page)).toBe(stopped);
            await touchDown(page, "오른쪽 이동", 3);
            await touchUp(page, "오른쪽 이동", 3);
            await page.clock.runFor(16);
            expect(await canvasData(page)).not.toBe(stopped);
            expect(errors).toEqual([]);
        } finally {
            await context.close();
        }
    });
}

test("B02 키보드 방향키를 뗀 뒤에는 남은 입력 tick 이후 가로 이동이 멈춘다", async ({ page }) => {
    await page.clock.install({ time: new Date("2026-11-04T00:00:00Z") });
    await page.clock.pauseAt(new Date("2026-11-04T00:00:00Z"));
    await page.goto("/pages/tetrisSingle.html");
    const initial = await canvasData(page);
    await page.keyboard.down("ArrowLeft");
    await page.clock.runFor(200);
    await page.keyboard.up("ArrowLeft");
    await page.clock.runFor(16);
    const released = await canvasData(page);
    expect(released).not.toBe(initial);
    await page.clock.runFor(200);
    expect(await canvasData(page)).toBe(released);
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
        await expect(players.hostPage.getByRole("region", { name: "터치 조작", exact: true })).toHaveCount(0);
        const ownBoard = await players.guestPage.locator(".player-column.is-mine canvas").boundingBox();
        expect(ownBoard.width).toBeGreaterThanOrEqual(60);
        expect(ownBoard.y).toBeGreaterThanOrEqual(0);
        expect(ownBoard.y + ownBoard.height).toBeLessThanOrEqual(viewport.height + 1);
        const controls = await players.guestPage.locator(".touch-controls-buttons").boundingBox();
        expect(controls.y).toBeGreaterThanOrEqual(0);
        expect(controls.y + controls.height).toBeLessThanOrEqual(viewport.height + 1);
        expect(ownBoard.y + ownBoard.height <= controls.y || ownBoard.x + ownBoard.width <= controls.x).toBe(true);
        const summary = players.guestPage.locator(".opponent-summary");
        if (viewport.height > viewport.width) {
            await expect(summary).toBeVisible();
            const box = await summary.boundingBox();
            expect(box.y).toBeGreaterThanOrEqual(0);
            expect(box.y + box.height).toBeLessThanOrEqual(ownBoard.y);
            await expect(summary.locator('[data-opponent-stat="status"]')).toHaveText("플레이 중");
        } else {
            await expect(summary).toBeHidden();
        }
        await touchDown(players.guestPage, "왼쪽 이동", 1);
        await touchDown(players.guestPage, "시계 회전", 2);
        await touchUp(players.guestPage, "시계 회전", 2);
        await expect.poll(() => monitor.getSentGameInputs().map(input => input.action)).toEqual(expect.arrayContaining(["move_left", "rotate"]));
        await touchUp(players.guestPage, "왼쪽 이동", 1, "pointercancel");
        await players.guestPage.waitForTimeout(100);
        const count = monitor.getSentGameInputCount();
        await players.guestPage.waitForTimeout(200);
        expect(monitor.getSentGameInputCount()).toBe(count);
        if (viewport.height > viewport.width) {
            await players.hostPage.keyboard.press("Space");
            await expect.poll(async () => Number(await summary.locator('[data-opponent-stat="score"]').textContent())).toBeGreaterThan(0);
            await expect(summary.locator('[data-opponent-stat="score"]')).toHaveText(await players.guestPage.locator('.player-column[data-player="1"] .score').textContent());
        }
    } finally {
        monitor.dispose();
        await players.close();
    }
});

}

test("B01 PVE에서도 키보드 없이 홀드와 하드 드롭이 서버에 전달된다", async ({ browser }, testInfo) => {
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
        await expect(page.locator(".opponent-summary")).toContainText("Heuristic AI");
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
        await page.screenshot({ path: testInfo.outputPath("mobile-feedback.png"), animations: "disabled" });
    } finally {
        monitor.dispose();
        await context.close();
    }
});

test("B02 PC 멀티에서 방향키를 뗀 뒤 새 이동 입력과 가로 이동이 멈춘다", async ({ browser }) => {
    const hostContext = await browser.newContext();
    const guestContext = await browser.newContext();
    const hostPage = await hostContext.newPage();
    const guestPage = await guestContext.newPage();
    const monitor = createAuthoritativeSnapshotMonitor(hostPage);
    const occupiedColumns = () => hostPage.locator(".player-column.is-mine canvas").evaluate(canvas => {
        const context = canvas.getContext("2d");
        const cell = canvas.width / 10;
        const columns = new Set();
        for (let row = 0; row < canvas.height / cell; row++) {
            for (let col = 0; col < 10; col++) {
                const alpha = context.getImageData((col + 0.5) * cell, (row + 0.5) * cell, 1, 1).data[3];
                if (alpha >= 240) columns.add(col);
            }
        }
        return [...columns].sort();
    });
    try {
        await createWaitingRoom(hostPage, guestPage);
        await startWaitingMatch(hostPage, guestPage);
        await hostPage.keyboard.down("ArrowLeft");
        await hostPage.waitForTimeout(220);
        await hostPage.keyboard.up("ArrowLeft");
        await hostPage.waitForTimeout(50);
        const sent = monitor.getSentGameInputCount();
        const released = await occupiedColumns();
        expect(sent).toBeGreaterThan(0);
        expect(released.length).toBeGreaterThan(0);
        await hostPage.waitForTimeout(250);
        expect(monitor.getSentGameInputCount()).toBe(sent);
        expect(await occupiedColumns()).toEqual(released);
    } finally {
        monitor.dispose();
        await Promise.all([hostContext.close(), guestContext.close()]);
    }
});

for (const mode of ["single", "pve"]) {
    test(`모바일 ${mode} 헤더 아이콘은 한 줄에 배치되고 이름과 상태를 유지한다`, async ({ browser }, testInfo) => {
        const context = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
        const page = await context.newPage();
        await page.addInitScript(() => {
            localStorage.setItem("theme", "light");
            localStorage.setItem("tetrisSoundEnabled", "false");
            HTMLMediaElement.prototype.play = () => Promise.resolve();
        });
        try {
            if (mode === "single") {
                await page.goto("/pages/tetrisSingle.html");
            } else {
                const { createPveRoom } = require("./helpers/pve.js");
                await createPveRoom(page, "normal");
                await page.locator("#btnPrimaryAction").click();
                await page.waitForURL(/tetrisMulti\.html/);
                await expect(page.locator('.game-text[data-player="1"]')).toBeHidden();
            }
            const theme = page.getByRole("button", { name: "다크 모드", exact: true });
            const sound = page.getByRole("button", { name: "사운드 켜기", exact: true });
            const home = page.getByRole("link", { name: "홈으로", exact: true });
            const boxes = [];
            for (const button of [sound, theme, home]) {
                await expect(button).toBeVisible();
                const box = await button.boundingBox();
                expect(box.width).toBeGreaterThanOrEqual(44);
                expect(box.height).toBeGreaterThanOrEqual(44);
                expect(box.x + box.width).toBeLessThanOrEqual(390);
                boxes.push(box);
                const style = await button.evaluate(element => ({
                    fontSize: getComputedStyle(element).fontSize,
                    mask: getComputedStyle(element, "::before").maskImage,
                }));
                expect(style.fontSize).toBe("0px");
                expect(style.mask).toContain("data:image/svg+xml");
            }
            expect(new Set(boxes.map(box => Math.round(box.y))).size).toBe(1);
            await theme.click();
            await expect(page.getByRole("button", { name: "라이트 모드", exact: true })).toHaveAttribute("aria-pressed", "true");
            await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
            await sound.click();
            await expect(page.getByRole("button", { name: "사운드 끄기", exact: true })).toHaveAttribute("aria-pressed", "true");
            await page.locator("header").screenshot({ path: testInfo.outputPath("mobile-header.png"), animations: "disabled" });
        } finally {
            await context.close();
        }
    });
}

test("모바일 입력창은 16px 이상이고 채팅 탭에서 메시지 공간을 확보한다", async ({ browser }) => {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
    const page = await context.newPage();
    try {
        await page.goto("/pages/index.html");
        const nickname = page.locator("#nicknameInput");
        await expect(nickname).toBeVisible();
        expect(await nickname.evaluate(element => parseFloat(getComputedStyle(element).fontSize))).toBeGreaterThanOrEqual(16);
        await nickname.fill("MobileGuest");
        await page.locator("#btnMulti").click();
        await page.waitForURL(/multiLobby\.html/);
        for (const selector of ["#roomCodeInput", "#chatInput"]) {
            const input = page.locator(selector);
            await expect(input).toBeEnabled();
            expect(await input.evaluate(element => parseFloat(getComputedStyle(element).fontSize))).toBeGreaterThanOrEqual(16);
        }
        await page.getByRole("tab", { name: "채팅", exact: true }).click();
        const chat = await page.locator(".chat-messages").boundingBox();
        expect(chat.height).toBeGreaterThanOrEqual(180);
        await page.locator("#chatInput").fill("mobile chat");
        await page.locator('#chatForm button[type="submit"]').click();
        await expect(page.locator("#chatMessages")).toContainText("mobile chat");
        await page.evaluate(() => { document.documentElement.style.fontSize = "12px"; });
        expect(await page.locator("#chatInput").evaluate(element => parseFloat(getComputedStyle(element).fontSize))).toBeGreaterThanOrEqual(16);
    } finally {
        await context.close();
    }
});
