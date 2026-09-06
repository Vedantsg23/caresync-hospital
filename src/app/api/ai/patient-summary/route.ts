import { protectedRoute } from '@/server/core/route';
import { created, parseBody } from '@/server/core/api';
import { aiSummarySchema } from '@/server/validators';
import { generateSummary } from '@/server/services/ai';
import { PERMISSIONS } from '@/types/rbac';

export const dynamic = 'force-dynamic';

/**
 * POST /api/ai/patient-summary
 * Advisory only. The response always carries the review banner, and the AI
 * layer has no write access to any clinical table.
 */
export const POST = protectedRoute(async ({ req, user }) => {
  const body = await parseBody(req, aiSummarySchema);
  return created(await generateSummary(user, {
    patientId: body.patientId,
    kind: body.kind ?? 'PATIENT_SUMMARY',
    days: body.days,
  }));
}, { permission: PERMISSIONS.AI_USE, limit: 30 });
