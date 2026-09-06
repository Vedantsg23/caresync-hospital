import { NextResponse } from 'next/server';
import { and, desc, eq, gt, sql } from 'drizzle-orm';
import { db } from '@/server/db/client';
import { notifications, timelineEvents } from '@/server/db/schema';
import { getCurrentUser } from '@/server/auth/context';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;

const POLL_MS = 2500;
const STREAM_MS = 50_000;

/**
 * GET /api/realtime/stream?patientId=...
 *
 * Server-Sent Events. The cursor lives in the database rather than in process
 * memory, so this behaves identically on a single server and across many
 * serverless instances - which an in-process event emitter would not.
 * The stream self-closes just under the platform timeout and the browser's
 * EventSource reconnects automatically.
 */
export async function GET(req: Request) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json(
      { success: false, error: { code: 'UNAUTHENTICATED', message: 'Authentication is required.' } },
      { status: 401 },
    );
  }

  const url = new URL(req.url);
  const patientId = url.searchParams.get('patientId');
  const encoder = new TextEncoder();
  const startedAt = Date.now();

  let lastNotificationAt = new Date();
  let lastEventAt = new Date();

  const stream = new ReadableStream({
    async start(controller) {
      let closed = false;
      const send = (event: string, data: unknown) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
        } catch {
          closed = true;
        }
      };

      const close = () => {
        if (closed) return;
        closed = true;
        clearInterval(timer);
        try { controller.close(); } catch { /* already closed */ }
      };

      req.signal.addEventListener('abort', close);

      const [initial] = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(notifications)
        .where(and(eq(notifications.recipientId, user.id), eq(notifications.read, false)));

      send('connected', { userId: user.id, unreadCount: initial?.count ?? 0, at: new Date().toISOString() });

      const tick = async () => {
        if (closed) return;
        if (Date.now() - startedAt > STREAM_MS) {
          send('reconnect', { reason: 'stream-window-elapsed' });
          return close();
        }

        try {
          const fresh = await db
            .select({
              id: notifications.id,
              type: notifications.type,
              title: notifications.title,
              message: notifications.message,
              severity: notifications.severity,
              link: notifications.link,
              referenceType: notifications.referenceType,
              referenceId: notifications.referenceId,
              patientId: notifications.patientId,
              createdAt: notifications.createdAt,
            })
            .from(notifications)
            .where(and(
              eq(notifications.recipientId, user.id),
              gt(notifications.createdAt, lastNotificationAt),
            ))
            .orderBy(desc(notifications.createdAt))
            .limit(20);

          if (fresh.length) {
            lastNotificationAt = fresh[0]!.createdAt;
            const [unread] = await db
              .select({ count: sql<number>`count(*)::int` })
              .from(notifications)
              .where(and(eq(notifications.recipientId, user.id), eq(notifications.read, false)));
            send('notification', { items: fresh.reverse(), unreadCount: unread?.count ?? 0 });
          }

          if (patientId) {
            const events = await db
              .select({
                id: timelineEvents.id,
                eventType: timelineEvents.eventType,
                title: timelineEvents.title,
                severity: timelineEvents.severity,
                occurredAt: timelineEvents.occurredAt,
              })
              .from(timelineEvents)
              .where(and(
                eq(timelineEvents.patientId, patientId),
                gt(timelineEvents.createdAt, lastEventAt),
              ))
              .orderBy(desc(timelineEvents.createdAt))
              .limit(20);

            if (events.length) {
              lastEventAt = new Date();
              send('patient-update', { patientId, items: events.reverse() });
            }
          }

          send('heartbeat', { at: new Date().toISOString() });
        } catch (err) {
          console.error('[realtime] poll failed', err);
          send('error', { message: 'Realtime poll failed' });
        }
      };

      const timer = setInterval(tick, POLL_MS);
    },
  });

  return new Response(stream, {
    headers: {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-cache, no-transform',
      connection: 'keep-alive',
      'x-accel-buffering': 'no',
    },
  });
}
