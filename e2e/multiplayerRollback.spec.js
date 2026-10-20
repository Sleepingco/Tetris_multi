/**
 * 빠른 로컬 예측 입력 뒤 authoritative snapshot이 보드를 되돌리지 않는지 검증한다.
 *
 * 준비한 Host·Guest 중 한쪽을 source, 다른 쪽을 observer로 두고 조각을 연속 배치한다.
 * 두 보드가 수렴한 뒤에도 여러 server tick 동안 같은 fingerprint가 유지되어야 통과한다.
 * 실패 시 입력·snapshot·Canvas를 첨부하고, finally에서 monitor와 context를 모두 정리한다.
 */
const { test, expect } = require("@playwright/test");
const {
    attachRollbackDiagnostics,
    createAuthoritativeSnapshotMonitor,
    createPlayerPages,
    enterTwoPlayerMatch,
    pressRapidInputCombination,
    readPlayerSession,
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
    inputMonitor,
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
            }, inputMonitor);

            // 120ms 착지 잔상이 끝난 고정 cell의 색으로 수렴을 검사한다.
            await sourcePage.waitForTimeout(150);
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
            readPlayerSession(hostPage).then(session => session.playerId),
            readPlayerSession(guestPage).then(session => session.playerId),
        ]);

        await runPlacementSequence({
            direction: "Host → Guest",
            sourcePage: hostPage,
            observerPage: guestPage,
            playerNumber: 1,
            playerId: hostPlayerId,
            snapshotMonitor: guestSnapshotMonitor,
            inputMonitor: hostSnapshotMonitor,
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
            inputMonitor: guestSnapshotMonitor,
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
