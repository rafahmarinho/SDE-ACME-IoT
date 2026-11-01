// Low-level access to the Supabase REST (PostgREST) endpoint for the API routes.
// Every call is made with the caller's own access token and the public anon key, so Postgres
// row-level security applies to the API exactly as it does to any other client. The service role
// key is never used by application code (SDE T227, T2598).

const UPSTREAM_TIMEOUT_MS = 5000;

export interface RestConfig {
  baseUrl: string;
  apiKey: string;
}

export interface RestResponse {
  status: number;
  body: unknown;
  headers: Headers;
}

export class UpstreamUnavailableError extends Error {
  constructor(reason: string) {
    super(reason);
  }
}

function isLocalUrl(url: URL): boolean {
  return ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
}

// SDE T21, T553: the data store is only reached over TLS (plain http only for a local stack).
export function getRestConfig(env: NodeJS.ProcessEnv = process.env): RestConfig | null {
  const baseUrl = (env.SUPABASE_URL || env.EXPO_PUBLIC_SUPABASE_URL || '').trim().replace(/\/+$/, '');
  const apiKey = (env.SUPABASE_ANON_KEY || env.EXPO_PUBLIC_SUPABASE_ANON_KEY || '').trim();
  if (!baseUrl || !apiKey) return null;
  try {
    const url = new URL(baseUrl);
    if (url.protocol !== 'https:' && !(url.protocol === 'http:' && isLocalUrl(url))) return null;
  } catch {
    return null;
  }
  return { baseUrl, apiKey };
}

export async function supabaseRest(
  method: 'GET' | 'POST' | 'PATCH',
  pathAndQuery: string,
  accessToken: string,
  options: { body?: unknown; prefer?: string[]; env?: NodeJS.ProcessEnv } = {}
): Promise<RestResponse> {
  const config = getRestConfig(options.env);
  if (!config) throw new UpstreamUnavailableError('data store is not configured');
  const headers: Record<string, string> = {
    apikey: config.apiKey,
    Authorization: `Bearer ${accessToken}`,
    Accept: 'application/json',
  };
  if (options.body !== undefined) headers['Content-Type'] = 'application/json';
  if (options.prefer && options.prefer.length > 0) headers.Prefer = options.prefer.join(', ');

  let response: Response;
  try {
    response = await fetch(`${config.baseUrl}/rest/v1/${pathAndQuery}`, {
      method,
      headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
    });
  } catch {
    throw new UpstreamUnavailableError('data store unreachable');
  }
  const text = await response.text();
  let body: unknown = null;
  if (text) {
    try {
      body = JSON.parse(text);
    } catch {
      body = null;
    }
  }
  return { status: response.status, body, headers: response.headers };
}
