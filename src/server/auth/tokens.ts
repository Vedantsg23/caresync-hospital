import '@/server/only';
import { randomBytes, createHash, timingSafeEqual } from 'node:crypto';
import { and, eq, isNull, sql } from 'drizzle-orm';
import { db } from '@/server/db/client';
import { verificationTokens } from '@/server/db/schema';
import type { Role } from '@/types/rbac';

/**
 * Single-use credentials delivered by email: verification links, password
 * resets and staff invitations.
 *
 * Three properties matter, and each is enforced here rather than left to the
 * caller to remember:
 *
 *  1. **The database never holds a usable token.** Only a SHA-256 hash is
 *     stored, so a leaked backup or a SQL-injection read cannot be replayed as
 *     a working reset link. The plaintext exists in exactly two places: the
 *     email that was sent, and the URL the holder clicks.
 *  2. **A token is spent once.** `consume()` marks it in the same statement
 *     that claims it, and a partial unique index rejects a second live token
 *     for the same address and purpose, so two simultaneous redemptions cannot
 *     both succeed.
 *  3. **A token expires.** Short lifetimes for resets, longer for invitations,
 *     because the threat models differ.
 */

export type TokenPurpose = 'EMAIL_VERIFICATION' | 'PASSWORD_RESET' | 'STAFF_INVITATION';

/** Deliberately different: a reset link is far more dangerous than a verify link. */
export const TOKEN_TTL_MINUTES: Record<TokenPurpose, number> = {
  PASSWORD_RESET: 30,
  EMAIL_VERIFICATION: 60 * 24,
  STAFF_INVITATION: 60 * 24 * 7,
};

/** 32 bytes of CSPRNG output, base64url — 256 bits, not guessable. */
function generateToken(): string {
  return randomBytes(32).toString('base64url');
}

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/**
 * Compare two hashes without leaking their difference through timing.
 * The lookup itself is by unique index, so this guards the final check only.
 */
export function hashesMatch(a: string, b: string): boolean {
  const left = Buffer.from(a, 'utf8');
  const right = Buffer.from(b, 'utf8');
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

export type IssuedToken = {
  /** Plaintext. Goes into the email and nowhere else — never log or store it. */
  token: string;
  expiresAt: Date;
  id: string;
};

export async function issueToken(input: {
  email: string;
  purpose: TokenPurpose;
  userId?: string | null;
  invitedRole?: Role | null;
  invitedDepartmentId?: string | null;
  createdById?: string | null;
  ipAddress?: string | null;
}): Promise<IssuedToken> {
  const email = input.email.trim().toLowerCase();
  const token = generateToken();
  const tokenHash = hashToken(token);
  const expiresAt = new Date(Date.now() + TOKEN_TTL_MINUTES[input.purpose] * 60_000);

  // Requesting a new link invalidates the previous one. Two live reset links
  // for one address is one more than anybody needs, and the partial unique
  // index would reject the insert anyway.
  await db
    .update(verificationTokens)
    .set({ consumedAt: new Date() })
    .where(and(
      eq(verificationTokens.email, email),
      eq(verificationTokens.purpose, input.purpose),
      isNull(verificationTokens.consumedAt),
    ));

  const [row] = await db
    .insert(verificationTokens)
    .values({
      email,
      purpose: input.purpose,
      tokenHash,
      expiresAt,
      userId: input.userId ?? null,
      invitedRole: input.invitedRole ?? null,
      invitedDepartmentId: input.invitedDepartmentId ?? null,
      createdById: input.createdById ?? null,
      ipAddress: input.ipAddress ?? null,
    })
    .returning({ id: verificationTokens.id });

  return { token, expiresAt, id: row!.id };
}

export type ResolvedToken = {
  id: string;
  email: string;
  userId: string | null;
  purpose: TokenPurpose;
  invitedRole: Role | null;
  invitedDepartmentId: string | null;
  createdById: string | null;
};

/**
 * Claim a token: verify it, mark it consumed, and return what it authorises.
 *
 * The update is the check. `WHERE consumed_at IS NULL` inside the statement
 * that sets `consumed_at` means the database decides the winner when two
 * requests race, and the loser gets no row back.
 */
export async function consumeToken(
  token: string,
  purpose: TokenPurpose,
): Promise<ResolvedToken | null> {
  if (!token || token.length < 20) return null;
  const tokenHash = hashToken(token);

  const [row] = await db
    .update(verificationTokens)
    .set({ consumedAt: new Date() })
    .where(and(
      eq(verificationTokens.tokenHash, tokenHash),
      eq(verificationTokens.purpose, purpose),
      isNull(verificationTokens.consumedAt),
      sql`${verificationTokens.expiresAt} > now()`,
    ))
    .returning({
      id: verificationTokens.id,
      email: verificationTokens.email,
      userId: verificationTokens.userId,
      purpose: verificationTokens.purpose,
      invitedRole: verificationTokens.invitedRole,
      invitedDepartmentId: verificationTokens.invitedDepartmentId,
      createdById: verificationTokens.createdById,
    });

  if (!row) return null;
  return {
    id: row.id,
    email: row.email,
    userId: row.userId,
    purpose: row.purpose as TokenPurpose,
    invitedRole: (row.invitedRole as Role | null) ?? null,
    invitedDepartmentId: row.invitedDepartmentId,
    createdById: row.createdById,
  };
}

/** Read a token without spending it — for showing an invitation's details. */
export async function peekToken(
  token: string,
  purpose: TokenPurpose,
): Promise<ResolvedToken | null> {
  if (!token || token.length < 20) return null;
  const [row] = await db
    .select({
      id: verificationTokens.id,
      email: verificationTokens.email,
      userId: verificationTokens.userId,
      purpose: verificationTokens.purpose,
      invitedRole: verificationTokens.invitedRole,
      invitedDepartmentId: verificationTokens.invitedDepartmentId,
      createdById: verificationTokens.createdById,
      tokenHash: verificationTokens.tokenHash,
    })
    .from(verificationTokens)
    .where(and(
      eq(verificationTokens.tokenHash, hashToken(token)),
      eq(verificationTokens.purpose, purpose),
      isNull(verificationTokens.consumedAt),
      sql`${verificationTokens.expiresAt} > now()`,
    ))
    .limit(1);

  if (!row || !hashesMatch(row.tokenHash, hashToken(token))) return null;
  return {
    id: row.id,
    email: row.email,
    userId: row.userId,
    purpose: row.purpose as TokenPurpose,
    invitedRole: (row.invitedRole as Role | null) ?? null,
    invitedDepartmentId: row.invitedDepartmentId,
    createdById: row.createdById,
  };
}

/** Housekeeping, exposed for a scheduled job. */
export async function purgeExpiredTokens(): Promise<number> {
  const res = await db.execute<{ caresync_purge_expired_tokens: number }>(
    sql`SELECT caresync_purge_expired_tokens()`,
  );
  const rows = res.rows as unknown as { caresync_purge_expired_tokens: number }[];
  return Number(rows[0]?.caresync_purge_expired_tokens ?? 0);
}
