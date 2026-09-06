import { execFileSync } from 'node:child_process';
import { eq } from 'drizzle-orm';
import { db } from '@/server/db/client';
import { users, staffProfiles, departments, patients } from '@/server/db/schema';
import { permissionsForRole, type Role } from '@/types/rbac';
import type { AuthUser } from '@/server/auth/context';

let prepared = false;

/**
 * Migrates and seeds the dedicated test database once per run.
 *
 * Integration tests exercise the real service layer against real Postgres —
 * including the RLS functions, triggers and constraints — because the parts of
 * this system most worth testing (authorization, state transitions, audit) only
 * exist when the database is in the loop.
 */
export function prepareDatabase(): void {
  if (prepared) return;
  const env = { ...process.env, SEED_FORCE: 'true' };
  execFileSync('npx', ['tsx', 'scripts/migrate.ts'], { env, stdio: 'pipe' });
  execFileSync('npx', ['tsx', 'scripts/seed.ts'], { env, stdio: 'pipe' });
  prepared = true;
}

/** Builds the AuthUser a route handler would have resolved from the session. */
export async function actorFor(email: string): Promise<AuthUser> {
  const [row] = await db
    .select({
      id: users.id,
      email: users.email,
      fullName: users.fullName,
      role: users.primaryRole,
      staffProfileId: staffProfiles.id,
      staffNumber: staffProfiles.staffNumber,
      designation: staffProfiles.designation,
      specialization: staffProfiles.specialization,
      acceptsReferrals: staffProfiles.acceptsReferrals,
      departmentId: departments.id,
      departmentName: departments.name,
      departmentCode: departments.code,
    })
    .from(users)
    .leftJoin(staffProfiles, eq(staffProfiles.userId, users.id))
    .leftJoin(departments, eq(departments.id, staffProfiles.departmentId))
    .where(eq(users.email, email))
    .limit(1);

  if (!row) throw new Error(`No seeded user with email ${email}`);

  return {
    id: row.id,
    email: row.email,
    fullName: row.fullName,
    role: row.role as Role,
    permissions: permissionsForRole(row.role as Role),
    sessionTokenId: `test-session-${row.id}`,
    staffProfileId: row.staffProfileId,
    staffNumber: row.staffNumber,
    designation: row.designation,
    specialization: row.specialization,
    departmentId: row.departmentId,
    departmentName: row.departmentName,
    departmentCode: row.departmentCode,
    acceptsReferrals: row.acceptsReferrals ?? false,
  };
}

export async function patientByNumber(patientNumber: string) {
  const [row] = await db.select().from(patients).where(eq(patients.patientNumber, patientNumber)).limit(1);
  if (!row) throw new Error(`No seeded patient with number ${patientNumber}`);
  return row;
}

/** The demo accounts the README documents. */
export const ACCOUNTS = {
  doctor: 'doctor@caresync.demo',
  specialist: 'specialist@caresync.demo',
  junior: 'junior@caresync.demo',
  nurse: 'nurse@caresync.demo',
  radiology: 'radiology@caresync.demo',
  pathology: 'pathology@caresync.demo',
  pharmacy: 'pharmacy@caresync.demo',
  admin: 'admin@caresync.demo',
  hr: 'hr@caresync.demo',
} as const;

/** The flagship demo patient. */
export const DEMO_PATIENT = 'PT-2026-00142';
