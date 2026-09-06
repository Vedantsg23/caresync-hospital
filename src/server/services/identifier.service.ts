import '@/server/only';
import { sql } from 'drizzle-orm';
import { db } from '@/server/db/client';

/**
 * Human-readable identifiers (PT-2026-00142, REF-2026-00007, …).
 * Generated inside the database with an advisory-lock-free sequence per
 * prefix+year so concurrent writers cannot collide.
 */
async function nextSequence(name: string): Promise<number> {
  // Sequence names cannot be parameterised, so the identifier is built from an
  // allow-list of characters and then re-checked. Callers only ever pass
  // literals plus a numeric year, but this makes the guarantee explicit rather
  // than relying on every future caller behaving.
  const seq = `caresync_seq_${name.replace(/[^a-z0-9_]/gi, '_').toLowerCase()}`;
  if (!/^caresync_seq_[a-z0-9_]+$/.test(seq)) {
    throw new Error(`Refusing to build an unsafe sequence identifier from "${name}"`);
  }
  await db.execute(sql.raw(`CREATE SEQUENCE IF NOT EXISTS ${seq} START 1`));
  const res = await db.execute<{ nextval: string }>(sql.raw(`SELECT nextval('${seq}') AS nextval`));
  const rows = res.rows as unknown as { nextval: string }[];
  return Number(rows[0].nextval);
}

const pad = (n: number, width = 5) => String(n).padStart(width, '0');

export async function nextPatientNumber(now = new Date()): Promise<string> {
  const year = now.getFullYear();
  return `PT-${year}-${pad(await nextSequence(`patient_${year}`))}`;
}

export async function nextAdmissionNumber(now = new Date()): Promise<string> {
  const year = now.getFullYear();
  return `ADM-${year}-${pad(await nextSequence(`admission_${year}`))}`;
}

export async function nextReferralNumber(now = new Date()): Promise<string> {
  const year = now.getFullYear();
  return `REF-${year}-${pad(await nextSequence(`referral_${year}`))}`;
}

export async function nextOrderNumber(prefix: 'LAB' | 'RAD', now = new Date()): Promise<string> {
  const year = now.getFullYear();
  return `${prefix}-${year}-${pad(await nextSequence(`${prefix.toLowerCase()}_order_${year}`))}`;
}

export async function nextAccessionNumber(now = new Date()): Promise<string> {
  const year = now.getFullYear();
  return `ACC-${year}-${pad(await nextSequence(`accession_${year}`))}`;
}

export async function nextStaffNumber(now = new Date()): Promise<string> {
  const year = now.getFullYear();
  return `STF-${year}-${pad(await nextSequence(`staff_${year}`), 4)}`;
}
