import { protectedRoute } from '@/server/core/route';
import { ok, parseQuery } from '@/server/core/api';
import { timelineQuerySchema } from '@/server/validators';
import { getPatientTimeline, countPatientEvents, type TimelineEventType } from '@/server/services/timeline.service';
import { assertPatientAccess } from '@/server/services/patient-access.service';
import { PERMISSIONS } from '@/types/rbac';

export const dynamic = 'force-dynamic';

type P = { id: string };

/**
 * GET /api/patients/:id/timeline
 * One chronological feed across admissions, notes, vitals, investigations,
 * medication and referrals. Cursor paginated, newest first.
 */
export const GET = protectedRoute<P>(async ({ req, user, params }) => {
  await assertPatientAccess(user, params.id);
  const q = parseQuery(req, timelineQuerySchema);

  const result = await getPatientTimeline({
    patientId: params.id,
    limit: q.limit,
    cursor: q.cursor,
    types: q.types ? (q.types.split(',').filter(Boolean) as TimelineEventType[]) : undefined,
  });

  return ok(result.items, { nextCursor: result.nextCursor, total: await countPatientEvents(params.id) });
}, { permission: PERMISSIONS.TIMELINE_READ });
