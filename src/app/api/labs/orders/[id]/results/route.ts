import { protectedRoute } from '@/server/core/route';
import { created, parseBody } from '@/server/core/api';
import { labResultsSchema } from '@/server/validators';
import { recordLabResults } from '@/server/services/diagnostics.service';
import { PERMISSIONS } from '@/types/rbac';

export const dynamic = 'force-dynamic';
type P = { id: string };

/**
 * POST /api/labs/orders/:id/results
 * Flags each value against its reference range and escalates critical results
 * to the ordering clinician and the care team.
 */
export const POST = protectedRoute<P>(async ({ req, user, params }) => {
  const { results } = await parseBody(req, labResultsSchema);
  return created(await recordLabResults(user, params.id, results));
}, { permission: PERMISSIONS.LAB_RESULT });
