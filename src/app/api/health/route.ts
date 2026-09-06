import { NextResponse } from 'next/server';
import { sql } from 'drizzle-orm';
import { db } from '@/server/db/client';
import { envStatus } from '@/lib/env';

export const dynamic = 'force-dynamic';

/**
 * Liveness, database reachability and configuration validity.
 *
 * Reports the NAMES of any misconfigured environment variables, never their
 * values. Those names are already public in `.env.example`, and without them a
 * missing variable shows up only as an opaque 500 on an unrelated endpoint —
 * which is exactly how a deployment ends up with sign-in broken and no clue why.
 */
export async function GET() {
  const config = envStatus();

  let database = 'connected';
  try {
    await db.execute(sql`SELECT 1`);
  } catch {
    database = 'unreachable';
  }

  const healthy = config.ok && database === 'connected';

  return NextResponse.json(
    healthy
      ? { success: true, data: { status: 'ok', database, configuration: 'ok', time: new Date().toISOString() } }
      : {
          success: false,
          error: {
            code: config.ok ? 'SERVICE_UNAVAILABLE' : 'CONFIGURATION_ERROR',
            message: config.ok
              ? 'Database is not reachable.'
              : `Missing or invalid environment variables: ${config.invalid.join(', ')}. Set them and redeploy.`,
            details: { database, configuration: config.ok ? 'ok' : config.invalid },
          },
        },
    { status: healthy ? 200 : 503 },
  );
}
