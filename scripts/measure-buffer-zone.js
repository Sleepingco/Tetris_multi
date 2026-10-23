#!/usr/bin/env node
/** 보존한 20행 빌드와 현재 40행 빌드를 같은 fixture로 비교하는 유한 로컬 측정이다. 학습·DB 접속은 하지 않는다. */
const assert = require("node:assert/strict");
const { createHash } = require("node:crypto");
const { execFileSync } = require("node:child_process");
const { readFileSync, readdirSync, realpathSync, statSync } = require("node:fs");
const { Session } = require("node:inspector/promises");
const os = require("node:os");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const SAMPLES = 25;
const ROOM_COUNT = 8;
const HUMAN_IDS = ["00000000-0000-4000-8000-000000000001", "00000000-0000-4000-8000-000000000002"];
const hash = value => createHash("sha256").update(value).digest("hex");
const board = rows => Array.from({ length: rows }, () => Array(10).fill(null));
const piece = (row, rotation = 0, col = 3) => ({ pieceType: "tree", rotation, row, col });
const load = (root, file) => require(path.join(root, "dist/server", file));

function buildHash(root) {
    const directory = path.join(root, "dist/server");
    const files = readdirSync(directory, { recursive: true })
        .filter(file => statSync(path.join(directory, file)).isFile()).sort();
    return hash(Buffer.concat(files.flatMap(file => [Buffer.from(file + "\n"), readFileSync(path.join(directory, file))])));
}

function distribution(samples) {
    const sorted = [...samples].sort((a, b) => a - b);
    return { samples: sorted.length, medianMs: sorted[Math.floor(sorted.length / 2)],
        p95Ms: sorted[Math.ceil(sorted.length * 0.95) - 1], maxMs: sorted.at(-1) };
}

function measure(operation) {
    for (let warmup = 0; warmup < 3; warmup++) operation();
    const times = [];
    for (let sample = 0; sample < SAMPLES; sample++) {
        const start = performance.now();
        operation();
        times.push(performance.now() - start);
    }
    return distribution(times);
}

function scenarios() {
    const low = board(20);
    const high = board(20);
    for (const [col, height] of [1, 2, 3, 4, 5, 3, 2, 4, 1, 2].entries()) {
        for (let row = 20 - height; row < 20; row++) low[row][col] = "tree";
    }
    for (const [col, height] of [16, 17, 16, 14, 12, 15, 17, 16, 15, 14].entries()) {
        for (let row = 20 - height; row < 20; row++) high[row][col] = "tree";
    }
    const pairs = ["empty", "low-stack", "high-stack"].map((id, index) => ({
        id, board20: [board(20), low, high][index], active20: piece(-1),
    }));
    for (const value of pairs) {
        value.board40 = [...board(20), ...structuredClone(value.board20)];
        value.active40 = piece(19);
    }
    const hidden = board(40);
    for (let row = 16; row < 40; row++) for (const col of [0, 1, 2, 7, 8, 9]) hidden[row][col] = "tree";
    for (const col of [3, 4, 5]) hidden[20][col] = "tree";
    const kick = board(40);
    kick[38].fill("tree");
    for (const col of [3, 4, 5]) kick[38][col] = null;
    for (const [row, col] of [[37, 3], [39, 3], [39, 5]]) kick[row][col] = "tree";
    return [...pairs, { id: "hidden-stack", board40: hidden, active40: piece(16, 1) },
        { id: "kick-slot", board40: kick, active40: piece(37, 3) },
        { id: "floor-kicks", board40: board(40), active40: { pieceType: "bar", row: 38, rotation: 0, col: 3 } }];
}

/** V8 호출 수로 BFS 방문 수를 따로 세어 production 탐색 코드와 시간 측정에 instrumentation을 넣지 않는다. */
async function visitedStates(session, root, generate, inputBoard, active) {
    await session.post("Profiler.startPreciseCoverage", { callCount: true, detailed: false });
    const candidates = generate(inputBoard, active);
    const coverage = await session.post("Profiler.takePreciseCoverage");
    await session.post("Profiler.stopPreciseCoverage");
    const script = coverage.result.find(value => value.url.includes(root)
        && value.url.endsWith("/reachablePlacementPlanner.js"));
    const count = script?.functions.find(value => value.functionName === "createHardDropPlacement")?.ranges[0].count;
    assert.ok(count >= candidates.length && count > 0, "BFS 방문 상태 수를 얻어야 한다");
    return { visitedStates: count, candidateCount: candidates.length };
}

async function measureSearch(root, rows, fixtures, session) {
    const { generateReachablePlacements } = load(root, "client/game/ai/heuristic/reachablePlacementPlanner.js");
    const { rankPlacements } = load(root, "client/game/ai/heuristic/heuristicEvaluator.js");
    const core = await load(root, "server/services/gameCoreLoader.js").loadGameCore();
    const { applyAuthoritativeInput } = load(root, "server/services/playerGameplayStep.js");
    const results = [];
    for (const fixture of fixtures) {
        const inputBoard = fixture[`board${rows}`];
        if (!inputBoard) continue;
        const active = fixture[`active${rows}`];
        const before = JSON.stringify(inputBoard);
        const candidates = generateReachablePlacements(inputBoard, active);
        const key = candidate => {
            const value = candidate.placement;
            return `${value.rotation}:${value.row - (rows === 40 ? 20 : 0)}:${value.col}`;
        };
        if (rows === 20) fixture.legacyKeys = candidates.map(key).sort();
        if (rows === 40 && ["empty", "low-stack"].includes(fixture.id)) {
            assert.deepEqual(candidates.map(key).sort(), fixture.legacyKeys);
        }
        let upwardKickTransitions = 0;
        let maxConsecutiveRotations = 0;
        if (rows === 40) for (const candidate of candidates) {
            const state = { board: structuredClone(inputBoard), activePiece: { ...active }, pendingPiece: { ...active },
                pieceQueue: ["bar"], pieceIndex: 1, phase: "playing", score: 0, lines: 0, combo: -1,
                backToBack: false, pendingGarbageQueue: [], spinRotation: null, lockDelay: core.createLockDelay(active.row) };
            let actual;
            let consecutiveRotations = 0;
            for (const action of candidate.plannedActions) {
                const previousRow = state.activePiece.row;
                actual = applyAuthoritativeInput(state, { action }, core);
                assert.equal(actual.ok, true);
                consecutiveRotations = action.startsWith("rotate") ? consecutiveRotations + 1 : 0;
                maxConsecutiveRotations = Math.max(maxConsecutiveRotations, consecutiveRotations);
                if (action.startsWith("rotate") && state.activePiece.row < previousRow) upwardKickTransitions++;
            }
            const { pieceType, rotation, row, col } = candidate.placement;
            assert.deepEqual(actual.placementResult.lockedPiece, { pieceType, rotation, row, col });
            if (!actual.placementResult.gameOver) assert.equal(actual.placementResult.tSpinType, candidate.tSpinType);
        }
        const stats = await visitedStates(session, root, generateReachablePlacements, inputBoard, active);
        const bfs = measure(() => generateReachablePlacements(inputBoard, active));
        const ranking = measure(() => rankPlacements(inputBoard, active, rows === 40
            ? { nextPieceType: "bar", pendingGarbageQueue: [], combo: -1, backToBack: false } : {}));
        assert.equal(JSON.stringify(inputBoard), before);
        assert.ok(ranking.p95Ms < 100, "이 로컬 fixture의 후보 평가 p95는 한 100ms AI 주기 안이어야 한다");
        results.push({ fixture: fixture.id, ...stats, upwardKickTransitions, maxConsecutiveRotations, bfs, ranking });
    }
    return results;
}

/** 같은 8개 PVP room에서 실제 ticker·mutation queue·snapshot 생성·JSON 직렬화를 비교한다. 전송망/DB는 제외한다. */
async function measureTicker(root, rows) {
    const matches = load(root, "server/services/matchService.js");
    const core = await load(root, "server/services/gameCoreLoader.js").loadGameCore();
    const { createAuthoritativeTickerService } = load(root, "server/services/authoritativeTickerService.js");
    const states = [];
    let messages = 0;
    let bytes = 0;
    const io = { to() { return { emit(event, payload) {
        if (event === "game:authoritative:snapshot") { messages++; bytes += Buffer.byteLength(JSON.stringify(payload)); }
    } }; } };
    const ticker = createAuthoritativeTickerService({ setIntervalFn: () => 1, clearIntervalFn() {},
        saveGameEventLog: async () => { throw new Error("unexpected lifecycle write"); },
        savePlacementDecisionLog: async () => { throw new Error("unexpected placement write"); } });
    matches.resetMatches();
    try {
        for (let room = 0; room < ROOM_COUNT; room++) {
            const roomId = `BEEF000${room}`;
            const result = matches.createMatch({ roomId, mode: "pvp", status: "playing",
                players: HUMAN_IDS.map(playerId => ({ playerId, playerType: "human" })) });
            assert.equal(result.ok, true);
            states.push(...result.match.players);
            ticker.startRoomTicker(roomId, io);
        }
        const times = [];
        for (let sample = 0; sample < SAMPLES + 3; sample++) {
            for (const player of states) {
                Object.assign(player.authoritativeState, { activePiece: piece(rows - 4), pendingPiece: piece(rows - 4),
                    board: board(rows), phase: "playing", lockDelay: core.createLockDelay(rows - 4) });
                player.lockUpdatedAt = performance.now();
            }
            const start = performance.now();
            for (let room = 0; room < ROOM_COUNT; room++) await ticker.tickRoom(`BEEF000${room}`, io, 500);
            if (sample >= 3) times.push(performance.now() - start);
        }
        assert.equal(messages, (SAMPLES + 3) * ROOM_COUNT * 2);
        const timing = distribution(times);
        assert.ok(timing.p95Ms < 100, "로컬 8룸 batch가 100ms ticker 주기 안이어야 한다");
        return { rooms: ROOM_COUNT, players: ROOM_COUNT * 2, timing, messages, meanSnapshotBytes: bytes / messages,
            scope: "in-process human gravity + DTO + JSON; excludes network/AI/DB, synthetic due every batch" };
    } finally { ticker.stopAllRoomTickers(); matches.resetMatches(); }
}

function measurePayload() {
    const { projectGameEventLog } = load(ROOT, "server/services/gameEventProjector.js");
    const { prepareCanonicalGameEvent, MAX_CANONICAL_EVENT_BYTES } = load(ROOT, "server/db/canonicalGameEvent.js");
    const { validateGameEventLog } = load(ROOT, "server/validators/gameLogValidator.js");
    const raw = structuredClone(require("../test/fixtures/gameplay-log-v3.json"));
    raw.authoritativeClientSequence = 7;
    raw.authoritativePieceIndex = raw.pieceIndex;
    raw.boardBefore = Array.from({ length: 40 }, () => Array(10).fill("garbage"));
    raw.boardAfter = structuredClone(raw.boardBefore);
    assert.equal(validateGameEventLog(raw).ok, true);
    const prepared = prepareCanonicalGameEvent(projectGameEventLog(raw));
    const bytes = Buffer.byteLength(prepared.canonicalEnvelope);
    assert.ok(bytes < MAX_CANONICAL_EVENT_BYTES);
    const matches = load(ROOT, "server/services/matchService.js");
    const match = matches.createMatch({ roomId: "BEEF0000", status: "playing", mode: "pvp",
        players: [{ playerId: HUMAN_IDS[0], playerType: "human" }] }).match;
    match.players[0].authoritativeState.board = raw.boardAfter;
    const presentation = { gameId: match.gameId, roomId: match.roomId, playerId: HUMAN_IDS[0],
        snapshot: matches.getAuthoritativePlayerSnapshotDto(match.roomId, HUMAN_IDS[0]).snapshot,
        presentationEffect: { id: "bench-line-clear", type: "line_clear", pieceIndex: 1,
            rows: [36, 37, 38, 39], boardBeforeClear: raw.boardBefore } };
    const { serverToClientSchemas } = require("../src/shared/socketContracts.mjs");
    const validation = serverToClientSchemas["game:authoritative:snapshot"].safeParse(presentation);
    assert.equal(validation.success, true, JSON.stringify(validation.error?.issues));
    const wireBytes = Buffer.byteLength(JSON.stringify(presentation));
    assert.ok(wireBytes < 512 * 1024);
    matches.resetMatches();
    return { rawPlacementBytes: Buffer.byteLength(JSON.stringify(raw)), canonicalPlacementBytes: bytes,
        canonicalLimitBytes: MAX_CANONICAL_EVENT_BYTES,
        twoBoardPresentationBytes: wireBytes, socketLimitBytes: 512 * 1024,
        note: "largest cell label in all 400 cells; complete structural payload fixture, not a reachable game or proof of every legal payload maximum" };
}

async function main() {
    const legacyRoot = realpathSync(path.resolve(process.argv[2] ?? "missing-legacy-build"));
    const manifest = JSON.parse(readFileSync(path.join(legacyRoot, "ROLLBACK.json"), "utf8"));
    assert.equal(manifest.gameplayRulesVersion, "legacy20-v1");
    assert.equal(hash(readFileSync(path.join(legacyRoot, "package-lock.json"))), hash(readFileSync(path.join(ROOT, "package-lock.json"))));
    assert.equal((await load(legacyRoot, "server/services/gameCoreLoader.js").loadGameCore()).BOARD_ROWS, 20);
    const fixtures = scenarios();
    const fixtureSha256 = hash(JSON.stringify(fixtures));
    const session = new Session();
    session.connect();
    try {
        await session.post("Profiler.enable");
        const legacy = await measureSearch(legacyRoot, 20, fixtures, session);
        const current = await measureSearch(ROOT, 40, fixtures, session);
        const report = { schemaVersion: 1, measuredAt: new Date().toISOString(), node: process.version,
            platform: `${os.platform()}/${os.arch()}`, cpu: os.cpus()[0].model, samples: SAMPLES, fixtureSha256,
            sourceRevision: execFileSync("git", ["rev-parse", "HEAD"], { cwd: ROOT, encoding: "utf8" }).trim(),
            includesUncommittedChanges: execFileSync("git", ["status", "--porcelain"], { cwd: ROOT, encoding: "utf8" }).trim().length > 0,
            legacyBuildId: manifest.buildId, legacySourceTreeSha256: manifest.sourceTreeSha256,
            currentBuildSha256: buildHash(ROOT), legacyBuildSha256: buildHash(legacyRoot),
            currentPlannerSha256: hash(readFileSync(path.join(ROOT, "src/client/game/ai/heuristic/reachablePlacementPlanner.ts"))),
            legacy, current, ticker: { legacy: await measureTicker(legacyRoot, 20), current: await measureTicker(ROOT, 40) },
            payload: measurePayload(), scope: "bounded local smoke; not production capacity or ML full evaluation" };
        process.stdout.write(JSON.stringify(report, null, 4) + "\n");
    } finally { session.disconnect(); }
}

main().catch(error => { console.error(error); process.exitCode = 1; });
