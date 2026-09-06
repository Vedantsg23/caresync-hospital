import '@/server/only';

/**
 * Lightweight in-process fixed-window limiter.
 * Adequate for a single instance and for blunting credential stuffing; swap the
 * `store` for Redis/Upstash when running many instances.
 */
type Bucket = { count: number; resetAt: number };

declare global {
  var __caresyncRateStore: Map<string, Bucket> | undefined;
}

const store: Map<string, Bucket> = global.__caresyncRateStore ?? new Map();
global.__caresyncRateStore = store;

export type RateResult = { allowed: boolean; remaining: number; retryAfterSeconds: number };

export function rateLimit(key: string, limit: number, windowMs = 60_000): RateResult {
  const now = Date.now();
  const bucket = store.get(key);

  if (!bucket || bucket.resetAt <= now) {
    store.set(key, { count: 1, resetAt: now + windowMs });
    if (store.size > 10_000) {
      for (const [k, b] of store) if (b.resetAt <= now) store.delete(k);
    }
    return { allowed: true, remaining: limit - 1, retryAfterSeconds: 0 };
  }

  bucket.count += 1;
  const allowed = bucket.count <= limit;
  return {
    allowed,
    remaining: Math.max(0, limit - bucket.count),
    retryAfterSeconds: allowed ? 0 : Math.ceil((bucket.resetAt - now) / 1000),
  };
}

export function clientIp(headers: Headers): string {
  return (
    headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    headers.get('x-real-ip') ||
    'unknown'
  );
}
