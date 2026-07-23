// =============================
// 메모리 기반 소켓 요청 제한
// 이벤트 종류와 player/IP key별 fixed window를 단일 Node 프로세스 메모리에 저장한다.
// =============================
export const RATE_LIMITS = Object.freeze({
    newSession: { limit: 20, windowMs: 60_000 },
    invalidResume: { limit: 10, windowMs: 60_000 },
    lifecycle: { limit: 10, windowMs: 60_000 },
    input: { limit: 60, windowMs: 1_000 },
    bag: { limit: 2, windowMs: 1_000 },
    chat: { limit: 1, windowMs: 1_000 },
    placementLog: { limit: 10, windowMs: 10_000 },
} as const)
export const TEST_RATE_LIMITS = Object.freeze({
    ...RATE_LIMITS,
    newSession: { limit: 120, windowMs: 60_000 },
    lifecycle: { limit: 100, windowMs: 60_000 },
    bag: { limit: 20, windowMs: 1_000 },
} as const)

export type SocketRateLimitBucket = keyof typeof RATE_LIMITS;
export type SocketRateLimitService = {
    cleanupExpired(): void;
    consume(bucketName: SocketRateLimitBucket, key: string | null | undefined): boolean;
};
type RateLimit = { limit: number; windowMs: number };
type Dependencies = {
    now?: () => number;
    limits?: Partial<Record<SocketRateLimitBucket, RateLimit>>;
};

/**
 * handler가 payload 해석이나 상태 변경 전에 호출할 rate limiter를 만든다.
 * `consume`은 이번 요청이 한도 안이면 true이고, key나 설정이 없거나 한도를 넘으면 false다.
 */
export function createSocketRateLimitService(
    dependencies: Dependencies = {},
): SocketRateLimitService {
    const now = dependencies.now || Date.now
    const limits = dependencies.limits || RATE_LIMITS
    const buckets = new Map<string, { count: number; resetAt: number }>()

    function consume(
        bucketName: SocketRateLimitBucket,
        key: string | null | undefined,
    ): boolean {
        const limit = limits[bucketName]
        if (!limit || !key) return false

        const currentTime = now()
        const bucketKey = `${bucketName}:${key}`
        const current = buckets.get(bucketKey)
        if (!current || current.resetAt <= currentTime) {
            buckets.set(bucketKey, {
                count: 1,
                resetAt: currentTime + limit.windowMs,
            })
            return true
        }
        if (current.count >= limit.limit) return false

        current.count += 1
        return true
    }

    function cleanupExpired(): void {
        const currentTime = now()
        for (const [key, bucket] of buckets) {
            if (bucket.resetAt <= currentTime) buckets.delete(key)
        }
    }

    return {
        cleanupExpired,
        consume,
    }
}
