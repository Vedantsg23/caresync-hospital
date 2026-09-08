import { protectedRoute } from '@/server/core/route';
import { ok, created, parseBody, parseQuery } from '@/server/core/api';
import { createLabOrderSchema, listQuerySchema } from '@/server/validators';
import { listLabOrders, createLabOrder } from '@/server/services/diagnostics.service';
import { PERMISSIONS } from '@/types/rbac';

export const dynamic = 'force-dynamic';

export const GET = protectedRoute(async ({ req, user }) => {
  const q = parseQuery(req, listQuerySchema);
  return ok(await listLabOrders({
    patientId: q.patientId,
    status: q.status ? (q.status.split(',').filter(Boolean) as ('ORDERED' | 'IN_PROGRESS' | 'COMPLETED' | 'CANCELLED')[]) : undefined,
    limit: q.limit,
  }, user));
}, { permission: PERMISSIONS.LAB_READ });

export const POST = protectedRoute(async ({ req, user }) => {
  const body = await parseBody(req, createLabOrderSchema);
  return created(await createLabOrder(user, body));
}, { permission: PERMISSIONS.LAB_ORDER });
