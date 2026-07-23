import { createHash } from "node:crypto";

export const MAX_CANONICAL_EVENT_BYTES = 256 * 1024;
export const MAX_GAME_ID_BYTES = 64;
export const MAX_PLAYER_ID_BYTES = 64;
const POSTGRES_INTEGER_MAX = 2_147_483_647;
const OCCURRED_AT_PATTERN =
    /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,3}))?(?:Z|([+-])(\d{2}):(\d{2}))$/;
const EVENT_KEYS = [
    "eventType",
    "gameId",
    "identityVersion",
    "occurredAt",
    "payload",
    "pieceIndex",
    "playerId",
    "schemaVersion",
    "trustLevel",
].sort();

export type CanonicalJsonValue =
    | null
    | boolean
    | number
    | string
    | readonly CanonicalJsonValue[]
    | { readonly [key: string]: CanonicalJsonValue };

export type CanonicalEventType =
    | "game_start"
    | "placement_decision"
    | "game_over";

export type CanonicalTrustLevel =
    | "server_authoritative"
    | "client_reported";

export type CanonicalGameEvent = Readonly<{
    identityVersion: "identity-v1";
    eventType: CanonicalEventType;
    schemaVersion: number;
    gameId: string;
    playerId: string | null;
    pieceIndex: number | null;
    trustLevel: CanonicalTrustLevel;
    occurredAt: string | null;
    payload: Readonly<Record<string, CanonicalJsonValue>>;
}>;

export type PreparedCanonicalGameEvent = Readonly<{
    snapshot: CanonicalGameEvent;
    identityTuple: readonly (string | number)[];
    canonicalEnvelope: string;
    eventId: string;
    eventSha256: string;
}>;

export class CanonicalGameEventError extends Error {
    readonly code: string;

    constructor(code: string) {
        super(code);
        this.name = "CanonicalGameEventError";
        this.code = code;
    }
}

function fail(code: string): never {
    throw new CanonicalGameEventError(code);
}

function isPostgresText(value: string): boolean {
    for (let index = 0; index < value.length; index += 1) {
        const codeUnit = value.charCodeAt(index);
        if (codeUnit === 0) return false;
        if (codeUnit >= 0xd800 && codeUnit <= 0xdbff) {
            if (index + 1 >= value.length) return false;
            const next = value.charCodeAt(index + 1);
            if (next < 0xdc00 || next > 0xdfff) return false;
            index += 1;
        } else if (codeUnit >= 0xdc00 && codeUnit <= 0xdfff) {
            return false;
        }
    }
    return true;
}

function cloneCanonicalValue(
    value: unknown,
    ancestors: Set<object>,
): CanonicalJsonValue {
    if (
        value === null
        || typeof value === "boolean"
    ) {
        return value;
    }
    if (typeof value === "string") {
        return isPostgresText(value) ? value : fail("CANONICAL_JSON_INVALID");
    }
    if (typeof value === "number") {
        return Number.isFinite(value) && !Object.is(value, -0)
            ? value
            : fail("CANONICAL_JSON_INVALID");
    }
    if (typeof value !== "object") {
        return fail("CANONICAL_JSON_INVALID");
    }
    if (ancestors.has(value)) {
        return fail("CANONICAL_JSON_INVALID");
    }

    ancestors.add(value);
    try {
        if (Array.isArray(value)) {
            if (Object.getPrototypeOf(value) !== Array.prototype) {
                return fail("CANONICAL_JSON_INVALID");
            }
            const ownKeys = Reflect.ownKeys(value);
            if (ownKeys.length !== value.length + 1) {
                return fail("CANONICAL_JSON_INVALID");
            }
            for (const key of ownKeys) {
                if (key === "length") continue;
                if (
                    typeof key !== "string"
                    || !/^(0|[1-9]\d*)$/.test(key)
                    || Number(key) >= value.length
                ) {
                    return fail("CANONICAL_JSON_INVALID");
                }
            }

            const clone: CanonicalJsonValue[] = [];
            for (let index = 0; index < value.length; index += 1) {
                if (!Object.hasOwn(value, index)) {
                    return fail("CANONICAL_JSON_INVALID");
                }
                const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
                if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) {
                    return fail("CANONICAL_JSON_INVALID");
                }
                clone.push(cloneCanonicalValue(descriptor.value, ancestors));
            }
            return Object.freeze(clone);
        }

        const prototype = Object.getPrototypeOf(value);
        if (prototype !== Object.prototype && prototype !== null) {
            return fail("CANONICAL_JSON_INVALID");
        }
        const ownKeys = Reflect.ownKeys(value);
        if (ownKeys.some(key => typeof key === "symbol")) {
            return fail("CANONICAL_JSON_INVALID");
        }

        const keys = Object.keys(value);
        if (ownKeys.length !== keys.length || keys.includes("toJSON")) {
            return fail("CANONICAL_JSON_INVALID");
        }

        const clone: Record<string, CanonicalJsonValue> = {};
        for (const key of keys.sort()) {
            if (!isPostgresText(key)) {
                return fail("CANONICAL_JSON_INVALID");
            }
            const descriptor = Object.getOwnPropertyDescriptor(value, key);
            if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) {
                return fail("CANONICAL_JSON_INVALID");
            }
            Object.defineProperty(clone, key, {
                configurable: false,
                enumerable: true,
                value: cloneCanonicalValue(descriptor.value, ancestors),
                writable: false,
            });
        }
        return Object.freeze(clone);
    } finally {
        ancestors.delete(value);
    }
}

function serializeCanonicalValue(value: CanonicalJsonValue): string {
    if (value === null) return "null";
    if (typeof value === "string") return JSON.stringify(value);
    if (typeof value === "number" || typeof value === "boolean") {
        return String(value);
    }
    if (Array.isArray(value)) {
        return `[${value.map(serializeCanonicalValue).join(",")}]`;
    }
    const objectValue = value as Readonly<Record<string, CanonicalJsonValue>>;
    const entries = Object.keys(objectValue)
        .sort()
        .map(key => `${JSON.stringify(key)}:${serializeCanonicalValue(objectValue[key])}`);
    return `{${entries.join(",")}}`;
}

export function canonicalJson(value: unknown): string {
    return serializeCanonicalValue(cloneCanonicalValue(value, new Set()));
}

function isRecord(value: CanonicalJsonValue): value is Record<string, CanonicalJsonValue> {
    return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isNonBlankString(value: CanonicalJsonValue): value is string {
    return typeof value === "string" && value.trim().length > 0;
}

function isBoundedIdentity(
    value: CanonicalJsonValue,
    maximumBytes: number,
): value is string {
    return isNonBlankString(value)
        && Buffer.byteLength(value, "utf8") <= maximumBytes;
}

function isPostgresInteger(value: CanonicalJsonValue): value is number {
    return typeof value === "number"
        && Number.isInteger(value)
        && value >= 0
        && value <= POSTGRES_INTEGER_MAX;
}

function normalizeOccurredAt(value: CanonicalJsonValue): string | null {
    if (value === null) return null;
    if (typeof value !== "string") {
        return fail("CANONICAL_EVENT_INVALID");
    }
    const match = OCCURRED_AT_PATTERN.exec(value);
    if (!match) return fail("CANONICAL_EVENT_INVALID");

    const year = Number(match[1]);
    const month = Number(match[2]);
    const day = Number(match[3]);
    const hour = Number(match[4]);
    const minute = Number(match[5]);
    const second = Number(match[6]);
    const offsetHour = match[9] === undefined ? 0 : Number(match[9]);
    const offsetMinute = match[10] === undefined ? 0 : Number(match[10]);
    const leapYear = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
    const daysInMonth = [
        31,
        leapYear ? 29 : 28,
        31,
        30,
        31,
        30,
        31,
        31,
        30,
        31,
        30,
        31,
    ];
    if (
        year === 0
        || month < 1
        || month > 12
        || day < 1
        || day > daysInMonth[month - 1]
        || hour > 23
        || minute > 59
        || second > 59
        || offsetHour > 23
        || offsetMinute > 59
    ) {
        return fail("CANONICAL_EVENT_INVALID");
    }

    const timestamp = new Date(value);
    if (Number.isNaN(timestamp.getTime())) {
        return fail("CANONICAL_EVENT_INVALID");
    }
    try {
        const normalized = timestamp.toISOString();
        return /^\d{4}-/.test(normalized)
            ? normalized
            : fail("CANONICAL_EVENT_INVALID");
    } catch {
        return fail("CANONICAL_EVENT_INVALID");
    }
}

function validateTopLevelKeys(value: Record<string, CanonicalJsonValue>): void {
    const keys = Object.keys(value).sort();
    if (keys.length !== EVENT_KEYS.length || keys.some((key, index) => key !== EVENT_KEYS[index])) {
        return fail("CANONICAL_EVENT_INVALID");
    }
}

function createSnapshot(input: unknown): CanonicalGameEvent {
    let value: CanonicalJsonValue;
    try {
        value = cloneCanonicalValue(input, new Set());
    } catch {
        return fail("CANONICAL_EVENT_INVALID");
    }
    if (!isRecord(value)) return fail("CANONICAL_EVENT_INVALID");
    validateTopLevelKeys(value);

    if (value.identityVersion !== "identity-v1") {
        return fail("CANONICAL_EVENT_INVALID");
    }
    if (
        value.eventType !== "game_start"
        && value.eventType !== "placement_decision"
        && value.eventType !== "game_over"
    ) {
        return fail("CANONICAL_EVENT_INVALID");
    }
    if (!isPostgresInteger(value.schemaVersion) || value.schemaVersion === 0) {
        return fail("CANONICAL_EVENT_INVALID");
    }
    if (!isBoundedIdentity(value.gameId, MAX_GAME_ID_BYTES)) {
        return fail("CANONICAL_EVENT_INVALID");
    }
    if (
        value.trustLevel !== "server_authoritative"
        && value.trustLevel !== "client_reported"
    ) {
        return fail("CANONICAL_EVENT_INVALID");
    }
    if (!isRecord(value.payload)) {
        return fail("CANONICAL_EVENT_INVALID");
    }

    const occurredAt = normalizeOccurredAt(value.occurredAt);
    if (value.eventType === "placement_decision") {
        if (
            (value.schemaVersion !== 1 && value.schemaVersion !== 2)
            || !isBoundedIdentity(value.playerId, MAX_PLAYER_ID_BYTES)
            || !isPostgresInteger(value.pieceIndex)
            || (value.schemaVersion === 2 && occurredAt === null)
        ) {
            return fail("CANONICAL_EVENT_INVALID");
        }
    } else if (
        (value.schemaVersion !== 1 && value.schemaVersion !== 2)
        || value.playerId !== null
        || value.pieceIndex !== null
        || occurredAt === null
        || value.trustLevel !== "server_authoritative"
    ) {
        return fail("CANONICAL_EVENT_INVALID");
    }

    return Object.freeze({
        identityVersion: "identity-v1",
        eventType: value.eventType,
        schemaVersion: value.schemaVersion,
        gameId: value.gameId,
        playerId: value.playerId,
        pieceIndex: value.pieceIndex,
        trustLevel: value.trustLevel,
        occurredAt,
        payload: value.payload,
    }) as CanonicalGameEvent;
}

function createIdentityTuple(event: CanonicalGameEvent): readonly (string | number)[] {
    return Object.freeze(event.eventType === "placement_decision"
        ? [
            event.identityVersion,
            event.eventType,
            event.gameId,
            event.playerId as string,
            event.pieceIndex as number,
        ]
        : [
            event.identityVersion,
            event.eventType,
            event.gameId,
        ]);
}

function sha256(value: string): string {
    return createHash("sha256").update(value, "utf8").digest("hex");
}

/**
 * CanonicalGameEvent snapshot 하나에서 identity와 immutable envelope digest를 계산한다.
 * eventId는 envelope에 포함하지 않으며 DB-owned ingested_at도 snapshot 밖에 둔다.
 */
export function prepareCanonicalGameEvent(input: unknown): PreparedCanonicalGameEvent {
    const snapshot = createSnapshot(input);
    const identityTuple = createIdentityTuple(snapshot);
    const canonicalEnvelope = canonicalJson(snapshot);
    if (Buffer.byteLength(canonicalEnvelope, "utf8") > MAX_CANONICAL_EVENT_BYTES) {
        return fail("CANONICAL_EVENT_TOO_LARGE");
    }

    return Object.freeze({
        snapshot,
        identityTuple,
        canonicalEnvelope,
        eventId: sha256(canonicalJson(identityTuple)),
        eventSha256: sha256(canonicalEnvelope),
    });
}

export function createCanonicalGameEvent(input: unknown): CanonicalGameEvent {
    return prepareCanonicalGameEvent(input).snapshot;
}
