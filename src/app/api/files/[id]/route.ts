import { NextResponse } from 'next/server';
import { protectedRoute } from '@/server/core/route';
import { readAttachment } from '@/server/services/storage.service';
import { PERMISSIONS } from '@/types/rbac';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
type P = { id: string };

/**
 * GET /api/files/:id
 * Authenticated download. Patient access is re-checked on every request and
 * the download is audited, so a shared URL grants nothing on its own.
 */
export const GET = protectedRoute<P>(async ({ user, params }) => {
  const { metadata, bytes } = await readAttachment(user, params.id);
  return new NextResponse(new Uint8Array(bytes), {
    headers: {
      'content-type': metadata.mimeType,
      'content-length': String(bytes.length),
      'content-disposition': `inline; filename="${metadata.fileName.replace(/"/g, '')}"`,
      'cache-control': 'private, no-store',
    },
  }) as unknown as NextResponse;
}, { permission: PERMISSIONS.FILE_READ });
