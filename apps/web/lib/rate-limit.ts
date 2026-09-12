/**
 * rate-limit.ts — minimal fixed-window rate limiter for public API routes.
 *
 * POST /api/tx is unauthenticated and every call fans out into Soroban RPC
 * (`getAccount` plus a full `simulateTransaction`). That makes it an
 * amplification vector: cheap for a caller, expensive for this server and for
 * the RPC quota behind it. This limiter puts a ceiling on that.
 *
 * Scope and limits, stated plainly: the counter lives in process memory, so on
 * a serverless platform each instance enforces its own window and a burst
 * spread across cold starts sees a higher effective limit. It is a speed bump
 * that removes the trivial single-client flood, not a substitute for an edge
 * WAF or a shared store. Deployments that need a hard guarantee should put a
 * platform-level limit in front of this route.
 */

interface Window {
  count: number;
  /** Epoch ms at which this window expires. */
  resetAt: number;
}

const windows = new Map<string, Window>();

/** Stop the map from growing without bound under a spray of distinct keys. */
const MAX_TRACKED_KEYS = 10_000;

export interface RateLimitResult {
  allowed: boolean;
  /** Requests still available in the current window. */
  remaining: number;
  /** Seconds until the window resets — suitable for a `Retry-After` header. */
  retryAfterSeconds: number;
}

/**
 * Consume one unit of quota for `key`.
 *
 * @param key - caller identity (see {@link clientKey})
 * @param limit - requests permitted per window
 * @param windowMs - window length in milliseconds
 * @returns whether the request is allowed, plus reset information
 */
export function rateLimit(
  key: string,
  limit: number,
  windowMs: number
): RateLimitResult {
  const now = Date.now();
  const existing = windows.get(key);

  if (!existing || existing.resetAt <= now) {
    if (windows.size >= MAX_TRACKED_KEYS) {
      // Cheapest correct eviction: drop entries whose window already lapsed.
      for (const [k, w] of windows) {
        if (w.resetAt <= now) windows.delete(k);
      }
      // Still full means a genuine flood of distinct keys; reset wholesale
      // rather than let the map grow into a memory-exhaustion vector.
      if (windows.size >= MAX_TRACKED_KEYS) windows.clear();
    }
    windows.set(key, { count: 1, resetAt: now + windowMs });
    return {
      allowed: true,
      remaining: limit - 1,
      retryAfterSeconds: Math.ceil(windowMs / 1000),
    };
  }

  existing.count += 1;
  const retryAfterSeconds = Math.max(
    1,
    Math.ceil((existing.resetAt - now) / 1000)
  );
  return {
    allowed: existing.count <= limit,
    remaining: Math.max(0, limit - existing.count),
    retryAfterSeconds,
  };
}

/**
 * Derive a rate-limit key from the request.
 *
 * `x-forwarded-for` is client-settable in general, but on Vercel (and any proxy
 * that overwrites rather than appends) the left-most entry is the real peer.
 * Only the first entry is used, so an attacker cannot multiply their quota by
 * prepending fake hops. Requests with no usable header share one bucket.
 *
 * @param headers - the incoming request headers
 * @returns a stable key for {@link rateLimit}
 */
export function clientKey(headers: Headers): string {
  const forwarded = headers.get('x-forwarded-for');
  if (forwarded) {
    const first = forwarded.split(',')[0]?.trim();
    if (first) return first;
  }
  return headers.get('x-real-ip')?.trim() || 'unknown';
}
