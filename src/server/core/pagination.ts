import '@/server/only';
import { z } from 'zod';

/**
 * Bounds on how much a single request may ask the database for.
 *
 * The point is not tidiness. An endpoint with no LIMIT is an availability
 * defect: one caller asking for a collection that has grown for three years
 * can hold a connection, spill to disk and serialise megabytes into a
 * serverless response, and no amount of front-end paging prevents it, because
 * the front end is not what issues the query. So the cap lives at the bottom,
 * where it cannot be bypassed, and a caller may ask for less but never more.
 */

/** Absolute ceiling for any single list response. */
export const MAX_PAGE_SIZE = 200;

/** What an endpoint returns when the caller asks for nothing in particular. */
export const DEFAULT_PAGE_SIZE = 25;

/**
 * Ceiling for bounded reference data — every bed on a ward board, the
 * investigation catalogue, the staff directory. These are read whole because
 * the screen genuinely needs them whole, so the cap is generous rather than
 * small; what matters is that it exists, and that a table which has quietly
 * grown past it degrades into a truncated list rather than a timeout.
 */
export const MAX_REFERENCE_ROWS = 1000;

/**
 * Clamps a requested row count into [1, max]. `undefined` and nonsense both
 * fall back to the endpoint's own default rather than to "everything".
 */
export function boundedLimit(requested: number | undefined | null, fallback: number, max = MAX_PAGE_SIZE): number {
  const ceiling = Math.min(max, MAX_PAGE_SIZE);
  if (requested == null || !Number.isFinite(requested)) return Math.min(fallback, ceiling);
  return Math.min(Math.max(1, Math.floor(requested)), ceiling);
}

export type PageParams = { page: number; pageSize: number; offset: number };

/** Normalises page/pageSize into a bounded offset window. */
export function pageParams(
  input: { page?: number; pageSize?: number } = {},
  defaults: { pageSize?: number; maxPageSize?: number } = {},
): PageParams {
  const page = Math.max(1, Math.floor(input.page ?? 1));
  const pageSize = boundedLimit(
    input.pageSize,
    defaults.pageSize ?? DEFAULT_PAGE_SIZE,
    defaults.maxPageSize ?? MAX_PAGE_SIZE,
  );
  return { page, pageSize, offset: (page - 1) * pageSize };
}

/** `?page=&pageSize=` for routes that expose offset paging. */
export const pageQuerySchema = z.object({
  page: z.coerce.number().int().min(1).max(100_000).optional(),
  pageSize: z.coerce.number().int().min(1).max(MAX_PAGE_SIZE).optional(),
});

/** `?limit=` for routes that expose a simple bounded window. */
export const limitQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(MAX_PAGE_SIZE).optional(),
});
