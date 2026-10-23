/**
 * 공유 fixture를 실제 40행 core·서버·AI·표시 계약에 연결한다.
 * 과거 20행 분석의 재현 검사는 별도로 유지한다.
 */
const test = require("node:test");
const assert = require("node:assert/strict");
const fixture = require("./fixtures/top-out-buffer-zone.json");

function createBoard(scenario = {}) {
    const board = Array.from({ length: fixture.geometry.rows }, () => Array(fixture.geometry.cols).fill(null));
    for (const { row, exceptCols } of scenario.filledRows ?? []) {
        board[row] = board[row].map((_, col) => exceptCols.includes(col) ? null : "tree");
    }
    for (const [row, col] of scenario.filledCells ?? []) {
        assert.equal(board[row][col], null, "fixture cells must not overwrite each other");
        board[row][col] = "tree";
    }
    return board;
}

function pieceCells(piece, blocks) {
    return blocks[piece.pieceType][piece.rotation].map(([x, y]) => [piece.row + y, piece.col + x]);
}

test("1단계 계약은 40행 좌표·고정 시 종료 순서와 미실행 후처리를 고정한다", async () => {
    const { default: blocks } = await import("../src/client/game/state/blocks.ts");
    assert.equal(fixture.geometry.rows, fixture.geometry.hiddenRows + fixture.geometry.visibleRows);
    assert.deepEqual(fixture.terminalPolicy.priority, ["lock_out", "top_out", "block_out"]);
    assert.deepEqual(fixture.terminalPolicy.lockOut, {
        stage: "lock_commit", recordLockedCells: true, preserveDropDistanceScore: true,
        linesCleared: 0, canceledGarbageLines: 0, appliedGarbageLines: 0,
        spawnNext: false, terminalPlacementCount: 1,
    });
    for (const scenario of fixture.locks) {
        const cells = pieceCells(scenario.piece, blocks);
        assert.equal(cells.every(([row]) => row < fixture.geometry.hiddenRows), scenario.expected.lockOut, scenario.id);
    }
});

test("과거 20행 재현을 보존하고 40행 부분 고정과 줄 삭제를 검증한다", async () => {
    const { simulatePlacement } = await import("../src/client/game/ai/heuristic/simulatePlacement.ts");
    const scenario = fixture.locks.find(item => item.id === "partial-clear");
    const board = createBoard(scenario);
    const original = structuredClone(board);
    const legacyResult = simulatePlacement(board.slice(fixture.geometry.hiddenRows), {
        ...scenario.piece, row: scenario.piece.row - fixture.geometry.hiddenRows,
    });
    assert.equal(legacyResult.gameOver, scenario.legacy.gameOver);
    assert.equal(legacyResult.linesCleared, scenario.legacy.linesCleared);
    assert.notEqual(legacyResult.gameOver, scenario.expected.lockOut);
    const shiftedResult = simulatePlacement(board, scenario.piece);
    assert.equal(shiftedResult.linesCleared, scenario.expected.linesCleared);
    assert.deepEqual(shiftedResult.boardAfter.flatMap((row, rowIndex) => row.flatMap((cell, col) =>
        cell === "square" ? [[rowIndex, col]] : [])), scenario.expected.remainingPieceCells);
    assert.deepEqual(board, original);
});

test("서버는 전체 상단 고정에서 줄 삭제·garbage·다음 spawn 없이 종료한다", async () => {
    const { loadGameCore } = require("../dist/server/server/services/gameCoreLoader.js");
    const { applyAuthoritativeInput } = require("../dist/server/server/services/playerGameplayStep.js");
    const core = await loadGameCore();
    const scenario = fixture.locks.find(item => item.id === "whole-hidden-before-clear");
    const state = {
        board: createBoard(scenario), activePiece: { ...scenario.piece }, pendingPiece: { ...scenario.piece },
        pieceQueue: ["tree"], holdPieceType: null, holdUsedThisDrop: false, score: 0, lines: 0,
        phase: "playing", combo: -1, backToBack: false, currentTick: 0, pieceIndex: 1,
        pendingGarbageQueue: [{ lines: scenario.pendingGarbageLines, holeCol: 4 }], spinRotation: null,
        lockDelay: core.createLockDelay(scenario.piece.row),
    };
    const { placementResult } = applyAuthoritativeInput(state, { action: "hard_drop" }, core);
    assert.equal(placementResult.gameOver, true);
    assert.equal(placementResult.gameOverReason, scenario.expected.gameOverReason);
    assert.equal(placementResult.linesCleared, 0);
    assert.equal(placementResult.appliedGarbageLines, 0);
    assert.equal(placementResult.canceledGarbageLines, 0);
    assert.equal(placementResult.nextPiece, null);
    assert.equal(state.pieceQueue.length, 1);
    assert.equal(state.pendingGarbageQueue.length, 1);
    assert.equal(state.board[19][0], "square");

});

test("7종은 바닥 기준 21·22행(I는 21행)에서 생성되고 가능하면 즉시 한 행 내린다", async () => {
    const { default: blocks } = await import("../src/client/game/state/blocks.ts");
    const { canPlacePiece } = await import("../src/client/game/core/board.ts");
    const { getSpawnedPiece } = await import("../src/client/game/core/piece.ts");
    assert.deepEqual(fixture.spawnPieces.map(piece => piece.pieceType).sort(), Object.keys(blocks).sort());
    for (const spawn of fixture.spawnPieces) {
        const piece = { pieceType: spawn.pieceType, row: spawn.row, col: spawn.col, rotation: 0 };
        assert.deepEqual(pieceCells(piece, blocks), spawn.cells, spawn.pieceType);
        const bottomRows = [...new Set(spawn.cells.map(([row]) => fixture.geometry.rows - row))].sort((a, b) => a - b);
        assert.deepEqual(bottomRows, spawn.pieceType === "bar" ? [21] : [21, 22], spawn.pieceType);
        assert.equal(canPlacePiece(createBoard(), piece, blocks), true);
        assert.equal(canPlacePiece(createBoard(), { ...piece, row: piece.row + 1 }, blocks), true);
        assert.deepEqual(pieceCells(getSpawnedPiece(createBoard(), spawn.pieceType), blocks),
            spawn.cells.map(([row, col]) => [row + 1, col]), spawn.pieceType);
    }
});

for (const scenario of fixture.spawnCases) {
    test(`spawn 계약: ${scenario.id}`, async () => {
        const { default: blocks } = await import("../src/client/game/state/blocks.ts");
        const { canPlacePiece } = await import("../src/client/game/core/board.ts");
        const spawn = fixture.spawnPieces.find(item => item.pieceType === scenario.pieceType);
        const piece = { pieceType: spawn.pieceType, row: spawn.row, col: spawn.col, rotation: 0 };
        const board = createBoard(scenario);
        assert.equal(canPlacePiece(board, piece, blocks), scenario.expected.canSpawn);
        if (scenario.expected.canDescend !== undefined) {
            assert.equal(canPlacePiece(board, { ...piece, row: piece.row + 1 }, blocks), scenario.expected.canDescend);
        }
        assert.equal(scenario.expected.gameOver, !scenario.expected.canSpawn);
    });
}

test("천장 경계는 piece 기준점과 실제 cell을 구분하고 범위 밖 cell을 막는다", async () => {
    const { default: blocks } = await import("../src/client/game/state/blocks.ts");
    const { canPlacePiece } = await import("../src/client/game/core/board.ts");
    for (const scenario of fixture.ceilingCases) {
        const inside = pieceCells(scenario.piece, blocks).every(([row]) => row >= 0 && row < fixture.geometry.rows);
        assert.equal(inside, scenario.expectedCanPlace, scenario.id);
        assert.equal(canPlacePiece(createBoard(), scenario.piece, blocks), scenario.expectedCanPlace, scenario.id);
    }
});

for (const scenario of fixture.spinCases) {
    test(`버퍼와 천장 T-Spin: ${scenario.id}`, async () => {
        const { classifyTSpin } = await import("../src/client/game/core/tSpin.ts");
        const result = classifyTSpin({
            board: createBoard(scenario), piece: scenario.piece,
            spinRotation: { lastKickIndex: 0, usedKick5: false },
        });
        assert.equal(result, scenario.expected);
    });
}

for (const scenario of fixture.nextSpawnCases) {
    test(`다음 조각의 실제 생성 충돌: ${scenario.id}`, async () => {
        const { simulatePlacement } = await import("../src/client/game/ai/heuristic/simulatePlacement.ts");
        const { canPlacePiece } = await import("../src/client/game/core/board.ts");
        const { default: blocks } = await import("../src/client/game/state/blocks.ts");
        const board = createBoard({
            filledCells: [[21, 3], [21, 4]],
            filledRows: scenario.clearRow ? [{ row: 20, exceptCols: [3, 4] }] : [],
        });
        const result = simulatePlacement(board, { pieceType: "square", rotation: 0, row: 19, col: 3 }, { nextPieceType: "tree", pendingGarbageQueue: [] });
        assert.equal(result.linesCleared, scenario.expected.linesCleared);
        const canSpawn = canPlacePiece(result.boardAfter, { pieceType: "tree", rotation: 0, row: 18, col: 3 }, blocks);
        assert.equal(canSpawn, scenario.expected.canSpawnNext);
        assert.equal(result.gameOver, scenario.expected.gameOver);
        assert.equal(scenario.expected.gameOver, !canSpawn);
    });
}

for (const scenario of fixture.garbageCases) {
    test(`garbage 경계 fixture: ${scenario.id}`, async () => {
        const { applyGarbageLines } = await import("../src/client/game/core/garbage.ts");
        const board = createBoard(scenario);
        const result = applyGarbageLines(board, { lines: scenario.lines, holeCol: 4 });
        assert.equal(result.overflow, scenario.expectedOverflow);
        assert.equal(board.length, fixture.geometry.rows);
        if (scenario.trackedCell) assert.equal(board[scenario.trackedCell[0]][scenario.trackedCell[1]], "tree");
        else assert.equal(board.flat().includes("tree"), false);
    });
}

test("heuristic은 점수가 높아도 종료 후보보다 생존 후보를 우선한다", async () => {
    const { compareHeuristicEvaluations } = await import("../src/client/game/ai/heuristic/heuristicEvaluator.ts");
    const candidates = fixture.ranking.candidates.map(candidate => ({
        ...candidate, linesCleared: 0, placement: fixture.locks[0].piece,
        metricsAfter: { holes: 0, aggregateHeight: 0, bumpiness: 0, maxHeight: 0 },
    }));
    assert.equal([...candidates].sort(compareHeuristicEvaluations)[0].id, fixture.ranking.expectedFirst);
    assert.equal(candidates.find(item => item.id === fixture.ranking.expectedFirst).gameOver, false);
    assert.notEqual(fixture.ranking.currentFirst, fixture.ranking.expectedFirst);
});

test("빈 보드 BFS는 20행을 위에 붙여도 대응하는 최종 후보 34개를 보존한다", async () => {
    const { generateReachablePlacements } = await import("../src/client/game/ai/heuristic/reachablePlacementPlanner.ts");
    const legacy = generateReachablePlacements(createBoard().slice(fixture.geometry.hiddenRows), fixture.bfs.legacyStart);
    const target = generateReachablePlacements(createBoard(), fixture.bfs.targetStart);
    const keys = (items, offset) => items.map(({ placement }) =>
        `${placement.rotation}:${placement.col}:${placement.row - offset}`).sort();
    assert.equal(legacy.length, fixture.bfs.expectedEmptyBoardCandidateCount);
    assert.equal(target.length, fixture.bfs.expectedEmptyBoardCandidateCount);
    assert.deepEqual(keys(target, fixture.geometry.hiddenRows), keys(legacy, 0));
});

test("열린 천장의 좌표 fixture는 20행 게임판과 위쪽 표시 영역을 분리한다", async () => {
    const { UPPER_DISPLAY_ROWS, internalRowToCanvasRow } = await import("../src/client/game/render/tetrisRender.ts");
    const view = fixture.visibility;
    assert.equal(UPPER_DISPLAY_ROWS, view.upperDisplayRowsForFixture);
    const top = view.upperDisplayRowsForFixture * view.cellSize;
    assert.equal(top, view.expectedVisibleBoardTop);
    assert.equal(fixture.geometry.cols * view.cellSize, view.expectedWidth);
    assert.equal(top + fixture.geometry.visibleRows * view.cellSize, view.expectedHeight);
    for (const [row, y] of view.rowCoordinates) {
        assert.equal(top + (row - fixture.geometry.hiddenRows) * view.cellSize, y);
        assert.equal(internalRowToCanvasRow(row) * view.cellSize, y);
    }
    assert.deepEqual(view.sharedCoordinates, ["settled", "active", "ghost", "hard_drop_from", "hard_drop_to", "line_clear"]);
});

for (const scenario of fixture.visibility.hiddenGhostCases) {
    test(`열린 천장에서도 ghost만으로 표시를 보장하지 않는다: row ${scenario.pieceRow}`, async () => {
        const { canPlacePiece } = await import("../src/client/game/core/board.ts");
        const { getHardDropRow } = await import("../src/client/game/core/piece.ts");
        const { default: blocks } = await import("../src/client/game/state/blocks.ts");
        const board = createBoard({ filledCells: [[scenario.supportRow, 4]] });
        const piece = { pieceType: "tree", rotation: 0, row: scenario.pieceRow, col: 3 };
        const row = getHardDropRow(piece, targetRow => canPlacePiece(board, { ...piece, row: targetRow }, blocks));
        assert.equal(row, scenario.expectedGhostRow);
        const cells = pieceCells({ ...piece, row }, blocks);
        assert.equal(cells.filter(([cellRow]) => cellRow >= fixture.geometry.hiddenRows).length, scenario.expectedVisibleGhostCells);
        const firstDisplayedRow = fixture.geometry.hiddenRows - fixture.visibility.upperDisplayRowsForFixture;
        assert.equal(cells.every(([cellRow]) => cellRow < firstDisplayedRow), scenario.needsPositionIndicator);
    });
}

test("40행 wire는 새 board를 허용하고 20행 board를 거부한다", async () => {
    const { boardSchema, serverToClientSchemas } = await import("../src/shared/socketContracts.mjs");
    assert.equal(boardSchema.safeParse(createBoard()).success, true);
    assert.equal(boardSchema.safeParse(createBoard().slice(20)).success, false);
    assert.equal(serverToClientSchemas["pve:ai-policy"].safeParse(fixture.compatibility.v4Policy).success, true);
    assert.equal(fixture.compatibility.v4InferenceAllowed, false);
});

test("v3 관찰 문맥 fixture는 next 누락·garbage 전 상태를 확정 종료 label로 쓰지 않는다", () => {
    assert.equal(fixture.logging.schemaVersion, 3);
    for (const scenario of fixture.logging.observationCases) {
        if (!scenario.nextPieceType || !scenario.garbageResolved) {
            assert.equal(scenario.nextSpawnOutcome, "not_evaluated");
            assert.equal(scenario.terminalOutcome, null);
        } else {
            assert.equal(scenario.stage, "post_garbage_spawn");
            assert.equal(scenario.terminalOutcome, "block_out");
        }
    }
});
