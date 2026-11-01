// Shared security layer for the Vercel API routes (files under api/_lib are not deployed as functions).
// Every route goes through createRoute(): verb allow-list, CORS allow-list, CSRF origin check, rate
// limiting, Supabase JWT authentication, a check of the caller's current membership, central RBAC,
// bounded JSON bodies, schema-checked responses and structured security logging.
import type { IncomingMessage, ServerResponse } from 'http';
import { createHmac, createPublicKey, timingSafeEqual, verify as verifySignature } from 'crypto';
import type { JsonWebKey } from 'crypto';
import { z } from 'zod';
import { checkRateLimit, hasPermission, isUserRole } from '../../src/services/securityCore';
import type { Permission } from '../../src/services/securityCore';
import type { UserRole } from '../../src/types';
import { supabaseRest } from './supabaseRest';
import type { RestResponse } from './supabaseRest';

export type HttpMethod = 'GET' | 'POST' | 'PATCH';

export interface Principal {
  userId: string;
  organizationId: string;
  role: UserRole;
  // Authenticator assurance level of the session: aal2 once a second factor (TOTP) was verified.
  aal: 'aal1' | 'aal2';
}

// The caller's profile as currently stored in the database (read with the caller's own token).
export interface MemberProfile {
  id: string;
  email: string;
  fullName: string;
  organizationId: string;
  role: UserRole;
  createdAt: string;
}

export class ApiError extends Error {
  readonly status: number;
  readonly publicMessage: string;
  readonly reason: string;

  constructor(status: number, publicMessage: string, reason: string = publicMessage) {
    super(reason);
    this.status = status;
    this.publicMessage = publicMessage;
    this.reason = reason;
  }
}

const MAX_BODY_BYTES = 50 * 1024;
const CLOCK_SKEW_SECONDS = 30;
const MIN_HMAC_SECRET_LENGTH = 32;
const MIN_RSA_MODULUS_BITS = 2048;
const CORS_MAX_AGE_SECONDS = 600;
const ALLOWED_REQUEST_HEADERS = ['authorization', 'content-type'];
const ALLOWED_JWT_ALGS = new Set(['HS256', 'ES256', 'RS256']);
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function header(req: IncomingMessage, name: string): string | undefined {
  const value = req.headers[name];
  if (Array.isArray(value)) return value[0];
  return value;
}

// SDE T32, T45, T2602: structured security log line (timestamp, source IP, event, status code).
// Tokens, bodies and personal data are never logged.
export function logSecurityEvent(
  event: string,
  details: { route: string; method: string; ip: string; status: number; reason?: string; userId?: string }
): void {
  console.warn(
    JSON.stringify({
      level: 'warn',
      category: 'security',
      event,
      timestamp: new Date().toISOString(),
      route: details.route,
      method: details.method,
      sourceIp: details.ip,
      status: details.status,
      reason: details.reason,
      userId: details.userId,
    })
  );
}

// SDE T2602: structured activity log for every successful change made through the API (who, which
// tenant, which object, which fields and their new values). Tokens and personal data are never logged.
export function logActivityEvent(
  event: string,
  details: {
    route: string;
    method: string;
    userId: string;
    organizationId: string;
    objectType: string;
    objectId: string;
    changes?: Record<string, unknown>;
  }
): void {
  console.info(
    JSON.stringify({
      level: 'info',
      category: 'activity',
      event,
      timestamp: new Date().toISOString(),
      route: details.route,
      method: details.method,
      userId: details.userId,
      organizationId: details.organizationId,
      objectType: details.objectType,
      objectId: details.objectId,
      changes: details.changes,
    })
  );
}

// Vercel overwrites x-forwarded-for with the real client address.
export function getClientIp(req: IncomingMessage): string {
  const forwarded = (header(req, 'x-forwarded-for') || '').split(',')[0].trim();
  return forwarded || header(req, 'x-real-ip') || req.socket?.remoteAddress || 'unknown';
}

function isLocalHost(host: string): boolean {
  return /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/i.test(host);
}

// SDE T257, T553: refuse requests that reached the platform over plain HTTP (except local dev),
// and any plain-HTTP request that claims an HTTPS origin.
export function isInsecureTransport(req: IncomingMessage): boolean {
  const proto = (header(req, 'x-forwarded-proto') || '').split(',')[0].trim().toLowerCase();
  if (!proto || proto === 'https') return false;
  const origin = (header(req, 'origin') || '').toLowerCase();
  if (origin.startsWith('https://')) return true;
  return !isLocalHost(header(req, 'host') || '');
}

// SDE T257: exact-match allow-list of trusted origins (comma-separated ALLOWED_ORIGINS).
// Wildcards and malformed entries are ignored, so the default is "no cross-origin access".
export function getAllowedOrigins(env: NodeJS.ProcessEnv = process.env): Set<string> {
  const origins = new Set<string>();
  (env.ALLOWED_ORIGINS || '').split(',').forEach((entry) => {
    const value = entry.trim();
    if (!value || value.includes('*')) return;
    try {
      const url = new URL(value);
      if (url.origin !== 'null') origins.add(url.origin.toLowerCase());
    } catch {
      // ignore malformed entries
    }
  });
  return origins;
}

function isSameOrigin(req: IncomingMessage, origin: string): boolean {
  const host = header(req, 'x-forwarded-host') || header(req, 'host');
  if (!host) return false;
  const proto = (header(req, 'x-forwarded-proto') || (isLocalHost(host) ? 'http' : 'https')).split(',')[0].trim();
  return origin.toLowerCase() === `${proto}://${host}`.toLowerCase();
}

function applySecurityHeaders(res: ServerResponse, cors: boolean): void {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Content-Security-Policy', "default-src 'none'; frame-ancestors 'none'");
  res.setHeader('Referrer-Policy', 'no-referrer');
  // SDE T64: API responses are never cached.
  res.setHeader('Cache-Control', 'no-store, no-cache, max-age=0, must-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  if (cors) res.setHeader('Vary', 'Origin');
}

function applyCorsHeaders(res: ServerResponse, origin: string, methods: string[]): void {
  res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Access-Control-Allow-Methods', methods.join(', '));
  res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
  res.setHeader('Access-Control-Max-Age', String(CORS_MAX_AGE_SECONDS));
}

const ErrorResponseSchema = z.object({ error: z.string() }).strict();

// SDE T2139: every JSON response is validated against an explicit schema before it is sent.
export function sendJson<T>(res: ServerResponse, status: number, schema: z.ZodType<T>, body: unknown): void {
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    console.error(
      JSON.stringify({ level: 'error', category: 'security', event: 'response_schema_violation', timestamp: new Date().toISOString() })
    );
    res.statusCode = 500;
    res.end(JSON.stringify({ error: 'Internal server error' }));
    return;
  }
  res.statusCode = status;
  res.end(JSON.stringify(parsed.data));
}

function sendError(res: ServerResponse, status: number, message: string): void {
  sendJson(res, status, ErrorResponseSchema, { error: message });
}

function extractBearerToken(req: IncomingMessage): string | null {
  const value = header(req, 'authorization');
  if (!value) return null;
  const match = /^Bearer\s+([A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)$/i.exec(value.trim());
  return match ? match[1] : null;
}

interface JwtConfig {
  hmacSecret?: string;
  jwks: Array<JsonWebKey & { kid?: string; alg?: string }>;
  issuer?: string;
}

// Verification keys come from the environment: SUPABASE_JWT_SECRET (HS256 projects) and/or
// SUPABASE_JWKS (JSON of <project>/auth/v1/.well-known/jwks.json for asymmetric signing keys).
function loadJwtConfig(env: NodeJS.ProcessEnv): JwtConfig {
  const secret = (env.SUPABASE_JWT_SECRET || '').trim();
  let jwks: JwtConfig['jwks'] = [];
  if (env.SUPABASE_JWKS) {
    try {
      const parsed = JSON.parse(env.SUPABASE_JWKS);
      jwks = Array.isArray(parsed?.keys) ? parsed.keys : [];
    } catch {
      jwks = [];
    }
  }
  const baseUrl = (env.SUPABASE_URL || env.EXPO_PUBLIC_SUPABASE_URL || '').trim().replace(/\/+$/, '');
  return {
    hmacSecret: secret.length >= MIN_HMAC_SECRET_LENGTH ? secret : undefined,
    jwks,
    issuer: baseUrl ? `${baseUrl}/auth/v1` : undefined,
  };
}

function unauthorized(reason: string): ApiError {
  return new ApiError(401, 'Authentication required', reason);
}

function decodeSegment(segment: string): any {
  return JSON.parse(Buffer.from(segment, 'base64url').toString('utf8'));
}

// SDE T184, T558, T553: verifies a Supabase access token (signature, algorithm, expiry, issuer,
// audience, subject) and returns the caller's identity, organization and role. The org_id and
// user_role claims are added by public.custom_access_token_hook (see supabase/migrations).
export function verifyAccessToken(
  token: string,
  env: NodeJS.ProcessEnv = process.env,
  nowSeconds: number = Math.floor(Date.now() / 1000)
): Principal {
  const { hmacSecret, jwks, issuer } = loadJwtConfig(env);
  if ((!hmacSecret && jwks.length === 0) || !issuer) {
    throw new ApiError(503, 'Authentication is temporarily unavailable', 'no JWT verification key or issuer configured');
  }

  const parts = token.split('.');
  if (parts.length !== 3) throw unauthorized('malformed token');
  let jwtHeader: any;
  let payload: any;
  try {
    jwtHeader = decodeSegment(parts[0]);
    payload = decodeSegment(parts[1]);
  } catch {
    throw unauthorized('undecodable token');
  }
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw unauthorized('invalid payload');

  const alg = jwtHeader?.alg;
  if (typeof alg !== 'string' || !ALLOWED_JWT_ALGS.has(alg)) throw unauthorized('unsupported algorithm');

  const signingInput = Buffer.from(`${parts[0]}.${parts[1]}`);
  const signature = Buffer.from(parts[2], 'base64url');
  if (alg === 'HS256') {
    if (!hmacSecret) throw unauthorized('HS256 tokens are not accepted');
    const expected = createHmac('sha256', hmacSecret).update(signingInput).digest();
    if (expected.length !== signature.length || !timingSafeEqual(expected, signature)) {
      throw unauthorized('invalid signature');
    }
  } else {
    const jwk = jwks.find((k) => k.kid === jwtHeader.kid && (!k.alg || k.alg === alg));
    const keyMatchesAlg =
      !!jwk && ((alg === 'ES256' && jwk.kty === 'EC' && jwk.crv === 'P-256') || (alg === 'RS256' && jwk.kty === 'RSA'));
    if (!jwk || !keyMatchesAlg) throw unauthorized('unknown signing key');
    let valid = false;
    try {
      const key = createPublicKey({ key: jwk, format: 'jwk' });
      // SDE T60/T445: only approved key sizes (RSA >= 2048 bits; EC keys are pinned to P-256 above).
      const rsaTooSmall = alg === 'RS256' && (key.asymmetricKeyDetails?.modulusLength ?? 0) < MIN_RSA_MODULUS_BITS;
      valid =
        !rsaTooSmall &&
        (alg === 'ES256'
          ? verifySignature('sha256', signingInput, { key, dsaEncoding: 'ieee-p1363' }, signature)
          : verifySignature('sha256', signingInput, key, signature));
    } catch {
      valid = false;
    }
    if (!valid) throw unauthorized('invalid signature');
  }

  if (typeof payload.exp !== 'number' || nowSeconds >= payload.exp + CLOCK_SKEW_SECONDS) throw unauthorized('token expired');
  if (typeof payload.nbf === 'number' && payload.nbf > nowSeconds + CLOCK_SKEW_SECONDS) throw unauthorized('token not yet valid');
  if (typeof payload.iat === 'number' && payload.iat > nowSeconds + CLOCK_SKEW_SECONDS) throw unauthorized('token issued in the future');
  if (payload.iss !== issuer) throw unauthorized('unexpected issuer');
  const aud = payload.aud;
  if (!(aud === 'authenticated' || (Array.isArray(aud) && aud.includes('authenticated')))) throw unauthorized('unexpected audience');
  if (payload.role !== 'authenticated') throw unauthorized('not an end-user token');
  if (typeof payload.sub !== 'string' || !UUID_RE.test(payload.sub)) throw unauthorized('invalid subject');

  if (typeof payload.org_id !== 'string' || !UUID_RE.test(payload.org_id) || !isUserRole(payload.user_role)) {
    throw new ApiError(403, 'Forbidden', 'token has no organization membership');
  }
  return { userId: payload.sub, organizationId: payload.org_id, role: payload.user_role, aal: payload.aal === 'aal2' ? 'aal2' : 'aal1' };
}

// SDE T338: critical requests involving personal or secret-bearing data need a session verified with
// a second factor. The public message lets the app ask the user to complete two-step verification.
export const STEP_UP_REQUIRED = 'Two-step verification required';

export function requireStepUp(principal: Principal, what: string): void {
  if (principal.aal !== 'aal2') throw new ApiError(403, STEP_UP_REQUIRED, `${what} requires an aal2 session`);
}

// SDE T93, T26: a signed JWT stays valid until it expires, so the Auth server is asked whether its
// session still exists (Supabase answers 401/403 once the user logged out or the session was revoked).
// Any other failure fails closed.
const SESSION_CHECK_TIMEOUT_MS = 3000;

export async function assertSessionActive(token: string, env: NodeJS.ProcessEnv = process.env): Promise<void> {
  const baseUrl = (env.SUPABASE_URL || env.EXPO_PUBLIC_SUPABASE_URL || '').trim().replace(/\/+$/, '');
  const apiKey = (env.SUPABASE_ANON_KEY || env.EXPO_PUBLIC_SUPABASE_ANON_KEY || '').trim();
  if (!baseUrl || !apiKey) {
    throw new ApiError(503, 'Authentication is temporarily unavailable', 'session check is not configured');
  }
  let response: Response;
  try {
    response = await fetch(`${baseUrl}/auth/v1/user`, {
      headers: { apikey: apiKey, Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(SESSION_CHECK_TIMEOUT_MS),
    });
  } catch {
    throw new ApiError(503, 'Authentication is temporarily unavailable', 'session check unreachable');
  }
  if (response.status === 401 || response.status === 403) throw unauthorized('session revoked or expired');
  if (!response.ok) {
    throw new ApiError(503, 'Authentication is temporarily unavailable', `session check answered ${response.status}`);
  }
}

// SDE T20, T15, T378: authorization uses the caller's current profile, read from the database with
// the caller's own token. A token whose organization or role no longer matches (privilege change) is
// refused with 401, so the client must authenticate again and gets a new session; a removed
// membership is refused with 401 as well. Fails closed when the profile cannot be read.
export async function loadCurrentMembership(
  token: string,
  principal: Principal,
  env: NodeJS.ProcessEnv = process.env
): Promise<MemberProfile> {
  let response: RestResponse;
  try {
    response = await supabaseRest(
      'GET',
      `user_profiles?select=id,email,full_name,organization_id,role,created_at&id=eq.${principal.userId}&limit=1`,
      token,
      { env }
    );
  } catch {
    throw new ApiError(503, 'Authentication is temporarily unavailable', 'membership check unreachable');
  }
  if (response.status === 401) throw unauthorized('data store rejected the token');
  if (response.status !== 200 || !Array.isArray(response.body)) {
    throw new ApiError(503, 'Authentication is temporarily unavailable', `membership check answered ${response.status}`);
  }
  const row = response.body[0] as Record<string, unknown> | undefined;
  // A removed member must sign in again (and is then refused), so the app drops its cached data at once.
  if (!row) throw unauthorized('organization membership no longer exists');
  if (row.organization_id !== principal.organizationId || row.role !== principal.role || !isUserRole(row.role)) {
    throw unauthorized('organization or role changed after the token was issued; a new session is required');
  }
  return {
    id: principal.userId,
    email: typeof row.email === 'string' ? row.email : '',
    fullName: typeof row.full_name === 'string' ? row.full_name : '',
    organizationId: principal.organizationId,
    role: row.role,
    createdAt: typeof row.created_at === 'string' ? row.created_at : '',
  };
}

// SDE T228, T536, T553: JSON only, at most 50 KB (bytes, not characters).
export function readJsonBody(
  req: IncomingMessage,
  maxBytes = MAX_BODY_BYTES,
  allowedContentTypes: readonly string[] = ['application/json']
): Promise<unknown> {
  const contentType = (header(req, 'content-type') || '').split(';')[0].trim().toLowerCase();
  if (!allowedContentTypes.includes(contentType)) {
    return Promise.reject(new ApiError(415, 'Unsupported media type', `unexpected content type ${contentType || '(none)'}`));
  }
  const declared = Number(header(req, 'content-length') || 0);
  if (declared > maxBytes) {
    return Promise.reject(new ApiError(413, 'Payload too large', `declared ${declared} bytes`));
  }
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    let tooLarge = false;
    req.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > maxBytes) {
        tooLarge = true; // keep draining without buffering so memory stays bounded
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (tooLarge) return reject(new ApiError(413, 'Payload too large', `received more than ${maxBytes} bytes`));
      const text = Buffer.concat(chunks).toString('utf8');
      if (!text) return resolve({});
      try {
        resolve(JSON.parse(text));
      } catch {
        reject(new ApiError(400, 'Invalid request', 'body is not valid JSON'));
      }
    });
    req.on('error', () => reject(new ApiError(400, 'Invalid request', 'request stream error')));
  });
}

// SDE T32, T98: schema validation of request input. The client gets a generic message; the log gets
// the names (never the values) of the offending fields.
export function validateInput<T>(schema: z.ZodType<T>, raw: unknown): T {
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    const fields = Array.from(
      new Set(
        parsed.error.issues.flatMap((i) =>
          i.code === 'unrecognized_keys' ? i.keys.map((k) => [...i.path, k].join('.')) : [i.path.join('.') || '(root)']
        )
      )
    );
    throw new ApiError(400, 'Invalid request', `invalid fields: ${fields.join(', ')}`);
  }
  return parsed.data;
}

export interface RequestContext {
  req: IncomingMessage;
  res: ServerResponse;
  principal: Principal | null;
  // The caller's verified access token, forwarded to Supabase so RLS applies (null on public routes).
  accessToken: string | null;
  profile: MemberProfile | null;
  clientIp: string;
  readBody: <T>(schema: z.ZodType<T>) => Promise<T>;
  send: <T>(status: number, schema: z.ZodType<T>, body: T) => void;
}

export interface MethodConfig {
  auth: 'public' | 'required';
  // Required whenever auth is 'required'; a missing permission denies the request.
  permission?: Permission;
  handler: (ctx: RequestContext) => Promise<void> | void;
}

export interface RouteConfig {
  name: string;
  // Allows cross-origin calls from ALLOWED_ORIGINS only.
  cors?: boolean;
  // Refuse state-changing requests whose Origin is neither this site nor allow-listed (default true).
  originCheck?: boolean;
  methods: Partial<Record<HttpMethod, MethodConfig>>;
  rateLimit?: { max: number; windowMs: number };
}

function eventForStatus(status: number): string {
  switch (status) {
    case 400: return 'validation_failed';
    case 401: return 'auth_failed';
    case 403: return 'forbidden';
    case 404: return 'object_not_found';
    case 409: return 'conflict';
    case 413: return 'payload_too_large';
    case 415: return 'unsupported_media_type';
    case 422: return 'result_set_limit';
    case 502: return 'upstream_error';
    case 503: return 'auth_unavailable';
    default: return 'request_rejected';
  }
}

// SDE T184, T2141, T15, T65: builds a deny-by-default handler from a declarative route config.
export function createRoute(config: RouteConfig) {
  const methods = Object.keys(config.methods) as HttpMethod[];
  const allowHeader = [...methods, ...(config.cors ? ['OPTIONS'] : [])].join(', ');
  const limit = config.rateLimit ?? { max: 60, windowMs: 60000 };

  return async function handler(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const method = (req.method || 'GET').toUpperCase();
    const clientIp = getClientIp(req);
    let userId: string | undefined;
    const log = (event: string, status: number, reason?: string) =>
      logSecurityEvent(event, { route: config.name, method, ip: clientIp, status, reason, userId });

    applySecurityHeaders(res, Boolean(config.cors));
    try {
      if (isInsecureTransport(req)) {
        log('insecure_transport', 400);
        return sendError(res, 400, 'HTTPS is required');
      }

      const origin = header(req, 'origin');
      const corsAllowed = Boolean(config.cors && origin && getAllowedOrigins().has(origin.toLowerCase()));

      if (method === 'OPTIONS') {
        const requestedMethod = (header(req, 'access-control-request-method') || '').toUpperCase();
        const requestedHeaders = (header(req, 'access-control-request-headers') || '')
          .split(',')
          .map((h) => h.trim().toLowerCase())
          .filter(Boolean);
        const preflightOk =
          corsAllowed &&
          methods.includes(requestedMethod as HttpMethod) &&
          requestedHeaders.every((h) => ALLOWED_REQUEST_HEADERS.includes(h));
        if (!preflightOk) {
          log('cors_rejected', 403, 'preflight from untrusted origin or with unexpected method/headers');
          return sendError(res, 403, 'Forbidden');
        }
        applyCorsHeaders(res, origin as string, methods);
        res.statusCode = 204;
        res.end();
        return;
      }

      const methodConfig = (config.methods as Partial<Record<string, MethodConfig>>)[method];
      if (!methodConfig) {
        res.setHeader('Allow', allowHeader);
        log('method_not_allowed', 405);
        return sendError(res, 405, 'Method not allowed');
      }

      if (origin && corsAllowed) applyCorsHeaders(res, origin, methods);
      // CSRF defence in depth: state-changing calls from foreign origins are refused.
      if (config.originCheck !== false && method !== 'GET' && origin && !corsAllowed && !isSameOrigin(req, origin)) {
        log('cors_rejected', 403, 'state-changing request from an untrusted origin');
        return sendError(res, 403, 'Forbidden');
      }

      // SDE T1362, T70: per-IP throttling before any authentication work.
      const ipLimit = checkRateLimit(`${config.name}:ip:${clientIp}`, limit.max, limit.windowMs);
      if (!ipLimit.allowed) {
        res.setHeader('Retry-After', String(Math.max(1, Math.ceil(ipLimit.retryAfterMs / 1000))));
        log('rate_limited', 429, 'per-IP limit');
        return sendError(res, 429, 'Too many requests');
      }

      let principal: Principal | null = null;
      let accessToken: string | null = null;
      let profile: MemberProfile | null = null;
      if (methodConfig.auth === 'required') {
        const token = extractBearerToken(req);
        if (!token) throw unauthorized('missing bearer token');
        principal = verifyAccessToken(token);
        userId = principal.userId;
        await assertSessionActive(token);
        profile = await loadCurrentMembership(token, principal);
        accessToken = token;
        if (!methodConfig.permission || !hasPermission(principal.role, methodConfig.permission)) {
          throw new ApiError(403, 'Forbidden', `role ${principal.role} lacks ${methodConfig.permission ?? 'a declared permission'}`);
        }
        const userLimit = checkRateLimit(`${config.name}:user:${principal.userId}`, limit.max, limit.windowMs);
        if (!userLimit.allowed) {
          res.setHeader('Retry-After', String(Math.max(1, Math.ceil(userLimit.retryAfterMs / 1000))));
          log('rate_limited', 429, 'per-user limit');
          return sendError(res, 429, 'Too many requests');
        }
      }

      await methodConfig.handler({
        req,
        res,
        principal,
        accessToken,
        profile,
        clientIp,
        readBody: async <T>(schema: z.ZodType<T>): Promise<T> => validateInput(schema, await readJsonBody(req)),
        send: <T>(status: number, schema: z.ZodType<T>, body: T) => sendJson(res, status, schema, body),
      });
    } catch (err) {
      if (err instanceof ApiError) {
        if (err.status === 401) res.setHeader('WWW-Authenticate', 'Bearer');
        log(eventForStatus(err.status), err.status, err.reason);
        return sendError(res, err.status, err.publicMessage);
      }
      log('server_error', 500, 'unexpected error');
      return sendError(res, 500, 'Internal server error');
    }
  };
}
