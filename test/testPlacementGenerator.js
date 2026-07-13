const test = require("node:test");
const assert = require("node:assert/strict");

const PIECE_TYPES = [
    "tree",
    "square",
    "bar",
    "zee",
    "eleft",
    "eright",
    "ess",
];

function createBoard(rows = 20, cols = 10) {
    return Array.from({ length: rows }, () => Array(cols).fill(null));
}

test("빈 board에서 모든 rotation의 최종 placement 후보를 생성한다", async () => {
    const { generatePlacements } = await import(
        "../src/client/game/ai/heuristic/placementGenerator.js"
    );
    const board = createBoard();
    const activePiece = {
        pieceType: "bar",
        rotation: 0,
        row: -1,
        col: 3,
    };
    const boardBefore = board.map(row => [...row]);
    const activePieceBefore = { ...activePiece };

    const placements = generatePlacements(board, activePiece);

    assert.ok(placements.length > 0);
    assert.deepEqual([...new Set(placements.map(placement => placement.rotation))], [0, 1, 2, 3]);
    assert.deepEqual(board, boardBefore);
    assert.deepEqual(activePiece, activePieceBefore);
});

test("모든 piece type은 빈 board에서 하나 이상의 후보를 가진다", async () => {
    const { generatePlacements } = await import(
        "../src/client/game/ai/heuristic/placementGenerator.js"
    );
    const board = createBoard();

    PIECE_TYPES.forEach(pieceType => {
        const placements = generatePlacements(board, { pieceType });
        assert.ok(placements.length > 0, `${pieceType} candidate가 비어 있다`);
        assert.ok(placements.every(placement => placement.pieceType === pieceType));
    });
});

test("locked block과 겹치는 placement 후보를 제외한다", async () => {
    const {
        canPlacePlacement,
        generatePlacements,
    } = await import("../src/client/game/ai/heuristic/placementGenerator.js");
    const board = createBoard();
    board[19][0] = "bar";
    board[19][1] = "bar";

    const placements = generatePlacements(board, { pieceType: "square" });

    assert.equal(canPlacePlacement(board, "square", 0, 0, 18), false);
    assert.ok(placements.every(placement => {
        return placement.cells.every(cell => board[cell.row][cell.col] === null);
    }));
});

test("board 밖 cell을 가진 placement를 제외한다", async () => {
    const {
        canPlacePlacement,
        generatePlacements,
    } = await import("../src/client/game/ai/heuristic/placementGenerator.js");
    const board = createBoard();

    assert.equal(canPlacePlacement(board, "square", 0, -1, 18), false);
    assert.equal(canPlacePlacement(board, "square", 0, 9, 18), false);
    assert.equal(canPlacePlacement(board, "square", 0, 0, 19), false);

    const placements = generatePlacements(board, { pieceType: "bar" });
    assert.ok(placements.every(placement => {
        return placement.cells.every(cell => {
            return cell.row >= 0 &&
                cell.row < board.length &&
                cell.col >= 0 &&
                cell.col < board[0].length;
        });
    }));
});

test("getDropRow는 직선 하드드롭 가능한 마지막 row를 반환한다", async () => {
    const { getDropRow } = await import(
        "../src/client/game/ai/heuristic/placementGenerator.js"
    );
    const board = createBoard();

    assert.equal(getDropRow(board, "square", 0, 0), 18);

    board[19][0] = "tree";
    assert.equal(getDropRow(board, "square", 0, 0), 17);
});

test("같은 pieceType, rotation, col, row 후보를 중복 생성하지 않는다", async () => {
    const { generatePlacements } = await import(
        "../src/client/game/ai/heuristic/placementGenerator.js"
    );
    const placements = generatePlacements(createBoard(), { pieceType: "square" });
    const keys = placements.map(placement => {
        return `${placement.pieceType}:${placement.rotation}:${placement.col}:${placement.row}`;
    });

    assert.equal(new Set(keys).size, placements.length);
});

test("normalizePlacement는 rotation과 절대 cell 좌표를 표준 형태로 만든다", async () => {
    const { normalizePlacement } = await import(
        "../src/client/game/ai/heuristic/placementGenerator.js"
    );

    assert.deepEqual(normalizePlacement({
        pieceType: "square",
        rotation: 4,
        col: 2,
        row: 5,
        cells: [{ row: 99, col: 99 }],
    }), {
        pieceType: "square",
        rotation: 0,
        col: 2,
        row: 5,
        cells: [
            { row: 5, col: 2 },
            { row: 5, col: 3 },
            { row: 6, col: 2 },
            { row: 6, col: 3 },
        ],
    });
});

test("놓을 수 있는 후보가 없으면 빈 배열을 반환한다", async () => {
    const { generatePlacements } = await import(
        "../src/client/game/ai/heuristic/placementGenerator.js"
    );
    const board = createBoard().map(row => row.map(() => "garbage"));

    assert.deepEqual(generatePlacements(board, { pieceType: "tree" }), []);
    assert.deepEqual(generatePlacements(board, null), []);
});
