/** Base URL of the REST API as seen from the browser. Inlined at build time (NEXT_PUBLIC_*). */
export const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001/api/v1';

/** RFC 9457 Problem Details, as returned by the API's global exception filter. */
export interface ProblemDetails {
  type: string;
  title: string;
  status: number;
  detail?: string;
  errorCode: string;
  errors?: { field: string; message: string }[];
}

/** Any non-2xx response, or a network failure (status 0, errorCode NETWORK_ERROR). */
export class ApiError extends Error {
  constructor(readonly problem: ProblemDetails) {
    super(problem.detail ?? problem.title);
    this.name = 'ApiError';
  }

  get status() {
    return this.problem.status;
  }

  get errorCode() {
    return this.problem.errorCode;
  }

  /** Optimistic-locking conflict: the ticket changed since the client read it. */
  get isVersionConflict() {
    return this.problem.errorCode === 'TICKET_VERSION_CONFLICT';
  }

  get isAiUnavailable() {
    return this.problem.status === 503;
  }
}

type Query = Record<string, string | number | undefined | null>;

interface RequestOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  body?: unknown;
  query?: Query;
  /** Acting agent, sent as X-User-Id (there is no auth in scope). */
  actorId?: string | null;
  signal?: AbortSignal;
}

export function buildUrl(path: string, query?: Query): string {
  const url = new URL(API_URL + path);
  for (const [key, value] of Object.entries(query ?? {})) {
    if (value !== undefined && value !== null && value !== '')
      url.searchParams.set(key, String(value));
  }
  return url.toString();
}

export async function api<T>(path: string, opts: RequestOptions = {}): Promise<T> {
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (opts.body !== undefined) headers['Content-Type'] = 'application/json';
  if (opts.actorId) headers['X-User-Id'] = opts.actorId;

  let res: Response;
  try {
    res = await fetch(buildUrl(path, opts.query), {
      method: opts.method ?? 'GET',
      headers,
      body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
      signal: opts.signal,
    });
  } catch (err) {
    if ((err as Error).name === 'AbortError') throw err;
    throw new ApiError({
      type: 'about:blank',
      title: 'API unreachable',
      status: 0,
      detail: `Could not reach the API at ${API_URL}. Check that it is running.`,
      errorCode: 'NETWORK_ERROR',
    });
  }

  if (res.status === 204) return undefined as T;
  const body: unknown = await res.json().catch(() => null);
  if (!res.ok) {
    const problem =
      body && typeof body === 'object' && 'title' in body
        ? (body as ProblemDetails)
        : {
            type: 'about:blank',
            title: res.statusText || 'Request failed',
            status: res.status,
            errorCode: 'HTTP_ERROR',
          };
    throw new ApiError(problem);
  }
  return body as T;
}

/** Message for an inline error or toast: Problem Details title + detail. */
export function describeError(err: unknown): { title: string; detail?: string } {
  if (err instanceof ApiError) {
    if (err.isAiUnavailable) {
      return {
        title: 'AI service unavailable',
        detail: 'The ticket is unchanged. Try again shortly.',
      };
    }
    if (err.isVersionConflict) {
      return {
        title: 'This ticket was updated by someone else',
        detail: 'Reload to see the latest version, then apply your change again.',
      };
    }
    const fieldErrors = err.problem.errors?.map((e) => `${e.field}: ${e.message}`).join('; ');
    return { title: err.problem.title, detail: fieldErrors || err.problem.detail };
  }
  return { title: 'Something went wrong', detail: (err as Error)?.message };
}
