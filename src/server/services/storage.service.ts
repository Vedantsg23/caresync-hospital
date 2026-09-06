import '@/server/only';
import { randomUUID } from 'node:crypto';
import { and, desc, eq } from 'drizzle-orm';
import { db } from '@/server/db/client';
import { attachments, fileBlobs, users } from '@/server/db/schema';
import { getEnv } from '@/lib/env';
import { AppError } from '@/server/core/errors';
import { assertPatientAccess } from './patient-access.service';
import { recordTimelineEvent } from './timeline.service';
import { recordAudit, AUDIT } from '@/server/core/audit';
import type { AuthUser } from '@/server/auth/context';

/**
 * Storage abstraction.
 *
 * Patient documents are never served from a public bucket. Every read goes
 * through an authenticated route that re-checks patient access, so a leaked URL
 * is worthless. `database` keeps bytes in Postgres (portable, works on any
 * host); `supabase` puts them in object storage and keeps only metadata in the
 * table, which is the right shape for large imaging files.
 *
 * The schema deliberately separates metadata (`attachments`) from bytes, so a
 * future DICOM/PACS integration only has to add a driver.
 */

const ALLOWED_MIME = new Set([
  'application/pdf', 'image/png', 'image/jpeg', 'image/webp', 'image/gif',
  'text/plain', 'text/csv',
  'application/dicom', 'application/octet-stream',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
]);

export type UploadInput = {
  patientId?: string | null;
  referralId?: string | null;
  category: 'LAB_REPORT' | 'RADIOLOGY_REPORT' | 'MEDICAL_DOCUMENT' | 'REFERRAL_ATTACHMENT' | 'OTHER';
  referenceType?: string | null;
  referenceId?: string | null;
  fileName: string;
  mimeType: string;
  bytes: Buffer;
};

export async function uploadAttachment(user: AuthUser, input: UploadInput) {
  const env = getEnv();
  const maxBytes = env.STORAGE_MAX_FILE_MB * 1024 * 1024;

  if (input.bytes.length === 0) throw new AppError('VALIDATION_ERROR', 'The uploaded file is empty.');
  if (input.bytes.length > maxBytes) {
    throw new AppError('VALIDATION_ERROR', `Files must be ${env.STORAGE_MAX_FILE_MB} MB or smaller.`);
  }
  if (!ALLOWED_MIME.has(input.mimeType)) {
    throw new AppError('VALIDATION_ERROR', `Files of type ${input.mimeType} are not accepted.`);
  }
  if (input.patientId) await assertPatientAccess(user, input.patientId);

  // Never trust a client-supplied filename on a path.
  const safeName = input.fileName.replace(/[^\w.\-() ]+/g, '_').slice(0, 160);
  const storagePath = `${input.patientId ?? 'general'}/${randomUUID()}-${safeName}`;

  const attachment = await db.transaction(async (tx) => {
    const [row] = await tx.insert(attachments).values({
      patientId: input.patientId ?? null,
      referralId: input.referralId ?? null,
      fileName: safeName,
      mimeType: input.mimeType,
      sizeBytes: input.bytes.length,
      category: input.category,
      storageDriver: env.STORAGE_DRIVER,
      storagePath,
      referenceType: input.referenceType ?? null,
      referenceId: input.referenceId ?? null,
      uploadedById: user.id,
    }).returning();

    if (env.STORAGE_DRIVER === 'database') {
      await tx.insert(fileBlobs).values({ attachmentId: row!.id, data: input.bytes });
    }
    return row!;
  });

  if (env.STORAGE_DRIVER === 'supabase') {
    await putSupabaseObject(storagePath, input.bytes, input.mimeType);
  }

  if (input.patientId) {
    await recordTimelineEvent({
      patientId: input.patientId,
      eventType: 'DOCUMENT_UPLOADED',
      title: `Document uploaded - ${safeName}`,
      description: input.category.replace(/_/g, ' ').toLowerCase(),
      actorId: user.id,
      departmentId: user.departmentId,
      referenceType: 'attachment',
      referenceId: attachment.id,
    });
  }

  await recordAudit({
    action: AUDIT.FILE_UPLOADED,
    entityType: 'attachment',
    entityId: attachment.id,
    patientId: input.patientId ?? null,
    actor: user,
    metadata: { fileName: safeName, sizeBytes: input.bytes.length, driver: env.STORAGE_DRIVER },
  });

  return attachment;
}

/** Authorised read. Re-checks patient access on every download. */
export async function readAttachment(user: AuthUser, attachmentId: string) {
  const [row] = await db.select().from(attachments).where(eq(attachments.id, attachmentId)).limit(1);
  if (!row) throw new AppError('NOT_FOUND', 'File could not be found.');
  if (row.patientId) await assertPatientAccess(user, row.patientId);

  let bytes: Buffer;
  if (row.storageDriver === 'database') {
    const [blob] = await db.select().from(fileBlobs).where(eq(fileBlobs.attachmentId, attachmentId)).limit(1);
    if (!blob) throw new AppError('NOT_FOUND', 'File contents are unavailable.');
    bytes = Buffer.isBuffer(blob.data) ? blob.data : Buffer.from(blob.data as unknown as ArrayBuffer);
  } else if (row.storageDriver === 'supabase') {
    bytes = await getSupabaseObject(row.storagePath);
  } else {
    throw new AppError('SERVICE_UNAVAILABLE', `Storage driver "${row.storageDriver}" is not available in this deployment.`);
  }

  await recordAudit({
    action: AUDIT.FILE_DOWNLOADED,
    entityType: 'attachment',
    entityId: attachmentId,
    patientId: row.patientId,
    actor: user,
    metadata: { fileName: row.fileName },
  });

  return { metadata: row, bytes };
}

export async function listAttachments(user: AuthUser, params: { patientId?: string; referralId?: string }) {
  if (params.patientId) await assertPatientAccess(user, params.patientId);

  return db
    .select({
      id: attachments.id,
      fileName: attachments.fileName,
      mimeType: attachments.mimeType,
      sizeBytes: attachments.sizeBytes,
      category: attachments.category,
      createdAt: attachments.createdAt,
      uploadedByName: users.fullName,
    })
    .from(attachments)
    .innerJoin(users, eq(users.id, attachments.uploadedById))
    .where(and(
      params.patientId ? eq(attachments.patientId, params.patientId) : undefined,
      params.referralId ? eq(attachments.referralId, params.referralId) : undefined,
    ))
    .orderBy(desc(attachments.createdAt));
}

/* ------------------------------------------------- supabase driver ------ */

function supabaseConfig() {
  const env = getEnv();
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) {
    throw new AppError('SERVICE_UNAVAILABLE', 'Supabase storage is selected but SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY are not configured.');
  }
  return { url: env.SUPABASE_URL.replace(/\/$/, ''), key: env.SUPABASE_SERVICE_ROLE_KEY, bucket: env.SUPABASE_STORAGE_BUCKET };
}

async function putSupabaseObject(path: string, bytes: Buffer, mimeType: string) {
  const { url, key, bucket } = supabaseConfig();
  const res = await fetch(`${url}/storage/v1/object/${bucket}/${encodeURI(path)}`, {
    method: 'POST',
    headers: { authorization: `Bearer ${key}`, 'content-type': mimeType, 'x-upsert': 'true' },
    body: new Uint8Array(bytes),
  });
  if (!res.ok) throw new AppError('SERVICE_UNAVAILABLE', `Storage upload failed (${res.status}).`);
}

async function getSupabaseObject(path: string): Promise<Buffer> {
  const { url, key, bucket } = supabaseConfig();
  const res = await fetch(`${url}/storage/v1/object/${bucket}/${encodeURI(path)}`, {
    headers: { authorization: `Bearer ${key}` },
  });
  if (!res.ok) throw new AppError('NOT_FOUND', 'File contents are unavailable.');
  return Buffer.from(await res.arrayBuffer());
}
