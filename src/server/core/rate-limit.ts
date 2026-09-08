import '@/server/only';
import { getEnv } from '@/lib/env';

/**
 * Request rate limiting.
 *
 * A limiter is only as good as the state it counts in. An in-process counter is
 * correct on one instance and quietly wrong on several — three instances behind
 * a load balancer give an attacker three times the allowance, and the defect is
 * invisible until someone is actually attacking you. So the counter lives
 * behind a store interface with two implementations:
 *
 *  - **Redis** (Upstash REST) when `REDIS_URL` is configured. State is shared,
 *    so the limit is the limit no matter how many instances are running, and
 *    the deployment can scale horizontally.
 *  - **In-memory** otherwise. Correct for a single instance, and honest about
 *    it: `rateLimitMode()` reports which one is live, `/api/health` surfaces it,
 *    and the documentation says plainly that the deployment is single-instance
 *    until Redis is configured.
 *
 * The fallback exists so the application runs correctly with no external
 * dependency — not so that a multi-instance deployment can pretend to be
 * protected.
 */

export type RateResult = {
  allowed: boolean;
  remaining: number;
  retryAfterSeconds: number;
};

interface RateStore {
  readonly name: 'redis' | 'memory';
  /** Increment the window's counter and return the new value plus its expiry. */
  hit(key: string, windowMs: number): Promise<{ count: number; resetAt: number }>;
}

/* ---------------------------------------------------------------- memory -- */

type Bucket = { count: number; resetAt: number };

declare global {
  var __caresyncRateStore: Map<string, Bucket> | undefined;
}

const buckets: Map<string, Bucket> = global.__caresyncRateStore ?? new Map();
global.__caresyncRateStore = buckets;

class MemoryRateStore implements RateStore {
  readonly name = 'memory' as const;

  async hit(key: string, windowMs: number) {
    const now = Date.now();
    const bucket = buckets.get(key);

    if (!bucket || bucket.resetAt <= now) {
      const fresh = { count: 1, resetAt: now + windowMs };
      buckets.set(key, fresh);
      // Opportunistic sweep; without it a long-lived instance leaks one entry
      // per distinct key forever.
      if (buckets.size > 10_000) {
        for (const [k, b] of buckets) if (b.resetAt <= now) buckets.delete(k);
      }
      return fresh;
    }

    bucket.count += 1;
    return { count: bucket.count, resetAt: bucket.resetAt };
  }
}

/* ----------------------------------------------------------------- redis -- */

/**
 * Upstash's REST API rather than a TCP client: serverless functions cannot hold
 * a connection pool open between invocations, so a stateless HTTP call is the
 * right shape here. INCR and PEXPIRE are pipelined into one round trip.
 */
class RedisRateStore implements RateStore {
  readonly name = 'redis' as const;

  constructor(private readonly url: string, private readonly token: string) {}

  async hit(key: string, windowMs: number) {
    const namespaced = `caresync:rl:${key}`;
    const res = await fetch(`${this.url.replace(/\/$/, '')}/pipeline`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${this.token}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify([
        ['INCR', namespaced],
        ['PEXPIRE', namespaced, String(windowMs), 'NX'],
        ['PTTL', namespaced],
      ]),
      // A slow limiter must not become a slow API.
      signal: AbortSignal.timeout(2_000),
    });

    if (!res.ok) throw new Error(`redis pipeline failed: ${res.status}`);

    const parsed = (await res.json()) as { result: number }[];
    const count = Number(parsed[0]?.result ?? 1);
    const ttl = Number(parsed[2]?.result ?? windowMs);
    return { count, resetAt: Date.now() + (ttl > 0 ? ttl : windowMs) };
  }
}

/* ------------------------------------------------------------- selection -- */

let store: RateStore | null = null;

function resolveStore(): RateStore {
  if (store) return store;
  const env = getEnv();
  store = env.REDIS_URL && env.REDIS_TOKEN
    ? new RedisRateStore(env.REDIS_URL, env.REDIS_TOKEN)
    : new MemoryRateStore();
  return store;
}

/** Which store is actually live. Reported by /api/health, never guessed. */
export function rateLimitMode(): 'redis' | 'memory' {
  return resolveStore().name;
}

/** Tests and configuration changes need a clean slate. */
export function resetRateLimiter() {
  store = null;
  buckets.clear();
}

export async function rateLimit(
  key: string,
  limit: number,
  windowMs = 60_000,
): Promise<RateResult> {
  const active = resolveStore();

  let result: { count: number; resetAt: number };
  try {
    result = await active.hit(key, windowMs);
  } catch (err) {
    // Redis being unreachable must not take the API down with it. Fall back to
    // the local counter for this request and say so — degraded limiting beats
    // no service, and the log tells the operator their cache is sick.
    console.error('[rate-limit] shared store unavailable, falling back to in-process:',
      err instanceof Error ? err.message : 'unknown error');
    result = await new MemoryRateStore().hit(key, windowMs);
  }

  const allowed = result.count <= limit;
  return {
    allowed,
    remaining: Math.max(0, limit - result.count),
    retryAfterSeconds: allowed ? 0 : Math.max(1, Math.ceil((result.resetAt - Date.now()) / 1000)),
  };
}

export function clientIp(headers: Headers): string {
  return (
    headers.get('x-forwarded-for')?.split(',')[0]?.trim()
    || headers.get('x-real-ip')
    || 'unknown'
  );
}
