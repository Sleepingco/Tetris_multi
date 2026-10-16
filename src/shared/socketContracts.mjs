// =============================
// 소켓 전송 계약
// TypeScript 타입은 런타임 입력을 막지 못하므로 양방향 payload를 Zod로 실제 검증한다.
// strictObject를 사용해 위조된 playerId 같은 선언되지 않은 필드도 신뢰 경계에서 거부한다.
// =============================
import * as z from "zod";

z.config({ jitless: true });

const UUID_V4_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ROOM_ID_PATTERN = /^[0-9A-F]{8}$/;
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;
const SHA256_PATTERN = /^[0-9a-f]{64}$/i;

const safeNonNegativeIntegerSchema = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
const safePositiveIntegerSchema = z.number().int().min(1).max(Number.MAX_SAFE_INTEGER);
const timestampSchema = safeNonNegativeIntegerSchema;
const reasonSchema = z.string().min(1).max(256);

export const humanPlayerIdSchema = z.string().regex(UUID_V4_PATTERN);
export const roomIdSchema = z.string().regex(ROOM_ID_PATTERN);
export const sessionTokenSchema = z.string().regex(TOKEN_PATTERN);
export const nicknameSchema = z.string().trim().min(1).max(24);
export const pieceTypeSchema = z.enum([
    "bar",
    "eleft",
    "eright",
    "ess",
    "square",
    "tree",
    "zee",
]);

const heuristicPlayerIdSchema = z.string().regex(/^heuristic-ai-[0-9A-F]{8}$/);
const humanPublicPlayerSchema = z.strictObject({
    playerId: humanPlayerIdSchema,
    nickname: nicknameSchema,
    playerType: z.literal("human"),
});
const heuristicPublicPlayerSchema = z.strictObject({
    playerId: heuristicPlayerIdSchema,
    nickname: z.enum(["Heuristic AI", "My Imitation AI (Experimental)"]),
    playerType: z.literal("heuristic_ai"),
});
export const publicPlayerSchema = z.union([
    humanPublicPlayerSchema,
    heuristicPublicPlayerSchema,
]);

export const roomPublicSchema = z.strictObject({
    roomId: roomIdSchema,
    mode: z.enum(["pvp", "pve"]),
    aiDifficulty: z.enum(["normal", "hard"]).nullable(),
    aiPolicy: z.enum(["heuristic", "placement_v4"]).nullable(),
    hostPlayerId: humanPlayerIdSchema,
    status: z.enum(["waiting", "playing", "finished"]),
    createdAt: timestampSchema,
    players: z.array(publicPlayerSchema).max(2),
});

const boardCellSchema = z.union([pieceTypeSchema, z.literal("garbage")]).nullable();
export const boardSchema = z.array(z.array(boardCellSchema).length(10)).length(20);
const activePieceSchema = z.strictObject({
    pieceType: z.union([pieceTypeSchema, z.literal("")]),
    rotation: z.number().int().min(0).max(3),
    row: z.number().int().min(Number.MIN_SAFE_INTEGER).max(Number.MAX_SAFE_INTEGER),
    col: z.number().int().min(Number.MIN_SAFE_INTEGER).max(Number.MAX_SAFE_INTEGER),
});
export const snapshotSchema = z.strictObject({
    board: boardSchema,
    activePiece: activePieceSchema.nullable(),
    pieceQueue: z.array(pieceTypeSchema),
    holdPieceType: pieceTypeSchema.nullable(),
    holdUsedThisDrop: z.boolean(),
    score: z.number().finite().nonnegative(),
    lines: safeNonNegativeIntegerSchema,
    phase: z.enum(["playing", "lineClearing", "gameOver"]),
    gameOver: z.boolean(),
    combo: z.number().int().min(-1).max(Number.MAX_SAFE_INTEGER),
    backToBack: z.boolean(),
    tick: safeNonNegativeIntegerSchema,
    pieceIndex: safeNonNegativeIntegerSchema,
    pendingGarbageLines: safeNonNegativeIntegerSchema,
    lastProcessedClientSequence: safeNonNegativeIntegerSchema,
});

const presentationEffectSchema = z.strictObject({
    type: z.literal("line_clear"),
    id: z.string().min(1).max(160),
    pieceIndex: safeNonNegativeIntegerSchema,
    rows: z.array(z.number().int().min(0).max(19)).max(20),
    boardBeforeClear: boardSchema,
});
const combatEffectSchema = z.strictObject({
    id: z.string().min(1).max(180),
    gameId: z.string().regex(UUID_V4_PATTERN),
    pieceIndex: safeNonNegativeIntegerSchema,
    targetPlayerId: z.union([humanPlayerIdSchema, heuristicPlayerIdSchema]).nullable(),
    sentLines: safeNonNegativeIntegerSchema,
    canceledLines: safeNonNegativeIntegerSchema,
    appliedLines: safeNonNegativeIntegerSchema,
    linesCleared: z.number().int().min(0).max(4),
    isTSpin: z.boolean(),
    combo: z.number().int().min(-1).max(Number.MAX_SAFE_INTEGER),
    backToBackBonus: z.boolean(),
}).refine(effect => (effect.sentLines > 0) === (effect.targetPlayerId !== null), {
    message: "Sent garbage requires a target player",
});
const aiPolicyRuntimeSchema = z.strictObject({
    roomId: roomIdSchema,
    playerId: heuristicPlayerIdSchema,
    policyRequested: z.enum(["heuristic", "placement_v4"]),
    policyUsed: z.enum(["heuristic", "placement_v4"]),
    fallbackReason: reasonSchema.nullable(),
    modelSha256: z.string().regex(SHA256_PATTERN).nullable(),
    fallbackCount: safeNonNegativeIntegerSchema,
    lastFallbackReason: reasonSchema.nullable(),
});
const matchPlayerSchema = z.strictObject({
    playerId: z.union([humanPlayerIdSchema, heuristicPlayerIdSchema]),
    playerType: z.enum(["human", "heuristic_ai"]),
    bagChunks: z.array(z.array(pieceTypeSchema).length(7)),
    snapshot: snapshotSchema.nullable(),
});
const matchSchema = z.strictObject({
    gameId: z.string().regex(UUID_V4_PATTERN).optional(),
    roomId: roomIdSchema,
    mode: z.enum(["pvp", "pve"]),
    aiPolicy: z.enum(["heuristic", "placement_v4"]).nullable(),
    aiPolicyRuntime: aiPolicyRuntimeSchema.nullable(),
    status: z.enum(["waiting", "playing", "finished"]),
    createdAt: timestampSchema,
    startsAt: timestampSchema.nullable().optional(),
    players: z.array(matchPlayerSchema).max(2),
});

export const handshakeAuthSchema = z.strictObject({
    nickname: nicknameSchema,
    playerId: humanPlayerIdSchema.optional(),
    token: sessionTokenSchema.optional(),
    credentialError: z.literal("MALFORMED").optional(),
});
export const connectErrorDataSchema = z.strictObject({
    code: reasonSchema,
    terminal: z.boolean(),
});

const roomIdRequestSchema = z.strictObject({ roomId: roomIdSchema });
const expectedTransformSchema = z.strictObject({
    pieceType: pieceTypeSchema,
    rotation: z.number().int().min(0).max(3),
    col: z.number().int().min(Number.MIN_SAFE_INTEGER).max(Number.MAX_SAFE_INTEGER),
});
const gameInputBaseShape = {
    roomId: roomIdSchema,
    tick: safeNonNegativeIntegerSchema,
    pieceIndex: safeNonNegativeIntegerSchema,
    clientSequence: safePositiveIntegerSchema,
};
const gameInputSchema = z.discriminatedUnion("action", [
    z.strictObject({
        ...gameInputBaseShape,
        action: z.literal("hold"),
        expectedTransform: expectedTransformSchema.optional(),
    }),
    z.strictObject({
        ...gameInputBaseShape,
        action: z.enum([
            "move_left",
            "move_right",
            "soft_drop",
            "rotate",
            "rotate_ccw",
            "hard_drop",
        ]),
        expectedTransform: expectedTransformSchema,
    }),
]);

export const clientToServerSchemas = Object.freeze({
    "global:chat": z.strictObject({ text: z.string().trim().min(1).max(200) }),
    "room:chat": z.strictObject({
        roomId: roomIdSchema,
        text: z.string().trim().min(1).max(200),
    }),
    "room:create": z.strictObject({
        mode: z.enum(["pvp", "pve"]).optional(),
        aiDifficulty: z.enum(["normal", "hard"]).optional(),
        aiPolicy: z.enum(["heuristic", "placement_v4"]).optional(),
    }),
    "room:join": roomIdRequestSchema,
    "room:leave": roomIdRequestSchema,
    "room:start": roomIdRequestSchema,
    "game:join": roomIdRequestSchema,
    "game:input": gameInputSchema,
    "game:log:placement_decision": z.strictObject({
        roomId: roomIdSchema,
        log: z.unknown(),
    }),
    "game:bag:request": roomIdRequestSchema,
    "game:leave": roomIdRequestSchema,
    "room:sync": roomIdRequestSchema,
});

const roomResultSchema = z.strictObject({
    ok: z.boolean(),
    room: roomPublicSchema.nullable(),
    reason: reasonSchema.nullable(),
    roomId: roomIdSchema.nullable().optional(),
    player: publicPlayerSchema.nullable().optional(),
    winnerPlayerId: z.union([humanPlayerIdSchema, heuristicPlayerIdSchema]).nullable().optional(),
    loserPlayerId: z.union([humanPlayerIdSchema, heuristicPlayerIdSchema]).nullable().optional(),
    finishReason: reasonSchema.optional(),
});
const chatResultSchema = z.strictObject({
    ok: z.boolean(),
    reason: reasonSchema.nullable(),
    text: z.string().max(200).optional(),
    room: roomPublicSchema.nullable().optional(),
});
const roomChatMessageSchema = z.strictObject({
    type: z.literal("chat"),
    scope: z.literal("room"),
    roomId: roomIdSchema,
    playerId: humanPlayerIdSchema,
    nickname: nicknameSchema,
    text: z.string().min(1).max(200),
});
const roomSystemMessageSchema = z.strictObject({
    type: z.literal("system"),
    text: z.string().min(1).max(256),
    roomId: roomIdSchema,
});
const inputResultSchema = z.strictObject({
    ok: z.boolean(),
    reason: reasonSchema.nullable(),
    clientSequence: safePositiveIntegerSchema.optional(),
    pieceIndex: safeNonNegativeIntegerSchema.optional(),
    placementCommitted: z.boolean(),
    snapshot: snapshotSchema.optional(),
});

export const serverToClientSchemas = Object.freeze({
    "session:ready": z.strictObject({
        version: z.literal(1),
        playerId: humanPlayerIdSchema,
        token: sessionTokenSchema,
        nickname: nicknameSchema,
        expiresAt: timestampSchema,
        resumed: z.boolean(),
    }),
    "chat:result": chatResultSchema,
    "global:message": z.strictObject({
        type: z.literal("chat"),
        scope: z.literal("global"),
        playerId: humanPlayerIdSchema,
        nickname: nicknameSchema,
        text: z.string().min(1).max(200),
    }),
    "room:message": z.union([roomChatMessageSchema, roomSystemMessageSchema]),
    "room:result": roomResultSchema,
    "room:updated": roomPublicSchema,
    "game:join:result": roomResultSchema.extend({
        match: matchSchema.nullable(),
        serverNow: timestampSchema.optional(),
    }),
    "game:countdown": z.strictObject({
        roomId: roomIdSchema,
        gameId: z.string().regex(UUID_V4_PATTERN),
        startsAt: timestampSchema.nullable(),
        serverNow: timestampSchema,
    }),
    "game:input:result": inputResultSchema,
    "game:log:result": z.strictObject({
        ok: z.boolean(),
        reason: reasonSchema.nullable(),
        log: z.unknown().nullable().optional(),
        room: roomPublicSchema.nullable().optional(),
    }),
    "game:bag:result": z.strictObject({
        ok: z.boolean(),
        reason: reasonSchema.nullable(),
        room: roomPublicSchema.nullable().optional(),
        match: z.null().optional(),
    }),
    "game:bag:append": z.strictObject({
        roomId: roomIdSchema,
        playerId: z.union([humanPlayerIdSchema, heuristicPlayerIdSchema]),
        bagChunk: z.array(pieceTypeSchema).length(7),
    }),
    "game:leave:result": roomResultSchema,
    "game:opponent-left": z.strictObject({
        room: roomPublicSchema.nullable(),
        playerId: humanPlayerIdSchema,
    }),
    "game:authoritative:snapshot": z.strictObject({
        roomId: roomIdSchema,
        playerId: z.union([humanPlayerIdSchema, heuristicPlayerIdSchema]),
        snapshot: snapshotSchema,
        presentationEffect: presentationEffectSchema.optional(),
        combatEffect: combatEffectSchema.optional(),
    }),
    "match:finish": z.strictObject({
        room: roomPublicSchema,
        winnerPlayerId: z.union([humanPlayerIdSchema, heuristicPlayerIdSchema]),
        loserPlayerId: z.union([humanPlayerIdSchema, heuristicPlayerIdSchema]),
        reason: reasonSchema,
    }),
    "pve:ai-policy": aiPolicyRuntimeSchema,
});

export function parseClientEvent(eventName, payload) {
    return clientToServerSchemas[eventName]?.safeParse(payload) ?? { success: false };
}

export function parseServerEvent(eventName, payload) {
    return serverToClientSchemas[eventName]?.safeParse(payload) ?? { success: false };
}
