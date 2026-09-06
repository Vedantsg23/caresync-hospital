import { protectedRoute } from '@/server/core/route';
import { ok } from '@/server/core/api';
import { generateHandover } from '@/server/services/ai';
import { PERMISSIONS } from '@/types/rbac';

export const dynamic = 'force-dynamic';

export const GET = protectedRoute(async ({ user }) => ok(await generateHandover(user)),
  { permission: PERMISSIONS.AI_USE, limit: 30 });
