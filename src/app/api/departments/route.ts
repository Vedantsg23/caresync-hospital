import { protectedRoute } from '@/server/core/route';
import { ok } from '@/server/core/api';
import { listDepartments } from '@/server/services/admin.service';

export const dynamic = 'force-dynamic';

/** Readable by any authenticated user - needed by referral and admission forms. */
export const GET = protectedRoute(async () => ok(await listDepartments()));
