import '@/server/only';
import { and, desc, eq, inArray, sql, type SQL } from 'drizzle-orm';
import { db } from '@/server/db/client';
import {
  users, staffProfiles, departments, roles, userRoles, auditLogs, patients, sessions,
} from '@/server/db/schema';
import { AppError } from '@/server/core/errors';
import { hashPassword, passwordIssues } from '@/server/auth/password';
import { revokeAllSessionsForUser } from '@/server/auth/session';
import { nextStaffNumber } from './identifier.service';
import { recordAudit, AUDIT } from '@/server/core/audit';
import { ROLES, type Role } from '@/types/rbac';
import type { AuthUser } from '@/server/auth/context';
import { MAX_REFERENCE_ROWS, boundedLimit } from '@/server/core/pagination';

export async function listDepartments() {
  return db
    .select({
      id: departments.id,
      code: departments.code,
      name: departments.name,
      description: departments.description,
      isClinical: departments.isClinical,
      isActive: departments.isActive,
      staffCount: sql<number>`(SELECT count(*)::int FROM ${staffProfiles} sp WHERE sp.department_id = departments.id)`,
    })
    .from(departments)
    .orderBy(departments.name);
}

export async function createDepartment(user: AuthUser, input: { code: string; name: string; description?: string; isClinical?: boolean }) {
  const [row] = await db.insert(departments).values({
    code: input.code.toUpperCase(),
    name: input.name,
    description: input.description ?? null,
    isClinical: input.isClinical ?? true,
  }).returning();

  await recordAudit({
    action: AUDIT.DEPARTMENT_CREATED, entityType: 'department', entityId: row!.id,
    actor: user, metadata: { code: input.code },
  });
  return row!;
}

export async function listStaff(params: { role?: Role; departmentId?: string; isActive?: boolean; q?: string; limit?: number } = {}) {
  const conditions: SQL[] = [];
  if (params.role) conditions.push(eq(users.primaryRole, params.role));
  if (params.departmentId) conditions.push(eq(staffProfiles.departmentId, params.departmentId));
  if (params.isActive !== undefined) conditions.push(eq(users.isActive, params.isActive));
  if (params.q?.trim()) {
    const term = `%${params.q.trim().toLowerCase()}%`;
    conditions.push(sql`(lower(${users.fullName}) LIKE ${term} OR lower(${users.email}) LIKE ${term})`);
  }

  return db
    .select({
      id: users.id,
      email: users.email,
      fullName: users.fullName,
      role: users.primaryRole,
      isActive: users.isActive,
      lastLoginAt: users.lastLoginAt,
      createdAt: users.createdAt,
      staffProfileId: staffProfiles.id,
      staffNumber: staffProfiles.staffNumber,
      designation: staffProfiles.designation,
      specialization: staffProfiles.specialization,
      registrationNumber: staffProfiles.registrationNumber,
      phone: staffProfiles.phone,
      acceptsReferrals: staffProfiles.acceptsReferrals,
      departmentId: departments.id,
      departmentName: departments.name,
      activeSessions: sql<number>`(SELECT count(*)::int FROM ${sessions} s WHERE s.user_id = users.id AND s.revoked_at IS NULL AND s.expires_at > now())`,
    })
    .from(users)
    .leftJoin(staffProfiles, eq(staffProfiles.userId, users.id))
    .leftJoin(departments, eq(departments.id, staffProfiles.departmentId))
    .where(conditions.length ? and(...conditions) : undefined)
    .orderBy(users.fullName)
    .limit(boundedLimit(params.limit, 100));
}

export type CreateStaffInput = {
  email: string;
  fullName: string;
  password: string;
  role: Role;
  departmentId?: string;
  designation: string;
  specialization?: string;
  registrationNumber?: string;
  phone?: string;
  acceptsReferrals?: boolean;
};

export async function createStaff(actor: AuthUser, input: CreateStaffInput) {
  const email = input.email.trim().toLowerCase();

  const issues = passwordIssues(input.password);
  if (issues.length) throw new AppError('VALIDATION_ERROR', `The password ${issues.join(', ')}.`);

  const [existing] = await db.select({ id: users.id }).from(users).where(eq(users.email, email)).limit(1);
  if (existing) throw new AppError('DUPLICATE_RESOURCE', 'An account already exists with that email address.');

  // Only a super administrator may mint another super administrator.
  if (input.role === 'SUPER_ADMIN' && actor.role !== 'SUPER_ADMIN') {
    throw new AppError('FORBIDDEN', 'Only a system administrator can create another system administrator.');
  }

  const staffNumber = await nextStaffNumber();
  const passwordHash = await hashPassword(input.password);

  const created = await db.transaction(async (tx) => {
    // An administrator creating an account directly is the vouching step, so
    // there is no verify-then-approve round: the account is usable at once.
    // `mustReset` marks the administrator-chosen password as temporary — the
    // holder is expected to replace it, and the UI prompts for that.
    const [user] = await tx.insert(users).values({
      email,
      passwordHash,
      fullName: input.fullName,
      primaryRole: input.role,
      isActive: true,
      status: 'ACTIVE',
      emailVerifiedAt: new Date(),
      approvedById: actor.id,
      approvedAt: new Date(),
      passwordChangedAt: new Date(),
      mustReset: true,
      phone: input.phone ?? null,
    }).returning();

    await tx.insert(staffProfiles).values({
      userId: user!.id,
      staffNumber,
      departmentId: input.departmentId ?? null,
      designation: input.designation,
      specialization: input.specialization ?? null,
      registrationNumber: input.registrationNumber ?? null,
      phone: input.phone ?? null,
      acceptsReferrals: input.acceptsReferrals ?? ['SENIOR_DOCTOR', 'JUNIOR_DOCTOR'].includes(input.role),
    });

    const [role] = await tx.select().from(roles).where(eq(roles.name, input.role)).limit(1);
    if (role) {
      await tx.insert(userRoles).values({ userId: user!.id, roleId: role.id, assignedById: actor.id });
    }

    return user!;
  });

  await recordAudit({
    action: AUDIT.USER_CREATED, entityType: 'user', entityId: created.id, actor,
    metadata: { email, role: input.role, staffNumber },
  });

  return { id: created.id, email: created.email, fullName: created.fullName, role: created.primaryRole, staffNumber };
}

export async function updateStaff(
  actor: AuthUser,
  userId: string,
  input: {
    fullName?: string; departmentId?: string | null; designation?: string;
    specialization?: string | null; registrationNumber?: string | null;
    phone?: string | null; acceptsReferrals?: boolean;
  },
) {
  const [target] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  if (!target) throw new AppError('USER_NOT_FOUND', 'Staff member could not be found.');

  if (input.fullName !== undefined) {
    await db.update(users).set({ fullName: input.fullName, updatedAt: new Date() }).where(eq(users.id, userId));
  }

  const profileFields = {
    ...(input.departmentId !== undefined ? { departmentId: input.departmentId } : {}),
    ...(input.designation !== undefined ? { designation: input.designation } : {}),
    ...(input.specialization !== undefined ? { specialization: input.specialization } : {}),
    ...(input.registrationNumber !== undefined ? { registrationNumber: input.registrationNumber } : {}),
    ...(input.phone !== undefined ? { phone: input.phone } : {}),
    ...(input.acceptsReferrals !== undefined ? { acceptsReferrals: input.acceptsReferrals } : {}),
  };
  if (Object.keys(profileFields).length) {
    await db.update(staffProfiles).set({ ...profileFields, updatedAt: new Date() }).where(eq(staffProfiles.userId, userId));
  }

  await recordAudit({
    action: AUDIT.USER_UPDATED, entityType: 'user', entityId: userId, actor,
    metadata: { fields: Object.keys(input) },
  });

  return listStaff({}).then((rows) => rows.find((r) => r.id === userId) ?? null);
}

/**
 * Role changes are the most sensitive administrative action in the system:
 * privileged, always audited, and they invalidate the target's sessions so a
 * demotion takes effect immediately rather than at next login.
 */
export async function changeRole(actor: AuthUser, userId: string, newRole: Role) {
  if (!ROLES.includes(newRole)) throw new AppError('VALIDATION_ERROR', 'Unknown role.');

  const [target] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  if (!target) throw new AppError('USER_NOT_FOUND', 'Staff member could not be found.');

  if (target.id === actor.id) {
    throw new AppError('FORBIDDEN', 'You cannot change your own role.');
  }
  if ((newRole === 'SUPER_ADMIN' || target.primaryRole === 'SUPER_ADMIN') && actor.role !== 'SUPER_ADMIN') {
    throw new AppError('FORBIDDEN', 'Only a system administrator can grant or remove system administrator access.');
  }

  const previous = target.primaryRole;

  await db.transaction(async (tx) => {
    await tx.update(users).set({ primaryRole: newRole, updatedAt: new Date() }).where(eq(users.id, userId));
    await tx.delete(userRoles).where(eq(userRoles.userId, userId));
    const [role] = await tx.select().from(roles).where(eq(roles.name, newRole)).limit(1);
    if (role) await tx.insert(userRoles).values({ userId, roleId: role.id, assignedById: actor.id });
  });

  await revokeAllSessionsForUser(userId);

  await recordAudit({
    action: AUDIT.ROLE_CHANGED, entityType: 'user', entityId: userId, actor,
    metadata: { from: previous, to: newRole, sessionsRevoked: true },
  });

  return { id: userId, previousRole: previous, role: newRole };
}

export async function setStaffActive(actor: AuthUser, userId: string, isActive: boolean) {
  const [target] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  if (!target) throw new AppError('USER_NOT_FOUND', 'Staff member could not be found.');
  if (target.id === actor.id) throw new AppError('FORBIDDEN', 'You cannot deactivate your own account.');
  if (target.primaryRole === 'SUPER_ADMIN' && actor.role !== 'SUPER_ADMIN') {
    throw new AppError('FORBIDDEN', 'Only a system administrator can change a system administrator account.');
  }

  await db.update(users).set({ isActive, updatedAt: new Date() }).where(eq(users.id, userId));
  if (!isActive) await revokeAllSessionsForUser(userId);

  await recordAudit({
    action: isActive ? AUDIT.USER_ACTIVATED : AUDIT.USER_DEACTIVATED,
    entityType: 'user', entityId: userId, actor,
  });

  return { id: userId, isActive };
}

export async function resetStaffPassword(actor: AuthUser, userId: string, newPassword: string) {
  const issues = passwordIssues(newPassword);
  if (issues.length) throw new AppError('VALIDATION_ERROR', `The password ${issues.join(', ')}.`);

  const [target] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  if (!target) throw new AppError('USER_NOT_FOUND', 'Staff member could not be found.');

  await db.update(users)
    .set({ passwordHash: await hashPassword(newPassword), mustReset: true, failedLogins: 0, lockedUntil: null, updatedAt: new Date() })
    .where(eq(users.id, userId));
  await revokeAllSessionsForUser(userId);

  await recordAudit({ action: AUDIT.PASSWORD_RESET, entityType: 'user', entityId: userId, actor, metadata: { byAdmin: true } });
  return { id: userId };
}

export async function listAuditLogs(params: {
  patientId?: string; userId?: string; action?: string; entityType?: string;
  limit?: number; cursor?: string | null;
} = {}) {
  const limit = Math.min(params.limit ?? 50, 200);
  const conditions: SQL[] = [];
  if (params.patientId) conditions.push(eq(auditLogs.patientId, params.patientId));
  if (params.userId) conditions.push(eq(auditLogs.userId, params.userId));
  if (params.action) conditions.push(eq(auditLogs.action, params.action));
  if (params.entityType) conditions.push(eq(auditLogs.entityType, params.entityType));
  if (params.cursor) conditions.push(sql`${auditLogs.createdAt} < ${new Date(params.cursor)}`);

  const rows = await db
    .select({
      id: auditLogs.id,
      action: auditLogs.action,
      entityType: auditLogs.entityType,
      entityId: auditLogs.entityId,
      outcome: auditLogs.outcome,
      metadata: auditLogs.metadata,
      ipAddress: auditLogs.ipAddress,
      createdAt: auditLogs.createdAt,
      actorEmail: auditLogs.actorEmail,
      actorRole: auditLogs.actorRole,
      actorName: users.fullName,
      patientId: patients.id,
      patientName: sql<string | null>`${patients.firstName} || ' ' || ${patients.lastName}`,
      patientNumber: patients.patientNumber,
    })
    .from(auditLogs)
    .leftJoin(users, eq(users.id, auditLogs.userId))
    .leftJoin(patients, eq(patients.id, auditLogs.patientId))
    .where(conditions.length ? and(...conditions) : undefined)
    .orderBy(desc(auditLogs.createdAt))
    .limit(limit + 1);

  const hasMore = rows.length > limit;
  const items = hasMore ? rows.slice(0, limit) : rows;
  return { items, nextCursor: hasMore ? items[items.length - 1]!.createdAt.toISOString() : null };
}

export async function listRolesWithCounts() {
  return db
    .select({
      id: roles.id,
      name: roles.name,
      label: roles.label,
      description: roles.description,
      userCount: sql<number>`(SELECT count(*)::int FROM ${users} u WHERE u.primary_role = roles.name)`,
    })
    .from(roles)
    .orderBy(roles.name);
}

export async function getStaffById(userId: string) {
  const rows = await listStaff({});
  return rows.find((r) => r.id === userId) ?? null;
}

export async function listDoctors() {
  return db
    .select({
      id: users.id,
      fullName: users.fullName,
      role: users.primaryRole,
      designation: staffProfiles.designation,
      specialization: staffProfiles.specialization,
      departmentId: departments.id,
      departmentName: departments.name,
    })
    .from(users)
    .innerJoin(staffProfiles, eq(staffProfiles.userId, users.id))
    .leftJoin(departments, eq(departments.id, staffProfiles.departmentId))
    .where(and(eq(users.isActive, true), inArray(users.primaryRole, ['SENIOR_DOCTOR', 'JUNIOR_DOCTOR'])))
    .orderBy(users.fullName)
    .limit(MAX_REFERENCE_ROWS);
}
