import '@/server/only';
import { NextResponse, type NextRequest } from 'next/server';
import { ZodError, type ZodSchema } from 'zod';
import { AppError } from './errors';
import { logger, type RequestLogger } from './logger';
import { EnvConfigError } from '@/lib/env';

export type ApiSuccess<T> = { success: true; data: T; meta?: Record<string, unknown> };
export type ApiFailure = { success: false; error: { code: string; message: string; details?: unknown } };
export type ApiResponse<T> = ApiSuccess<T> | ApiFailure;

export function ok<T>(data: T, meta?: Record<string, unknown>, status = 200) {
  return NextResponse.json<ApiSuccess<T>>({ success: true, data, ...(meta ? { meta } : {}) }, { status });
}

export function created<T>(data: T, meta?: Record<string, unknown>) {
  return ok(data, meta, 201);
}

export function fail(code: string, message: string, status: number, details?: unknown) {
  return NextResponse.json<ApiFailure>({ success: false, error: { code, message, ...(details ? { details } : {}) } }, { status });
}

/** Normalises anything thrown inside a route handler into the error envelope. */
export function toErrorResponse(err: unknown, log: Pick<RequestLogger, 'warn' | 'error'> = logger) {
  if (err instanceof AppError) {
    // Expected refusals — a denied patient, a bad password, a stale referral
    // transition. They are the system working, so they are logged at warn with
    // their code and nothing else; the message can name a resource.
    log.warn('request_refused', { code: err.code, status: err.status });
    return fail(err.code, err.message, err.status, err.details);
  }
  // A misconfigured deployment is an operator problem, not a bug, and saying so
  // is worth more than the generic 500 it used to hide behind. The variable
  // NAMES are already public in .env.example; the values never leave the process.
  if (err instanceof EnvConfigError) {
    log.error('configuration_error', { message: err.variables.join(',') });
    return fail(
      'CONFIGURATION_ERROR',
      `The server is missing required configuration: ${err.variables.join(', ')}. `
      + 'Set these environment variables and redeploy.',
      503,
      { variables: err.variables },
    );
  }
  if (err instanceof ZodError) {
    // The issues name fields, never their values — see formatZodIssues.
    log.warn('validation_failed', { count: err.issues.length });
    return fail('VALIDATION_ERROR', 'The submitted data is not valid.', 422, formatZodIssues(err));
  }
  // Postgres error codes surfaced by the referral state-machine guard etc.
  const pg = err as { code?: string; message?: string; constraint?: string };
  if (pg?.code === '23505') {
    log.warn('constraint_violation', { code: '23505' });
    return fail('DUPLICATE_RESOURCE', 'A record with these details already exists.', 409);
  }
  if (pg?.code === '23503') {
    log.warn('constraint_violation', { code: '23503' });
    return fail('CONFLICT', 'A referenced record does not exist.', 409);
  }
  if (pg?.code === '23514' && pg.message?.includes('referral transition')) {
    log.warn('constraint_violation', { code: '23514' });
    return fail('INVALID_STATE_TRANSITION', pg.message, 409);
  }
  // Genuinely unexpected. The message and stack are ours, not the patient's,
  // and without them a 500 is unactionable.
  const e = err as { name?: string; message?: string; stack?: string };
  log.error('unhandled_error', {
    errorName: e?.name ?? typeof err,
    message: e?.message ?? String(err),
    stack: e?.stack,
  });
  return fail('INTERNAL_ERROR', 'An unexpected error occurred. The incident has been logged.', 500);
}

export function formatZodIssues(err: ZodError) {
  return err.issues.map((i) => ({ field: i.path.join('.') || '(root)', message: i.message }));
}

/** Parses and validates a JSON body, throwing a typed error on failure. */
export async function parseBody<T>(req: NextRequest, schema: ZodSchema<T>): Promise<T> {
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    throw new AppError('VALIDATION_ERROR', 'Request body must be valid JSON.');
  }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    throw new AppError('VALIDATION_ERROR', 'The submitted data is not valid.', formatZodIssues(parsed.error));
  }
  return parsed.data;
}

/** Parses and validates query-string parameters. */
export function parseQuery<T>(req: NextRequest, schema: ZodSchema<T>): T {
  const obj: Record<string, string> = {};
  req.nextUrl.searchParams.forEach((v, k) => { obj[k] = v; });
  const parsed = schema.safeParse(obj);
  if (!parsed.success) {
    throw new AppError('VALIDATION_ERROR', 'Invalid query parameters.', formatZodIssues(parsed.error));
  }
  return parsed.data;
}

export type PageMeta = { page: number; pageSize: number; total: number; totalPages: number };

export function pageMeta(page: number, pageSize: number, total: number): PageMeta {
  return { page, pageSize, total, totalPages: Math.max(1, Math.ceil(total / pageSize)) };
}
