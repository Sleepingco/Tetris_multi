const { test, expect } = require("@playwright/test");
const {
    MULTI_LOBBY_URL,
    createPlayerPages,
    createAuthoritativeSnapshotMonitor,
    enterTwoPlayerMatch,
    createWaitingRoom,
    readPlayerSession,
    readBottomBoardFingerprint,
    waitForBoardConvergence,
} = require("./helpers/multiplayer.js");

test("유효한 room session 없이 게임 화면에 접근하면 로비로 돌아간다", async ({ page }) => {
    await page.goto("/pages/tetrisMulti.html?roomId=missing");
    await expect(page).toHaveURL(MULTI_LOBBY_URL);
});

test("Host와 Guest의 sessionStorage와 게임 역할이 서로 격리된다", async ({ browser }) => {
    const players = await createPlayerPages(browser);
    const { hostPage, guestPage } = players;

    try {
        const roomId = await enterTwoPlayerMatch(hostPage, guestPage);
        const [hostSession, guestSession] = await Promise.all([
            hostPage.evaluate(() => ({
                session: JSON.parse(sessionStorage.getItem("tetris:playerSession")),
                roomId: sessionStorage.getItem("tetris:roomId"),
            })),
            guestPage.evaluate(() => ({
                session: JSON.parse(sessionStorage.getItem("tetris:playerSession")),
                roomId: sessionStorage.getItem("tetris:roomId"),
            })),
        ]);

        expect(hostSession.session.version).toBe(1);
        expect(hostSession.session.playerId).not.toBe(guestSession.session.playerId);
        expect(hostSession.session.token).toHaveLength(43);
        expect(hostSession.roomId).toBe(roomId);
        expect(guestSession.roomId).toBe(roomId);
        await expect(hostPage.locator("#player1RoleBadge")).toHaveText("내 보드");
        await expect(hostPage.locator("#player2RoleBadge")).toHaveText("상대 보드");
        await expect(guestPage.locator("#player1RoleBadge")).toHaveText("상대 보드");
        await expect(guestPage.locator("#player2RoleBadge")).toHaveText("내 보드");
    } finally {
        await players.close();
    }
});

test("current token 중복 연결은 이전 로비 탭을 terminal 상태로 남긴다", async ({ page }) => {
    const terminalMessage = "세션이 만료되었거나 다른 탭으로 이동했습니다. 새로고침해 주세요.";
    await page.goto("/pages/multiLobby.html");
    const currentSession = await readPlayerSession(page);

    await page.evaluate((session) => new Promise((resolve, reject) => {
        const duplicateSocket = io({
            autoConnect: false,
            forceNew: true,
            reconnection: false,
            auth: {
                playerId: session.playerId,
                token: session.token,
                nickname: session.nickname,
            },
        });
        duplicateSocket.on("session:ready", resolve);
        duplicateSocket.on("connect_error", reject);
        duplicateSocket.connect();
    }), currentSession);

    await expect(page.locator("#chatMessages")).toContainText(terminalMessage);
    await expect(page.locator("#btnJoinCode")).toBeDisabled();
    expect(await readPlayerSession(page)).toEqual(currentSession);
});

test("lobby reload와 transport reconnect는 token을 회전하고 room을 다시 sync한다", async ({ browser }) => {
    const players = await createPlayerPages(browser);
    const { hostContext, hostPage, guestPage } = players;

    try {
        const roomId = await createWaitingRoom(hostPage, guestPage);
        const initialSession = await readPlayerSession(hostPage);

        await hostPage.reload();
        await expect(hostPage.locator("#roomCodeText")).toHaveText(roomId);
        const reloadedSession = await readPlayerSession(hostPage);
        expect(reloadedSession.playerId).toBe(initialSession.playerId);
        expect(reloadedSession.token).not.toBe(initialSession.token);
        expect(reloadedSession.expiresAt).toBe(initialSession.expiresAt);

        await hostContext.setOffline(true);
        await expect(hostPage.locator("#btnLeaveRoom")).toBeDisabled();
        await hostContext.setOffline(false);
        await expect.poll(async () => (await readPlayerSession(hostPage))?.token).not.toBe(
            reloadedSession.token,
        );
        await expect(hostPage.locator("#roomCodeText")).toHaveText(roomId);
        await expect(hostPage.locator("#btnLeaveRoom")).toBeEnabled();

        const tokenBeforeBfcacheRestore = (await readPlayerSession(hostPage)).token;
        await Promise.all([
            hostPage.waitForNavigation(),
            hostPage.evaluate(() => {
                window.dispatchEvent(new PageTransitionEvent("pageshow", { persisted: true }));
            }),
        ]);
        await expect.poll(async () => (await readPlayerSession(hostPage))?.token).not.toBe(
            tokenBeforeBfcacheRestore,
        );
        await expect(hostPage.locator("#roomCodeText")).toHaveText(roomId);
    } finally {
        await players.close();
    }
});

test("game reload은 자동 game:join으로 같은 player session을 복구한다", async ({ browser }) => {
    const players = await createPlayerPages(browser);
    const { hostPage, guestPage } = players;

    try {
        await enterTwoPlayerMatch(hostPage, guestPage);
        const beforeReload = await readPlayerSession(guestPage);

        await guestPage.reload();
        await expect(guestPage.locator('.next-preview[data-player="1"] .next-cell')).toHaveCount(32);
        const afterReload = await readPlayerSession(guestPage);

        expect(afterReload.playerId).toBe(beforeReload.playerId);
        expect(afterReload.token).not.toBe(beforeReload.token);
    } finally {
        await players.close();
    }
});

test("game transport reconnect는 authoritative match와 sequence, bag 흐름을 복구한다", async ({ browser }) => {
    test.setTimeout(75_000);
    const players = await createPlayerPages(browser);
    const { guestContext, hostPage, guestPage } = players;
    const monitor = createAuthoritativeSnapshotMonitor(guestPage);

    try {
        await enterTwoPlayerMatch(hostPage, guestPage);
        const initialFingerprint = await readBottomBoardFingerprint(guestPage, 2);
        await guestPage.keyboard.press("Space");
        const committedBeforeReconnect = await waitForBoardConvergence({
            sourcePage: guestPage,
            observerPage: hostPage,
            playerNumber: 2,
            previousFingerprint: initialFingerprint,
        });
        const sequenceBeforeReconnect = monitor.getSentGameInputs().at(-1).clientSequence;
        const sessionBeforeReconnect = await readPlayerSession(guestPage);

        await guestContext.setOffline(true);
        await expect(guestPage.locator('.game-text[data-player="2"] span')).toHaveText("재연결 중");
        const inputCountWhileOffline = monitor.getSentGameInputCount();
        await guestPage.keyboard.press("Space");
        await guestPage.waitForTimeout(200);
        expect(monitor.getSentGameInputCount()).toBe(inputCountWhileOffline);

        await guestContext.setOffline(false);
        await expect.poll(async () => (await readPlayerSession(guestPage))?.token).not.toBe(
            sessionBeforeReconnect.token,
        );
        await expect(guestPage.locator('.next-preview[data-player="2"] .next-cell')).toHaveCount(32);
        await expect.poll(async () => {
            const [guestBoard, hostBoard] = await Promise.all([
                readBottomBoardFingerprint(guestPage, 2),
                readBottomBoardFingerprint(hostPage, 2),
            ]);
            return guestBoard === committedBeforeReconnect && hostBoard === committedBeforeReconnect;
        }).toBe(true);

        async function pressAndWaitForAuthoritativeAck(key) {
            const sentInputCount = monitor.getSentGameInputCount();
            await guestPage.keyboard.press(key);
            await expect.poll(() => monitor.getSentGameInputCount()).toBeGreaterThan(sentInputCount);
            const sequence = monitor.getSentGameInputs().at(-1).clientSequence;
            await expect.poll(() => monitor.getRecentEvents(sessionBeforeReconnect.playerId).some(event => {
                return event.lastProcessedClientSequence >= sequence;
            })).toBe(true);
            return sequence;
        }

        await pressAndWaitForAuthoritativeAck("ArrowRight");
        const sequenceAfterReconnect = await pressAndWaitForAuthoritativeAck("Space");
        expect(sequenceAfterReconnect).toBeGreaterThan(sequenceBeforeReconnect);
        await expect.poll(async () => {
            const [guestBoard, hostBoard] = await Promise.all([
                readBottomBoardFingerprint(guestPage, 2),
                readBottomBoardFingerprint(hostPage, 2),
            ]);
            return {
                guestChanged: guestBoard !== committedBeforeReconnect,
                hostChanged: hostBoard !== committedBeforeReconnect,
            };
        }).toEqual({
            guestChanged: true,
            hostChanged: true,
        });

        const bagRequestsBefore = monitor.getSentBagRequestCount();
        const bagAppendsBefore = monitor.getReceivedBagAppendCount();
        const horizontalPatterns = [
            ["ArrowLeft", "ArrowLeft", "ArrowLeft"],
            ["ArrowLeft"],
            ["ArrowRight"],
            ["ArrowRight", "ArrowRight", "ArrowRight"],
        ];
        for (let drop = 0; drop < 18 && monitor.getReceivedBagAppendCount() === bagAppendsBefore; drop += 1) {
            for (const key of horizontalPatterns[drop % horizontalPatterns.length]) {
                await pressAndWaitForAuthoritativeAck(key);
            }
            await pressAndWaitForAuthoritativeAck("Space");
            await guestPage.waitForTimeout(50);
        }

        await expect.poll(() => monitor.getSentBagRequestCount()).toBeGreaterThan(bagRequestsBefore);
        await expect.poll(() => monitor.getReceivedBagAppendCount()).toBeGreaterThan(bagAppendsBefore);
    } finally {
        monitor.dispose();
        await players.close();
    }
});

test("replayed token은 room을 탈취하지 못하고 한 번의 신규 identity recovery로 끝난다", async ({ browser }) => {
    const players = await createPlayerPages(browser);
    const { hostContext, hostPage, guestPage } = players;
    let replayPage = null;

    try {
        await createWaitingRoom(hostPage, guestPage);
        const replayedSession = await readPlayerSession(hostPage);
        await hostPage.reload();
        await expect.poll(async () => (await readPlayerSession(hostPage))?.token).not.toBe(
            replayedSession.token,
        );

        replayPage = await hostContext.newPage();
        await replayPage.addInitScript((session) => {
            sessionStorage.setItem("tetris:nickname", session.nickname);
            sessionStorage.setItem("tetris:playerSession", JSON.stringify(session));
        }, replayedSession);
        await replayPage.goto("/pages/multiLobby.html");

        await expect.poll(async () => (await readPlayerSession(replayPage))?.playerId).not.toBe(
            replayedSession.playerId,
        );
        expect(await replayPage.evaluate(() => sessionStorage.getItem("tetris:roomId"))).toBeNull();
    } finally {
        await replayPage?.close();
        await players.close();
    }
});

test("public room storage에는 private session 식별자가 없다", async ({ browser }) => {
    const players = await createPlayerPages(browser);
    const { hostPage, guestPage } = players;

    try {
        await createWaitingRoom(hostPage, guestPage);
        const roomJson = await hostPage.evaluate(() => sessionStorage.getItem("room"));

        expect(roomJson).not.toContain("socketId");
        expect(roomJson).not.toContain("tokenDigest");
        expect(roomJson).not.toContain("generation");
        expect(roomJson).not.toContain("expiresAt");
    } finally {
        await players.close();
    }
});

test("허용되지 않은 Origin의 Socket.IO handshake는 거부된다", async ({ request }) => {
    const response = await request.get("/socket.io/?EIO=4&transport=polling", {
        headers: { Origin: "https://evil.example.com" },
    });

    expect(response.status()).toBe(400);
});

test("playing disconnect는 30초 grace 후 disconnect_timeout으로 종료된다", async ({ browser }) => {
    test.setTimeout(55_000);
    const players = await createPlayerPages(browser);
    const { hostPage, guestPage } = players;
    let replacementContext = null;

    try {
        const roomId = await enterTwoPlayerMatch(hostPage, guestPage);
        await guestPage.close();

        const lobbyButton = hostPage.locator('.game-text[data-player="1"] .match-lobby-btn');
        await expect(lobbyButton).toBeHidden({ timeout: 2_000 });
        await expect(lobbyButton).toBeVisible({ timeout: 35_000 });
        await Promise.all([
            hostPage.waitForURL(MULTI_LOBBY_URL),
            lobbyButton.click(),
        ]);
        await expect(hostPage.locator("#roomStateText")).toHaveText("waiting");
        await expect(hostPage.locator("#roomPlayerCountText")).toHaveText("1");

        replacementContext = await browser.newContext();
        const replacementPage = await replacementContext.newPage();
        await replacementPage.goto("/pages/multiLobby.html");
        await expect.poll(() => replacementPage.evaluate(() => {
            return sessionStorage.getItem("tetris:playerSession") !== null;
        })).toBe(true);
        await replacementPage.locator("#roomCodeInput").fill(roomId);
        await replacementPage.locator("#btnJoinCode").click();
        await expect(hostPage.locator("#roomPlayerCountText")).toHaveText("2");
        await expect(hostPage.locator("#btnPrimaryAction")).toBeEnabled();
    } finally {
        await replacementContext?.close();
        await players.close();
    }
});

test("Guest의 빠른 입력과 연속 placement가 Host의 상대 보드로 수렴한다", async ({ browser }) => {
    const players = await createPlayerPages(browser);
    const { hostPage, guestPage } = players;

    try {
        await enterTwoPlayerMatch(hostPage, guestPage);

        const baseline = await readBottomBoardFingerprint(guestPage, 2);
        await guestPage.keyboard.press("ArrowRight");
        await guestPage.keyboard.press("ArrowRight");
        await guestPage.keyboard.press("ArrowUp");
        await guestPage.keyboard.press("Space");

        const firstPlacement = await waitForBoardConvergence({
            sourcePage: guestPage,
            observerPage: hostPage,
            playerNumber: 2,
            previousFingerprint: baseline,
        });

        await guestPage.keyboard.press("ArrowLeft");
        await guestPage.keyboard.press("ArrowUp");
        await guestPage.keyboard.press("Space");

        await waitForBoardConvergence({
            sourcePage: guestPage,
            observerPage: hostPage,
            playerNumber: 2,
            previousFingerprint: firstPlacement,
        });
    } finally {
        await players.close();
    }
});

test("게임 중 Guest가 홈으로 나가면 Host는 1인 로비로 복귀한다", async ({ browser }) => {
    const players = await createPlayerPages(browser);
    const { hostPage, guestPage } = players;

    try {
        await enterTwoPlayerMatch(hostPage, guestPage);

        await Promise.all([
            hostPage.waitForURL(MULTI_LOBBY_URL),
            guestPage.waitForURL("**/pages/index.html"),
            guestPage.locator(".home-btn").click(),
        ]);

        await expect(hostPage.locator("#roomPlayerCountText")).toHaveText("1");
        await expect(hostPage.locator("#roomStateText")).toHaveText("waiting");
        await expect(hostPage.locator("#btnPrimaryAction")).toBeDisabled();
    } finally {
        await players.close();
    }
});
