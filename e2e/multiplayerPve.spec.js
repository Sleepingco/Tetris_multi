const { test, expect } = require("@playwright/test");
const {
    readBottomBoardFingerprint,
} = require("./helpers/multiplayer.js");
const {
    createPveRoom,
    createPveSocketMonitor,
    hardDropHumanUntilResult,
    returnPveMatchToLobby,
    startPveMatch,
} = require("./helpers/pve.js");

const EMPTY_BOTTOM_BOARD = Array(80).fill("empty").join("|");

function getActionSummary(initialSnapshot, snapshots) {
    if (!initialSnapshot?.activePiece || !Number.isInteger(initialSnapshot.pieceIndex)) {
        return null;
    }

    const actions = [];
    let previous = {
        pieceIndex: initialSnapshot.pieceIndex,
        activePiece: { ...initialSnapshot.activePiece },
    };

    snapshots.forEach((snapshot) => {
        if (!snapshot.activePiece) return;

        if (snapshot.pieceIndex > previous.pieceIndex) {
            actions.push({ type: "hard_drop", snapshot });
            previous = snapshot;
            return;
        }
        if (snapshot.pieceIndex !== previous.pieceIndex) return;

        if (snapshot.activePiece.col !== previous.activePiece.col) {
            actions.push({ type: "move", snapshot });
        }
        if (snapshot.activePiece.rotation !== previous.activePiece.rotation) {
            actions.push({ type: "rotate", snapshot });
        }
        if (snapshot.activePiece.row === previous.activePiece.row + 1) {
            actions.push({ type: "soft_drop", snapshot });
        }
        previous = snapshot;
    });

    return {
        actions,
        actionTypes: actions.map(action => action.type),
        maxConsecutiveSoftDrops: actions.reduce((result, action) => {
            const current = action.type === "soft_drop"
                ? result.current + 1
                : 0;
            return {
                current,
                maximum: Math.max(result.maximum, current),
            };
        }, { current: 0, maximum: 0 }).maximum,
    };
}

async function waitForAiActionSummary(monitor, requiredActionTypes) {
    await expect.poll(() => {
        return monitor.getObservedPlayerIds().some(playerId => {
            const summary = getActionSummary(
                monitor.getInitialSnapshot(playerId),
                monitor.getSnapshots(playerId),
            );
            return requiredActionTypes.every(actionType => {
                return summary?.actionTypes.includes(actionType);
            });
        });
    }, {
        timeout: 10_000,
        intervals: [100, 150, 250],
    }).toBe(true);

    const aiPlayerId = monitor.getObservedPlayerIds().find(playerId => {
        const summary = getActionSummary(
            monitor.getInitialSnapshot(playerId),
            monitor.getSnapshots(playerId),
        );
        return requiredActionTypes.every(actionType => {
            return summary?.actionTypes.includes(actionType);
        });
    });

    return {
        aiPlayerId,
        summary: getActionSummary(
            monitor.getInitialSnapshot(aiPlayerId),
            monitor.getSnapshots(aiPlayerId),
        ),
    };
}

function getLatestSnapshot(monitor, playerId) {
    return monitor.getSnapshots(playerId).at(-1) || null;
}

test("PVE normal은 AI 중간 action과 human 입력/중력을 함께 진행한다", async ({ page }) => {
    const monitor = createPveSocketMonitor(page);

    try {
        await createPveRoom(page, "normal");
        await startPveMatch(page);

        const normalObservation = await waitForAiActionSummary(
            monitor,
            ["move", "rotate", "soft_drop", "hard_drop"],
        );
        const { aiPlayerId, summary: normalSummary } = normalObservation;
        await expect.poll(() => monitor.getObservedPlayerIds().length).toBe(2);
        const humanPlayerId = monitor.getObservedPlayerIds().find(playerId => {
            return playerId !== aiPlayerId;
        });
        expect(humanPlayerId).toBeTruthy();

        const humanCanvas = page.locator(
            '.playground[data-player="1"] .tetrisBoardCanvas',
        );
        const humanBeforeInput = monitor.getSnapshots(humanPlayerId).at(-1);
        expect(humanBeforeInput?.activePiece).toBeTruthy();
        const humanCanvasBefore = await humanCanvas.evaluate(canvas => canvas.toDataURL());
        await page.keyboard.press("ArrowRight");
        await page.keyboard.press("ArrowUp");

        await expect.poll(() => {
            return monitor.getSnapshots(humanPlayerId).some(snapshot => {
                return snapshot.sequence > humanBeforeInput.sequence &&
                    snapshot.pieceIndex === humanBeforeInput.pieceIndex &&
                    (snapshot.activePiece?.col !== humanBeforeInput.activePiece.col ||
                        snapshot.activePiece?.rotation !== humanBeforeInput.activePiece.rotation);
            });
        }).toBe(true);
        await expect.poll(async () => {
            return humanCanvas.evaluate(canvas => canvas.toDataURL());
        }).not.toBe(humanCanvasBefore);

        const firstHardDropIndex = normalSummary.actions.findIndex(action => {
            return action.type === "hard_drop";
        });
        const firstPieceActions = normalSummary.actions.slice(0, firstHardDropIndex + 1);
        expect(firstHardDropIndex).toBeGreaterThan(0);
        expect(normalSummary.maxConsecutiveSoftDrops).toBeGreaterThanOrEqual(5);

        const aiBoard = await readBottomBoardFingerprint(page, 2, 8);
        expect(aiBoard).not.toBe(EMPTY_BOTTOM_BOARD);
        const firstLock = firstPieceActions.at(-1).snapshot;
        expect(firstLock.occupiedCellCount).toBeGreaterThan(0);

        const humanInitialSnapshot = monitor.getInitialSnapshot(humanPlayerId);
        await expect.poll(() => {
            return monitor.getSnapshots(humanPlayerId).some(snapshot => {
                return snapshot.pieceIndex === humanInitialSnapshot.pieceIndex &&
                    snapshot.tick > humanInitialSnapshot.tick &&
                    snapshot.activePiece?.row > humanInitialSnapshot.activePiece?.row;
            });
        }, {
            timeout: 5_000,
            intervals: [100, 150, 250],
        }).toBe(true);
    } finally {
        monitor.dispose();
    }
});

test("PVE hard는 terminal soft drop 없이 action 단계 후 hard drop한다", async ({ page }) => {
    const monitor = createPveSocketMonitor(page);

    try {
        await createPveRoom(page, "hard");
        await startPveMatch(page);

        const hardObservation = await waitForAiActionSummary(
            monitor,
            ["move", "hard_drop"],
        );
        const { summary: hardSummary } = hardObservation;
        const firstHardDropIndex = hardSummary.actions.findIndex(action => {
            return action.type === "hard_drop";
        });
        const firstPieceActions = hardSummary.actions.slice(0, firstHardDropIndex + 1);

        expect(firstHardDropIndex).toBeGreaterThan(0);
        expect(hardSummary.maxConsecutiveSoftDrops).toBeLessThan(5);
        expect(firstPieceActions.at(-1).snapshot.occupiedCellCount).toBeGreaterThan(0);

        const aiBoard = await readBottomBoardFingerprint(page, 2, 8);
        expect(aiBoard).not.toBe(EMPTY_BOTTOM_BOARD);
    } finally {
        monitor.dispose();
    }
});

test("PVE AI attack은 human pending 표시 후 다음 lock에 적용된다", async ({ page }) => {
    const monitor = createPveSocketMonitor(page);

    try {
        await createPveRoom(page, "hard");
        await startPveMatch(page);

        const { aiPlayerId } = await waitForAiActionSummary(
            monitor,
            ["move", "hard_drop"],
        );
        await expect.poll(() => monitor.getObservedPlayerIds().length).toBe(2);
        const humanPlayerId = monitor.getObservedPlayerIds().find(playerId => {
            return playerId !== aiPlayerId;
        });
        const pendingGarbage = page.locator('.pending-garbage[data-player="1"]');
        const incomingStatus = page.locator(
            '.player-column[data-player="1"] .stat--incoming',
        );

        await expect.poll(async () => Number(await pendingGarbage.textContent()), {
            timeout: 20_000,
            intervals: [100, 150, 250],
        }).toBeGreaterThan(0);
        await expect(incomingStatus).toHaveClass(/is-danger/);

        const pendingSnapshot = monitor.getSnapshots(humanPlayerId).findLast(snapshot => {
            return snapshot.pendingGarbageLines > 0;
        });
        expect(pendingSnapshot).toBeTruthy();
        const garbageCellsBeforeLock = pendingSnapshot.board
            .flat()
            .filter(cell => cell === "garbage").length;

        await page.keyboard.press("Space");

        await expect.poll(async () => {
            const snapshotBeforeUi = getLatestSnapshot(monitor, humanPlayerId);
            const garbageCellCount = snapshotBeforeUi?.board
                .flat()
                .filter(cell => cell === "garbage").length;
            if (!snapshotBeforeUi ||
                snapshotBeforeUi.sequence <= pendingSnapshot.sequence ||
                snapshotBeforeUi.pieceIndex <= pendingSnapshot.pieceIndex ||
                snapshotBeforeUi.boardFingerprint === pendingSnapshot.boardFingerprint ||
                garbageCellCount <= garbageCellsBeforeLock) {
                return false;
            }

            const displayedPending = Number(await pendingGarbage.textContent());
            const isDanger = await incomingStatus.evaluate(element => {
                return element.classList.contains("is-danger");
            });
            const snapshotAfterUi = getLatestSnapshot(monitor, humanPlayerId);

            return snapshotBeforeUi.sequence === snapshotAfterUi?.sequence &&
                displayedPending === snapshotAfterUi.pendingGarbageLines &&
                isDanger === (snapshotAfterUi.pendingGarbageLines > 0);
        }).toBe(true);
    } finally {
        monitor.dispose();
    }
});

test("PVE server gameOver 후 결과를 표시하고 같은 방을 재시작한다", async ({ page }) => {
    const monitor = createPveSocketMonitor(page);

    try {
        const roomId = await createPveRoom(page, "normal");
        await startPveMatch(page);
        await hardDropHumanUntilResult(page);

        await expect(page.locator('.game-text[data-player="1"] > span')).toHaveText("패배");
        await expect(page.locator('.game-text[data-player="2"] > span')).toHaveText("승리");
        await expect.poll(() => monitor.getMatchFinishes().length).toBeGreaterThan(0);

        await returnPveMatchToLobby(page);
        await Promise.all([
            page.waitForURL(/\/pages\/tetrisMulti\.html\?roomId=[^&]+$/),
            page.locator("#btnPrimaryAction").click(),
        ]);

        await expect(page.locator("#roomCodeText")).toContainText(roomId);
        await expect(page.locator("#player2Name")).toHaveText("Heuristic AI");
        await expect(page.locator('.next-preview[data-player="1"] .next-cell')).toHaveCount(32);
    } finally {
        monitor.dispose();
    }
});
