import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import {
    realpath,
    stat,
    writeFile,
} from "node:fs/promises";
import {
    basename,
    dirname,
    join,
    resolve,
} from "node:path";
import { createInterface } from "node:readline";
import { Transform } from "node:stream";
import {
    canonicalJson,
    prepareCanonicalGameEvent,
} from "./canonicalGameEvent.js";
import type {
    CanonicalGameEvent,
    CanonicalJsonValue,
} from "./canonicalGameEvent.js";
import {
    createPostgresEventRepository,
} from "../repositories/postgresEventRepository.js";
import type {
    AppendPostgresEventResult,
} from "../repositories/postgresEventRepository.js";
import {
    projectGameEventLog,
} from "../services/gameEventProjector.js";
import {
    DEFAULT_MAX_LOG_BYTES,
    validateGameEventLog,
} from "../validators/gameLogValidator.js";

const REPORT_VERSION = 1;
const MAX_REPORTED_ISSUES = 100;
const SOURCE_EVENT_TYPES = new Set([
    "game_start",
    "placement_decision",
    "game_over",
]);
const PRIVATE_KEYS = new Set([
    "authorization",
    "cookie",
    "credential",
    "credentials",
    "databaseurl",
    "ip",
    "ipaddress",
    "password",
    "reconnecttoken",
    "sessiontoken",
    "socketid",
    "token",
    "useragent",
]);

type EventRepository = {
    append(event: CanonicalGameEvent): Promise<AppendPostgresEventResult>;
    close(): Promise<void>;
};

type ImportIssue = {
    lineNumber: number;
    reasonCode: string;
    eventId: string | null;
};

type LifecycleState = {
    mode: string | null;
    members: Set<string>;
    expectedCounts: Map<string, number> | null;
    schemaVersion: number;
    duplicateMembers: boolean;
};

type PlacementState = {
    count: number;
    indices: Set<number>;
};

type GameState = {
    gameId: string;
    starts: LifecycleState[];
    overs: LifecycleState[];
    placements: Map<string, PlacementState>;
    idempotencyConflict: boolean;
};

export type JsonlImportReport = {
    reportVersion: number;
    ok: boolean;
    dryRun: boolean;
    source: {
        fileName: string;
        sha256: string;
        bytes: number;
        lineCount: number;
        eventTypeCounts: Readonly<Record<string, number>>;
    };
    canonical: {
        eventCount: number;
        eventTypeCounts: Readonly<Record<string, number>>;
        orderedEventSha256: string;
        uniqueIdentityCount: number;
        duplicateIdentityCount: number;
        conflictIdentityCount: number;
    };
    writes: {
        attempted: number;
        inserted: number;
        duplicate: number;
        conflict: number;
        failed: number;
    };
    failures: {
        count: number;
        reasonCodeCounts: Readonly<Record<string, number>>;
        issues: readonly ImportIssue[];
        truncatedIssueCount: number;
    };
    completeness: {
        gameCount: number;
        completeGameCount: number;
        ambiguousGameCount: number;
        incompleteGameCount: number;
        reasonCodeCounts: Readonly<Record<string, number>>;
        games: readonly {
            gameDigest: string;
            status: "complete" | "ambiguous" | "incomplete";
            mlExportEligible: boolean;
            reasonCodes: readonly string[];
        }[];
    };
};

export type RunJsonlImportOptions = {
    inputPath: string;
    dryRun?: boolean;
    repository?: EventRepository;
    maxLineBytes?: number;
};

type CliOptions = {
    inputPath: string;
    dryRun: boolean;
    reportPath: string | null;
};

export class JsonlImportError extends Error {
    readonly code: string;

    constructor(code: string) {
        super(code);
        this.name = "JsonlImportError";
        this.code = code;
    }
}

function fail(code: string): never {
    throw new JsonlImportError(code);
}

function increment(counts: Map<string, number>, key: string): void {
    counts.set(key, (counts.get(key) ?? 0) + 1);
}

function sortedCounts(counts: Map<string, number>): Readonly<Record<string, number>> {
    return Object.freeze(Object.fromEntries([...counts].sort(([left], [right]) => (
        left < right ? -1 : left > right ? 1 : 0
    ))));
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return value !== null && typeof value === "object" && !Array.isArray(value);
}

function normalizedPrivateKey(key: string): string {
    return key.replaceAll(/[_-]/g, "").toLowerCase();
}

function containsPrivateField(value: unknown): boolean {
    const pending = [value];
    while (pending.length > 0) {
        const current = pending.pop();
        if (current === null || typeof current !== "object") continue;
        for (const [key, child] of Object.entries(current)) {
            if (PRIVATE_KEYS.has(normalizedPrivateKey(key))) return true;
            if (child !== null && typeof child === "object") pending.push(child);
        }
    }
    return false;
}

function lifecycleState(event: CanonicalGameEvent): LifecycleState {
    const payload = event.payload as Readonly<Record<string, CanonicalJsonValue>>;
    const mode = typeof payload.mode === "string" ? payload.mode : null;
    const members = new Set<string>();
    let duplicateMembers = false;
    const players = Array.isArray(payload.players) ? payload.players : [];
    for (const player of players) {
        if (
            player !== null
            && typeof player === "object"
            && !Array.isArray(player)
            && typeof player.playerId === "string"
        ) {
            if (members.has(player.playerId)) duplicateMembers = true;
            members.add(player.playerId);
        }
    }

    let expectedCounts: Map<string, number> | null = null;
    if (Array.isArray(payload.expectedPlacementEventCounts)) {
        expectedCounts = new Map();
        for (const value of payload.expectedPlacementEventCounts) {
            if (
                value !== null
                && typeof value === "object"
                && !Array.isArray(value)
                && typeof value.playerId === "string"
                && typeof value.expectedPlacementEventCount === "number"
            ) {
                if (members.has(value.playerId)) duplicateMembers = true;
                expectedCounts.set(
                    value.playerId,
                    value.expectedPlacementEventCount,
                );
                members.add(value.playerId);
            }
        }
    }
    return {
        mode,
        members,
        expectedCounts,
        schemaVersion: event.schemaVersion,
        duplicateMembers,
    };
}

function addCompletenessEvent(
    games: Map<string, GameState>,
    event: CanonicalGameEvent,
): void {
    let game = games.get(event.gameId);
    if (!game) {
        game = {
            gameId: event.gameId,
            starts: [],
            overs: [],
            placements: new Map(),
            idempotencyConflict: false,
        };
        games.set(event.gameId, game);
    }
    if (event.eventType === "game_start") {
        game.starts.push(lifecycleState(event));
        return;
    }
    if (event.eventType === "game_over") {
        game.overs.push(lifecycleState(event));
        return;
    }

    const playerId = event.playerId as string;
    let placement = game.placements.get(playerId);
    if (!placement) {
        placement = { count: 0, indices: new Set() };
        game.placements.set(playerId, placement);
    }
    placement.count += 1;
    placement.indices.add(event.pieceIndex as number);
}

function sameStrings(left: Set<string>, right: Set<string>): boolean {
    return left.size === right.size && [...left].every(value => right.has(value));
}

function gameCompleteness(game: GameState): {
    gameDigest: string;
    status: "complete" | "ambiguous" | "incomplete";
    mlExportEligible: boolean;
    reasonCodes: readonly string[];
} {
    const reasons = new Set<string>();
    if (game.starts.length === 0) reasons.add("lifecycle_start_missing");
    if (game.starts.length > 1) reasons.add("lifecycle_start_duplicate");
    if (game.overs.length === 0) reasons.add("lifecycle_over_missing");
    if (game.overs.length > 1) reasons.add("lifecycle_over_duplicate");
    if (game.idempotencyConflict) reasons.add("idempotency_conflict");

    const start = game.starts.length === 1 ? game.starts[0] : null;
    const over = game.overs.length === 1 ? game.overs[0] : null;
    if (start && over && start.mode !== over.mode) {
        reasons.add("lifecycle_mode_mismatch");
    }
    if (start?.duplicateMembers || over?.duplicateMembers) {
        reasons.add("lifecycle_membership_mismatch");
    }
    if (start && [...game.placements.keys()].some(playerId => (
        !start.members.has(playerId)
    ))) {
        reasons.add("placement_player_membership_mismatch");
    }

    for (const placement of game.placements.values()) {
        if (placement.count !== placement.indices.size) {
            reasons.add("placement_duplicate");
        }
        const indices = [...placement.indices].sort((left, right) => left - right);
        if (indices.some((value, index) => (
            index > 0 && value !== indices[index - 1] + 1
        ))) {
            reasons.add("placement_internal_gap");
        }
    }

    if (start && over?.expectedCounts) {
        if (!sameStrings(start.members, new Set(over.expectedCounts.keys()))) {
            reasons.add("lifecycle_membership_mismatch");
        }
        for (const [playerId, expectedCount] of over.expectedCounts) {
            const actualCount = game.placements.get(playerId)?.indices.size ?? 0;
            if (actualCount !== expectedCount) {
                reasons.add("placement_tail_count_mismatch");
            }
        }
    } else if (over?.schemaVersion === 1) {
        reasons.add("legacy_unknown_tail");
    }

    const reasonCodes = Object.freeze([...reasons].sort());
    const status = reasonCodes.length === 0
        ? "complete"
        : reasonCodes.every(reason => reason === "legacy_unknown_tail")
            ? "ambiguous"
            : "incomplete";
    return Object.freeze({
        gameDigest: createHash("sha256")
            .update(canonicalJson(["identity-v1", "game", game.gameId]), "utf8")
            .digest("hex"),
        status,
        mlExportEligible: status === "complete",
        reasonCodes,
    });
}

function summarizeCompleteness(games: Map<string, GameState>): JsonlImportReport["completeness"] {
    const reasonCounts = new Map<string, number>();
    const summaries = [...games.values()]
        .map(gameCompleteness)
        .sort((left, right) => (
            left.gameDigest < right.gameDigest
                ? -1
                : left.gameDigest > right.gameDigest ? 1 : 0
        ));
    for (const summary of summaries) {
        for (const reason of summary.reasonCodes) increment(reasonCounts, reason);
    }
    return Object.freeze({
        gameCount: summaries.length,
        completeGameCount: summaries.filter(value => value.status === "complete").length,
        ambiguousGameCount: summaries.filter(value => value.status === "ambiguous").length,
        incompleteGameCount: summaries.filter(value => value.status === "incomplete").length,
        reasonCodeCounts: sortedCounts(reasonCounts),
        games: Object.freeze(summaries),
    });
}

function createSourceTransform(
    hash: ReturnType<typeof createHash>,
    maximumLineBytes: number,
    byteCounter: { value: number },
): Transform {
    let lineBytes = 0;
    let previousByte = -1;
    return new Transform({
        transform(chunk: Buffer, _encoding, callback) {
            const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
            hash.update(bytes);
            byteCounter.value += bytes.length;
            for (const byte of bytes) {
                if (byte === 0x0a) {
                    const jsonBytes = previousByte === 0x0d ? lineBytes - 1 : lineBytes;
                    if (jsonBytes > maximumLineBytes) {
                        callback(new JsonlImportError("SOURCE_LINE_TOO_LARGE"));
                        return;
                    }
                    lineBytes = 0;
                    previousByte = byte;
                    continue;
                }
                lineBytes += 1;
                previousByte = byte;
                if (lineBytes > maximumLineBytes + (byte === 0x0d ? 1 : 0)) {
                    callback(new JsonlImportError("SOURCE_LINE_TOO_LARGE"));
                    return;
                }
            }
            callback(null, bytes);
        },
        flush(callback) {
            const jsonBytes = previousByte === 0x0d ? lineBytes - 1 : lineBytes;
            callback(jsonBytes > maximumLineBytes
                ? new JsonlImportError("SOURCE_LINE_TOO_LARGE")
                : null);
        },
    });
}

function sourceUnchanged(
    before: Awaited<ReturnType<typeof stat>>,
    after: Awaited<ReturnType<typeof stat>>,
    bytesRead: number,
): boolean {
    return before.dev === after.dev
        && before.ino === after.ino
        && before.size === after.size
        && before.mtimeMs === after.mtimeMs
        && after.size === bytesRead;
}

async function sha256File(filePath: string): Promise<string> {
    const hash = createHash("sha256");
    for await (const chunk of createReadStream(filePath)) {
        hash.update(chunk);
    }
    return hash.digest("hex");
}

export async function runJsonlImport(
    options: RunJsonlImportOptions,
): Promise<JsonlImportReport> {
    const inputPath = resolve(options.inputPath);
    const dryRun = options.dryRun === true;
    const maximumLineBytes = options.maxLineBytes ?? DEFAULT_MAX_LOG_BYTES;
    if (!Number.isSafeInteger(maximumLineBytes) || maximumLineBytes <= 0) {
        await options.repository?.close().catch(() => {});
        return fail("SOURCE_LINE_LIMIT_INVALID");
    }
    if (!dryRun && !options.repository) {
        return fail("IMPORT_REPOSITORY_REQUIRED");
    }

    let before: Awaited<ReturnType<typeof stat>>;
    try {
        before = await stat(inputPath);
    } catch {
        await options.repository?.close().catch(() => {});
        return fail("SOURCE_FILE_REQUIRED");
    }
    if (!before.isFile()) {
        await options.repository?.close().catch(() => {});
        return fail("SOURCE_FILE_REQUIRED");
    }

    const sourceHash = createHash("sha256");
    const orderedEventHash = createHash("sha256");
    const bytesRead = { value: 0 };
    const sourceEventCounts = new Map<string, number>();
    const canonicalEventCounts = new Map<string, number>();
    const failureCounts = new Map<string, number>();
    const issues: ImportIssue[] = [];
    const games = new Map<string, GameState>();
    const identities = new Map<string, string>();
    const writes = {
        attempted: 0,
        inserted: 0,
        duplicate: 0,
        conflict: 0,
        failed: 0,
    };
    let lineCount = 0;
    let canonicalEventCount = 0;
    let duplicateIdentityCount = 0;
    let conflictIdentityCount = 0;
    let appendDisabled = false;
    let closeFailed = false;

    function addIssue(
        reasonCode: string,
        lineNumber: number,
        eventId: string | null = null,
    ): void {
        increment(failureCounts, reasonCode);
        if (issues.length < MAX_REPORTED_ISSUES) {
            issues.push({ lineNumber, reasonCode, eventId });
        }
    }

    const source = createReadStream(inputPath);
    const guarded = source.pipe(createSourceTransform(
        sourceHash,
        maximumLineBytes,
        bytesRead,
    ));
    const lines = createInterface({ input: guarded, crlfDelay: Infinity });
    try {
        for await (const line of lines) {
            lineCount += 1;
            let raw: unknown;
            try {
                raw = JSON.parse(line);
            } catch {
                addIssue("INVALID_JSON", lineCount);
                continue;
            }
            if (isRecord(raw) && typeof raw.eventType === "string") {
                increment(
                    sourceEventCounts,
                    SOURCE_EVENT_TYPES.has(raw.eventType) ? raw.eventType : "unknown",
                );
            }
            if (containsPrivateField(raw)) {
                addIssue("PRIVATE_FIELD_PRESENT", lineCount);
                continue;
            }

            const validation = validateGameEventLog(raw);
            if (!validation.ok) {
                addIssue(validation.reason, lineCount);
                continue;
            }

            let prepared;
            try {
                prepared = prepareCanonicalGameEvent(projectGameEventLog(validation.log));
            } catch {
                addIssue("CANONICAL_PROJECTION_FAILED", lineCount);
                continue;
            }
            canonicalEventCount += 1;
            increment(canonicalEventCounts, prepared.snapshot.eventType);
            orderedEventHash.update(
                `${prepared.eventId}:${prepared.eventSha256}\n`,
                "utf8",
            );
            addCompletenessEvent(games, prepared.snapshot);

            const previousHash = identities.get(prepared.eventId);
            if (previousHash === prepared.eventSha256) {
                duplicateIdentityCount += 1;
            } else if (previousHash !== undefined) {
                conflictIdentityCount += 1;
                games.get(prepared.snapshot.gameId)!.idempotencyConflict = true;
                if (dryRun) {
                    addIssue("IDEMPOTENCY_CONFLICT", lineCount, prepared.eventId);
                }
            } else {
                identities.set(prepared.eventId, prepared.eventSha256);
            }

            if (dryRun || appendDisabled) continue;
            writes.attempted += 1;
            try {
                const result = await options.repository?.append(prepared.snapshot);
                if (!result) return fail("IMPORT_REPOSITORY_RESULT_INVALID");
                if (result.status === "inserted") writes.inserted += 1;
                if (result.status === "duplicate") writes.duplicate += 1;
                if (result.status === "conflict") {
                    writes.conflict += 1;
                    games.get(prepared.snapshot.gameId)!.idempotencyConflict = true;
                    addIssue("IDEMPOTENCY_CONFLICT", lineCount, prepared.eventId);
                }
            } catch {
                writes.failed += 1;
                addIssue("DB_APPEND_FAILED", lineCount, prepared.eventId);
                appendDisabled = true;
            }
        }
    } catch (error) {
        if (error instanceof JsonlImportError) throw error;
        return fail("SOURCE_READ_FAILED");
    } finally {
        lines.close();
        source.destroy();
        guarded.destroy();
        if (options.repository) {
            try {
                await options.repository.close();
            } catch {
                closeFailed = true;
            }
        }
    }

    if (closeFailed) {
        writes.failed += 1;
        addIssue("DB_CLOSE_FAILED", lineCount);
    }
    const sourceSha256 = sourceHash.digest("hex");
    const verifiedSha256 = await sha256File(inputPath);
    const after = await stat(inputPath);
    if (
        sourceSha256 !== verifiedSha256
        || !sourceUnchanged(before, after, bytesRead.value)
    ) {
        return fail("SOURCE_FILE_CHANGED");
    }

    const failureCount = [...failureCounts.values()]
        .reduce((sum, value) => sum + value, 0);
    return Object.freeze({
        reportVersion: REPORT_VERSION,
        ok: failureCount === 0,
        dryRun,
        source: Object.freeze({
            fileName: basename(inputPath),
            sha256: sourceSha256,
            bytes: bytesRead.value,
            lineCount,
            eventTypeCounts: sortedCounts(sourceEventCounts),
        }),
        canonical: Object.freeze({
            eventCount: canonicalEventCount,
            eventTypeCounts: sortedCounts(canonicalEventCounts),
            orderedEventSha256: orderedEventHash.digest("hex"),
            uniqueIdentityCount: identities.size,
            duplicateIdentityCount,
            conflictIdentityCount,
        }),
        writes: Object.freeze(writes),
        failures: Object.freeze({
            count: failureCount,
            reasonCodeCounts: sortedCounts(failureCounts),
            issues: Object.freeze(issues),
            truncatedIssueCount: failureCount - issues.length,
        }),
        completeness: summarizeCompleteness(games),
    });
}

export function parseJsonlImportArgs(args: readonly string[]): CliOptions {
    let dryRun = false;
    let reportPath: string | null = null;
    let inputPath: string | null = null;
    for (let index = 0; index < args.length; index += 1) {
        const value = args[index];
        if (value === "--dry-run" && !dryRun) {
            dryRun = true;
            continue;
        }
        if (value === "--report" && reportPath === null) {
            const next = args[index + 1];
            if (!next || next.startsWith("--")) return fail("REPORT_PATH_REQUIRED");
            reportPath = next;
            index += 1;
            continue;
        }
        if (value.startsWith("--")) return fail("IMPORT_OPTION_INVALID");
        if (inputPath !== null) return fail("IMPORT_SOURCE_COUNT_INVALID");
        inputPath = value;
    }
    if (!inputPath) return fail("IMPORT_SOURCE_REQUIRED");
    return { inputPath, dryRun, reportPath };
}

async function assertReportPathIsSafe(
    inputPath: string,
    reportPath: string,
): Promise<string> {
    const sourcePath = await realpath(resolve(inputPath));
    const resolvedReport = resolve(reportPath);
    const reportParent = await realpath(dirname(resolvedReport));
    const canonicalReport = join(reportParent, basename(resolvedReport));
    if (canonicalReport === sourcePath) return fail("REPORT_PATH_IS_SOURCE");
    try {
        const [sourceInfo, reportInfo] = await Promise.all([
            stat(sourcePath),
            stat(canonicalReport),
        ]);
        if (sourceInfo.dev === reportInfo.dev && sourceInfo.ino === reportInfo.ino) {
            return fail("REPORT_PATH_IS_SOURCE");
        }
    } catch (error) {
        if (!isRecord(error) || error.code !== "ENOENT") throw error;
    }
    return canonicalReport;
}

function safeErrorCode(error: unknown): string {
    if (error instanceof JsonlImportError) return error.code;
    if (
        isRecord(error)
        && typeof error.code === "string"
        && /^[A-Z][A-Z0-9_]*$/.test(error.code)
    ) {
        return error.code;
    }
    return "JSONL_IMPORT_FAILED";
}

export async function runJsonlImportCli(
    args: readonly string[] = process.argv.slice(2),
    env: NodeJS.ProcessEnv = process.env,
): Promise<number> {
    const options = parseJsonlImportArgs(args);
    const reportPath = options.reportPath
        ? await assertReportPathIsSafe(options.inputPath, options.reportPath)
        : null;
    let repository: EventRepository | undefined;
    if (!options.dryRun) {
        const connectionUrl = env.IMPORT_DATABASE_URL?.trim();
        if (!connectionUrl) return fail("IMPORT_DATABASE_URL_REQUIRED");
        repository = createPostgresEventRepository({
            connectionUrl,
            ca: env.IMPORT_DATABASE_CA?.trim() || undefined,
            applicationName: "tetris-goal9c-import",
            max: 1,
        });
    }
    const report = await runJsonlImport({
        inputPath: options.inputPath,
        dryRun: options.dryRun,
        repository,
    });
    const output = `${JSON.stringify(report, null, 2)}\n`;
    if (reportPath) await writeFile(reportPath, output, "utf8");
    process.stdout.write(output);
    return report.ok ? 0 : 1;
}

if (require.main === module) {
    runJsonlImportCli()
        .then(code => {
            process.exitCode = code;
        })
        .catch(error => {
            console.error(safeErrorCode(error));
            process.exitCode = 1;
        });
}
