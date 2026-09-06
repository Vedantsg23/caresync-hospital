/** Typed application errors → consistent HTTP responses. */

export const ERROR_CODES = {
  UNAUTHENTICATED: 401,
  INVALID_CREDENTIALS: 401,
  SESSION_EXPIRED: 401,
  FORBIDDEN: 403,
  PATIENT_ACCESS_DENIED: 403,
  INSUFFICIENT_PERMISSION: 403,
  NOT_FOUND: 404,
  PATIENT_NOT_FOUND: 404,
  REFERRAL_NOT_FOUND: 404,
  USER_NOT_FOUND: 404,
  CONFLICT: 409,
  DUPLICATE_RESOURCE: 409,
  INVALID_STATE_TRANSITION: 409,
  BED_UNAVAILABLE: 409,
  VALIDATION_ERROR: 422,
  RATE_LIMITED: 429,
  ACCOUNT_LOCKED: 429,
  INTERNAL_ERROR: 500,
  SERVICE_UNAVAILABLE: 503,
} as const;

export type ErrorCode = keyof typeof ERROR_CODES;

export class AppError extends Error {
  readonly code: ErrorCode;
  readonly status: number;
  readonly details?: unknown;

  constructor(code: ErrorCode, message: string, details?: unknown) {
    super(message);
    this.name = 'AppError';
    this.code = code;
    this.status = ERROR_CODES[code];
    this.details = details;
  }
}

export const unauthenticated = (m = 'Authentication is required.') => new AppError('UNAUTHENTICATED', m);
export const forbidden = (m = 'You do not have permission to perform this action.') => new AppError('FORBIDDEN', m);
export const notFound = (code: ErrorCode = 'NOT_FOUND', m = 'The requested resource could not be found.') =>
  new AppError(code, m);
export const conflict = (m: string, code: ErrorCode = 'CONFLICT') => new AppError(code, m);
export const validationError = (m: string, details?: unknown) => new AppError('VALIDATION_ERROR', m, details);
