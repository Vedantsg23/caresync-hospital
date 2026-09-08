import { NextResponse, type NextRequest } from 'next/server';
import { jwtVerify } from 'jose';

/**
 * Edge route protection.
 *
 * This is a fast first gate that keeps unauthenticated users off application
 * routes. It is NOT the security boundary: every API route independently
 * re-verifies the session against the database and checks permissions, and the
 * database carries RLS policies on top of that.
 */
/**
 * Everything a person can reach before they have an account. The edge gate is a
 * fast first filter, not the security boundary — every one of these endpoints
 * re-validates its own input, and the authenticated ones re-check the session
 * against the database regardless of what happens here.
 */
const PUBLIC_PATHS = [
  '/login',
  '/register',
  '/verify-email',
  '/forgot-password',
  '/reset-password',
  '/accept-invitation',
  '/api/health',
  '/api/public',
  '/api/auth/login',
  '/api/auth/register',
  '/api/auth/verify-email',
  '/api/auth/resend-verification',
  '/api/auth/forgot-password',
  '/api/auth/reset-password',
  '/api/auth/accept-invitation',
  '/api/auth/bootstrap',
];

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  if (
    PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`)) ||
    pathname.startsWith('/_next') ||
    pathname.startsWith('/favicon') ||
    pathname === '/robots.txt'
  ) {
    return NextResponse.next();
  }

  const token = req.cookies.get('caresync_session')?.value;
  let valid = false;

  if (token && process.env.AUTH_SECRET) {
    try {
      await jwtVerify(token, new TextEncoder().encode(process.env.AUTH_SECRET), { issuer: 'caresync-hospital' });
      valid = true;
    } catch {
      valid = false;
    }
  }

  if (valid) return NextResponse.next();

  if (pathname.startsWith('/api/')) {
    return NextResponse.json(
      { success: false, error: { code: 'UNAUTHENTICATED', message: 'Authentication is required.' } },
      { status: 401 },
    );
  }

  const loginUrl = new URL('/login', req.url);
  if (pathname !== '/') loginUrl.searchParams.set('next', pathname + req.nextUrl.search);
  return NextResponse.redirect(loginUrl);
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)'],
};
