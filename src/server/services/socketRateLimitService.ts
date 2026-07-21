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
