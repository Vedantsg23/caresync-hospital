/**
 * Centralised, typed API client.
 *
 * Every network call in the application goes through `request()`, so error
 * shape, credentials, content type and abort handling are defined once. No
 * component issues a raw `fetch`.
 */

export type ApiEnvelope<T> =
  | { success: true; data: T; meta?: Record<string, unknown> }
  | { success: false; error: { code: string; message: string; details?: unknown } };

export type FieldIssue = { field: string; message: string };

export class ApiError extends Error {
  readonly code: string;
  readonly status: number;
  readonly issues: FieldIssue[];

  constructor(code: string, message: string, status: number, details?: unknown) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
    this.status = status;
    this.issues = Array.isArray(details) ? (details as FieldIssue[]) : [];
  }

  /** Maps a validation failure back onto a form field. */
  issueFor(field: string): string | undefined {
    return this.issues.find((i) => i.field === field)?.message;
  }
}

export type Result<T> = { data: T; meta?: Record<string, unknown> };

async function request<T>(
  path: string,
  init: RequestInit & { query?: Record<string, string | number | boolean | undefined | null> } = {},
): Promise<Result<T>> {
  const { query, ...rest } = init;

  let url = path.startsWith('/') ? `/api${path}` : `/api/${path}`;
  if (query) {
    const params = new URLSearchParams();
    Object.entries(query).forEach(([k, v]) => {
      if (v !== undefined && v !== null && v !== '') params.set(k, String(v));
    });
    const qs = params.toString();
    if (qs) url += `?${qs}`;
  }

  const isFormData = rest.body instanceof FormData;

  let res: Response;
  try {
    res = await fetch(url, {
      credentials: 'same-origin',
      ...rest,
      headers: {
        ...(isFormData ? {} : { 'content-type': 'application/json' }),
        accept: 'application/json',
        ...(rest.headers ?? {}),
      },
    });
  } catch {
    throw new ApiError('NETWORK_ERROR', 'Could not reach the server. Check your connection and try again.', 0);
  }

  if (res.status === 204) return { data: undefined as T };

  const contentType = res.headers.get('content-type') ?? '';
  if (!contentType.includes('application/json')) {
    if (res.ok) return { data: undefined as T };
    throw new ApiError('INTERNAL_ERROR', `Unexpected response from the server (${res.status}).`, res.status);
  }

  const json = (await res.json()) as ApiEnvelope<T>;

  if (!json.success) {
    throw new ApiError(json.error.code, json.error.message, res.status, json.error.details);
  }
  return { data: json.data, meta: json.meta };
}

const get = <T>(path: string, query?: Record<string, string | number | boolean | undefined | null>) =>
  request<T>(path, { method: 'GET', query });
const post = <T>(path: string, body?: unknown) =>
  request<T>(path, { method: 'POST', body: body === undefined ? undefined : JSON.stringify(body) });
const patch = <T>(path: string, body?: unknown) =>
  request<T>(path, { method: 'PATCH', body: body === undefined ? undefined : JSON.stringify(body) });

export const api = { request, get, post, patch };
