import '@/server/only';
import type { NextRequest, NextResponse } from 'next/server';
import { requireUser, assertPermission, type AuthUser } from '@/server/auth/context';
import { toErrorResponse, fail } from './api';
import { rateLimit, clientIp } from './rate-limit';
import { logger, requestIdFrom, routePattern, type RequestLogger } from './logger';
import { getEnv } from '@/lib/env';
import type { Permission } from '@/types/rbac';

export type RouteContext<P = Record<string, string>> = {
  req: NextRequest;
  user: AuthUser;
  params: P;
  ip: string;
  userAgent: string | null;
  /** Correlates every line this request writes, and the response header. */
  requestId: string;
  log: RequestLogger;
};

type Handler<P> = (ctx: RouteContext<P>) => Promise<NextResponse> | NextResponse;

type Options = {
  /** Permission the caller must hold. Omit for authenticated-only routes. */
  permission?: Permission;
  /** Requests per minute for this route, keyed by user + path. */
  limit?: number;
};

/**
 * A request's log line is written once, on the way out, with its outcome and
 * duration. Two lines per request (one at entry, one at exit) doubles the
 * volume to say the same thing, and a request that never returns is visible as
 * a missing line next to its neighbours anyway.
 */
function finish(res: NextResponse, requestId: string, started: number, log: RequestLogger, method: string, route: string): NextResponse {
  res.headers.set('x-request-id', requestId);
  const status = res.status;
  const durationMs = Math.round(performance.now() - started);
  log[status >= 500 ? 'error' : status >= 400 ? 'warn' : 'info']('http_request', {
    method, route, status, durationMs,
  });
  return res;
}

/**
 * Wraps a route handler with authentication, permission enforcement, rate
 * limiting and uniform error mapping. Every mutating API route uses this —
 * there is no code path that reaches a service without an authenticated caller.
 */
export function protectedRoute<P = Record<string, string>>(handler: Handler<P>, options: Options = {}) {
  return async (req: NextRequest, ctx: { params: Promise<P> }): Promise<NextResponse> => {
    const started = performance.now();
    const requestId = requestIdFrom(req.headers);
    const route = routePattern(req.nextUrl.pathname);
    const method = req.method;
    let log = logger.child({ requestId });

    try {
      const user = await requireUser();
      // Bound after authentication so the id and role travel with every line
      // the handler writes. Neither is patient information.
      log = logger.child({ requestId, userId: user.id, role: user.role });

      if (options.permission) assertPermission(user, options.permission);

      const ip = clientIp(req.headers);
      const limit = options.limit ?? getEnv().RATE_LIMIT_API_PER_MIN;
      const rl = await rateLimit(`api:${user.id}:${req.nextUrl.pathname}`, limit);
      if (!rl.allowed) {
        return finish(
          fail('RATE_LIMITED', 'Too many requests. Please slow down.', 429, {
            retryAfterSeconds: rl.retryAfterSeconds,
          }),
          requestId, started, log, method, route,
        );
      }

      const params = ctx?.params ? await ctx.params : ({} as P);
      const res = await handler({
        req, user, params, ip, userAgent: req.headers.get('user-agent'), requestId, log,
      });
      return finish(res, requestId, started, log, method, route);
    } catch (err) {
      return finish(toErrorResponse(err, log), requestId, started, log, method, route);
    }
  };
}

/** For genuinely public routes (login, health). Still rate limited. */
export function publicRoute<P = Record<string, string>>(
  handler: (ctx: Omit<RouteContext<P>, 'user'>) => Promise<NextResponse> | NextResponse,
) {
  return async (req: NextRequest, ctx: { params: Promise<P> }): Promise<NextResponse> => {
    const started = performance.now();
    const requestId = requestIdFrom(req.headers);
    const route = routePattern(req.nextUrl.pathname);
    const log = logger.child({ requestId });

    try {
      const params = ctx?.params ? await ctx.params : ({} as P);
      const res = await handler({
        req,
        params,
        ip: clientIp(req.headers),
        userAgent: req.headers.get('user-agent'),
        requestId,
        log,
      });
      return finish(res, requestId, started, log, req.method, route);
    } catch (err) {
      return finish(toErrorResponse(err, log), requestId, started, log, req.method, route);
    }
  };
}
