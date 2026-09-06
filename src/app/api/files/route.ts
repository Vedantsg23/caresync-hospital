import { protectedRoute } from '@/server/core/route';
import { created, fail } from '@/server/core/api';
import { uploadAttachment } from '@/server/services/storage.service';
import { PERMISSIONS } from '@/types/rbac';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const CATEGORIES = ['LAB_REPORT', 'RADIOLOGY_REPORT', 'MEDICAL_DOCUMENT', 'REFERRAL_ATTACHMENT', 'OTHER'] as const;
type Category = (typeof CATEGORIES)[number];

/** POST /api/files - multipart upload. Bytes never touch a public bucket. */
export const POST = protectedRoute(async ({ req, user }) => {
  const form = await req.formData();
  const file = form.get('file');
  if (!(file instanceof File)) return fail('VALIDATION_ERROR', 'A file is required.', 422);

  const rawCategory = String(form.get('category') ?? 'MEDICAL_DOCUMENT');
  const category = (CATEGORIES as readonly string[]).includes(rawCategory) ? (rawCategory as Category) : 'MEDICAL_DOCUMENT';

  const attachment = await uploadAttachment(user, {
    patientId: (form.get('patientId') as string) || null,
    referralId: (form.get('referralId') as string) || null,
    category,
    referenceType: (form.get('referenceType') as string) || null,
    referenceId: (form.get('referenceId') as string) || null,
    fileName: file.name,
    mimeType: file.type || 'application/octet-stream',
    bytes: Buffer.from(await file.arrayBuffer()),
  });

  return created(attachment);
}, { permission: PERMISSIONS.FILE_UPLOAD, limit: 60 });
