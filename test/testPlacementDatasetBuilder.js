const test = require("node:test");
const assert = require("node:assert/strict");

function createBoard(rows = 20, cols = 10) {
    return Array.from({ length: rows }, () => Array(cols).fill(null));
}

function createMetrics(columnCount = 10) {
    return {
        columnHeights: Array(columnCount).fill(0),
        aggregateHeight: 0,
        maxHeight: 0,
        holes: 0,
        bumpiness: 0,
        completeLines: 0,
    };
}

async function createValidLog(overrides = {}) {
    const { generateReachablePlacements } = await import(
        "../src/client/game/ai/heuristic/reachablePlacementPlanner.js"
    );
    const boardBefore = createBoard();
    const activePiece = {
        pieceType: "square",
        rotation: 0,
        row: -1,
        col: 3,
        cells: [
            { row: -1, col: 3 },
            { row: -1, col: 4 },
            { row: 0, col: 3 },
            { row: 0, col: 4 },
        ],
    };
    const selectedPlacement = generateReachablePlacements(
        boardBefore,
        activePiece,
    ).find(candidate => candidate.placement.col === 3).placement;

    return {
        eventType: "placement_decision",
        schemaVersion: 2,
        gameId: "game-human-001",
        roomId: "room-001",
        playerId: "player-001",
        source: "human",
        modelType: null,
        tick: 10,
        pieceIndex: 3,
        createdAt: 1780000000000,
        boardBefore,
        boardAfter: createBoard(),
        activePiece,
        nextQueue: ["bar", "tree"],
        holdPiece: null,
        selectedPlacement,
        placementResult: {
            linesCleared: 0,
            scoreDelta: 36,
            gameOver: false,
        },
        metricsBefore: createMetrics(),
        metricsAfter: createMetrics(),
        evaluation: {
            score: -2,
            candidateCount: 9,
            reason: {
                linesCleared: 0,
                holesDelta: 0,
                bumpinessDelta: 0,
                aggregateHeightDelta: 4,
                maxHeightDelta: 2,
            },
        },
        aiComparison: {
            heuristicPlacement: structuredClone(selectedPlacement),
            heuristicScore: -2,
            userScore: -2,
            betterBy: 0,
            samePlacement: true,
        },
        inputSequence: [{
            action: "hard_drop",
            tick: 10,
            pieceIndex: 3,
            sequence: 1,
            createdAt: 1780000000000,
        }],
        ...overrides,
    };
}

test("valid human schemaVersion 2 로그에서 reachable candidate samples를 생성한다", async () => {
    const { buildPlacementDataset, PLACEMENT_DATASET_SCHEMA_VERSION } = await import(
        "../src/client/game/ai/dataset/placementDatasetBuilder.js"
    );
    const log = await createValidLog();
    const result = buildPlacementDataset([log]);

    assert.ok(result.samples.length > 0);
    assert.equal(result.rejected.length, 0);
    assert.equal(result.summary.acceptedLogCount, 1);
    assert.equal(result.summary.sampleCount, result.samples.length);
    assert.ok(result.samples.every(sample => {
        return sample.datasetSchemaVersion === PLACEMENT_DATASET_SCHEMA_VERSION &&
            sample.gameId === log.gameId &&
            sample.source === "human" &&
            sample.pieceType === "square" &&
            sample.plannedActions.at(-1) === "hard_drop";
    }));
});

test("heuristic_ai normal과 hard metadata를 candidate마다 보존한다", async () => {
    const { buildPlacementDataset } = await import(
        "../src/client/game/ai/dataset/placementDatasetBuilder.js"
    );
    const normalLog = await createValidLog({
        gameId: "game-normal",
        playerId: "ai-normal",
        source: "heuristic_ai",
        modelType: "heuristic",
        aiDifficulty: "normal",
        aiComparison: undefined,
    });
    const hardLog = await createValidLog({
        gameId: "game-hard",
        playerId: "ai-hard",
        source: "heuristic_ai",
        modelType: "heuristic",
        aiDifficulty: "hard",
        aiComparison: undefined,
    });
    const result = buildPlacementDataset([normalLog, hardLog]);

    assert.equal(result.rejected.length, 0);
    assert.ok(result.samples.some(sample => sample.aiDifficulty === "normal"));
    assert.ok(result.samples.some(sample => sample.aiDifficulty === "hard"));
    assert.ok(result.samples.every(sample => {
        return sample.source === "heuristic_ai" && sample.modelType === "heuristic";
    }));
});

test("원본 selectedPlacement와 일치하는 candidate 하나만 label이 true다", async () => {
    const { buildPlacementDataset } = await import(
        "../src/client/game/ai/dataset/placementDatasetBuilder.js"
    );
    const log = await createValidLog();
    const result = buildPlacementDataset([log]);
    const selectedSamples = result.samples.filter(sample => sample.selectedBySource);

    assert.equal(selectedSamples.length, 1);
    assert.deepEqual(selectedSamples[0].candidatePlacement, log.selectedPlacement);
});

test("candidateResult는 후보 simulation의 linesCleared와 gameOver를 사용한다", async () => {
    const { buildPlacementDataset, PLACEMENT_DATASET_SCHEMA_VERSION } = await import(
        "../src/client/game/ai/dataset/placementDatasetBuilder.js"
    );
    const result = buildPlacementDataset([await createValidLog()]);

    assert.equal(PLACEMENT_DATASET_SCHEMA_VERSION, 2);
    assert.ok(result.samples.every(sample => {
        return Number.isInteger(sample.candidateResult.linesCleared) &&
            sample.candidateResult.linesCleared >= 0 &&
            typeof sample.candidateResult.gameOver === "boolean";
    }));
    assert.ok(result.samples.every(sample => {
        return sample.candidateResult.linesCleared ===
            sample.heuristicBaseline.reason.linesCleared;
    }));
});

test("inputSequence와 입력 객체를 변경하지 않고 metadata 복사본을 만든다", async () => {
    const { buildPlacementDataset } = await import(
        "../src/client/game/ai/dataset/placementDatasetBuilder.js"
    );
    const log = await createValidLog();
    const originalLog = structuredClone(log);
    const result = buildPlacementDataset([log]);

    assert.deepEqual(log, originalLog);
    assert.deepEqual(result.samples[0].metadata.inputSequence, log.inputSequence);
    assert.notStrictEqual(result.samples[0].metadata.inputSequence, log.inputSequence);
    assert.notStrictEqual(result.samples[0].boardBefore, log.boardBefore);

    result.samples[0].metadata.inputSequence[0].action = "move_left";
    result.samples[0].boardBefore[0][0] = "changed";
    assert.deepEqual(log, originalLog);
});

test("inputSequence 내부 항목의 action과 숫자 필드 타입 및 범위를 검증한다", async () => {
    const {
        buildPlacementDataset,
        DATASET_REJECTION_REASONS,
    } = await import("../src/client/game/ai/dataset/placementDatasetBuilder.js");
    const validInput = {
        action: "hard_drop",
        tick: 10,
        pieceIndex: 3,
        sequence: 1,
        createdAt: 1780000000000,
    };
    const invalidSequences = [
        [null],
        [{ ...validInput, action: 123 }],
        [{ ...validInput, action: "teleport" }],
        [{ ...validInput, tick: "10" }],
        [{ ...validInput, tick: -1 }],
        [{ ...validInput, pieceIndex: 3.5 }],
        [{ ...validInput, pieceIndex: -1 }],
        [{ ...validInput, sequence: "1" }],
        [{ ...validInput, sequence: 0 }],
        [{ ...validInput, createdAt: Number.POSITIVE_INFINITY }],
        [{ ...validInput, createdAt: -1 }],
    ];

    for (const [index, inputSequence] of invalidSequences.entries()) {
        const log = await createValidLog({
            gameId: `game-invalid-input-${index}`,
            inputSequence,
        });
        const result = buildPlacementDataset([log]);

        assert.equal(result.samples.length, 0);
        assert.equal(
            result.rejected[0].reason,
            DATASET_REJECTION_REASONS.INVALID_INPUT_SEQUENCE,
        );
    }
});

test("schemaVersion 1 로그는 명시적인 reason으로 제외한다", async () => {
    const {
        buildPlacementDataset,
        DATASET_REJECTION_REASONS,
    } = await import("../src/client/game/ai/dataset/placementDatasetBuilder.js");
    const log = await createValidLog({ schemaVersion: 1 });
    const result = buildPlacementDataset([log]);

    assert.equal(result.samples.length, 0);
    assert.deepEqual(result.rejected, [{
        index: 0,
        gameId: log.gameId,
        pieceIndex: log.pieceIndex,
        reason: DATASET_REJECTION_REASONS.UNSUPPORTED_SCHEMA_VERSION,
    }]);
});

test("malformed board와 도달 불가능한 선택을 rejected reason으로 분류한다", async () => {
    const {
        buildPlacementDataset,
        DATASET_REJECTION_REASONS,
    } = await import("../src/client/game/ai/dataset/placementDatasetBuilder.js");
    const malformedBoardLog = await createValidLog({
        gameId: "game-malformed",
        boardBefore: [[null], [null, null]],
    });
    const unreachableLog = await createValidLog({
        gameId: "game-unreachable",
        selectedPlacement: {
            pieceType: "square",
            rotation: 0,
            row: 0,
            col: 0,
            cells: [
                { row: 0, col: 0 },
                { row: 0, col: 1 },
                { row: 1, col: 0 },
                { row: 1, col: 1 },
            ],
        },
    });
    const result = buildPlacementDataset([malformedBoardLog, unreachableLog]);

    assert.deepEqual(result.rejected.map(item => item.reason), [
        DATASET_REJECTION_REASONS.INVALID_BOARD,
        DATASET_REJECTION_REASONS.SELECTED_PLACEMENT_NOT_REACHABLE,
    ]);
});

test("미래 결과와 원본 evaluation은 sample feature에 포함하지 않는다", async () => {
    const { buildPlacementDataset } = await import(
        "../src/client/game/ai/dataset/placementDatasetBuilder.js"
    );
    const log = await createValidLog({
        boardAfter: [["FUTURE_BOARD_LEAK"]],
        placementResult: {
            linesCleared: 99,
            scoreDelta: 99999,
            gameOver: true,
        },
        evaluation: {
            score: 777777,
            candidateCount: 1,
            reason: { futureResult: true },
        },
        winner: "player-001",
    });
    const result = buildPlacementDataset([log]);
    const serializedSamples = JSON.stringify(result.samples);

    assert.equal(serializedSamples.includes("FUTURE_BOARD_LEAK"), false);
    assert.equal(serializedSamples.includes("placementResult"), false);
    assert.equal(serializedSamples.includes("777777"), false);
    assert.equal(serializedSamples.includes("winner"), false);
    assert.ok(result.samples.every(sample => {
        return Number.isFinite(sample.heuristicBaseline.score) &&
            Number.isFinite(sample.heuristicBaseline.reason.linesCleared);
    }));
});

test("동일 로그 입력은 후보 순서, score, rejected reason까지 결정적이다", async () => {
    const { buildPlacementDataset } = await import(
        "../src/client/game/ai/dataset/placementDatasetBuilder.js"
    );
    const validLog = await createValidLog();
    const invalidLog = await createValidLog({
        gameId: "game-invalid-source",
        source: "ml_ai",
        modelType: "ml",
    });

    const first = buildPlacementDataset([validLog, invalidLog]);
    const second = buildPlacementDataset([validLog, invalidLog]);

    assert.deepEqual(first, second);
});

function createSplitSamples(gameCount = 20) {
    return Array.from({ length: gameCount }, (_, gameIndex) => {
        return Array.from({ length: 2 }, (_, candidateIndex) => ({
            gameId: `game-${String(gameIndex).padStart(2, "0")}`,
            playerId: "player-001",
            pieceIndex: 1,
            candidatePlacement: {
                pieceType: "square",
                rotation: 0,
                row: 18,
                col: candidateIndex,
            },
        }));
    }).flat();
}

function createGameSplitMap(split) {
    return new Map([
        ...split.train.map(sample => [sample.gameId, "train"]),
        ...split.validation.map(sample => [sample.gameId, "validation"]),
    ]);
}

test("gameId 단위 split은 train과 validation leakage를 막는다", async () => {
    const { splitDatasetByGameId } = await import(
        "../src/client/game/ai/dataset/placementDatasetBuilder.js"
    );
    const samples = createSplitSamples();
    const split = splitDatasetByGameId(samples, {
        validationRatio: 0.4,
        seed: "split-seed",
    });
    const trainGameIds = new Set(split.train.map(sample => sample.gameId));
    const validationGameIds = new Set(split.validation.map(sample => sample.gameId));

    assert.ok(split.train.length > 0);
    assert.ok(split.validation.length > 0);
    assert.equal(split.train.length + split.validation.length, samples.length);
    assert.ok([...trainGameIds].every(gameId => !validationGameIds.has(gameId)));
});

test("같은 seed의 split 결과는 동일하다", async () => {
    const { splitDatasetByGameId } = await import(
        "../src/client/game/ai/dataset/placementDatasetBuilder.js"
    );
    const samples = createSplitSamples();
    const options = { validationRatio: 0.3, seed: 20260714 };

    assert.deepEqual(
        splitDatasetByGameId(samples, options),
        splitDatasetByGameId(samples, options),
    );
});

test("입력 sample 순서가 바뀌어도 gameId별 split과 출력 순서가 유지된다", async () => {
    const { splitDatasetByGameId } = await import(
        "../src/client/game/ai/dataset/placementDatasetBuilder.js"
    );
    const samples = createSplitSamples();
    const options = { validationRatio: 0.35, seed: "order-independent" };
    const forward = splitDatasetByGameId(samples, options);
    const reversed = splitDatasetByGameId([...samples].reverse(), options);

    assert.deepEqual(createGameSplitMap(forward), createGameSplitMap(reversed));
    assert.deepEqual(forward, reversed);
});
