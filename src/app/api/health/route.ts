import { NextResponse } from 'next/server';
import { sql } from 'drizzle-orm';
import { db } from '@/server/db/client';

export const dynamic = 'force-dynamic';

/** Liveness + database reachability. Deliberately leaks nothing. */
export async function GET() {
  try {
    await db.execute(sql`SELECT 1`);
    return NextResponse.json({ success: true, data: { status: 'ok', database: 'connected', time: new Date().toISOString() } });
  } catch {
    return NextResponse.json(
      { success: false, error: { code: 'SERVICE_UNAVAILABLE', message: 'Database is not reachable.' } },
      { status: 503 },
    );
  }
}
