import '@/server/only';
import { and, count, desc, eq, isNull, sql } from 'drizzle-orm';
import { db } from '@/server/db/client';
import { users, staffProfiles, departments } from '@/server/db/schema';
import { AppError } from '@/server/core/errors';
import { hashPassword, passwordIssues } from '@/server/auth/password';
import { issueToken, consumeToken, peekToken } from '@/server/auth/tokens';
import { revokeAllSessionsForUser } from '@/server/auth/session';
import { recordAudit, AUDIT } from '@/server/core/audit';
import { sendQuietly } from '@/server/mail';
import { nextStaffNumber } from '@/server/services/identifier.service';
import { getEnv } from '@/lib/env';
import { ROLES, type Role } from '@/types/rbac';
import type { AuthUser } from '@/server/auth/context';

/**
 * Account creation for a real hospital deployment.
 *
 * The governing rule is that **registration is self-service but privilege is
 * not**. Anyone can ask for an account; nobody grants themselves a role. A
 * registration writes `requested_role`, which is a statement of intent and
 * carries no authority. The account's actual `primary_role` — the one the
 * permission system reads — is only ever written by an administrator during
 * approval, or by redeeming an invitation that an administrator created.
 *
 * That separation is what makes the public form safe to expose. A registrant
 * who tampers with the payload changes what they are asking for, not what they
 * are.
 */

const APP_NAME = 'CareSync Hospital';

function appOrigin(): string {
  const env = getEnv();
  return (env.APP_ORIGIN || env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000').replace(/\/$/, '');
}

/** Roles a person may ask for. Neither SUPER_ADMIN nor HOSPITAL_ADMIN is here. */
/**
 * The role a registration holds until an administrator grants a real one.
 *
 * Named once so the row that is written and the audit row that describes it
 * cannot drift apart. It is the least-privileged role in the system, and the
 * account is inactive besides — the role is a placeholder, not a grant.
 */
const UNAPPROVED_ROLE = 'NURSE' as const satisfies Role;

export const REQUESTABLE_ROLES: Role[] = ROLES.filter(
  (r) => r !== 'SUPER_ADMIN' && r !== 'HOSPITAL_ADMIN',
);

/* ------------------------------------------------------------ registration */

export type RegistrationInput = {
  email: string;
  fullName: string;
  password: string;
  phone?: string | null;
  requestedRole: Role;
  requestedDepartmentId?: string | null;
  registrationNote?: string | null;
};

export async function register(
  input: RegistrationInput,
  context: { ipAddress?: string | null; userAgent?: string | null } = {},
): Promise<{ status: 'PENDING_VERIFICATION'; email: string }> {
  const email = input.email.trim().toLowerCase();

  const issues = passwordIssues(input.password);
  if (issues.length) {
    throw new AppError('VALIDATION_ERROR', `Password ${issues.join(', ')}.`, [
      { field: 'password', message: `Password ${issues.join(', ')}.` },
    ]);
  }

  // An administrator role can never be self-requested, whatever the client sent.
  if (!REQUESTABLE_ROLES.includes(input.requestedRole)) {
    await recordAudit({
      action: AUDIT.REGISTRATION_REJECTED, entityType: 'user', outcome: 'DENIED',
      metadata: { email, attemptedRole: input.requestedRole, reason: 'PRIVILEGED_ROLE_REQUESTED' },
      ipAddress: context.ipAddress, userAgent: context.userAgent,
    });
    throw new AppError(
      'FORBIDDEN',
      'Administrator accounts cannot be self-registered. Ask an existing administrator for an invitation.',
    );
  }

  const [existing] = await db
    .select({ id: users.id, status: users.status })
    .from(users)
    .where(eq(users.email, email))
    .limit(1);

  // Registration must not become an account-enumeration oracle: the response is
  // identical whether or not the address is already known. A person who really
  // owns the address gets a "you already have an account" email instead.
  if (existing) {
    await sendQuietly({
      to: email,
      subject: `${APP_NAME}: an account already exists for this address`,
      text:
        `Someone (possibly you) tried to register a ${APP_NAME} account with this email address.\n\n`
        + `An account already exists. If that was you, sign in instead:\n`
        + `${appOrigin()}/login\n\n`
        + `If you have forgotten your password, request a reset from the sign-in page.\n\n`
        + `If this was not you, no action is required — no new account was created.`,
    });
    await recordAudit({
      action: AUDIT.REGISTRATION_DUPLICATE, entityType: 'user', entityId: existing.id,
      outcome: 'DENIED', metadata: { email },
      ipAddress: context.ipAddress, userAgent: context.userAgent,
    });
    return { status: 'PENDING_VERIFICATION', email };
  }

  const passwordHash = await hashPassword(input.password);

  const created = await db.transaction(async (tx) => {
    const [row] = await tx
      .insert(users)
      .values({
        email,
        passwordHash,
        fullName: input.fullName.trim(),
        phone: input.phone?.trim() || null,
        // The permission system reads `primaryRole`. Until an administrator
        // approves this account it holds the least-privileged role available,
        // and `status` keeps it from signing in regardless.
        primaryRole: UNAPPROVED_ROLE,
        requestedRole: input.requestedRole,
        requestedDepartmentId: input.requestedDepartmentId || null,
        registrationNote: input.registrationNote?.trim() || null,
        status: 'PENDING_VERIFICATION',
        isActive: false,
        passwordChangedAt: new Date(),
      })
      .returning({ id: users.id, email: users.email, fullName: users.fullName });
    return row!;
  });

  const { token } = await issueToken({
    email,
    purpose: 'EMAIL_VERIFICATION',
    userId: created.id,
    ipAddress: context.ipAddress,
  });

  await sendQuietly({
    to: email,
    subject: `${APP_NAME}: confirm your email address`,
    text:
      `Hello ${created.fullName},\n\n`
      + `Confirm this address to continue your ${APP_NAME} registration:\n\n`
      + `${appOrigin()}/verify-email?token=${token}\n\n`
      + `The link expires in 24 hours.\n\n`
      + `After confirming, an administrator reviews your request and assigns your role `
      + `and department. You will be emailed once that is done — you cannot sign in until then.\n\n`
      + `If you did not request an account, ignore this message.`,
  });

  await recordAudit({
    action: AUDIT.REGISTRATION_SUBMITTED, entityType: 'user', entityId: created.id,
    // Nobody administrative acted here, but the applicant did, and an audit row
    // that reads "system submitted a registration" answers nothing. The role
    // recorded is the inert placeholder every registration starts with — no
    // role has been granted at this point, which is the whole point.
    actor: { id: created.id, email, role: UNAPPROVED_ROLE },
    outcome: 'SUCCESS',
    metadata: { email, requestedRole: input.requestedRole },
    ipAddress: context.ipAddress, userAgent: context.userAgent,
  });

  return { status: 'PENDING_VERIFICATION', email };
}

/* ------------------------------------------------------ email verification */

export async function verifyEmail(
  token: string,
  context: { ipAddress?: string | null } = {},
): Promise<{ email: string; status: 'PENDING_APPROVAL' | 'ACTIVE' }> {
  const resolved = await consumeToken(token, 'EMAIL_VERIFICATION');
  if (!resolved || !resolved.userId) {
    throw new AppError('NOT_FOUND', 'This confirmation link is invalid or has expired.');
  }

  const [user] = await db
    .select({ id: users.id, email: users.email, status: users.status, fullName: users.fullName })
    .from(users)
    .where(eq(users.id, resolved.userId))
    .limit(1);

  if (!user) throw new AppError('USER_NOT_FOUND', 'The account no longer exists.');

  // An invited member is already approved — verifying their address activates
  // them. A self-registrant still has to wait for a human.
  const nextStatus = user.status === 'PENDING_VERIFICATION' ? 'PENDING_APPROVAL' : user.status;

  await db
    .update(users)
    .set({
      emailVerifiedAt: new Date(),
      status: nextStatus,
      updatedAt: new Date(),
    })
    .where(eq(users.id, user.id));

  await recordAudit({
    action: AUDIT.EMAIL_VERIFIED, entityType: 'user', entityId: user.id,
    outcome: 'SUCCESS', metadata: { email: user.email },
    ipAddress: context.ipAddress,
  });

  return { email: user.email, status: nextStatus === 'ACTIVE' ? 'ACTIVE' : 'PENDING_APPROVAL' };
}

export async function resendVerification(email: string, ipAddress?: string | null): Promise<void> {
  const address = email.trim().toLowerCase();
  const [user] = await db
    .select({ id: users.id, fullName: users.fullName, status: users.status })
    .from(users)
    .where(and(eq(users.email, address), isNull(users.emailVerifiedAt)))
    .limit(1);

  // Silent when there is nothing to send: the caller gets the same response
  // either way, so this cannot be used to test whether an address is registered.
  if (!user) return;

  const { token } = await issueToken({
    email: address, purpose: 'EMAIL_VERIFICATION', userId: user.id, ipAddress,
  });

  await sendQuietly({
    to: address,
    subject: `${APP_NAME}: confirm your email address`,
    text:
      `Hello ${user.fullName},\n\n`
      + `Here is a fresh confirmation link. It expires in 24 hours and replaces any earlier one:\n\n`
      + `${appOrigin()}/verify-email?token=${token}\n`,
  });
}

/* ---------------------------------------------------------------- approval */

export type PendingAccount = {
  id: string;
  email: string;
  fullName: string;
  phone: string | null;
  requestedRole: Role | null;
  requestedDepartmentId: string | null;
  requestedDepartmentName: string | null;
  registrationNote: string | null;
  emailVerifiedAt: Date | null;
  status: string;
  createdAt: Date;
};

export async function listPendingAccounts(options: { limit?: number; cursor?: string } = {}) {
  const limit = Math.min(Math.max(options.limit ?? 25, 1), 100);

  const rows = await db
    .select({
      id: users.id,
      email: users.email,
      fullName: users.fullName,
      phone: users.phone,
      requestedRole: users.requestedRole,
      requestedDepartmentId: users.requestedDepartmentId,
      requestedDepartmentName: departments.name,
      registrationNote: users.registrationNote,
      emailVerifiedAt: users.emailVerifiedAt,
      status: users.status,
      createdAt: users.createdAt,
    })
    .from(users)
    .leftJoin(departments, eq(departments.id, users.requestedDepartmentId))
    .where(and(
      sql`${users.status} IN ('PENDING_VERIFICATION', 'PENDING_APPROVAL')`,
      options.cursor ? sql`${users.createdAt} < ${new Date(options.cursor)}` : sql`true`,
    ))
    .orderBy(desc(users.createdAt))
    .limit(limit + 1);

  const items = rows.slice(0, limit) as PendingAccount[];
  const nextCursor = rows.length > limit ? items[items.length - 1]!.createdAt.toISOString() : null;

  const [{ total }] = await db
    .select({ total: count() })
    .from(users)
    .where(sql`${users.status} IN ('PENDING_VERIFICATION', 'PENDING_APPROVAL')`);

  return { items, nextCursor, total: Number(total) };
}

/**
 * Approve an account and grant it a role.
 *
 * This is the only place outside invitation redemption where `primary_role`
 * is written from a registration, and it takes the role from the *approver's*
 * input, never from what the applicant asked for.
 */
/**
 * Who performed an account-lifecycle action.
 *
 * The email and role are carried, not just the id, because `recordAudit` writes
 * `actor_email` and `actor_role` onto the row and a trail that reads
 * "ACCOUNT_REJECTED · system" cannot answer the only question anyone asks of
 * it: which administrator did this.
 */
type Approver = Pick<AuthUser, 'id' | 'email' | 'role'>;

export async function approveAccount(
  approver: Approver,
  input: {
    userId: string;
    role: Role;
    departmentId?: string | null;
    designation?: string | null;
    specialization?: string | null;
    registrationNumber?: string | null;
    acceptsReferrals?: boolean;
  },
  context: { ipAddress?: string | null; userAgent?: string | null } = {},
) {
  // Only a super administrator may mint another administrator. A hospital
  // administrator can staff the hospital but cannot create a peer or a superior.
  if ((input.role === 'SUPER_ADMIN' || input.role === 'HOSPITAL_ADMIN') && approver.role !== 'SUPER_ADMIN') {
    throw new AppError('FORBIDDEN', 'Only a system administrator can grant an administrator role.');
  }

  const [user] = await db
    .select({ id: users.id, email: users.email, fullName: users.fullName, status: users.status })
    .from(users)
    .where(eq(users.id, input.userId))
    .limit(1);

  if (!user) throw new AppError('USER_NOT_FOUND', 'That account does not exist.');
  if (user.status === 'ACTIVE') {
    throw new AppError('CONFLICT', 'That account is already active.');
  }

  await db.transaction(async (tx) => {
    await tx
      .update(users)
      .set({
        primaryRole: input.role,
        status: 'ACTIVE',
        isActive: true,
        approvedById: approver.id,
        approvedAt: new Date(),
        rejectionReason: null,
        updatedAt: new Date(),
      })
      .where(eq(users.id, user.id));

    const [profile] = await tx
      .select({ id: staffProfiles.id })
      .from(staffProfiles)
      .where(eq(staffProfiles.userId, user.id))
      .limit(1);

    if (profile) {
      await tx
        .update(staffProfiles)
        .set({
          departmentId: input.departmentId ?? null,
          designation: input.designation ?? 'Staff',
          specialization: input.specialization ?? null,
          registrationNumber: input.registrationNumber ?? null,
          acceptsReferrals: input.acceptsReferrals ?? false,
          updatedAt: new Date(),
        })
        .where(eq(staffProfiles.id, profile.id));
    } else {
      await tx.insert(staffProfiles).values({
        userId: user.id,
        staffNumber: await nextStaffNumber(),
        departmentId: input.departmentId ?? null,
        designation: input.designation ?? 'Staff',
        specialization: input.specialization ?? null,
        registrationNumber: input.registrationNumber ?? null,
        acceptsReferrals: input.acceptsReferrals ?? false,
      });
    }
  });

  await sendQuietly({
    to: user.email,
    subject: `${APP_NAME}: your account has been approved`,
    text:
      `Hello ${user.fullName},\n\n`
      + `Your ${APP_NAME} account has been approved. You can now sign in:\n\n`
      + `${appOrigin()}/login\n\n`
      + `Your role: ${input.role.replace(/_/g, ' ').toLowerCase()}.\n`,
  });

  await recordAudit({
    action: AUDIT.ACCOUNT_APPROVED, actor: approver, entityType: 'user', entityId: user.id,
    outcome: 'SUCCESS',
    metadata: { email: user.email, grantedRole: input.role, departmentId: input.departmentId ?? null },
    ipAddress: context.ipAddress, userAgent: context.userAgent,
  });

  return { id: user.id, email: user.email, role: input.role };
}

export async function rejectAccount(
  approver: Approver,
  input: { userId: string; reason: string },
  context: { ipAddress?: string | null; userAgent?: string | null } = {},
) {
  const [user] = await db
    .select({ id: users.id, email: users.email, fullName: users.fullName, status: users.status })
    .from(users)
    .where(eq(users.id, input.userId))
    .limit(1);

  if (!user) throw new AppError('USER_NOT_FOUND', 'That account does not exist.');
  if (user.status === 'ACTIVE') {
    throw new AppError('CONFLICT', 'That account is active. Deactivate it instead of rejecting it.');
  }

  await db
    .update(users)
    .set({
      status: 'REJECTED',
      isActive: false,
      rejectionReason: input.reason,
      approvedById: approver.id,
      approvedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(users.id, user.id));

  await revokeAllSessionsForUser(user.id);

  await sendQuietly({
    to: user.email,
    subject: `${APP_NAME}: your account request was not approved`,
    text:
      `Hello ${user.fullName},\n\n`
      + `Your request for a ${APP_NAME} account was not approved.\n\n`
      + `Reason: ${input.reason}\n\n`
      + `If you believe this is a mistake, contact your hospital administrator.`,
  });

  await recordAudit({
    action: AUDIT.ACCOUNT_REJECTED, actor: approver, entityType: 'user', entityId: user.id,
    outcome: 'SUCCESS', metadata: { email: user.email, reason: input.reason },
    ipAddress: context.ipAddress, userAgent: context.userAgent,
  });

  return { id: user.id };
}

/* ------------------------------------------------------------- invitations */

export async function inviteStaff(
  inviter: { id: string; role: Role; fullName: string },
  input: { email: string; role: Role; departmentId?: string | null },
  context: { ipAddress?: string | null; userAgent?: string | null } = {},
) {
  const email = input.email.trim().toLowerCase();

  if ((input.role === 'SUPER_ADMIN' || input.role === 'HOSPITAL_ADMIN') && inviter.role !== 'SUPER_ADMIN') {
    throw new AppError('FORBIDDEN', 'Only a system administrator can invite an administrator.');
  }

  const [existing] = await db.select({ id: users.id }).from(users).where(eq(users.email, email)).limit(1);
  if (existing) {
    throw new AppError('DUPLICATE_RESOURCE', 'An account already exists for that address.');
  }

  const { token, expiresAt } = await issueToken({
    email,
    purpose: 'STAFF_INVITATION',
    invitedRole: input.role,
    invitedDepartmentId: input.departmentId ?? null,
    createdById: inviter.id,
    ipAddress: context.ipAddress,
  });

  await sendQuietly({
    to: email,
    subject: `${APP_NAME}: you have been invited to join`,
    text:
      `${inviter.fullName} has invited you to join ${APP_NAME} as `
      + `${input.role.replace(/_/g, ' ').toLowerCase()}.\n\n`
      + `Set your password and activate your account:\n\n`
      + `${appOrigin()}/accept-invitation?token=${token}\n\n`
      + `This invitation expires on ${expiresAt.toDateString()}.\n\n`
      + `If you were not expecting this, ignore it — no account exists until you use the link.`,
  });

  await recordAudit({
    action: AUDIT.INVITATION_SENT, userId: inviter.id, entityType: 'user', outcome: 'SUCCESS',
    metadata: { email, role: input.role, departmentId: input.departmentId ?? null },
    ipAddress: context.ipAddress, userAgent: context.userAgent,
  });

  return { email, expiresAt };
}

/** Read an invitation so the acceptance form can show who it is for. */
export async function describeInvitation(token: string) {
  const resolved = await peekToken(token, 'STAFF_INVITATION');
  if (!resolved) throw new AppError('NOT_FOUND', 'This invitation is invalid or has expired.');
  return {
    email: resolved.email,
    role: resolved.invitedRole,
    departmentId: resolved.invitedDepartmentId,
  };
}

/**
 * Redeem an invitation. The role comes from the token an administrator issued,
 * never from the request body, so the person accepting cannot upgrade themselves.
 */
export async function acceptInvitation(
  input: { token: string; fullName: string; password: string; phone?: string | null; designation?: string | null },
  context: { ipAddress?: string | null; userAgent?: string | null } = {},
) {
  const issues = passwordIssues(input.password);
  if (issues.length) {
    throw new AppError('VALIDATION_ERROR', `Password ${issues.join(', ')}.`, [
      { field: 'password', message: `Password ${issues.join(', ')}.` },
    ]);
  }

  const resolved = await consumeToken(input.token, 'STAFF_INVITATION');
  if (!resolved || !resolved.invitedRole) {
    throw new AppError('NOT_FOUND', 'This invitation is invalid or has expired.');
  }

  const [existing] = await db.select({ id: users.id }).from(users).where(eq(users.email, resolved.email)).limit(1);
  if (existing) throw new AppError('DUPLICATE_RESOURCE', 'An account already exists for that address.');

  const passwordHash = await hashPassword(input.password);

  const created = await db.transaction(async (tx) => {
    const [row] = await tx
      .insert(users)
      .values({
        email: resolved.email,
        passwordHash,
        fullName: input.fullName.trim(),
        phone: input.phone?.trim() || null,
        primaryRole: resolved.invitedRole!,
        status: 'ACTIVE',
        isActive: true,
        // The invitation was sent to this address; clicking the link in it is
        // itself proof of control, so a second verification round is theatre.
        emailVerifiedAt: new Date(),
        approvedById: resolved.createdById,
        approvedAt: new Date(),
        passwordChangedAt: new Date(),
      })
      .returning({ id: users.id, email: users.email });

    await tx.insert(staffProfiles).values({
      userId: row!.id,
      staffNumber: await nextStaffNumber(),
      departmentId: resolved.invitedDepartmentId,
      designation: input.designation?.trim() || 'Staff',
      acceptsReferrals: resolved.invitedRole === 'SENIOR_DOCTOR',
    });

    return row!;
  });

  await recordAudit({
    action: AUDIT.INVITATION_ACCEPTED, userId: created.id, entityType: 'user', entityId: created.id,
    outcome: 'SUCCESS', metadata: { email: created.email, role: resolved.invitedRole },
    ipAddress: context.ipAddress, userAgent: context.userAgent,
  });

  return { id: created.id, email: created.email, role: resolved.invitedRole };
}

/* --------------------------------------------------------- first-run setup */

/**
 * Create the first administrator of an empty deployment.
 *
 * A production database starts with no users, which leaves nobody able to
 * approve anybody — so there has to be exactly one way in. This is it, and it
 * is deliberately narrow: it requires a secret only the operator holds, and it
 * refuses to run the moment any administrator exists. It cannot be used to add
 * a second back door later.
 */
export async function bootstrapFirstAdmin(
  input: { token: string; email: string; fullName: string; password: string },
  context: { ipAddress?: string | null; userAgent?: string | null } = {},
) {
  const env = getEnv();
  if (!env.BOOTSTRAP_TOKEN) {
    throw new AppError('FORBIDDEN', 'Bootstrap is not enabled on this deployment.');
  }

  const [{ admins }] = await db
    .select({ admins: count() })
    .from(users)
    .where(sql`${users.primaryRole} IN ('SUPER_ADMIN', 'HOSPITAL_ADMIN') AND ${users.isActive}`);

  if (Number(admins) > 0) {
    await recordAudit({
      action: AUDIT.BOOTSTRAP_REFUSED, entityType: 'user', outcome: 'DENIED',
      metadata: { reason: 'ADMIN_ALREADY_EXISTS' },
      ipAddress: context.ipAddress, userAgent: context.userAgent,
    });
    throw new AppError('CONFLICT', 'This deployment already has an administrator.');
  }

  // Compared in constant time; a wrong token is indistinguishable from a
  // disabled bootstrap as far as timing goes.
  const provided = Buffer.from(input.token, 'utf8');
  const expected = Buffer.from(env.BOOTSTRAP_TOKEN, 'utf8');
  const ok = provided.length === expected.length
    && (await import('node:crypto')).timingSafeEqual(provided, expected);

  if (!ok) {
    await recordAudit({
      action: AUDIT.BOOTSTRAP_REFUSED, entityType: 'user', outcome: 'DENIED',
      metadata: { reason: 'BAD_TOKEN' },
      ipAddress: context.ipAddress, userAgent: context.userAgent,
    });
    throw new AppError('FORBIDDEN', 'Invalid bootstrap token.');
  }

  const issues = passwordIssues(input.password);
  if (issues.length) {
    throw new AppError('VALIDATION_ERROR', `Password ${issues.join(', ')}.`);
  }

  const email = input.email.trim().toLowerCase();
  const passwordHash = await hashPassword(input.password);

  const created = await db.transaction(async (tx) => {
    const [row] = await tx
      .insert(users)
      .values({
        email,
        passwordHash,
        fullName: input.fullName.trim(),
        primaryRole: 'SUPER_ADMIN',
        status: 'ACTIVE',
        isActive: true,
        emailVerifiedAt: new Date(),
        approvedAt: new Date(),
        passwordChangedAt: new Date(),
      })
      .returning({ id: users.id, email: users.email });

    await tx.insert(staffProfiles).values({
      userId: row!.id,
      staffNumber: await nextStaffNumber(),
      designation: 'System Administrator',
    });

    return row!;
  });

  await recordAudit({
    action: AUDIT.BOOTSTRAP_COMPLETED, userId: created.id, entityType: 'user', entityId: created.id,
    outcome: 'SUCCESS', metadata: { email: created.email },
    ipAddress: context.ipAddress, userAgent: context.userAgent,
  });

  return { id: created.id, email: created.email, role: 'SUPER_ADMIN' as const };
}
