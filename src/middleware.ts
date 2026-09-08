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


/**
 * Content Security Policy.
 *
 * Built per request around a fresh nonce rather than shipped as a static
 * string, because a policy containing 'unsafe-inline' for scripts is not a
 * policy — it permits exactly the injection it is meant to stop. Next injects
 * its own bootstrap scripts and picks the nonce up from the request header, so
 * the application keeps working while anything a third party manages to write
 * into the page does not execute.
 *
 * `'strict-dynamic'` lets those nonced scripts load their own chunks; script
 * hosts are otherwise nobody. `'unsafe-eval'` is present in development only —
 * React Refresh needs it, production does not get it.
 */
function contentSecurityPolicy(nonce: string): string {
  const dev = process.env.NODE_ENV !== 'production';
  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${dev ? " 'unsafe-eval'" : ''}`,
    // Tailwind compiles to a stylesheet, but Next still emits inline style
    // attributes for its own layout primitives; style-src cannot be nonced
    // without breaking them, and injected CSS is not script execution.
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    // Same-origin only. The SSE stream, the API and nothing else.
    "connect-src 'self'",
    "media-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    "frame-src 'none'",
    "worker-src 'self' blob:",
    "manifest-src 'self'",
    ...(dev ? [] : ['upgrade-insecure-requests']),
  ].join('; ');
}

/** Applied to every response the middleware produces, redirects included. */
function withSecurityHeaders(res: NextResponse, csp: string): NextResponse {
  res.headers.set('Content-Security-Policy', csp);
  return res;
}

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // One nonce per request. Next reads it from the request header and stamps it
  // onto the scripts it renders.
  const nonce = crypto.randomUUID().replace(/-/g, '');
  const csp = contentSecurityPolicy(nonce);
  const requestHeaders = new Headers(req.headers);
  requestHeaders.set('x-nonce', nonce);
  requestHeaders.set('Content-Security-Policy', csp);
  const forward = () => NextResponse.next({ request: { headers: requestHeaders } });

  if (
    PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`)) ||
    pathname.startsWith('/_next') ||
    pathname.startsWith('/favicon') ||
    pathname === '/robots.txt'
  ) {
    return withSecurityHeaders(forward(), csp);
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

  if (valid) return withSecurityHeaders(forward(), csp);

  if (pathname.startsWith('/api/')) {
    return withSecurityHeaders(
      NextResponse.json(
        { success: false, error: { code: 'UNAUTHENTICATED', message: 'Authentication is required.' } },
        { status: 401 },
      ),
      csp,
    );
  }

  const loginUrl = new URL('/login', req.url);
  if (pathname !== '/') loginUrl.searchParams.set('next', pathname + req.nextUrl.search);
  return withSecurityHeaders(NextResponse.redirect(loginUrl), csp);
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)'],
};
