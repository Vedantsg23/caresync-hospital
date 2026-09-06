import { protectedRoute } from '@/server/core/route';
import { ok, created, parseBody } from '@/server/core/api';
import { createNoteSchema, noteTypeSchema } from '@/server/validators';
import { listClinicalNotes, createClinicalNote } from '@/server/services/clinical.service';
import { PERMISSIONS } from '@/types/rbac';

export const dynamic = 'force-dynamic';

type P = { id: string };

export const GET = protectedRoute<P>(async ({ req, user, params }) => {
  const raw = req.nextUrl.searchParams.get('type');
  const parsed = raw ? noteTypeSchema.safeParse(raw) : null;
  return ok(await listClinicalNotes(user, params.id, parsed?.success ? parsed.data : undefined));
}, { permission: PERMISSIONS.NOTE_READ });

export const POST = protectedRoute<P>(async ({ req, user, params }) => {
  const body = await parseBody(req, createNoteSchema);
  return created(await createClinicalNote(user, { patientId: params.id, ...body }));
}, { permission: PERMISSIONS.NOTE_CREATE });
