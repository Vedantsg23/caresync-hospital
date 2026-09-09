import { describe, it, expect } from 'vitest';
import { toErrorResponse } from '@/server/core/api';
import { AppError } from '@/server/core/errors';

/**
 * Error mapping, against the errors the application actually throws.
 *
 * These exist because every PostgreSQL mapping in `toErrorResponse` was dead
 * and nothing noticed. Drizzle does not rethrow the driver's error — it throws
 * its own with the original on `cause` — so `err.code` was undefined and a
 * duplicate key came back as a 500 rather than a 409, while a malformed id in a
 * URL did the same.
 *
 * The rest of the suite never saw it because those tests call services
 * directly, and nothing they do passes through this function. So these cases
 * build the wrapped shape deliberately: a bare pg error would pass even with
 * the bug present, which would make the test worse than none.
 */

/** What Drizzle throws: its own Error, with the driver's on `cause`. */
function wrapped(code: string, message: string): Error {
  const driverError = Object.assign(new Error(message), { code, name: 'error' });
  return Object.assign(new Error(`Failed query: select …`), { cause: driverError });
}

const silent = { warn: () => {}, error: () => {} };

describe('toErrorResponse', () => {
  it('maps a wrapped duplicate key to 409, not 500', () => {
    const res = toErrorResponse(wrapped('23505', 'duplicate key value violates unique constraint'), silent);
    expect(res.status).toBe(409);
  });

  it('maps a wrapped foreign-key violation to 409', () => {
    const res = toErrorResponse(wrapped('23503', 'violates foreign key constraint'), silent);
    expect(res.status).toBe(409);
  });

  it('maps a malformed identifier to 422 rather than an internal error', () => {
    // /api/patients/not-a-uuid — a client mistake, and one a scanner makes by
    // the thousand. Reporting it as a server fault buries real incidents.
    const res = toErrorResponse(wrapped('22P02', 'invalid input syntax for type uuid: "not-a-uuid"'), silent);
    expect(res.status).toBe(422);
  });

  it('still maps a bare pg error, not only a wrapped one', () => {
    const bare = Object.assign(new Error('duplicate key'), { code: '23505' });
    expect(toErrorResponse(bare, silent).status).toBe(409);
  });

  it('finds the code however deeply it is wrapped', () => {
    const inner = Object.assign(new Error('invalid input syntax'), { code: '22P02' });
    const middle = Object.assign(new Error('inner failure'), { cause: inner });
    const outer = Object.assign(new Error('Failed query'), { cause: middle });
    expect(toErrorResponse(outer, silent).status).toBe(422);
  });

  it('does not mistake some other library\'s `code` for a Postgres one', () => {
    // Node uses string codes too — ENOENT, ECONNREFUSED. Only five-character
    // SQLSTATE codes should be treated as Postgres.
    const nodeError = Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED' });
    expect(toErrorResponse(nodeError, silent).status).toBe(500);
  });

  it('leaves an AppError to carry its own status', () => {
    const res = toErrorResponse(new AppError('PATIENT_ACCESS_DENIED', 'No.'), silent);
    expect(res.status).toBe(403);
  });

  it('reports anything genuinely unexpected as 500', () => {
    expect(toErrorResponse(new Error('something nobody predicted'), silent).status).toBe(500);
  });
});
