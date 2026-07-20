const RATE_LIMITS = Object.freeze({
    newSession: { limit: 120, windowMs: 60_000 },
    invalidResume: { limit: 10, windowMs: 60_000 },
    lifecycle: { limit: 30, windowMs: 60_000 },
    input: { limit: 60, windowMs: 1_000 },
    bag: { limit: 4, windowMs: 1_000 },
    chat: { limit: 1, windowMs: 1_000 },
    placementLog: { limit: 10, windowMs: 10_000 },
})

function createSocketRateLimitService(dependencies = {}) {
    const now = dependencies.now || Date.now
    const limits = dependencies.limits || RATE_LIMITS
    const buckets = new Map()

    function consume(bucketName, key) {
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

    function cleanupExpired() {
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

module.exports = {
    RATE_LIMITS,
    createSocketRateLimitService,
}
