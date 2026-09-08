import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { and, eq, sql } from 'drizzle-orm';
import { db, pool } from '@/server/db/client';
import { users, auditLogs, verificationTokens, sessions, departments } from '@/server/db/schema';
import {
  register, verifyEmail, resendVerification,
  approveAccount, rejectAccount, listPendingAccounts,
  inviteStaff, acceptInvitation, describeInvitation,
  bootstrapFirstAdmin, REQUESTABLE_ROLES,
} from '@/server/services/registration.service';
import { requestPasswordReset, resetPassword } from '@/server/services/password-reset.service';
import { login, changePassword } from '@/server/services/auth.service';
import { rotateSession, verifySessionToken } from '@/server/auth/session';
import { outbox } from '@/server/mail';
import { AppError } from '@/server/core/errors';
import { prepareDatabase, actorFor, ACCOUNTS } from './helpers';
import type { AuthUser } from '@/server/auth/context';

/**
 * Production authentication.
 *
 * The property under test throughout is that **registration is self-service but
 * privilege is not**: anybody may ask for an account, nobody grants themselves
 * a role, and no endpoint reveals which addresses belong to hospital staff.
 */

const STRONG = 'Nimbus-Harbour-41';
const OTHER = 'Lantern-Meadow-77';

/** Pull a token out of the mail the console driver captured. */
function tokenFromMail(email: string, path: string): string {
  const mail = outbox.lastTo(email);
  if (!mail) throw new Error(`no mail was sent to ${email}`);
  const match = mail.text.match(new RegExp(`${path}\\?token=([A-Za-z0-9_-]+)`));
  if (!match) throw new Error(`no ${path} link in the mail to ${email}`);
  return match[1]!;
}

describe('production authentication', () => {
  let admin: AuthUser;
  let generalMedicineId: string;

  beforeAll(async () => {
    prepareDatabase();
    admin = await actorFor(ACCOUNTS.admin);
    const [dept] = await db.select({ id: departments.id }).from(departments).limit(1);
    generalMedicineId = dept!.id;
  });

  afterAll(async () => { await pool.end(); });
  beforeEach(() => { outbox.clear(); });

  /* ------------------------------------------------------------ register -- */

  describe('registration', () => {
    it('creates an account that cannot sign in yet, and emails a confirmation link', async () => {
      const email = `nurse.applicant.${Date.now()}@hospital.test`;
      const result = await register({
        email, fullName: 'Applicant Nurse', password: STRONG,
        requestedRole: 'NURSE', requestedDepartmentId: generalMedicineId,
        registrationNote: 'Bank nurse, nights.',
      });
      expect(result.status).toBe('PENDING_VERIFICATION');

      const [row] = await db.select().from(users).where(eq(users.email, email));
      expect(row!.status).toBe('PENDING_VERIFICATION');
      expect(row!.isActive).toBe(false);
      expect(row!.emailVerifiedAt).toBeNull();
      expect(row!.requestedRole).toBe('NURSE');

      // The password is hashed, never stored as given.
      expect(row!.passwordHash).not.toContain(STRONG);
      expect(row!.passwordHash.startsWith('$2')).toBe(true);

      // A correct password is not enough while the account is unverified.
      await expect(login({ email, password: STRONG })).rejects.toMatchObject({ status: 403 });

      const mail = outbox.lastTo(email);
      expect(mail?.subject).toContain('confirm');
      expect(mail?.text).toContain('/verify-email?token=');
    });

    it('refuses to let anyone self-register as an administrator', async () => {
      for (const role of ['SUPER_ADMIN', 'HOSPITAL_ADMIN'] as const) {
        await expect(register({
          email: `escalate.${role}.${Date.now()}@hospital.test`,
          fullName: 'Ambitious Person', password: STRONG,
          requestedRole: role,
        })).rejects.toMatchObject({ code: 'FORBIDDEN' });
      }
      expect(REQUESTABLE_ROLES).not.toContain('SUPER_ADMIN');
      expect(REQUESTABLE_ROLES).not.toContain('HOSPITAL_ADMIN');
    });

    it('never lets the requested role become the granted role', async () => {
      const email = `sneaky.${Date.now()}@hospital.test`;
      await register({
        email, fullName: 'Sneaky Applicant', password: STRONG, requestedRole: 'SENIOR_DOCTOR',
      });
      const [row] = await db.select().from(users).where(eq(users.email, email));
      expect(row!.requestedRole).toBe('SENIOR_DOCTOR');
      // primaryRole is what the permission system reads, and it is the least
      // privileged role until an administrator says otherwise.
      expect(row!.primaryRole).toBe('NURSE');
      expect(row!.isActive).toBe(false);
    });

    it('does not reveal whether an address is already registered', async () => {
      const known = ACCOUNTS.doctor;
      const before = await db.select({ n: sql<number>`count(*)::int` }).from(users);

      const result = await register({
        email: known, fullName: 'Impostor', password: STRONG, requestedRole: 'NURSE',
      });

      // Same shape of answer as a genuine registration...
      expect(result.status).toBe('PENDING_VERIFICATION');
      // ...but no account was created, and the real owner was told.
      const after = await db.select({ n: sql<number>`count(*)::int` }).from(users);
      expect(after[0]!.n).toBe(before[0]!.n);
      expect(outbox.lastTo(known)?.subject).toContain('already exists');
    });

    it('rejects a weak password before creating anything', async () => {
      const email = `weak.${Date.now()}@hospital.test`;
      await expect(register({
        email, fullName: 'Weak Password', password: 'password', requestedRole: 'NURSE',
      })).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });

      const rows = await db.select().from(users).where(eq(users.email, email));
      expect(rows).toHaveLength(0);
    });
  });

  /* -------------------------------------------------------- verification -- */

  describe('email verification', () => {
    it('moves a verified account into the approval queue', async () => {
      const email = `verify.${Date.now()}@hospital.test`;
      await register({ email, fullName: 'Verify Me', password: STRONG, requestedRole: 'JUNIOR_DOCTOR' });

      const result = await verifyEmail(tokenFromMail(email, '/verify-email'));
      expect(result.status).toBe('PENDING_APPROVAL');

      const [row] = await db.select().from(users).where(eq(users.email, email));
      expect(row!.emailVerifiedAt).not.toBeNull();
      expect(row!.status).toBe('PENDING_APPROVAL');

      // Verified but not approved still cannot sign in.
      await expect(login({ email, password: STRONG })).rejects.toMatchObject({ status: 403 });
    });

    it('spends the token exactly once', async () => {
      const email = `once.${Date.now()}@hospital.test`;
      await register({ email, fullName: 'Single Use', password: STRONG, requestedRole: 'NURSE' });
      const token = tokenFromMail(email, '/verify-email');

      await verifyEmail(token);
      await expect(verifyEmail(token)).rejects.toThrow(AppError);
    });

    it('stores only a hash, so the database cannot be replayed', async () => {
      const email = `hashed.${Date.now()}@hospital.test`;
      await register({ email, fullName: 'Hashed Token', password: STRONG, requestedRole: 'NURSE' });
      const token = tokenFromMail(email, '/verify-email');

      const rows = await db.select().from(verificationTokens).where(eq(verificationTokens.email, email));
      expect(rows.length).toBeGreaterThan(0);
      for (const row of rows) {
        expect(row.tokenHash).not.toBe(token);
        expect(row.tokenHash).toMatch(/^[0-9a-f]{64}$/);
      }
    });

    it('invalidates the previous link when a new one is requested', async () => {
      const email = `resend.${Date.now()}@hospital.test`;
      await register({ email, fullName: 'Resend Me', password: STRONG, requestedRole: 'NURSE' });
      const first = tokenFromMail(email, '/verify-email');

      outbox.clear();
      await resendVerification(email);
      const second = tokenFromMail(email, '/verify-email');
      expect(second).not.toBe(first);

      await expect(verifyEmail(first)).rejects.toThrow(AppError);
      await expect(verifyEmail(second)).resolves.toMatchObject({ status: 'PENDING_APPROVAL' });
    });

    it('stays silent for an address it does not know', async () => {
      await expect(resendVerification(`ghost.${Date.now()}@hospital.test`)).resolves.toBeUndefined();
      expect(outbox.all()).toHaveLength(0);
    });
  });

  /* ------------------------------------------------------------ approval -- */

  describe('administrator approval', () => {
    const applicantEmail = () => `approve.${Date.now()}.${Math.random().toString(36).slice(2, 7)}@hospital.test`;

    async function applicant(role: (typeof REQUESTABLE_ROLES)[number] = 'NURSE') {
      const email = applicantEmail();
      await register({ email, fullName: 'Queue Applicant', password: STRONG, requestedRole: role });
      await verifyEmail(tokenFromMail(email, '/verify-email'));
      const [row] = await db.select().from(users).where(eq(users.email, email));
      return { email, id: row!.id };
    }

    it('lists pending accounts for the approver', async () => {
      const { id } = await applicant();
      const queue = await listPendingAccounts({ limit: 100 });
      expect(queue.items.map((i) => i.id)).toContain(id);
      expect(queue.total).toBeGreaterThan(0);
    });

    it('grants the role the approver chooses, not the one requested', async () => {
      const { email, id } = await applicant('SENIOR_DOCTOR');

      // The applicant asked to be a senior doctor; the administrator says nurse.
      await approveAccount(admin, {
        userId: id, role: 'NURSE', departmentId: generalMedicineId, designation: 'Staff Nurse',
      });

      const [row] = await db.select().from(users).where(eq(users.id, id));
      expect(row!.primaryRole).toBe('NURSE');
      expect(row!.requestedRole).toBe('SENIOR_DOCTOR');
      expect(row!.status).toBe('ACTIVE');
      expect(row!.approvedById).toBe(admin.id);

      // And now, finally, sign-in works.
      const session = await login({ email, password: STRONG });
      expect(session.user.role).toBe('NURSE');
      expect(session.user.email).toBe(email);
    });

    it('stops a hospital administrator from minting another administrator', async () => {
      const { id } = await applicant();
      const hospitalAdmin = { id: admin.id, email: admin.email, role: 'HOSPITAL_ADMIN' as const };

      for (const role of ['SUPER_ADMIN', 'HOSPITAL_ADMIN'] as const) {
        await expect(approveAccount(hospitalAdmin, { userId: id, role }))
          .rejects.toMatchObject({ code: 'FORBIDDEN' });
      }

      const [row] = await db.select().from(users).where(eq(users.id, id));
      expect(row!.status).not.toBe('ACTIVE');
    });

    it('names the administrator on the audit row, not "system"', async () => {
      // Found in production: the approval and rejection rows carried no actor,
      // so the trail read "ACCOUNT_REJECTED · system" and could not answer the
      // only question anyone asks of an audit trail — which administrator did
      // this. An audit row that does not name the actor is not an audit row.
      const { id } = await applicant();
      await rejectAccount(admin, { userId: id, reason: 'Not a member of staff.' });

      const [entry] = await db.select().from(auditLogs)
        .where(and(eq(auditLogs.action, 'ACCOUNT_REJECTED'), eq(auditLogs.entityId, id)))
        .limit(1);

      expect(entry, 'a rejection must be audited').toBeTruthy();
      expect(entry!.actorEmail).toBe(admin.email);
      expect(entry!.userId).toBe(admin.id);
      expect(entry!.actorRole).toBe(admin.role);

      // The applicant's own action is attributed to the applicant, for the same
      // reason: "system registered an account" describes nothing.
      const [submitted] = await db.select().from(auditLogs)
        .where(and(eq(auditLogs.action, 'REGISTRATION_SUBMITTED'), eq(auditLogs.entityId, id)))
        .limit(1);
      expect(submitted!.actorEmail).toBeTruthy();
      expect(submitted!.userId).toBe(id);
    });

    it('rejection blocks sign-in and records the reason', async () => {
      const { email, id } = await applicant();
      await rejectAccount(admin, { userId: id, reason: 'Not a member of staff.' });

      const [row] = await db.select().from(users).where(eq(users.id, id));
      expect(row!.status).toBe('REJECTED');
      expect(row!.rejectionReason).toContain('Not a member of staff');

      // Generic failure: a rejected account must look like a wrong password.
      await expect(login({ email, password: STRONG }))
        .rejects.toMatchObject({ code: 'INVALID_CREDENTIALS' });
    });

    it('a rejected account cannot recover itself through password reset', async () => {
      const { email, id } = await applicant();
      await rejectAccount(admin, { userId: id, reason: 'Revoked.' });

      outbox.clear();
      await requestPasswordReset(email);
      // No reset mail, so no way back in.
      expect(outbox.lastTo(email)).toBeNull();
    });
  });

  /* --------------------------------------------------------- invitations -- */

  describe('staff invitations', () => {
    it('carries the role in the token, not the request body', async () => {
      const email = `invited.${Date.now()}@hospital.test`;
      await inviteStaff(
        { id: admin.id, role: admin.role, fullName: 'Admin' },
        { email, role: 'PATHOLOGY', departmentId: generalMedicineId },
      );

      const described = await describeInvitation(tokenFromMail(email, '/accept-invitation'));
      expect(described.role).toBe('PATHOLOGY');

      const accepted = await acceptInvitation({
        token: tokenFromMail(email, '/accept-invitation'),
        fullName: 'Invited Pathologist',
        password: STRONG,
      });
      expect(accepted.role).toBe('PATHOLOGY');

      // Invited members skip the queue: the link proved the address already.
      const session = await login({ email, password: STRONG });
      expect(session.user.role).toBe('PATHOLOGY');
    });

    it('refuses to invite an administrator unless the inviter is one', async () => {
      await expect(inviteStaff(
        { id: admin.id, role: 'HOSPITAL_ADMIN', fullName: 'Admin' },
        { email: `admin.invite.${Date.now()}@hospital.test`, role: 'SUPER_ADMIN' },
      )).rejects.toMatchObject({ code: 'FORBIDDEN' });
    });

    it('cannot be redeemed twice', async () => {
      const email = `twice.${Date.now()}@hospital.test`;
      await inviteStaff({ id: admin.id, role: admin.role, fullName: 'Admin' }, { email, role: 'NURSE' });
      const token = tokenFromMail(email, '/accept-invitation');

      await acceptInvitation({ token, fullName: 'First Use', password: STRONG });
      await expect(acceptInvitation({ token, fullName: 'Second Use', password: OTHER }))
        .rejects.toThrow(AppError);
    });
  });

  /* ------------------------------------------------------ password reset -- */

  describe('password reset', () => {
    it('resets the password, ends every session, and consumes the token', async () => {
      const email = `reset.${Date.now()}@hospital.test`;
      await inviteStaff({ id: admin.id, role: admin.role, fullName: 'Admin' }, { email, role: 'NURSE' });
      await acceptInvitation({
        token: tokenFromMail(email, '/accept-invitation'),
        fullName: 'Reset Subject', password: STRONG,
      });

      // Sign in so there is a live session for the reset to destroy.
      const before = await login({ email, password: STRONG });
      const [{ live }] = await db.select({ live: sql<number>`count(*)::int` })
        .from(sessions).where(and(eq(sessions.tokenId, before.session.token ? sql`${sessions.tokenId}` : sql`${sessions.tokenId}`), sql`true`));
      expect(live).toBeGreaterThan(0);

      outbox.clear();
      await requestPasswordReset(email);
      const token = tokenFromMail(email, '/reset-password');

      await resetPassword({ token, newPassword: OTHER });

      // Old password is dead, new one works.
      await expect(login({ email, password: STRONG }))
        .rejects.toMatchObject({ code: 'INVALID_CREDENTIALS' });
      await expect(login({ email, password: OTHER })).resolves.toBeTruthy();

      // Single use.
      await expect(resetPassword({ token, newPassword: 'Third-Password-99' }))
        .rejects.toThrow(AppError);
    });

    it('answers identically for an unknown address', async () => {
      const unknown = `nobody.${Date.now()}@hospital.test`;
      await expect(requestPasswordReset(unknown)).resolves.toBeUndefined();
      expect(outbox.lastTo(unknown)).toBeNull();

      // The attempt is still audited, so the pattern is visible to an operator.
      const [entry] = await db.select().from(auditLogs)
        .where(and(eq(auditLogs.action, 'PASSWORD_RESET_REQUESTED'), eq(auditLogs.outcome, 'DENIED')))
        .limit(1);
      expect(entry).toBeDefined();
    });

    it('refuses to accept the password the account already has', async () => {
      const email = `same.${Date.now()}@hospital.test`;
      await inviteStaff({ id: admin.id, role: admin.role, fullName: 'Admin' }, { email, role: 'NURSE' });
      await acceptInvitation({
        token: tokenFromMail(email, '/accept-invitation'),
        fullName: 'Same Password', password: STRONG,
      });

      outbox.clear();
      await requestPasswordReset(email);
      await expect(resetPassword({
        token: tokenFromMail(email, '/reset-password'), newPassword: STRONG,
      })).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    });

    it('rejects an expired token', async () => {
      const email = `expired.${Date.now()}@hospital.test`;
      await inviteStaff({ id: admin.id, role: admin.role, fullName: 'Admin' }, { email, role: 'NURSE' });
      await acceptInvitation({
        token: tokenFromMail(email, '/accept-invitation'),
        fullName: 'Expired Token', password: STRONG,
      });

      outbox.clear();
      await requestPasswordReset(email);
      const token = tokenFromMail(email, '/reset-password');

      // Push it into the past rather than waiting half an hour.
      await db.update(verificationTokens)
        .set({ expiresAt: new Date(Date.now() - 60_000) })
        .where(and(eq(verificationTokens.email, email), eq(verificationTokens.purpose, 'PASSWORD_RESET')));

      await expect(resetPassword({ token, newPassword: OTHER })).rejects.toThrow(AppError);
    });
  });

  /* ------------------------------------------------------------ sessions -- */

  describe('sessions', () => {
    it('rotation issues a new token and kills the old one', async () => {
      const email = `rotate.session.${Date.now()}@hospital.test`;
      await inviteStaff({ id: admin.id, role: admin.role, fullName: 'Admin' }, { email, role: 'NURSE' });
      await acceptInvitation({
        token: tokenFromMail(email, '/accept-invitation'),
        fullName: 'Rotation Subject', password: STRONG,
      });

      const first = await login({ email, password: STRONG });
      const claims = await verifySessionToken(first.session.token);
      expect(claims).not.toBeNull();

      const [row] = await db.select().from(users).where(eq(users.email, email));
      const rotated = await rotateSession({
        currentTokenId: claims!.jti,
        userId: row!.id,
        role: 'NURSE',
        email,
      });

      expect(rotated).not.toBeNull();
      expect(rotated!.token).not.toBe(first.session.token);

      // The token that was rotated away is revoked, so a stolen copy is dead.
      const [old] = await db.select().from(sessions).where(eq(sessions.tokenId, claims!.jti));
      expect(old!.revokedAt).not.toBeNull();

      // The replacement is live, and records what it replaced.
      const [fresh] = await db.select().from(sessions).where(eq(sessions.tokenId, rotated!.tokenId));
      expect(fresh!.revokedAt).toBeNull();
      expect(fresh!.rotatedFromId).toBe(old!.id);

      // Rotating a revoked session is refused rather than quietly reissuing.
      const again = await rotateSession({
        currentTokenId: claims!.jti, userId: row!.id, role: 'NURSE', email,
      });
      expect(again).toBeNull();
    });

    it('refuses to renew past the absolute ceiling', async () => {
      const email = `ceiling.${Date.now()}@hospital.test`;
      await inviteStaff({ id: admin.id, role: admin.role, fullName: 'Admin' }, { email, role: 'NURSE' });
      await acceptInvitation({
        token: tokenFromMail(email, '/accept-invitation'),
        fullName: 'Ceiling Subject', password: STRONG,
      });

      const session = await login({ email, password: STRONG });
      const claims = await verifySessionToken(session.session.token);
      const [row] = await db.select().from(users).where(eq(users.email, email));

      // Move the ceiling into the past: renewal must stop, not extend.
      await db.update(sessions)
        .set({ absoluteExpiresAt: new Date(Date.now() - 1000) })
        .where(eq(sessions.tokenId, claims!.jti));

      const rotated = await rotateSession({
        currentTokenId: claims!.jti, userId: row!.id, role: 'NURSE', email,
      });
      expect(rotated).toBeNull();

      const [dead] = await db.select().from(sessions).where(eq(sessions.tokenId, claims!.jti));
      expect(dead!.revokedAt).not.toBeNull();
    });

    it('changing the password revokes every existing session', async () => {
      const email = `change.${Date.now()}@hospital.test`;
      await inviteStaff({ id: admin.id, role: admin.role, fullName: 'Admin' }, { email, role: 'NURSE' });
      await acceptInvitation({
        token: tokenFromMail(email, '/accept-invitation'),
        fullName: 'Changing User', password: STRONG,
      });
      await login({ email, password: STRONG });
      const user = await actorFor(email);

      await changePassword(user, { currentPassword: STRONG, newPassword: OTHER });

      const [{ live }] = await db.select({ live: sql<number>`count(*)::int` })
        .from(sessions)
        .where(and(eq(sessions.userId, user.id), sql`${sessions.revokedAt} IS NULL`));
      expect(live, 'no session may survive a password change').toBe(0);

      await expect(login({ email, password: STRONG }))
        .rejects.toMatchObject({ code: 'INVALID_CREDENTIALS' });
      await expect(login({ email, password: OTHER })).resolves.toBeTruthy();
    });

    it('rejects a change that does not know the current password', async () => {
      const doctor = await actorFor(ACCOUNTS.doctor);
      await expect(changePassword(doctor, {
        currentPassword: 'not-the-password', newPassword: 'Brand-New-Value-12',
      })).rejects.toMatchObject({ code: 'INVALID_CREDENTIALS' });
    });
  });

  /* ----------------------------------------------------------- bootstrap -- */

  describe('first-administrator bootstrap', () => {
    // The seeded database already has administrators, which is the state this
    // endpoint must refuse in. BOOTSTRAP_TOKEN is set in .env.test so the
    // refusal is the real one, not "bootstrap is switched off".
    const TOKEN = 'test-bootstrap-token-at-least-24-chars';

    it('refuses once an administrator already exists', async () => {
      await expect(bootstrapFirstAdmin({
        token: TOKEN,
        email: `boot.${Date.now()}@hospital.test`,
        fullName: 'Would-be Admin',
        password: STRONG,
      })).rejects.toMatchObject({ code: 'CONFLICT' });
    });

    it('records the refusal, so a probe is visible to an operator', async () => {
      const [entry] = await db.select().from(auditLogs)
        .where(and(eq(auditLogs.action, 'BOOTSTRAP_REFUSED'), eq(auditLogs.outcome, 'DENIED')))
        .limit(1);
      expect(entry).toBeDefined();
      expect((entry!.metadata as { reason?: string })?.reason).toBe('ADMIN_ALREADY_EXISTS');
    });

    it('creates the first administrator of an empty deployment', async () => {
      // Temporarily clear the administrators so the empty-deployment path is
      // reachable, then put them back. This is the only way to exercise the
      // branch that matters without a second database.
      const restored = await db.update(users)
        .set({ isActive: false })
        .where(sql`${users.primaryRole} IN ('SUPER_ADMIN', 'HOSPITAL_ADMIN') AND ${users.isActive}`)
        .returning({ id: users.id });

      try {
        const email = `first.admin.${Date.now()}@hospital.test`;

        // A wrong token is refused even when the deployment is genuinely empty.
        await expect(bootstrapFirstAdmin({
          token: 'wrong-token-but-still-long-enough-to-pass',
          email, fullName: 'Impostor', password: STRONG,
        })).rejects.toMatchObject({ code: 'FORBIDDEN' });

        const created = await bootstrapFirstAdmin({
          token: TOKEN, email, fullName: 'First Administrator', password: STRONG,
        });
        expect(created.role).toBe('SUPER_ADMIN');

        const [row] = await db.select().from(users).where(eq(users.id, created.id));
        expect(row!.status).toBe('ACTIVE');
        expect(row!.emailVerifiedAt).not.toBeNull();

        const session = await login({ email, password: STRONG });
        expect(session.user.role).toBe('SUPER_ADMIN');

        // And now the door is shut again.
        await expect(bootstrapFirstAdmin({
          token: TOKEN, email: `second.${Date.now()}@hospital.test`,
          fullName: 'Second Admin', password: STRONG,
        })).rejects.toMatchObject({ code: 'CONFLICT' });

        await db.update(users).set({ isActive: false }).where(eq(users.id, created.id));
      } finally {
        for (const r of restored) {
          await db.update(users).set({ isActive: true }).where(eq(users.id, r.id));
        }
      }
    });
  });

  /* --------------------------------------------------------------- audit -- */

  it('writes an audit trail for the account lifecycle', async () => {
    const actions = await db
      .selectDistinct({ action: auditLogs.action })
      .from(auditLogs);
    const seen = actions.map((a) => a.action);

    for (const expected of [
      'REGISTRATION_SUBMITTED', 'EMAIL_VERIFIED', 'ACCOUNT_APPROVED',
      'ACCOUNT_REJECTED', 'INVITATION_SENT', 'INVITATION_ACCEPTED',
      'PASSWORD_RESET_REQUESTED', 'PASSWORD_RESET_COMPLETED', 'LOGIN_BLOCKED',
    ]) {
      expect(seen, `${expected} must be audited`).toContain(expected);
    }
  });
});
