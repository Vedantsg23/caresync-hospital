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

type PostgresError = { code?: string; message?: string; constraint?: string };

/**
 * Finds the PostgreSQL error inside whatever wrapped it.
 *
 * Drizzle does not rethrow the driver's error; it throws its own with the
 * original on `cause`, so `err.code` is undefined and every check below it
 * silently failed to match. That is how a malformed id in a URL became a 500
 * — and, less visibly, how a duplicate-key violation did too, because the
 * mapping to 409 never fired either.
 *
 * The unit tests never saw it: they call services directly, so nothing they do
 * passes through this function. It took driving the running application to
 * find, which is the argument for doing that.
 *
 * Walks the cause chain rather than checking one level, because a wrapper today
 * is two wrappers after an upgrade.
 */
function postgresErrorOf(err: unknown): PostgresError {
  let cur = err as (PostgresError & { cause?: unknown }) | undefined;
  for (let depth = 0; cur && depth < 5; depth++) {
    // Postgres codes are five characters — '23505', '22P02'. Anything else on a
    // `code` field belongs to some other library.
    if (typeof cur.code === 'string' && /^[0-9A-Z]{5}$/.test(cur.code)) return cur;
    cur = cur.cause as typeof cur;
  }
  return {};
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
  const pg = postgresErrorOf(err);
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
  // 22P02 — invalid_text_representation. Almost always a malformed identifier
  // in a URL: /api/patients/not-a-uuid reaches Postgres, which refuses to cast
  // it, and the whole thing used to surface as a 500.
  //
  // Three things were wrong with that. It reported a client mistake as a server
  // fault. It wrote an `unhandled_error` line for input a scanner produces by
  // the thousand, which is how real incidents get buried. And it gave a
  // malformed id a different shape of response from a well-formed one the
  // caller may not have, which is a small distinction an attacker can measure.
  if (pg?.code === '22P02') {
    log.warn('malformed_identifier', { code: '22P02' });
    return fail('VALIDATION_ERROR', 'That identifier is not valid.', 422);
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
