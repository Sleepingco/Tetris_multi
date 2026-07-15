const { test, expect } = require("@playwright/test");
const {
    attachRollbackDiagnostics,
    createAuthoritativeSnapshotMonitor,
    createPlayerPages,
    enterTwoPlayerMatch,
    pressRapidInputCombination,
    readBottomBoardState,
    waitForBoardConvergence,
    waitForBoardStabilityAcrossSnapshots,
} = require("./helpers/multiplayer.js");

const BOTTOM_ROWS = 8;
const PLACEMENT_PLANS = [
    {
        side: "left",
        keys: ["ArrowLeft", "ArrowLeft", "ArrowLeft", "ArrowUp", "ArrowDown", "Space"],
    },
    {
        side: "right",
        keys: ["ArrowRight", "ArrowRight", "ArrowRight", "ArrowUp", "ArrowDown", "Space"],
    },
    {
        side: "left",
        keys: ["ArrowLeft", "ArrowLeft", "ArrowLeft", "ArrowUp", "ArrowDown", "Space"],
    },
];

function findAddedOccupiedCells(beforeState, afterState) {
    const beforeCells = new Map(beforeState.cells.map(cell => {
        return [`${cell.row}:${cell.col}`, cell.color];
    }));

    return afterState.cells.filter(cell => {
        return cell.color !== "empty" && beforeCells.get(`${cell.row}:${cell.col}`) === "empty";
    });
}

/**
 * 한 플레이어가 세 조각을 빠르게 배치하는 동안 source/observer board 불변 조건을 검증한다.
 *
 * @param {Object} params - 입력 방향과 양쪽 페이지, snapshot monitor, 실패 진단 문맥
 * @returns {Promise<void>}
 */
async function runPlacementSequence({
    direction,
    sourcePage,
    observerPage,
    playerNumber,
    playerId,
    snapshotMonitor,
    inputHistory,
    diagnosticContext,
}) {
    for (let planIndex = 0; planIndex < PLACEMENT_PLANS.length; planIndex += 1) {
        const plan = PLACEMENT_PLANS[planIndex];
        const pieceNumber = planIndex + 1;

        await test.step(`${direction} ${pieceNumber}번 조각 빠른 입력과 수렴`, async () => {
            const beforeState = await readBottomBoardState(
                sourcePage,
                playerNumber,
                BOTTOM_ROWS,
            );
            const observations = [];
            Object.assign(diagnosticContext, {
                direction,
                sourcePage,
                observerPage,
                playerNumber,
                playerId,
                snapshotMonitor,
                observations,
            });

            await pressRapidInputCombination(sourcePage, plan.keys, (key, inputIndex) => {
                inputHistory.push({
                    direction,
                    pieceNumber,
                    inputIndex: inputIndex + 1,
                    key,
                });
            });

            const committedFingerprint = await waitForBoardConvergence({
                sourcePage,
                observerPage,
                playerNumber,
                previousFingerprint: beforeState.fingerprint,
                bottomRows: BOTTOM_ROWS,
            });
            const committedState = await readBottomBoardState(
                sourcePage,
                playerNumber,
                BOTTOM_ROWS,
            );
            const addedCells = findAddedOccupiedCells(beforeState, committedState);

            expect(addedCells.length, "hard drop은 하단 board에 새 고정 cell을 남겨야 한다").toBeGreaterThan(0);
            if (plan.side === "left") {
                expect(Math.max(...addedCells.map(cell => cell.col))).toBeLessThanOrEqual(4);
            } else {
                expect(Math.min(...addedCells.map(cell => cell.col))).toBeGreaterThanOrEqual(5);
            }
            if (pieceNumber === PLACEMENT_PLANS.length) {
                expect(
                    beforeState.occupiedCellCount,
                    "마지막 조각 전에는 하단에 이전 조각이 누적되어야 한다",
                ).toBeGreaterThanOrEqual(6);
            }

            await waitForBoardStabilityAcrossSnapshots({
                sourcePage,
                observerPage,
                playerNumber,
                playerId,
                committedFingerprint,
                previousFingerprint: beforeState.fingerprint,
                snapshotMonitor,
                bottomRows: BOTTOM_ROWS,
                requiredSnapshotCycles: 2,
                observations,
            });
        });
    }
}

test("Host와 Guest의 연속 placement가 양방향 수렴하고 rollback되지 않는다", async ({ browser }, testInfo) => {
    const players = await createPlayerPages(browser);
    const { hostPage, guestPage } = players;
    const hostSnapshotMonitor = createAuthoritativeSnapshotMonitor(hostPage);
    const guestSnapshotMonitor = createAuthoritativeSnapshotMonitor(guestPage);
    const inputHistory = [];
    const diagnosticContext = {
        direction: "match setup",
        sourcePage: hostPage,
        observerPage: guestPage,
        playerNumber: 1,
        playerId: null,
        snapshotMonitor: guestSnapshotMonitor,
        observations: [],
    };

    try {
        await enterTwoPlayerMatch(hostPage, guestPage);
        const [hostPlayerId, guestPlayerId] = await Promise.all([
            hostPage.evaluate(() => sessionStorage.getItem("tetris:playerId")),
            guestPage.evaluate(() => sessionStorage.getItem("tetris:playerId")),
        ]);

        await runPlacementSequence({
            direction: "Host → Guest",
            sourcePage: hostPage,
            observerPage: guestPage,
            playerNumber: 1,
            playerId: hostPlayerId,
            snapshotMonitor: guestSnapshotMonitor,
            inputHistory,
            diagnosticContext,
        });
        await runPlacementSequence({
            direction: "Guest → Host",
            sourcePage: guestPage,
            observerPage: hostPage,
            playerNumber: 2,
            playerId: guestPlayerId,
            snapshotMonitor: hostSnapshotMonitor,
            inputHistory,
            diagnosticContext,
        });
    } catch (error) {
        await attachRollbackDiagnostics({
            testInfo,
            ...diagnosticContext,
            inputHistory,
            error,
        });
        throw error;
    } finally {
        hostSnapshotMonitor.dispose();
        guestSnapshotMonitor.dispose();
        await players.close();
    }
});
