/** 실제 Canvas의 열린 천장과 새 40행 경기의 wire·폴백 표시를 검증한다. */
const { test, expect } = require("@playwright/test");
const { createPveRoom, startPveMatch, hardDropHumanUntilResult } = require("./helpers/pve.js");
const { monitorPlacementLogs } = require("./helpers/placementLogs.js");

test("PVE 상단 종료의 human 전송 수와 명시적인 rate-limit 거부 수를 대조한다", async ({ page }, testInfo) => {
    const monitor = monitorPlacementLogs(page);
    try {
        await createPveRoom(page, "normal");
        await startPveMatch(page);
        await hardDropHumanUntilResult(page);
        await monitor.verifyAndWrite(testInfo, "pve");
    } finally { monitor.dispose(); }
});

test("구버전 탭의 handshake는 session 발급 전에 거부하고 현재 탭 연결은 유지한다", async ({ page }) => {
    await page.goto("/pages/multiLobby.html");
    await expect(page.locator("#btnOpenCreateRoom")).toBeVisible();
    const errors = await page.evaluate(async () => {
        const results = [];
        for (const version of [undefined, 1, 3]) {
            results.push(await new Promise(resolve => {
                const socket = window.io({ forceNew: true, reconnection: false,
                    auth: { protocolVersion: version, newSession: true, nickname: "OldTab" } });
                socket.on("connect_error", error => {
                    socket.disconnect();
                    resolve({ code: error.data?.code, terminal: error.data?.terminal, connected: socket.connected });
                });
            }));
        }
        return results;
    });
    expect(errors).toEqual(Array.from({ length: 3 }, () => ({
        code: "GAMEPLAY_PROTOCOL_INCOMPATIBLE", terminal: true, connected: false,
    })));
    await page.locator("#btnOpenCreateRoom").click();
    await page.locator("#btnOpenPveCreate").click();
    await page.locator("#btnCreatePveRoom").click();
    await expect(page.locator("#roomStatus")).toBeVisible();
});

test("싱글은 20행 크기를 유지하고 열린 천장 위에 생성 조각을 그린다", async ({ page }, testInfo) => {
    await page.addInitScript(() => { Math.random = () => 0; });
    const time = new Date("2026-10-23T00:00:00Z");
    await page.clock.install({ time });
    await page.clock.pauseAt(time);
    await page.goto("/pages/tetrisSingle.html");
    await expect(page.locator(".next-preview .next-cell")).toHaveCount(64);
    const geometry = await page.locator("#tetrisBoardCanvas").evaluate(canvas => {
        const ctx = canvas.getContext("2d");
        const upperCells = [];
        for (let row = 0; row < 4; row++) for (let col = 0; col < 10; col++) {
            if (ctx.getImageData(col * 30 + 15, row * 30 + 15, 1, 1).data[3] >= 240) upperCells.push([row, col]);
        }
        const frame = getComputedStyle(canvas.parentElement, "::after");
        return { width: canvas.width, height: canvas.height, visibleHeight: canvas.height - 120,
            borderTop: getComputedStyle(canvas).borderTopWidth,
            borderLeft: getComputedStyle(canvas).borderLeftWidth,
            outerBorder: getComputedStyle(canvas.closest(".playfield")).borderTopWidth,
            frameTop: parseFloat(frame.top), frameBottom: parseFloat(frame.bottom), upperCells };
    });
    expect(geometry).toMatchObject({ width: 300, height: 720, visibleHeight: 600,
        borderTop: "0px", borderLeft: "0px", outerBorder: "0px", frameTop: 120, frameBottom: 0 });
    expect(geometry.upperCells.length).toBeGreaterThan(0);
    await page.screenshot({ path: testInfo.outputPath("open-ceiling-desktop.png") });
    await page.setViewportSize({ width: 390, height: 844 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(390);
    await page.screenshot({ path: testInfo.outputPath("open-ceiling-mobile.png") });
});

test("싱글에서 하강 불가 spawn은 자동 고정 뒤 종료 화면과 재시작을 제공한다", async ({ page }) => {
    const errors = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.addInitScript(() => { Math.random = () => 0.3; });
    const time = new Date("2026-10-23T00:00:00Z");
    await page.clock.install({ time });
    await page.clock.pauseAt(time);
    await page.goto("/pages/tetrisSingle.html");
    await expect(page.locator(".next-preview .next-cell")).toHaveCount(64);
    for (let drop = 0; drop < 11; drop++) {
        await page.keyboard.press("Space");
        await page.clock.runFor(16);
    }
    const upperCellCount = await page.locator("#tetrisBoardCanvas").evaluate(canvas => {
        const ctx = canvas.getContext("2d");
        let cells = 0;
        for (let row = 0; row < 4; row++) for (let col = 0; col < 10; col++) {
            if (ctx.getImageData(col * 30 + 15, row * 30 + 15, 1, 1).data[3] >= 240) cells++;
        }
        return cells;
    });
    expect(upperCellCount).toBe(4);
    await page.clock.runFor(480);
    await expect(page.locator(".game-text")).not.toBeVisible();
    await page.clock.runFor(32);
    await expect(page.locator(".game-text")).toBeVisible();
    await page.locator(".game-text > button").click();
    await expect(page.locator(".game-text")).not.toBeVisible();
    await expect(page.locator(".score")).toHaveText("0");
    const before = await page.locator("#tetrisBoardCanvas").evaluate(canvas => canvas.toDataURL());
    await page.keyboard.press("ArrowLeft");
    await page.clock.runFor(16);
    expect(await page.locator("#tetrisBoardCanvas").evaluate(canvas => canvas.toDataURL())).not.toBe(before);
    expect(errors).toEqual([]);
});

test("40행 PVE의 V4 요청은 사유를 본문에 표시하고 두 보드·재접속에서 40행 계약을 유지한다", async ({ page }) => {
    await page.addInitScript(() => {
        let factory;
        Object.defineProperty(window, "io", {
            configurable: true, get: () => factory,
            set: value => { factory = new Proxy(value, { apply(target, thisArg, args) {
                const socket = Reflect.apply(target, thisArg, args);
                window.__bufferSocket = socket;
                window.__bufferJoins = [];
                window.__bufferPolicies = [];
                socket.on("game:join:result", result => { if (result.ok) window.__bufferJoins.push(result); });
                socket.on("pve:ai-policy", policy => window.__bufferPolicies.push(policy));
                return socket;
            } }); },
        });
    });
    await page.goto("/pages/multiLobby.html");
    await page.locator("#btnOpenCreateRoom").click();
    await page.locator("#btnOpenPveCreate").click();
    await page.locator('#aiPolicySelector input[value="placement_v4"]').check();
    await page.locator("#btnCreatePveRoom").click();
    await expect(page.locator("#roomStatus")).toBeVisible();
    await page.locator("#btnPrimaryAction").click();
    await expect(page.locator('.next-preview[data-player="1"] .next-cell')).toHaveCount(64);
    await expect(page.locator("#player2RoleBadge")).toContainText("새 규칙 미지원 · 휴리스틱 사용");
    const first = await page.evaluate(() => window.__bufferJoins.at(-1));
    expect(first.match.players.every(player => player.snapshot.board.length === 40)).toBe(true);
    expect(first.match.players.every(player => player.snapshot.board.every(row => row.length === 10))).toBe(true);
    expect(await page.locator(".tetrisBoardCanvas").evaluateAll(canvases => canvases.every(canvas => canvas.height === 720))).toBe(true);
    const policy = await page.evaluate(() => window.__bufferPolicies.at(-1));
    expect(policy).toMatchObject({ policyRequested: "placement_v4", policyUsed: "heuristic", fallbackReason: "RULESET_INCOMPATIBLE" });
    await page.evaluate(() => { window.__bufferSocket.disconnect(); window.__bufferSocket.connect(); });
    await expect.poll(() => page.evaluate(() => window.__bufferJoins.length)).toBe(2);
    const restored = await page.evaluate(() => window.__bufferJoins.at(-1));
    expect(restored.match.gameId).toBe(first.match.gameId);
    expect(restored.match.players.every(player => player.snapshot.board.length === 40)).toBe(true);
    await expect(page.locator("#player2RoleBadge")).toContainText("새 규칙 미지원 · 휴리스틱 사용");
    await page.setViewportSize({ width: 390, height: 844 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(390);
});
