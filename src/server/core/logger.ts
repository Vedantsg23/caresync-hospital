import '@/server/only';

/**
 * Structured logging.
 *
 * Two decisions shape this file, and both come from what the application
 * handles.
 *
 * The first is that log lines are JSON on one line each, because that is what
 * every collector — Vercel, CloudWatch, Loki, Datadog — can index without a
 * parser written specially for us, and because a request id is only useful if
 * you can search on it.
 *
 * The second is that fields are ALLOWED rather than DENIED. A deny-list of
 * sensitive keys is the usual approach and it is the wrong one here: nobody can
 * enumerate every field that might carry a patient's identity, and the first
 * one somebody forgets ends up in a log aggregator that is backed up, indexed
 * and searchable by people with no clinical relationship to that patient. So
 * only the keys named in SAFE_KEYS are written; everything else is dropped and
 * counted, which is visible in the line itself rather than silent.
 *
 * The practical consequence is that logs say WHICH request failed and WHERE,
 * never WHOSE record it was. If you need to know whose, that is what the audit
 * trail is for: it is access-controlled, append-only, and it is admissible.
 */

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LEVELS: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };

function threshold(): number {
  const configured = (process.env.LOG_LEVEL ?? '').toLowerCase() as LogLevel;
  if (configured in LEVELS) return LEVELS[configured];
  return process.env.NODE_ENV === 'production' ? LEVELS.info : LEVELS.debug;
}

/**
 * Every field name that may be written to a log line.
 *
 * The test is not "is this field sensitive today" but "could this field ever
 * hold something a patient told a clinician in confidence". Names, dates of
 * birth, phone numbers, addresses, note bodies, diagnoses, medicine names and
 * free-text reasons are all absent on purpose, as are the entire request body
 * and query string. Identifiers are permitted — a UUID is meaningless without
 * the database, and it is the only way to correlate a log line with an audit
 * row.
 */
const SAFE_KEYS = new Set([
  // request identity and shape
  'requestId', 'method', 'route', 'status', 'durationMs', 'ip', 'userAgent',
  // who, by opaque id and role only
  'userId', 'role', 'sessionId',
  // what happened
  'event', 'outcome', 'code', 'errorName', 'message', 'stack',
  // subsystem detail
  'driver', 'mode', 'store', 'attempt', 'limit', 'remaining', 'retryAfterSeconds',
  'poolTotal', 'poolIdle', 'poolWaiting', 'latencyMs', 'migration', 'count',
  'entityType', 'entityId', 'patientId', 'target',
]);

const MAX_STRING = 1000;

function sanitiseValue(value: unknown): unknown {
  if (value == null) return value;
  if (typeof value === 'string') return value.length > MAX_STRING ? `${value.slice(0, MAX_STRING)}…` : value;
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  if (value instanceof Date) return value.toISOString();
  // Anything structured is a shape we have not vetted. Report its type, not it.
  return `[${Array.isArray(value) ? 'array' : typeof value}]`;
}

/** Keeps the allowed fields, counts the rest. */
export function sanitiseFields(fields: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  let dropped = 0;
  for (const [key, value] of Object.entries(fields)) {
    if (SAFE_KEYS.has(key)) out[key] = sanitiseValue(value);
    else dropped += 1;
  }
  if (dropped > 0) out.droppedFields = dropped;
  return out;
}

function emit(level: LogLevel, event: string, fields: Record<string, unknown> = {}): void {
  if (LEVELS[level] < threshold()) return;
  const line = JSON.stringify({
    ts: new Date().toISOString(),
    level,
    event,
    ...sanitiseFields(fields),
  });
  // stderr for warn and error so a collector splitting on stream still sorts
  // them correctly; stdout for the rest.
  if (level === 'error' || level === 'warn') process.stderr.write(`${line}\n`);
  else process.stdout.write(`${line}\n`);
}

export const logger = {
  debug: (event: string, fields?: Record<string, unknown>) => emit('debug', event, fields),
  info: (event: string, fields?: Record<string, unknown>) => emit('info', event, fields),
  warn: (event: string, fields?: Record<string, unknown>) => emit('warn', event, fields),
  error: (event: string, fields?: Record<string, unknown>) => emit('error', event, fields),

  /** Binds a request id (and anything else constant) to every subsequent line. */
  child(bound: Record<string, unknown>) {
    const merge = (fields?: Record<string, unknown>) => ({ ...bound, ...fields });
    return {
      debug: (event: string, fields?: Record<string, unknown>) => emit('debug', event, merge(fields)),
      info: (event: string, fields?: Record<string, unknown>) => emit('info', event, merge(fields)),
      warn: (event: string, fields?: Record<string, unknown>) => emit('warn', event, merge(fields)),
      error: (event: string, fields?: Record<string, unknown>) => emit('error', event, merge(fields)),
    };
  },
};

export type RequestLogger = ReturnType<typeof logger.child>;

/**
 * Collapses identifiers out of a path so log lines aggregate.
 *
 * `/api/patients/6f3.../notes` becomes `/api/patients/:id/notes`, which is what
 * you want to group by when asking which endpoint is slow. The identifier is
 * still available in the audit trail when it is needed for a specific request.
 */
export function routePattern(pathname: string): string {
  return pathname
    .replace(/\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, '/:id')
    .replace(/\/\d+(?=\/|$)/g, '/:n');
}

/** A request id: the caller's, if they sent a sane one, or a fresh one. */
export function requestIdFrom(headers: Headers): string {
  const supplied = headers.get('x-request-id');
  if (supplied && /^[\w-]{8,128}$/.test(supplied)) return supplied;
  return crypto.randomUUID();
}
