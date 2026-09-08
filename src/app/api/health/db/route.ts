import { NextResponse } from 'next/server';
import { sql } from 'drizzle-orm';
import { db, pool } from '@/server/db/client';
import { rateLimitMode } from '@/server/core/rate-limit';
import { mailDriverName } from '@/server/mail';
import { logger } from '@/server/core/logger';

export const dynamic = 'force-dynamic';

/**
 * Database health, in enough detail to diagnose the two failures that actually
 * happen in production.
 *
 * The first is exhaustion: every pooled connection is checked out and requests
 * queue behind them. `waiting` above zero for any length of time is that,
 * and it is invisible from `/api/health`, which only asks whether one query
 * succeeds. The second is latency drift — a database that answers, slowly,
 * because it has been moved, resized, or is now a region away.
 *
 * Deliberately public and deliberately thin. It reports counters and timings
 * about this process; it names no patient, runs no user query, and reveals no
 * connection string. Anything richer than this belongs behind authentication.
 */
export async function GET() {
  const started = performance.now();

  let reachable = false;
  let latencyMs: number | null = null;
  let serverVersion: string | null = null;
  let migrations: number | null = null;

  try {
    const probe = performance.now();
    const version = await db.execute<{ version: string }>(sql`SELECT version() AS version`);
    latencyMs = Math.round((performance.now() - probe) * 10) / 10;
    serverVersion = (version.rows[0]?.version ?? '').split(' ').slice(0, 2).join(' ') || null;
    reachable = true;

    const applied = await db.execute<{ count: number }>(
      sql`SELECT count(*)::int AS count FROM _caresync_migrations`,
    );
    migrations = applied.rows[0]?.count ?? null;
  } catch (err) {
    logger.error('health_db_unreachable', {
      errorName: (err as Error)?.name,
      message: (err as Error)?.message,
    });
  }

  // node-postgres exposes these three counters; they are the whole picture of
  // pool pressure. `waiting` is the one that matters.
  const poolStats = {
    total: pool.totalCount,
    idle: pool.idleCount,
    waiting: pool.waitingCount,
    max: Number(process.env.DB_POOL_MAX ?? 5),
  };

  const body = {
    status: reachable ? ('ok' as const) : ('unreachable' as const),
    database: {
      reachable,
      latencyMs,
      serverVersion,
      migrationsApplied: migrations,
    },
    pool: poolStats,
    // Which implementation is actually serving these, rather than which one the
    // documentation hopes is serving them.
    limiter: rateLimitMode(),
    mail: mailDriverName(),
    checkedInMs: Math.round((performance.now() - started) * 10) / 10,
    time: new Date().toISOString(),
  };

  return NextResponse.json(
    reachable
      ? { success: true, data: body }
      : { success: false, error: { code: 'SERVICE_UNAVAILABLE', message: 'Database is not reachable.', details: body } },
    { status: reachable ? 200 : 503, headers: { 'Cache-Control': 'no-store' } },
  );
}
