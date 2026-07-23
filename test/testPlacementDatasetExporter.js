/**
 * append-only game event JSONL을 재현 가능한 train/validation snapshot으로 내보내는 전체 경로를 검증한다.
 *
 * 준비: 임시 디렉터리에 complete/incomplete/malformed game event를 JSONL로 기록한다.
 * 실행: lifecycle·winner/source/piece 정책 필터, builder, gameId split과 manifest 생성을 수행한다.
 * 검증: 제외 사유와 난이도 provenance가 보존되고, 동일 입력·seed는 동일한 네 output 파일을 만들며,
 * train/validation 사이 gameId 누출이나 stale row가 없고 원본 JSONL bytes는 바뀌지 않아야 한다.
 *
 * `t.after`로 임시 파일을 정리하므로 운영 dataset과 log에는 영향을 주지 않는다.
 */
const test = require("node:test");
const assert = require("node:assert/strict");
const { createHash } = require("node:crypto");
const { mkdtemp, readFile, rm, writeFile } = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");

const {
    exportPlacementDataset,
    parseCliArgs,
} = require("../scripts/export-placement-dataset.js");

function createBoard(rows = 20, columns = 10) {
    return Array.from({ length: rows }, () => Array(columns).fill(null));
}

function createPlacementDecision(overrides = {}) {
    return {
        eventType: "placement_decision",
        schemaVersion: 2,
        gameId: "game-001",
        playerId: "winner-001",
        source: "human",
        modelType: null,
        pieceIndex: 5,
        boardBefore: createBoard(),
        activePiece: {
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
        },
        selectedPlacement: {
            pieceType: "square",
            rotation: 0,
            row: 18,
            col: 3,
            cells: [
                { row: 18, col: 3 },
                { row: 18, col: 4 },
                { row: 19, col: 3 },
                { row: 19, col: 4 },
            ],
        },
        inputSequence: [],
        ...overrides,
    };
}

/**
 * game_start → placement들 → game_over 순서의 완결된 lifecycle fixture를 만든다.
 * exporter가 개별 row가 아니라 game 결과 문맥으로 placement를 선택하는 이유를 보여 준다.
 */
function createCompleteGame({
    gameId = "game-001",
    winnerPlayerId = "winner-001",
    loserPlayerId = "loser-001",
    finishType = "normal",
    placements = [createPlacementDecision({ gameId, playerId: winnerPlayerId })],
} = {}) {
    return [
        {
            eventType: "game_start",
            schemaVersion: 1,
            gameId,
            players: [{ playerId: winnerPlayerId }, { playerId: loserPlayerId }],
        },
        ...placements,
        {
            eventType: "game_over",
            schemaVersion: 1,
            gameId,
            winnerPlayerId,
            loserPlayerId,
            finishType,
        },
    ];
}

function createGames(gameCount) {
    return Array.from({ length: gameCount }, (_, index) => {
        const suffix = String(index).padStart(2, "0");
        const gameId = `game-${suffix}`;
        const winnerPlayerId = `winner-${suffix}`;
        return createCompleteGame({
            gameId,
            winnerPlayerId,
            loserPlayerId: `loser-${suffix}`,
            placements: [createPlacementDecision({
                gameId,
                playerId: winnerPlayerId,
                pieceIndex: 5 + index,
            })],
        });
    }).flat();
}

async function createTestPaths(t) {
    const root = await mkdtemp(path.join(os.tmpdir(), "placement-exporter-"));
    t.after(async () => {
        await rm(root, { recursive: true, force: true });
    });
    return {
        root,
        input: path.join(root, "game-events.jsonl"),
        output: path.join(root, "dataset"),
    };
}

async function writeJsonLines(filePath, rows) {
    const text = rows.map(row => {
        return typeof row === "string" ? row : JSON.stringify(row);
    }).join("\n");
    await writeFile(filePath, text === "" ? "" : `${text}\n`, "utf8");
}

async function readJsonLines(filePath) {
    const text = await readFile(filePath, "utf8");
    if (text.trim() === "") return [];
    return text.trimEnd().split("\n").map(line => JSON.parse(line));
}

async function readOutputs(outputDir) {
    const fileNames = [
        "train.jsonl",
        "validation.jsonl",
        "rejected.jsonl",
        "manifest.json",
    ];
    return Object.fromEntries(await Promise.all(fileNames.map(async fileName => {
        return [fileName, await readFile(path.join(outputDir, fileName), "utf8")];
    })));
}

function getGameIds(rows) {
    return [...new Set(rows.map(row => row.gameId))].sort();
}

test("정상 complete game을 train dataset과 manifest로 export한다", async t => {
    const paths = await createTestPaths(t);
    await writeJsonLines(paths.input, createCompleteGame());

    const { manifest } = await exportPlacementDataset({
        input: paths.input,
        outputDir: paths.output,
        validationRatio: 0,
        seed: "complete-game",
    });
    const train = await readJsonLines(path.join(paths.output, "train.jsonl"));

    assert.ok(train.length > 0);
    assert.equal(manifest.datasetSchemaVersion, 2);
    assert.equal(manifest.exportPolicyVersion, 2);
    assert.deepEqual(manifest.excludePlayerPrefixes, []);
    assert.equal(manifest.selectionPolicy, "winner-only");
    assert.equal(manifest.sourceFilter, "all");
    assert.equal(manifest.winnerOnly, true);
    assert.equal(manifest.minimumPieceIndex, 5);
    assert.equal(manifest.requiredFinishType, "normal");
    assert.equal(manifest.inputLineCount, 3);
    assert.equal(manifest.jsonParseSuccessCount, 3);
    assert.equal(manifest.jsonParseFailureCount, 0);
    assert.deepEqual(manifest.eventTypeCounts, {
        game_over: 1,
        game_start: 1,
        placement_decision: 1,
    });
    assert.equal(manifest.totalGameCount, 1);
    assert.equal(manifest.eligibleGameCount, 1);
    assert.equal(manifest.excludedGameCount, 0);
    assert.equal(manifest.acceptedPlacementLogCount, 1);
    assert.equal(manifest.rejectedPlacementLogCount, 0);
    assert.equal(manifest.sampleCountBySource.human, train.length);
    assert.equal(manifest.acceptedPlacementLogCountBySource.human, 1);
    assert.equal(manifest.acceptedPlacementLogCountByAiDifficulty.unknown, 1);
    assert.equal(manifest.selectedBySourceSampleCount, 1);
    assert.equal(manifest.trainGameCount, 1);
    assert.equal(manifest.validationGameCount, 0);
    assert.ok(train.every(sample => {
        return sample.metadata.isWinner === true &&
            sample.metadata.winnerPlayerId === "winner-001" &&
            sample.metadata.finishType === "normal" &&
            sample.isWinner === undefined &&
            sample.winnerPlayerId === undefined &&
            sample.finishType === undefined;
    }));
});

test("malformed JSON line은 격리하고 나머지 game export를 계속한다", async t => {
    const paths = await createTestPaths(t);
    await writeJsonLines(paths.input, [
        ...createCompleteGame(),
        "{not-json",
        "   ",
    ]);

    const { manifest } = await exportPlacementDataset({
        input: paths.input,
        outputDir: paths.output,
        validationRatio: 0,
    });
    const rejected = await readJsonLines(path.join(paths.output, "rejected.jsonl"));

    assert.equal(manifest.inputLineCount, 5);
    assert.equal(manifest.jsonParseSuccessCount, 3);
    assert.equal(manifest.jsonParseFailureCount, 1);
    assert.equal(manifest.rejectionReasonCounts.INVALID_JSON_LINE, 1);
    assert.equal(rejected.at(-1).reason, "INVALID_JSON_LINE");
    assert.equal(manifest.acceptedPlacementLogCount, 1);
});

test("game_over 없는 게임의 placement는 INCOMPLETE_GAME으로 제외한다", async t => {
    const paths = await createTestPaths(t);
    const events = createCompleteGame().slice(0, -1);
    await writeJsonLines(paths.input, events);

    const { manifest } = await exportPlacementDataset({
        input: paths.input,
        outputDir: paths.output,
    });

    assert.equal(manifest.eligibleGameCount, 0);
    assert.equal(manifest.excludedGameCount, 1);
    assert.equal(manifest.acceptedPlacementLogCount, 0);
    assert.equal(manifest.rejectionReasonCounts.INCOMPLETE_GAME, 1);
});

test("loser placement와 pieceIndex 5 미만 placement를 정책 reason으로 제외한다", async t => {
    const paths = await createTestPaths(t);
    const placements = [
        createPlacementDecision({ playerId: "loser-001", pieceIndex: 6 }),
        createPlacementDecision({ playerId: "winner-001", pieceIndex: 4 }),
        createPlacementDecision({ playerId: "winner-001", pieceIndex: 5 }),
    ];
    await writeJsonLines(paths.input, createCompleteGame({ placements }));

    const { manifest } = await exportPlacementDataset({
        input: paths.input,
        outputDir: paths.output,
        validationRatio: 0,
    });

    assert.equal(manifest.acceptedPlacementLogCount, 1);
    assert.equal(manifest.rejectedPlacementLogCount, 2);
    assert.equal(manifest.rejectionReasonCounts.LOSER_PLACEMENT, 1);
    assert.equal(manifest.rejectionReasonCounts.EARLY_PIECE_INDEX, 1);
});

test("all-completed 정책은 loser placement도 결과 metadata와 함께 포함한다", async t => {
    const paths = await createTestPaths(t);
    const placements = [
        createPlacementDecision({ playerId: "winner-001", pieceIndex: 5 }),
        createPlacementDecision({ playerId: "loser-001", pieceIndex: 6 }),
    ];
    await writeJsonLines(paths.input, createCompleteGame({ placements }));

    const { manifest } = await exportPlacementDataset({
        input: paths.input,
        outputDir: paths.output,
        validationRatio: 0,
        selectionPolicy: "all-completed",
    });
    const train = await readJsonLines(path.join(paths.output, "train.jsonl"));
    const loserSamples = train.filter(sample => sample.playerId === "loser-001");

    assert.equal(manifest.selectionPolicy, "all-completed");
    assert.equal(manifest.winnerOnly, false);
    assert.equal(manifest.acceptedPlacementLogCount, 2);
    assert.equal(manifest.rejectionReasonCounts.LOSER_PLACEMENT, undefined);
    assert.ok(loserSamples.length > 0);
    assert.ok(loserSamples.every(sample => {
        return sample.metadata.isWinner === false &&
            sample.metadata.winnerPlayerId === "winner-001" &&
            sample.metadata.finishType === "normal";
    }));
});

test("source filter는 요청한 source만 builder에 전달한다", async t => {
    const paths = await createTestPaths(t);
    const heuristicOutput = path.join(paths.root, "heuristic-output");
    const placements = [
        createPlacementDecision({ playerId: "winner-001", pieceIndex: 5 }),
        createPlacementDecision({
            playerId: "loser-001",
            pieceIndex: 6,
            source: "heuristic_ai",
            modelType: "heuristic",
            aiDifficulty: "normal",
        }),
    ];
    await writeJsonLines(paths.input, createCompleteGame({ placements }));

    const humanResult = await exportPlacementDataset({
        input: paths.input,
        outputDir: paths.output,
        validationRatio: 0,
        selectionPolicy: "all-completed",
        sourceFilter: "human",
    });
    const heuristicResult = await exportPlacementDataset({
        input: paths.input,
        outputDir: heuristicOutput,
        validationRatio: 0,
        selectionPolicy: "all-completed",
        sourceFilter: "heuristic_ai",
    });
    const humanRows = await readJsonLines(path.join(paths.output, "train.jsonl"));
    const heuristicRows = await readJsonLines(
        path.join(heuristicOutput, "train.jsonl"),
    );

    assert.ok(humanRows.every(sample => sample.source === "human"));
    assert.ok(heuristicRows.every(sample => sample.source === "heuristic_ai"));
    assert.equal(humanResult.manifest.sourceFilter, "human");
    assert.equal(heuristicResult.manifest.sourceFilter, "heuristic_ai");
    assert.equal(humanResult.manifest.acceptedPlacementLogCountBySource.human, 1);
    assert.equal(
        heuristicResult.manifest.acceptedPlacementLogCountBySource.heuristic_ai,
        1,
    );
    assert.equal(humanResult.manifest.rejectionReasonCounts.SOURCE_FILTERED, 1);
    assert.equal(heuristicResult.manifest.rejectionReasonCounts.SOURCE_FILTERED, 1);
});

test("human sample은 같은 gameId의 AI 난이도를 추론해 연결한다", async t => {
    const paths = await createTestPaths(t);
    const createDifficultyGame = (gameId, difficulty) => createCompleteGame({
        gameId,
        winnerPlayerId: `${gameId}-ai`,
        loserPlayerId: `${gameId}-human`,
        placements: [
            createPlacementDecision({
                gameId,
                playerId: `${gameId}-human`,
                pieceIndex: 5,
            }),
            createPlacementDecision({
                gameId,
                playerId: `${gameId}-ai`,
                pieceIndex: 5,
                source: "heuristic_ai",
                modelType: "heuristic",
                aiDifficulty: difficulty,
            }),
        ],
    });
    await writeJsonLines(paths.input, [
        ...createDifficultyGame("game-normal", "normal"),
        ...createDifficultyGame("game-hard", "hard"),
    ]);

    const { manifest } = await exportPlacementDataset({
        input: paths.input,
        outputDir: paths.output,
        validationRatio: 0,
        selectionPolicy: "all-completed",
        sourceFilter: "human",
    });
    const train = await readJsonLines(path.join(paths.output, "train.jsonl"));

    assert.equal(manifest.difficultyEnrichmentCount, 2);
    assert.equal(manifest.acceptedPlacementLogCountByAiDifficulty.normal, 1);
    assert.equal(manifest.acceptedPlacementLogCountByAiDifficulty.hard, 1);
    assert.ok(train.some(sample => sample.aiDifficulty === "normal"));
    assert.ok(train.some(sample => sample.aiDifficulty === "hard"));
    assert.equal(manifest.sampleCountByAiDifficulty.unknown, 0);
});

test("한 gameId의 AI 난이도가 충돌하면 human placement를 명시적으로 reject한다", async t => {
    const paths = await createTestPaths(t);
    const placements = [
        createPlacementDecision({ playerId: "winner-001", pieceIndex: 5 }),
        createPlacementDecision({
            playerId: "ai-normal",
            pieceIndex: 5,
            source: "heuristic_ai",
            modelType: "heuristic",
            aiDifficulty: "normal",
        }),
        createPlacementDecision({
            playerId: "ai-hard",
            pieceIndex: 6,
            source: "heuristic_ai",
            modelType: "heuristic",
            aiDifficulty: "hard",
        }),
    ];
    await writeJsonLines(paths.input, createCompleteGame({ placements }));

    const { manifest } = await exportPlacementDataset({
        input: paths.input,
        outputDir: paths.output,
        selectionPolicy: "all-completed",
        sourceFilter: "human",
    });

    assert.equal(manifest.acceptedPlacementLogCount, 0);
    assert.equal(manifest.difficultyEnrichmentCount, 0);
    assert.equal(manifest.rejectionReasonCounts.AMBIGUOUS_AI_DIFFICULTY, 1);
});

test("human 명시 난이도와 game AI 난이도가 다르면 조용히 덮어쓰지 않는다", async t => {
    const paths = await createTestPaths(t);
    const placements = [
        createPlacementDecision({
            playerId: "winner-001",
            pieceIndex: 5,
            aiDifficulty: "hard",
        }),
        createPlacementDecision({
            playerId: "ai-normal",
            pieceIndex: 5,
            source: "heuristic_ai",
            modelType: "heuristic",
            aiDifficulty: "normal",
        }),
    ];
    await writeJsonLines(paths.input, createCompleteGame({ placements }));

    const { manifest } = await exportPlacementDataset({
        input: paths.input,
        outputDir: paths.output,
        selectionPolicy: "all-completed",
        sourceFilter: "human",
    });

    assert.equal(manifest.acceptedPlacementLogCount, 0);
    assert.equal(manifest.difficultyEnrichmentCount, 0);
    assert.equal(manifest.rejectionReasonCounts.AMBIGUOUS_AI_DIFFICULTY, 1);
});

test("schema v1과 builder-invalid placement rejection reason을 전달한다", async t => {
    const paths = await createTestPaths(t);
    const unreachablePlacement = {
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
    };
    const placements = [
        createPlacementDecision({ schemaVersion: 1, pieceIndex: 5 }),
        createPlacementDecision({
            pieceIndex: 6,
            selectedPlacement: unreachablePlacement,
        }),
    ];
    await writeJsonLines(paths.input, createCompleteGame({ placements }));

    const { manifest } = await exportPlacementDataset({
        input: paths.input,
        outputDir: paths.output,
    });

    assert.equal(manifest.acceptedPlacementLogCount, 0);
    assert.equal(manifest.rejectionReasonCounts.UNSUPPORTED_SCHEMA_VERSION, 1);
    assert.equal(
        manifest.rejectionReasonCounts.SELECTED_PLACEMENT_NOT_REACHABLE,
        1,
    );
});

test("명시한 test-player prefix만 TEST_PLAYER_EXCLUDED로 제외한다", async t => {
    const paths = await createTestPaths(t);
    const playerId = "test-fixture-winner";
    await writeJsonLines(paths.input, createCompleteGame({
        winnerPlayerId: playerId,
        placements: [createPlacementDecision({ playerId })],
    }));

    const { manifest } = await exportPlacementDataset({
        input: paths.input,
        outputDir: paths.output,
        excludePlayerPrefixes: ["test-fixture-", "", "test-fixture-"],
    });

    assert.equal(manifest.acceptedPlacementLogCount, 0);
    assert.equal(manifest.rejectionReasonCounts.TEST_PLAYER_EXCLUDED, 1);
    assert.deepEqual(manifest.excludePlayerPrefixes, ["test-fixture-"]);
});

test("human과 heuristic_ai difficulty sample count를 manifest에 기록한다", async t => {
    const paths = await createTestPaths(t);
    const humanGame = createCompleteGame({ gameId: "game-human" });
    const normalGame = createCompleteGame({
        gameId: "game-normal",
        winnerPlayerId: "ai-normal",
        placements: [createPlacementDecision({
            gameId: "game-normal",
            playerId: "ai-normal",
            source: "heuristic_ai",
            modelType: "heuristic",
            aiDifficulty: "normal",
        })],
    });
    const hardGame = createCompleteGame({
        gameId: "game-hard",
        winnerPlayerId: "ai-hard",
        placements: [createPlacementDecision({
            gameId: "game-hard",
            playerId: "ai-hard",
            source: "heuristic_ai",
            modelType: "heuristic",
            aiDifficulty: "hard",
        })],
    });
    await writeJsonLines(paths.input, [...humanGame, ...normalGame, ...hardGame]);

    const { manifest } = await exportPlacementDataset({
        input: paths.input,
        outputDir: paths.output,
        validationRatio: 0,
    });

    assert.ok(manifest.sampleCountBySource.human > 0);
    assert.ok(manifest.sampleCountBySource.heuristic_ai > 0);
    assert.ok(manifest.sampleCountByAiDifficulty.normal > 0);
    assert.ok(manifest.sampleCountByAiDifficulty.hard > 0);
});

test("같은 input, seed, validationRatio의 네 output 파일은 결정적이다", async t => {
    const paths = await createTestPaths(t);
    const secondOutput = path.join(paths.root, "dataset-second");
    await writeJsonLines(paths.input, createGames(6));

    await exportPlacementDataset({
        input: paths.input,
        outputDir: paths.output,
        validationRatio: 0.5,
        seed: "deterministic-seed",
    });
    await exportPlacementDataset({
        input: paths.input,
        outputDir: secondOutput,
        validationRatio: 0.5,
        seed: "deterministic-seed",
    });

    assert.deepEqual(
        await readOutputs(paths.output),
        await readOutputs(secondOutput),
    );
});

test("입력 line 순서가 달라도 동일 gameId split을 만든다", async t => {
    const paths = await createTestPaths(t);
    const reversedInput = path.join(paths.root, "reversed.jsonl");
    const reversedOutput = path.join(paths.root, "reversed-output");
    const events = createGames(8);
    await writeJsonLines(paths.input, events);
    await writeJsonLines(reversedInput, [...events].reverse());

    await exportPlacementDataset({
        input: paths.input,
        outputDir: paths.output,
        validationRatio: 0.5,
        seed: "order-independent",
    });
    await exportPlacementDataset({
        input: reversedInput,
        outputDir: reversedOutput,
        validationRatio: 0.5,
        seed: "order-independent",
    });

    const forwardTrain = await readJsonLines(path.join(paths.output, "train.jsonl"));
    const forwardValidation = await readJsonLines(
        path.join(paths.output, "validation.jsonl"),
    );
    const reversedTrain = await readJsonLines(
        path.join(reversedOutput, "train.jsonl"),
    );
    const reversedValidation = await readJsonLines(
        path.join(reversedOutput, "validation.jsonl"),
    );

    assert.deepEqual(getGameIds(forwardTrain), getGameIds(reversedTrain));
    assert.deepEqual(getGameIds(forwardValidation), getGameIds(reversedValidation));
});

test("train과 validation 사이에 gameId leakage가 없다", async t => {
    const paths = await createTestPaths(t);
    await writeJsonLines(paths.input, createGames(10));

    await exportPlacementDataset({
        input: paths.input,
        outputDir: paths.output,
        validationRatio: 0.4,
        seed: "no-leakage",
    });
    const train = await readJsonLines(path.join(paths.output, "train.jsonl"));
    const validation = await readJsonLines(
        path.join(paths.output, "validation.jsonl"),
    );
    const trainGameIds = new Set(getGameIds(train));

    assert.ok(train.length > 0);
    assert.ok(validation.length > 0);
    assert.ok(getGameIds(validation).every(gameId => !trainGameIds.has(gameId)));
});

test("같은 output을 재생성하면 stale JSONL row가 남지 않는다", async t => {
    const paths = await createTestPaths(t);
    await writeJsonLines(paths.input, createGames(5));
    await exportPlacementDataset({
        input: paths.input,
        outputDir: paths.output,
        validationRatio: 0.4,
    });

    await writeJsonLines(paths.input, createGames(1));
    const { manifest } = await exportPlacementDataset({
        input: paths.input,
        outputDir: paths.output,
        validationRatio: 0,
    });
    const train = await readJsonLines(path.join(paths.output, "train.jsonl"));
    const validation = await readJsonLines(
        path.join(paths.output, "validation.jsonl"),
    );

    assert.equal(train.length, manifest.trainSampleCount);
    assert.equal(validation.length, 0);
    assert.equal(getGameIds(train).length, 1);
});

test("export 전후 입력 JSONL bytes와 SHA-256은 변하지 않는다", async t => {
    const paths = await createTestPaths(t);
    await writeJsonLines(paths.input, createGames(3));
    const before = await readFile(paths.input);
    const expectedSha = createHash("sha256").update(before).digest("hex");

    const { manifest } = await exportPlacementDataset({
        input: paths.input,
        outputDir: paths.output,
    });
    const after = await readFile(paths.input);

    assert.deepEqual(after, before);
    assert.equal(manifest.inputSha256, expectedSha);
});

test("CLI 옵션은 기본 test prefix 없이 repeatable prefix를 명시적으로 받는다", () => {
    const defaults = parseCliArgs([]);
    const parsed = parseCliArgs([
        "--input", "custom.jsonl",
        "--output-dir", "custom-output",
        "--validation-ratio", "0.3",
        "--seed", "custom-seed",
        "--selection-policy", "all-completed",
        "--source", "human",
        "--exclude-player-prefix", "test-",
        "--exclude-player-prefix", "fixture-",
    ]);

    assert.deepEqual(defaults.excludePlayerPrefixes, []);
    assert.equal(defaults.selectionPolicy, "winner-only");
    assert.equal(defaults.sourceFilter, "all");
    assert.deepEqual(parsed, {
        input: "custom.jsonl",
        outputDir: "custom-output",
        validationRatio: 0.3,
        seed: "custom-seed",
        excludePlayerPrefixes: ["test-", "fixture-"],
        selectionPolicy: "all-completed",
        sourceFilter: "human",
    });
});
