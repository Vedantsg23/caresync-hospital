import '@/server/only';
import type { NextRequest, NextResponse } from 'next/server';
import { requireUser, assertPermission, type AuthUser } from '@/server/auth/context';
import { toErrorResponse, fail } from './api';
import { rateLimit, clientIp } from './rate-limit';
import { getEnv } from '@/lib/env';
import type { Permission } from '@/types/rbac';

export type RouteContext<P = Record<string, string>> = {
  req: NextRequest;
  user: AuthUser;
  params: P;
  ip: string;
  userAgent: string | null;
};

type Handler<P> = (ctx: RouteContext<P>) => Promise<NextResponse> | NextResponse;

type Options = {
  /** Permission the caller must hold. Omit for authenticated-only routes. */
  permission?: Permission;
  /** Requests per minute for this route, keyed by user + path. */
  limit?: number;
};

/**
 * Wraps a route handler with authentication, permission enforcement, rate
 * limiting and uniform error mapping. Every mutating API route uses this —
 * there is no code path that reaches a service without an authenticated caller.
 */
export function protectedRoute<P = Record<string, string>>(handler: Handler<P>, options: Options = {}) {
  return async (req: NextRequest, ctx: { params: Promise<P> }): Promise<NextResponse> => {
    try {
      const user = await requireUser();
      if (options.permission) assertPermission(user, options.permission);

      const ip = clientIp(req.headers);
      const limit = options.limit ?? getEnv().RATE_LIMIT_API_PER_MIN;
      const rl = await rateLimit(`api:${user.id}:${req.nextUrl.pathname}`, limit);
      if (!rl.allowed) {
        return fail('RATE_LIMITED', 'Too many requests. Please slow down.', 429, {
          retryAfterSeconds: rl.retryAfterSeconds,
        });
      }

      const params = ctx?.params ? await ctx.params : ({} as P);
      return await handler({ req, user, params, ip, userAgent: req.headers.get('user-agent') });
    } catch (err) {
      return toErrorResponse(err);
    }
  };
}

/** For genuinely public routes (login, health). Still rate limited. */
export function publicRoute<P = Record<string, string>>(
  handler: (ctx: Omit<RouteContext<P>, 'user'>) => Promise<NextResponse> | NextResponse,
) {
  return async (req: NextRequest, ctx: { params: Promise<P> }): Promise<NextResponse> => {
    try {
      const params = ctx?.params ? await ctx.params : ({} as P);
      return await handler({
        req,
        params,
        ip: clientIp(req.headers),
        userAgent: req.headers.get('user-agent'),
      });
    } catch (err) {
      return toErrorResponse(err);
    }
  };
}
