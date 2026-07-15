const { test, expect } = require("@playwright/test");
const {
    createPlayerPages,
    enterTwoPlayerMatch,
    readBottomBoardFingerprint,
    waitForBoardConvergence,
} = require("./helpers/multiplayer.js");

test("Host placement가 Guest 보드와 수렴하고 rollback되지 않는다", async ({ browser }) => {
    const players = await createPlayerPages(browser);
    const { hostPage, guestPage } = players;

    try {
        await enterTwoPlayerMatch(hostPage, guestPage);

        const baseline = await readBottomBoardFingerprint(hostPage, 1);

        await hostPage.keyboard.press("ArrowLeft");
        await hostPage.keyboard.press("ArrowLeft");
        await hostPage.keyboard.press("ArrowUp");
        await hostPage.keyboard.press("Space");

        const committedBoard = await waitForBoardConvergence({
            sourcePage: hostPage,
            observerPage: guestPage,
            playerNumber: 1,
            previousFingerprint: baseline,
        });

        // snapshotCorrection의 750ms grace보다 긴 구간을 표본 검사한다.
        for (let sample = 0; sample < 15; sample += 1) {
            await hostPage.waitForTimeout(100);

            const [hostBoard, guestBoard] = await Promise.all([
                readBottomBoardFingerprint(hostPage, 1),
                readBottomBoardFingerprint(guestPage, 1),
            ]);

            expect(hostBoard).toBe(committedBoard);
            expect(guestBoard).toBe(committedBoard);
        }
    } finally {
        await players.close();
    }
});
