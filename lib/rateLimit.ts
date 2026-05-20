/**
 * Rate-limiting via Upstash Redis.
 *
 * Uses a simple INCR + EXPIRE pipeline pattern:
 *   INCR rl:{namespace}:{identifier}
 *   EXPIRE rl:{namespace}:{identifier} {windowSeconds} NX
 *
 * The NX flag on EXPIRE ensures the TTL is only set on the first increment
 * (when the key is created), so the window doesn't reset on subsequent hits.
 *
 * Used by:
 *   - POST /api/preview (Req 3.7): 5 requests per IP per hour
 *   - POST /api/auth/magic (Req 15.6): 5 requests per email-hash per hour
 *
 * Design ref: §7 Security – Magic-link rate limit & enumeration protection
 */
import { Redis } from "@upstash/redis";
import { getServerEnv } from "@/lib/env";

let redis: Redis | undefined;

function getRedis(): Redis | null {
  if (redis) return redis;
  const env = getServerEnv();
  if (!env.UPSTASH_REDIS_REST_URL || !env.UPSTASH_REDIS_REST_TOKEN) {
    return null; // Redis not configured — fail open
  }
  redis = new Redis({
    url: env.UPSTASH_REDIS_REST_URL,
    token: env.UPSTASH_REDIS_REST_TOKEN,
  });
  return redis;
}

export interface RateLimitResult {
  /** Whether the request is allowed (counter ≤ limit). */
  allowed: boolean;
  /** Current counter value after this request. */
  current: number;
  /** Maximum allowed requests in the window. */
  limit: number;
}

/**
 * Check and increment a rate-limit counter.
 *
 * @param namespace - Logical grouping, e.g. "preview" or "magic"
 * @param identifier - The unique key within the namespace (IP address, email hash, etc.)
 * @param limit - Maximum allowed requests in the window (default: 5)
 * @param windowSeconds - Window duration in seconds (default: 3600 = 1 hour)
 */
export async function checkRateLimit(
  namespace: string,
  identifier: string,
  limit: number = 5,
  windowSeconds: number = 3600,
): Promise<RateLimitResult> {
  const client = getRedis();

  // Fail open when Redis is not configured (no UPSTASH env vars)
  if (!client) {
    return { allowed: true, current: 0, limit };
  }

  const key = `rl:${namespace}:${identifier}`;

  // Pipeline: INCR the counter, then set TTL only if the key is new (NX).
  const pipeline = client.pipeline();
  pipeline.incr(key);
  pipeline.expire(key, windowSeconds, "NX");

  const results = await pipeline.exec();

  // INCR returns the new counter value as the first result.
  const current = results[0] as number;

  return {
    allowed: current <= limit,
    current,
    limit,
  };
}
