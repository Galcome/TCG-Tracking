export class ApiError extends Error {
  constructor(readonly status: number, message: string) { super(message); this.name = 'ApiError'; }
}
export class SessionChangedError extends Error {
  constructor() { super('Your session changed. Please try again.'); this.name = 'SessionChangedError'; }
}
export interface RequestOptions {
  method?: string;
  headers?: Record<string, string>;
  body?: unknown;
  multipart?: boolean;
}
export interface TransportResponse {
  ok: boolean; status: number; statusText: string; json(): Promise<unknown>;
}
export type Transport = (url: string, options: RequestOptions) => Promise<TransportResponse>;
export type ApiRequest = <T>(path: string, options?: RequestOptions) => Promise<T>;
export function isWorthRetrying(error: unknown) {
  return !(error instanceof SessionChangedError) && (!(error instanceof ApiError) || error.status >= 500);
}
async function message(response: TransportResponse) {
  try {
    const data = await response.json() as { detail?: unknown };
    if (typeof data?.detail === 'string') return data.detail;
    if (Array.isArray(data?.detail)) {
      const errors = data.detail.map((item: unknown) =>
        item && typeof item === 'object' && 'msg' in item && typeof item.msg === 'string' ? item.msg : ''
      ).filter(Boolean);
      if (errors.length) return errors.join(', ');
    }
  } catch { /* A non-JSON error response still has its HTTP status. */ }
  return response.statusText || 'Request failed';
}
export function createRequest(deps: {
  baseUrl: string; getIdToken: () => Promise<string | null>; transport: Transport;
  isCurrent: () => boolean;
}): ApiRequest {
  return async <T>(path: string, options: RequestOptions = {}): Promise<T> => {
    if (!path.startsWith('/api/v1/') || path.includes('://')) throw new Error('Invalid API path');
    if (!deps.isCurrent()) throw new SessionChangedError();
    const token = await deps.getIdToken();
    if (!deps.isCurrent()) throw new SessionChangedError();
    if (!token) throw new ApiError(401, 'Not signed in');
    const response = await deps.transport(deps.baseUrl.replace(/\/$/, '') + path, {
      ...options,
      headers: {
        ...(options.multipart ? {} : { 'Content-Type': 'application/json' }),
        ...options.headers, Authorization: 'Bearer ' + token,
      },
    });
    if (!deps.isCurrent()) throw new SessionChangedError();
    if (!response.ok) throw new ApiError(response.status, await message(response));
    const data = response.status === 204 ? undefined : await response.json();
    if (!deps.isCurrent()) throw new SessionChangedError();
    return data as T;
  };
}
