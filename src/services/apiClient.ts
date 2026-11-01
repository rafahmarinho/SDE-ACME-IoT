// Authenticated client for the ACME IoT API (/api). In server mode every data read and write goes
// through these calls, so the server decides what the signed-in user may see and change (SDE T17,
// T145, T378). The access token travels only in the Authorization header (never in URLs) and API
// responses are never cached.
import { isSecureBackendUrl } from '../config/runtime';

export interface ApiResult<T> {
  ok: boolean;
  status: number;
  data?: T;
  error?: string;
}

type TokenProvider = () => Promise<string | null>;

const REQUEST_TIMEOUT_MS = 10000;

let getAccessToken: TokenProvider = async () => null;
let onUnauthorized: (() => void) | null = null;
let baseUrlOverride: string | null = null;

export function configureApiClient(options: {
  getAccessToken: TokenProvider;
  // Called when the server rejects the session (expired, revoked or privileges changed): the app
  // signs out so the user authenticates again and gets a new session (SDE T20).
  onUnauthorized?: () => void;
  baseUrl?: string;
}): void {
  getAccessToken = options.getAccessToken;
  onUnauthorized = options.onUnauthorized ?? null;
  baseUrlOverride = options.baseUrl === undefined ? null : options.baseUrl.replace(/\/+$/, '');
}

function resolveBaseUrl(): string | null {
  if (baseUrlOverride !== null) return baseUrlOverride;
  const configured = (process.env.EXPO_PUBLIC_API_URL || '').trim().replace(/\/+$/, '');
  if (configured) return isSecureBackendUrl(configured) ? configured : null;
  // On the web the API is served from the same origin; native builds must set EXPO_PUBLIC_API_URL.
  return typeof window !== 'undefined' && typeof document !== 'undefined' ? '' : null;
}

export async function apiRequest<T>(method: 'GET' | 'POST', path: string, body?: unknown): Promise<ApiResult<T>> {
  const baseUrl = resolveBaseUrl();
  if (baseUrl === null) return { ok: false, status: 0, error: 'The ACME IoT API is not configured.' };
  const token = await getAccessToken();
  if (!token) {
    onUnauthorized?.();
    return { ok: false, status: 401, error: 'Sign in required.' };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const headers: Record<string, string> = { Accept: 'application/json', Authorization: `Bearer ${token}` };
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    const response = await fetch(`${baseUrl}/api/${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      cache: 'no-store',
      credentials: 'omit',
      signal: controller.signal,
    });
    let payload: any = null;
    try {
      payload = await response.json();
    } catch {
      payload = null;
    }
    if (response.status === 401) onUnauthorized?.();
    if (!response.ok) {
      return { ok: false, status: response.status, error: typeof payload?.error === 'string' ? payload.error : 'The request failed.' };
    }
    return { ok: true, status: response.status, data: payload as T };
  } catch {
    return { ok: false, status: 0, error: 'The server could not be reached. Please try again.' };
  } finally {
    clearTimeout(timer);
  }
}
