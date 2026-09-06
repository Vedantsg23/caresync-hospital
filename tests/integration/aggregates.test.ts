import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { sql } from 'drizzle-orm';
import { db, pool } from '@/server/db/client';
import { listDepartments, listRolesWithCounts, listStaff } from '@/server/services/admin.service';
import { listWards } from '@/server/services/admission.service';
import { getAdminDashboard, getDoctorDashboard } from '@/server/services/dashboard.service';
import { listLabOrders } from '@/server/services/diagnostics.service';
import { listMedicationOrders } from '@/server/services/pharmacy.service';
import { prepareDatabase, actorFor, ACCOUNTS } from './helpers';
import type { AuthUser } from '@/server/auth/context';

/**
 * Regression guard for correlated subqueries.
 *
 * Drizzle omits the table qualifier on a single-table select, so an interpolated
 * outer column inside a correlated subquery renders bare (`"id"`) and then
 * resolves against the SUBQUERY's own table — producing silently wrong counts,
 * or an "ambiguous column" error. Every aggregate below is compared against
 * ground truth computed independently in SQL.
 */
describe('dashboard and list aggregates match the database', () => {
  let doctor: AuthUser;

  beforeAll(async () => {
    prepareDatabase();
    doctor = await actorFor(ACCOUNTS.doctor);
  });

  afterAll(async () => { await pool.end(); });

  const truth = async (query: ReturnType<typeof sql>) => {
    const res = await db.execute<Record<string, string>>(query);
    return res.rows as unknown as Record<string, string>[];
  };

  it('reports the real staff count per department', async () => {
    const rows = await listDepartments();
    const expected = await truth(sql`
      SELECT d.code, count(sp.id)::text AS n
      FROM departments d LEFT JOIN staff_profiles sp ON sp.department_id = d.id
      GROUP BY d.code`);
    const byCode = Object.fromEntries(expected.map((e) => [e.code, Number(e.n)]));

    expect(rows.length).toBeGreaterThan(0);
    // At least one department must have staff, or the test would pass vacuously.
    expect(Object.values(byCode).some((n) => n > 0)).toBe(true);
    for (const d of rows) {
      expect(Number(d.staffCount), `staff count for ${d.code}`).toBe(byCode[d.code]);
    }
  });

  it('reports the real bed counts per ward', async () => {
    const rows = await listWards();
    const expected = await truth(sql`
      SELECT w.code,
             count(b.id)::text AS total,
             count(*) FILTER (WHERE b.status = 'OCCUPIED')::text AS occupied,
             count(*) FILTER (WHERE b.status = 'AVAILABLE')::text AS available
      FROM wards w LEFT JOIN beds b ON b.ward_id = w.id GROUP BY w.code`);
    const byCode = Object.fromEntries(expected.map((e) => [e.code, e]));

    expect(rows.length).toBeGreaterThan(0);
    for (const w of rows) {
      const t = byCode[w.code]!;
      expect(Number(w.totalBeds), `total beds in ${w.code}`).toBe(Number(t.total));
      expect(Number(w.occupiedBeds), `occupied beds in ${w.code}`).toBe(Number(t.occupied));
      expect(Number(w.availableBeds), `available beds in ${w.code}`).toBe(Number(t.available));
      expect(Number(w.totalBeds)).toBeGreaterThan(0);
    }
  });

  it('reports the real user count per role', async () => {
    const rows = await listRolesWithCounts();
    const expected = await truth(sql`SELECT primary_role AS role, count(*)::text AS n FROM users GROUP BY primary_role`);
    const byRole = Object.fromEntries(expected.map((e) => [e.role, Number(e.n)]));

    for (const r of rows) {
      expect(Number(r.userCount), `user count for ${r.name}`).toBe(byRole[r.name] ?? 0);
    }
    expect(rows.some((r) => Number(r.userCount) > 0)).toBe(true);
  });

  it('reports the real active session count per staff member', async () => {
    const rows = await listStaff({});
    const expected = await truth(sql`
      SELECT u.email, count(s.id)::text AS n
      FROM users u LEFT JOIN sessions s
        ON s.user_id = u.id AND s.revoked_at IS NULL AND s.expires_at > now()
      GROUP BY u.email`);
    const byEmail = Object.fromEntries(expected.map((e) => [e.email, Number(e.n)]));

    for (const s of rows) {
      expect(Number(s.activeSessions), `sessions for ${s.email}`).toBe(byEmail[s.email] ?? 0);
    }
  });

  it('builds the admin department activity table without an ambiguous column', async () => {
    const dashboard = await getAdminDashboard();
    expect(dashboard.departmentActivity.length).toBeGreaterThan(0);

    const expected = await truth(sql`
      SELECT d.code,
             (SELECT count(*)::text FROM staff_profiles sp JOIN users u ON u.id = sp.user_id
               WHERE sp.department_id = d.id AND u.is_active) AS staff,
             (SELECT count(*)::text FROM admissions a
               WHERE a.department_id = d.id AND a.status = 'ADMITTED') AS admitted,
             (SELECT count(*)::text FROM referrals r WHERE r.to_department_id = d.id) AS ref_in
      FROM departments d`);
    const byCode = Object.fromEntries(expected.map((e) => [e.code, e]));

    for (const row of dashboard.departmentActivity) {
      const t = byCode[row.code]!;
      expect(Number(row.staff), `staff in ${row.code}`).toBe(Number(t.staff));
      expect(Number(row.activeAdmissions), `admissions in ${row.code}`).toBe(Number(t.admitted));
      expect(Number(row.referralsIn), `referrals into ${row.code}`).toBe(Number(t.ref_in));
    }
    expect(dashboard.departmentActivity.some((d) => Number(d.staff) > 0)).toBe(true);
  });

  it('counts the doctor’s own caseload correctly', async () => {
    const dashboard = await getDoctorDashboard(doctor);
    const expected = await truth(sql`
      SELECT count(DISTINCT p.id)::text AS n
      FROM patients p
      WHERE EXISTS (SELECT 1 FROM admissions a
                    WHERE a.patient_id = p.id AND a.attending_doctor_id = ${doctor.id} AND a.status = 'ADMITTED')
         OR EXISTS (SELECT 1 FROM care_team_members c
                    WHERE c.patient_id = p.id AND c.user_id = ${doctor.id} AND c.removed_at IS NULL)`);
    expect(dashboard.kpis.patientsUnderCare).toBe(Number(expected[0]!.n));
    expect(dashboard.kpis.patientsUnderCare).toBeGreaterThan(0);
  });

  it('counts laboratory results and abnormal values per order', async () => {
    const orders = await listLabOrders({ status: ['COMPLETED'], limit: 50 });
    expect(orders.length).toBeGreaterThan(0);

    for (const o of orders.slice(0, 10)) {
      const [t] = await truth(sql`
        SELECT count(*)::text AS total,
               count(*) FILTER (WHERE flag <> 'NORMAL')::text AS abnormal
        FROM investigation_results WHERE order_id = ${o.id}`);
      expect(Number(o.resultCount), `result count for ${o.orderNumber}`).toBe(Number(t!.total));
      expect(Number(o.abnormalCount), `abnormal count for ${o.orderNumber}`).toBe(Number(t!.abnormal));
    }
    expect(orders.some((o) => Number(o.resultCount) > 0)).toBe(true);
  });

  it('counts medication administrations per order', async () => {
    const orders = await listMedicationOrders({ limit: 50 });
    expect(orders.length).toBeGreaterThan(0);

    for (const m of orders.slice(0, 10)) {
      const [t] = await truth(sql`
        SELECT count(*)::text AS n FROM medication_administrations WHERE medication_order_id = ${m.id}`);
      expect(Number(m.administrationCount), `administrations for ${m.medicineName}`).toBe(Number(t!.n));
    }
  });

  it('produces a hospital overview with internally consistent bed figures', async () => {
    const { kpis } = await getAdminDashboard();
    expect(kpis.totalBeds).toBe(
      kpis.occupiedBeds + kpis.availableBeds + kpis.cleaningBeds + kpis.reservedBeds,
    );
    expect(kpis.totalBeds).toBeGreaterThan(0);
    expect(kpis.occupiedBeds).toBeGreaterThan(0);
    expect(kpis.activeStaff).toBeGreaterThan(0);
    expect(kpis.totalPatients).toBeGreaterThan(0);
  });
});
