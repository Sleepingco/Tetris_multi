const { test, expect } = require("@playwright/test");
const { enterTwoPlayerMatch, readPlayerSession } = require("./helpers/multiplayer.js");
const { createPveRoom, startPveMatch, createPveSocketMonitor } = require("./helpers/pve.js");

for (const mode of ["pvp", "pve"]) {
    test(`${mode}는 실제 T 회전 이력을 snapshot과 재join에 전달한다`, async ({ page, browser }) => {
        const errors = [];
        page.on("pageerror", error => errors.push(error.message));
        await page.addInitScript(() => {
            let factory;
            window.__spinJoins = [];
            Object.defineProperty(window, "io", {
                configurable: true, get: () => factory,
                set: value => {
                    factory = new Proxy(value, {
                        apply(target, thisArg, args) {
                            const socket = Reflect.apply(target, thisArg, args);
                            socket.on("game:join:result", result => {
                                if (result.ok) window.__spinJoins.push(result);
                            });
                            socket.on("game:authoritative:snapshot", payload => {
                                if (!window.__spinReconnectArmed || payload.playerId !== window.__spinOwnId
                                    || !payload.snapshot.spinRotation) return;
                                window.__spinBeforeReconnect = payload.snapshot;
                                window.__spinReconnectArmed = false;
                                socket.disconnect();
                                socket.connect();
                            });
                            return socket;
                        },
                    });
                },
            });
        });
        const monitor = createPveSocketMonitor(page);
        let guestContext;
        try {
            if (mode === "pvp") {
                guestContext = await browser.newContext();
                await enterTwoPlayerMatch(page, await guestContext.newPage());
            } else {
                await createPveRoom(page, "normal");
                await startPveMatch(page);
            }
            const { playerId } = await readPlayerSession(page);
            const current = () => monitor.getSnapshots(playerId).at(-1) ?? monitor.getInitialSnapshot(playerId);
            await expect.poll(() => Boolean(current()?.activePiece?.pieceType)).toBe(true);
            // 첫 7-bag의 T가 나올 때까지 양끝으로 쌓아 실제 입력만으로 준비한다.
            for (let count = 0; count < 7 && current().activePiece.pieceType !== "tree"; count++) {
                const pieceIndex = current().pieceIndex;
                for (let shift = 0; shift < 4; shift++) {
                    await page.keyboard.press(count % 2 === 0 ? "ArrowLeft" : "ArrowRight");
                    await page.waitForTimeout(20);
                }
                await page.keyboard.press("Space");
                await expect.poll(() => current().pieceIndex).toBeGreaterThan(pieceIndex);
            }
            expect(current().activePiece.pieceType).toBe("tree");
            await page.evaluate(id => {
                window.__spinOwnId = id;
                window.__spinReconnectArmed = true;
            }, playerId);
            await page.keyboard.press("ArrowUp");
            await expect.poll(() => page.evaluate(() => window.__spinJoins.length)).toBe(2);
            const { before, restored } = await page.evaluate(id => ({
                before: window.__spinBeforeReconnect,
                restored: window.__spinJoins[1].match.players.find(player => player.playerId === id).snapshot,
            }), playerId);
            expect(before.spinRotation).toEqual({ lastKickIndex: 0, usedKick5: false });
            expect(restored.pieceIndex).toBe(before.pieceIndex);
            expect(restored.activePiece.rotation).toBe(before.activePiece.rotation);
            // 재연결 동안 중력이 한 칸 진행했다면 그 하강이 회전 자격을 해제한다.
            expect(restored.spinRotation).toEqual(restored.activePiece.row === before.activePiece.row
                ? before.spinRotation : null);
            await page.keyboard.press("Space");
            await expect.poll(() => current().pieceIndex).toBeGreaterThan(restored.pieceIndex);
            expect(current().spinRotation).toBeNull();
            expect(errors).toEqual([]);
        } finally {
            monitor.dispose();
            await guestContext?.close();
        }
    });
}
