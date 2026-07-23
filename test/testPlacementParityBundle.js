/**
 * Node와 Python이 같은 입력으로 추론하는지 비교할 parity bundle 생성 테스트다.
 *
 * 작은 JSONL dataset과 manifest를 임시 경로에 준비하고 bundle 생성을 실행한 뒤, canonical 순서와 통계를 검증한다.
 * 출력 경로가 원본·symlink·hardlink와 겹쳐도 source bytes를 덮어쓰지 않는 것이 가장 중요한 안전 불변식이다.
 */
const test = require("node:test");
const assert = require("node:assert/strict");
const { link, mkdir, mkdtemp, readFile, rm, symlink, writeFile } = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");

const {
    assertSafeParityOutput,
    buildParityBundle,
    parseArgs,
    writeBundle,
} = require("../scripts/export-placement-parity-bundle.js");

function createSample({ gameId, pieceIndex, col, selected, firstFeature }) {
    return {
        datasetSchemaVersion: 2,
        gameId,
        playerId: "human-a",
        pieceIndex,
        source: "human",
        pieceType: "square",
        aiDifficulty: "normal",
        boardBefore: [[null]],
        metricsBefore: { aggregateHeight: 0 },
        candidatePlacement: { pieceType: "square", rotation: 0, row: 18, col },
        candidateResult: { linesCleared: firstFeature, gameOver: false },
        metricDelta: {
            aggregateHeight: 0,
            maxHeight: 0,
            holes: 0,
            bumpiness: 0,
            columnHeights: Array(10).fill(0),
        },
        candidateMetricsAfter: {},
        heuristicBaseline: { score: firstFeature, reason: {} },
        selectedBySource: selected,
        metadata: { isWinner: false, winnerPlayerId: "ai-a", finishType: "normal" },
    };
}

function createRows() {
    return ["game-b", "game-a"].flatMap((gameId, gameIndex) => [
        createSample({ gameId, pieceIndex: gameIndex + 5, col: 1, selected: true, firstFeature: 1 }),
        createSample({
            gameId,
            pieceIndex: gameIndex + 5,
            col: 0,
            selected: false,
            firstFeature: gameId === "game-b" ? 1 : 0,
        }),
    ]);
}

function createManifest(trainRows, validationRows, rejectedRows, overrides = {}) {
    const rows = [...trainRows, ...validationRows];
    const decisionKeys = new Set(rows.map(row => `${row.gameId}:${row.playerId}:${row.pieceIndex}`));
    const trainGameIds = new Set(trainRows.map(row => row.gameId));
    const validationGameIds = new Set(validationRows.map(row => row.gameId));
    const rejectedPlacementLogCount = rejectedRows.filter(row => {
        return row.eventType === "placement_decision";
    }).length;
    return {
        datasetSchemaVersion: 2,
        sourceFilter: "human",
        inputSha256: "fixture-input",
        eventTypeCounts: { placement_decision: decisionKeys.size + rejectedPlacementLogCount },
        acceptedPlacementLogCount: decisionKeys.size,
        rejectedPlacementLogCount,
        acceptedPlacementLogCountBySource: { human: decisionKeys.size, heuristic_ai: 0 },
        acceptedPlacementLogCountByAiDifficulty: { normal: decisionKeys.size, hard: 0, unknown: 0 },
        sampleCountBySource: { human: rows.length, heuristic_ai: 0 },
        sampleCountByAiDifficulty: { normal: rows.length, hard: 0, unknown: 0 },
        trainSampleCount: trainRows.length,
        validationSampleCount: validationRows.length,
        trainGameCount: trainGameIds.size,
        validationGameCount: validationGameIds.size,
        selectedBySourceSampleCount: rows.filter(row => row.selectedBySource === true).length,
        rejectionReasonCounts: {},
        ...overrides,
    };
}

async function writeDataset(datasetDir, rows = createRows(), options = {}) {
    const trainRows = options.trainRows || rows;
    const validationRows = options.validationRows || [];
    const rejectedRows = options.rejectedRows || [];
    const manifest = createManifest(
        trainRows,
        validationRows,
        rejectedRows,
        options.manifestOverrides,
    );
    await mkdir(datasetDir, { recursive: true });
    await writeFile(path.join(datasetDir, "manifest.json"), `${JSON.stringify(manifest)}\n`);
    await writeFile(
        path.join(datasetDir, "train.jsonl"),
        trainRows.length ? `${trainRows.map(JSON.stringify).join("\n")}\n` : "",
    );
    await writeFile(
        path.join(datasetDir, "validation.jsonl"),
        validationRows.length ? `${validationRows.map(JSON.stringify).join("\n")}\n` : "",
    );
    await writeFile(
        path.join(datasetDir, "rejected.jsonl"),
        rejectedRows.length ? `${rejectedRows.map(JSON.stringify).join("\n")}\n` : "",
    );
}

test("parity bundle은 canonical 첫 game을 기본 validation으로 고르고 원본 dataset을 보존한다", async t => {
    const root = await mkdtemp(path.join(os.tmpdir(), "placement-parity-bundle-"));
    t.after(() => rm(root, { recursive: true, force: true }));
    const datasetDir = path.join(root, "dataset");
    await writeDataset(datasetDir);
    const sourcePaths = ["manifest.json", "train.jsonl", "validation.jsonl", "rejected.jsonl"]
        .map(name => path.join(datasetDir, name));
    const before = await Promise.all(sourcePaths.map(filePath => readFile(filePath)));

    const first = await buildParityBundle({ datasetDir, validationGameId: null });
    const second = await buildParityBundle({ datasetDir, validationGameId: null });
    const after = await Promise.all(sourcePaths.map(filePath => readFile(filePath)));

    assert.deepEqual(first, second);
    assert.deepEqual(after, before);
    assert.equal(first.validationGameId, "game-a");
    assert.deepEqual(first.trainGameIds, ["game-b"]);
    assert.equal(first.counts.trainDecisionCount, 1);
    assert.equal(first.counts.validationDecisionCount, 1);
    assert.equal(first.counts.trainPairCount, 1);
    assert.equal(first.parityBundleSchemaVersion, 2);
    assert.equal(first.counts.trainZeroDifferencePairCount, 1);
    assert.equal(first.counts.trainSelectedFeatureDuplicateDecisionCount, 1);
    assert.equal(first.counts.validationSelectedFeatureDuplicateDecisionCount, 0);
    assert.equal(first.trainingPairs[0].weight, 1);
    assert.deepEqual(first.featureNames, first.jsReference.featureNames);
    assert.equal(first.runtimeIntegration, false);
});

test("parity bundle은 명시 validation game과 결정적인 artifact를 지원한다", async t => {
    const root = await mkdtemp(path.join(os.tmpdir(), "placement-parity-output-"));
    t.after(() => rm(root, { recursive: true, force: true }));
    const datasetDir = path.join(root, "dataset");
    const outputOne = path.join(root, "one.json");
    const outputTwo = path.join(root, "two.json");
    await writeDataset(datasetDir);
    const bundle = await buildParityBundle({ datasetDir, validationGameId: "game-b" });

    await writeBundle({ datasetDir, output: outputOne, bundle });
    await writeBundle({ datasetDir, output: outputTwo, bundle });

    assert.equal(bundle.validationGameId, "game-b");
    assert.equal(bundle.jsReference.validation.metrics.topScoreTieDecisionCount, 1);
    assert.equal(bundle.jsReference.validation.metrics.tieAwareTop1Accuracy, 1);
    assert.deepEqual(await readFile(outputOne), await readFile(outputTwo));
    assert.equal(JSON.parse(await readFile(outputOne, "utf8")).validationGameId, "game-b");
    await assert.rejects(
        buildParityBundle({ datasetDir, validationGameId: "missing" }),
        /UNKNOWN_VALIDATION_GAME_ID/,
    );
});

test("parity output은 source dataset 4파일의 exact path, alias, symlink, hardlink를 거부한다", async t => {
    const root = await mkdtemp(path.join(os.tmpdir(), "placement-parity-path-safety-"));
    t.after(() => rm(root, { recursive: true, force: true }));
    const datasetDir = path.join(root, "dataset");
    const datasetAlias = path.join(root, "dataset-alias");
    const outputSymlink = path.join(root, "output-link.json");
    const outputHardlink = path.join(root, "output-hardlink.json");
    await writeDataset(datasetDir);
    await symlink(datasetDir, datasetAlias);
    await symlink(path.join(datasetDir, "validation.jsonl"), outputSymlink);
    await link(path.join(datasetDir, "train.jsonl"), outputHardlink);
    const sourcePaths = ["manifest.json", "train.jsonl", "validation.jsonl", "rejected.jsonl"]
        .map(name => path.join(datasetDir, name));
    const before = await Promise.all(sourcePaths.map(filePath => readFile(filePath)));
    const bundle = await buildParityBundle({ datasetDir, validationGameId: null });

    const conflictingOutputs = [
        path.join(datasetDir, "manifest.json"),
        path.join(datasetDir, "..", "dataset", "train.jsonl"),
        path.join(datasetAlias, "validation.jsonl"),
        path.join(datasetDir, "rejected.jsonl"),
        outputSymlink,
        outputHardlink,
    ];
    for (const output of conflictingOutputs) {
        await assert.rejects(
            writeBundle({ datasetDir, output, bundle }),
            /OUTPUT_CONFLICTS_WITH_SOURCE_DATASET/,
        );
        await assert.rejects(
            assertSafeParityOutput(datasetDir, output),
            /OUTPUT_CONFLICTS_WITH_SOURCE_DATASET/,
        );
    }
    const after = await Promise.all(sourcePaths.map(filePath => readFile(filePath)));
    assert.deepEqual(after, before);
});

test("parity staging은 source exact path, alias, 기존 symlink와 hardlink를 사용하지 않는다", async t => {
    const root = await mkdtemp(path.join(os.tmpdir(), "placement-parity-staging-safety-"));
    t.after(() => rm(root, { recursive: true, force: true }));
    const datasetDir = path.join(root, "dataset");
    const output = path.join(datasetDir, "bundle.json");
    const stagingSymlink = path.join(datasetDir, "staging-symlink.tmp");
    const stagingHardlink = path.join(datasetDir, "staging-hardlink.tmp");
    await writeDataset(datasetDir);
    await writeFile(output, "existing-output\n");
    await symlink(path.join(datasetDir, "validation.jsonl"), stagingSymlink);
    await link(path.join(datasetDir, "rejected.jsonl"), stagingHardlink);
    const bundle = await buildParityBundle({ datasetDir, validationGameId: null });
    const sourcePaths = ["manifest.json", "train.jsonl", "validation.jsonl", "rejected.jsonl"]
        .map(name => path.join(datasetDir, name));
    const sourceBefore = await Promise.all(sourcePaths.map(filePath => readFile(filePath)));
    const outputBefore = await readFile(output);
    const conflictingStagingPaths = [
        path.join(datasetDir, "manifest.json"),
        path.join(datasetDir, "..", "dataset", "train.jsonl"),
        stagingSymlink,
        stagingHardlink,
    ];

    for (const stagingPath of conflictingStagingPaths) {
        await assert.rejects(
            writeBundle({
                datasetDir,
                output,
                bundle,
                stagingPathFactory: () => stagingPath,
            }),
            /OUTPUT_CONFLICTS_WITH_SOURCE_DATASET/,
        );
        assert.deepEqual(await readFile(output), outputBefore);
    }
    assert.deepEqual(
        await Promise.all(sourcePaths.map(filePath => readFile(filePath))),
        sourceBefore,
    );
});

test("writeBundle은 dataset 보호 인자를 생략할 수 없다", async () => {
    await assert.rejects(
        writeBundle({ output: "bundle.json", bundle: {} }),
        /datasetDir, output, and bundle are required/,
    );
});

test("parity bundle 직렬화 실패는 source와 기존 output bytes를 보존한다", async t => {
    const root = await mkdtemp(path.join(os.tmpdir(), "placement-parity-write-failure-"));
    t.after(() => rm(root, { recursive: true, force: true }));
    const datasetDir = path.join(root, "dataset");
    const output = path.join(root, "bundle.json");
    await writeDataset(datasetDir);
    await writeFile(output, "existing-output\n");
    const sourcePaths = ["manifest.json", "train.jsonl", "validation.jsonl", "rejected.jsonl"]
        .map(name => path.join(datasetDir, name));
    const sourceBefore = await Promise.all(sourcePaths.map(filePath => readFile(filePath)));
    const outputBefore = await readFile(output);
    const circularBundle = {};
    circularBundle.self = circularBundle;

    await assert.rejects(
        writeBundle({ datasetDir, output, bundle: circularBundle }),
        /circular structure/i,
    );

    assert.deepEqual(await readFile(output), outputBefore);
    assert.deepEqual(
        await Promise.all(sourcePaths.map(filePath => readFile(filePath))),
        sourceBefore,
    );
});

test("parity exporter는 non-boolean, 복수 selected와 non-human source row를 거부한다", async t => {
    const root = await mkdtemp(path.join(os.tmpdir(), "placement-parity-source-contract-"));
    t.after(() => rm(root, { recursive: true, force: true }));

    const invalidSelectedRows = createRows();
    invalidSelectedRows[1].selectedBySource = 0;
    const invalidSelectedDir = path.join(root, "invalid-selected");
    await writeDataset(invalidSelectedDir, invalidSelectedRows);
    await assert.rejects(
        buildParityBundle({ datasetDir: invalidSelectedDir, validationGameId: null }),
        /REJECTED_DECISION_GROUPS:INVALID_SELECTED_FLAG/,
    );

    const multipleSelectedRows = createRows();
    multipleSelectedRows[1].selectedBySource = true;
    const multipleSelectedDir = path.join(root, "multiple-selected");
    await writeDataset(multipleSelectedDir, multipleSelectedRows);
    await assert.rejects(
        buildParityBundle({ datasetDir: multipleSelectedDir, validationGameId: null }),
        /REJECTED_DECISION_GROUPS:MULTIPLE_SELECTED_CANDIDATES/,
    );

    const nonHumanRows = createRows();
    nonHumanRows[0].source = "heuristic_ai";
    const nonHumanDir = path.join(root, "non-human");
    await writeDataset(nonHumanDir, nonHumanRows);
    await assert.rejects(
        buildParityBundle({ datasetDir: nonHumanDir, validationGameId: null }),
        /HUMAN_SOURCE_ROW_REQUIRED/,
    );
});

test("parity exporter는 manifest decision, candidate, game count 불일치를 거부한다", async t => {
    const root = await mkdtemp(path.join(os.tmpdir(), "placement-parity-manifest-contract-"));
    t.after(() => rm(root, { recursive: true, force: true }));
    const cases = [
        ["decision", { acceptedPlacementLogCount: 99 }, "acceptedPlacementLogCount"],
        ["candidate", { trainSampleCount: 99 }, "trainSampleCount"],
        ["game", { trainGameCount: 99 }, "trainGameCount"],
    ];

    for (const [name, manifestOverrides, reason] of cases) {
        const datasetDir = path.join(root, name);
        await writeDataset(datasetDir, createRows(), { manifestOverrides });
        await assert.rejects(
            buildParityBundle({ datasetDir, validationGameId: null }),
            new RegExp(`MANIFEST_COUNT_MISMATCH:${reason}`),
        );
    }
});

test("canonical ordering은 locale이 아닌 Unicode code-point 순서를 사용한다", async t => {
    const root = await mkdtemp(path.join(os.tmpdir(), "placement-parity-order-"));
    t.after(() => rm(root, { recursive: true, force: true }));
    const datasetDir = path.join(root, "dataset");
    const rows = ["😀-game", "\uE000-game"].flatMap((gameId, index) => [
        createSample({ gameId, pieceIndex: index + 5, col: 1, selected: true, firstFeature: 1 }),
        createSample({ gameId, pieceIndex: index + 5, col: 0, selected: false, firstFeature: 0 }),
    ]);
    await writeDataset(datasetDir, rows);

    const bundle = await buildParityBundle({ datasetDir, validationGameId: null });
    assert.equal(bundle.validationGameId, "\uE000-game");
    assert.deepEqual(bundle.trainGameIds, ["😀-game"]);
});

test("parity bundle CLI options는 필수 경로와 선택 game ID를 검증한다", () => {
    assert.deepEqual(parseArgs([
        "--dataset-dir", "dataset",
        "--output", "bundle.json",
        "--validation-game-id", "game-a",
    ]), {
        datasetDir: "dataset",
        output: "bundle.json",
        validationGameId: "game-a",
    });
    assert.throws(() => parseArgs(["--dataset-dir", "dataset"]), /required/);
});
