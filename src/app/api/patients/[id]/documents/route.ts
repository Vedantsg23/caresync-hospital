import { protectedRoute } from '@/server/core/route';
import { ok } from '@/server/core/api';
import { listAttachments } from '@/server/services/storage.service';
import { PERMISSIONS } from '@/types/rbac';

export const dynamic = 'force-dynamic';
type P = { id: string };

export const GET = protectedRoute<P>(async ({ user, params }) => {
  return ok(await listAttachments(user, { patientId: params.id }));
}, { permission: PERMISSIONS.FILE_READ });
