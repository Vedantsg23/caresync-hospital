import { protectedRoute } from '@/server/core/route';
import { ok } from '@/server/core/api';
import {
  getDoctorDashboard, getNurseDashboard, getAdminDashboard,
  getPathologyDashboard, getRadiologyDashboard, getPharmacyDashboard,
} from '@/server/services/dashboard.service';

export const dynamic = 'force-dynamic';

/**
 * GET /api/dashboard
 * Role-aware: each role receives the aggregate shaped for its own workflow.
 * Every number is computed live from the database.
 */
export const GET = protectedRoute(async ({ user }) => {
  switch (user.role) {
    case 'SENIOR_DOCTOR':
    case 'JUNIOR_DOCTOR':
      return ok({ role: user.role, ...(await getDoctorDashboard(user)) });
    case 'NURSE':
      return ok({ role: user.role, ...(await getNurseDashboard(user)) });
    case 'PATHOLOGY':
      return ok({ role: user.role, ...(await getPathologyDashboard()) });
    case 'RADIOLOGY':
      return ok({ role: user.role, ...(await getRadiologyDashboard()) });
    case 'PHARMACY':
      return ok({ role: user.role, ...(await getPharmacyDashboard()) });
    case 'SUPER_ADMIN':
    case 'HOSPITAL_ADMIN':
    case 'HR_ADMIN':
    default:
      return ok({ role: user.role, ...(await getAdminDashboard()) });
  }
});
