const { test, expect } = require("@playwright/test");
const { createPveRoom, startPveMatch } = require("./helpers/pve.js");

async function prepareAchievementFixtures(page) {
    await page.addInitScript(() => {
        localStorage.setItem("tetrisReducedEffects", "false");
        let ioFactory;
        Object.defineProperty(window, "io", {
            configurable: true,
            get: () => ioFactory,
            set: factory => {
                ioFactory = new Proxy(factory, {
                    apply(target, thisArg, args) {
                        const socket = Reflect.apply(target, thisArg, args);
                        window.__achievementSocket = socket;
                        socket.on("game:join:result", result => {
                            if (result.ok) window.__achievementJoin = result;
                        });
                        return socket;
                    },
                });
            },
        });
    });
    await createPveRoom(page, "hard");
    await startPveMatch(page);
    // AI가 우연히 성과를 낼 때까지 기다리지 않고 검증된 S2C 계약 fixture를 UI에 전달한다.
    await page.evaluate(() => {
        const socket = window.__achievementSocket;
        window.__achievementListeners = socket.listeners("game:authoritative:snapshot").slice();
        socket.off("game:authoritative:snapshot");
        window.__achievementIndexes = window.__achievementJoin.match.players.map(player => player.snapshot.pieceIndex + 1);
    });
}

async function deliverAchievement(page, playerNumber, values) {
    await page.evaluate(({ playerNumber, values }) => {
        const join = window.__achievementJoin;
        const player = join.match.players[playerNumber - 1];
        const pieceIndex = window.__achievementIndexes[playerNumber - 1]++;
        const payload = {
            roomId: join.room.roomId,
            playerId: player.playerId,
            snapshot: { ...player.snapshot, pieceIndex: pieceIndex + 1 },
            combatEffect: {
                id: `${join.match.gameId}:${player.playerId}:${pieceIndex}:combat`,
                gameId: join.match.gameId, pieceIndex,
                targetPlayerId: null, sentLines: 0, canceledLines: 0, appliedLines: 0,
                linesCleared: 1, isTSpin: false, combo: 0, backToBackBonus: false,
                ...values,
            },
        };
        window.__lastAchievementPayload = payload;
        window.__achievementListeners.forEach(callback => callback(payload));
    }, { playerNumber, values });
}

test("TETRIS·T-SPIN·COMBO는 양쪽 보드 옆에 한 번 표시하고 축소·모바일·cleanup을 따른다", async ({ page }) => {
    const errors = [];
    page.on("pageerror", error => errors.push(error.message));
    await prepareAchievementFixtures(page);
    const own = page.locator('.combat-achievement[data-player="1"]');
    const opponent = page.locator('.combat-achievement[data-player="2"]');
    await deliverAchievement(page, 1, { linesCleared: 4, combo: 1 });
    await expect(own.locator(".combat-achievement-title")).toHaveText("TETRIS");
    await expect(own.locator(".combat-achievement-combo")).toHaveText("COMBO 1");
    await deliverAchievement(page, 2, { isTSpin: true, combo: 3 });
    await expect(opponent.locator(".combat-achievement-title")).toHaveText("T-SPIN");
    await expect(opponent.locator(".combat-achievement-combo")).toHaveText("COMBO 3");
    const noOverlap = await page.evaluate(() => {
        const overlap = (a, b) => a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
        const events = [...document.querySelectorAll(".combat-achievement")].map(node => node.getBoundingClientRect());
        const protectedAreas = [...document.querySelectorAll("canvas, .incoming-meter")].map(node => node.getBoundingClientRect());
        return events.every(event => protectedAreas.every(area => !overlap(event, area))) && !overlap(events[0], events[1]);
    });
    expect(noOverlap).toBe(true);
    await page.evaluate(() => {
        window.__firstAchievement = document.querySelector('.combat-achievement[data-player="2"]');
        window.__achievementListeners.forEach(callback => callback(window.__lastAchievementPayload));
    });
    expect(await page.evaluate(() => window.__firstAchievement === document.querySelector('.combat-achievement[data-player="2"]'))).toBe(true);

    await deliverAchievement(page, 1, { isTSpin: true, linesCleared: 0 });
    await expect(own.locator(".combat-achievement-title")).toHaveText("T-SPIN");
    await expect(own.locator(".combat-achievement-combo")).toHaveCount(0);
    await deliverAchievement(page, 1, { combo: 2 });
    await expect(own.locator(".combat-achievement-title")).toHaveText("COMBO 2");
    await expect(page.locator('.achievement-spark')).toHaveCount(8);
    await page.locator("#effectsToggle").click();
    await expect(own).toHaveAttribute("data-reduced", "true");
    expect(await own.evaluate(node => node.getAnimations({ subtree: true }).length)).toBe(0);
    await expect(page.locator(".combat-achievement")).toHaveCount(0);

    await deliverAchievement(page, 1, { combo: 0 });
    await expect(own).toHaveCount(0);
    await page.setViewportSize({ width: 390, height: 844 });
    for (const enlargedLineHeight of [false, true]) {
        if (enlargedLineHeight) {
            // 글줄 높이가 커지는 조건에서도 보드와 겹치지 않아야 한다.
            await page.evaluate(() => document.styleSheets[0].insertRule(
                ".combat-achievement .combat-achievement-combo { line-height: 2.25; }",
                document.styleSheets[0].cssRules.length,
            ));
        }
        for (const playerNumber of [1, 2]) {
            if (playerNumber === 2) {
                await page.evaluate(() => {
                    document.querySelector('.player-column[data-player="1"] .player-header').style.paddingBottom = "48px";
                });
            }
            await deliverAchievement(page, playerNumber, { linesCleared: 4, combo: 4 });
            const achievement = page.locator(`.combat-achievement[data-player="${playerNumber}"]`);
            await expect(achievement.locator(".combat-achievement-combo")).toHaveText("COMBO 4");
            await expect(achievement.locator(".achievement-spark")).toHaveCount(0);
            if (playerNumber === 2) {
                // 앞쪽 HUD 높이가 바뀌어도 표시 중인 문구는 대상 보드를 따라가야 한다.
                await page.evaluate(() => {
                    document.querySelector('.player-column[data-player="1"] .player-header').style.removeProperty("padding-bottom");
                });
            }
            const mobilePlacement = await achievement.evaluate(node => {
                const event = node.getBoundingClientRect();
                const board = document.querySelector(`.player-column[data-player="${node.dataset.player}"] canvas`).getBoundingClientRect();
                return {
                    aboveBoard: event.bottom <= board.top,
                    insideViewport: event.left >= 0 && event.right <= innerWidth,
                    event: event.toJSON(),
                    board: board.toJSON(),
                };
            });
            expect(mobilePlacement, JSON.stringify({ playerNumber, enlargedLineHeight, ...mobilePlacement }))
                .toMatchObject({ aboveBoard: true, insideViewport: true });
        }
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(390);
    await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent("pagehide")));
    await expect(page.locator(".combat-achievement")).toHaveCount(0);
    await expect(page.locator(".combat-feedback[data-achievement]")).toHaveCount(0);
    expect(errors).toEqual([]);
});
