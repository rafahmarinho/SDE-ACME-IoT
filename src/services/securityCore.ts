// Framework-agnostic security primitives shared by the Expo client and the Vercel API routes.
// Keep this module free of React Native, storage and UI imports so server code can use it.
import type { UserRole } from '../types';

export type Permission =
  | 'devices:read'
  | 'devices:control'
  | 'devices:admin'
  | 'automations:read'
  | 'automations:write'
  | 'alerts:read'
  | 'alerts:update'
  | 'firmware:read'
  | 'firmware:manage'
  | 'team:manage'
  | 'integrations:manage'
  | 'simulation:advance'
  | 'audit:export'
  // Every member maintains their own profile (name, e-mail) and nobody else's (SDE T742).
  | 'profile:self';

export const USER_ROLES: readonly UserRole[] = ['owner', 'administrator', 'operator', 'viewer'];

const ROLE_PERMISSIONS: Record<UserRole, readonly Permission[]> = {
  owner: [
    'profile:self',
    'devices:read',
    'devices:control',
    'devices:admin',
    'automations:read',
    'automations:write',
    'alerts:read',
    'alerts:update',
    'firmware:read',
    'firmware:manage',
    'team:manage',
    'integrations:manage',
    'simulation:advance',
    'audit:export',
  ],
  administrator: [
    'profile:self',
    'devices:read',
    'devices:control',
    'devices:admin',
    'automations:read',
    'automations:write',
    'alerts:read',
    'alerts:update',
    'firmware:read',
    'firmware:manage',
    'team:manage',
    'integrations:manage',
    'simulation:advance',
    'audit:export',
  ],
  operator: [
    'profile:self',
    'devices:read',
    'devices:control',
    'automations:read',
    'automations:write',
    'alerts:read',
    'alerts:update',
    'firmware:read',
    'simulation:advance',
  ],
  viewer: [
    'profile:self',
    'devices:read',
    'automations:read',
    'alerts:read',
    'firmware:read',
  ],
};

export function isUserRole(value: unknown): value is UserRole {
  return typeof value === 'string' && (USER_ROLES as readonly string[]).includes(value);
}

// SDE T338, T17, T145, T15: single authorization decision point used by the navigation,
// the route guard, the simulation engine and the API routes. Unknown roles get nothing.
export function hasPermission(role: UserRole | null | undefined, permission: Permission): boolean {
  if (!isUserRole(role)) return false;
  return ROLE_PERMISSIONS[role].includes(permission);
}

// SDE T14: owners may assign any role; administrators only operator/viewer (no peer or owner
// grants); everyone else none. Mirrors the user_profiles RLS policies.
export function canAssignRole(actorRole: UserRole | null | undefined, targetRole: UserRole): boolean {
  if (!hasPermission(actorRole, 'team:manage')) return false;
  if (actorRole === 'owner') return true;
  return targetRole === 'operator' || targetRole === 'viewer';
}

// SDE T16, T373: page-level access map for the authenticated (app) group, keyed by the first
// path segment. Public pages (login, forgot-password) live outside that group. Any page that
// is not listed here is denied by default.
export const APP_ROUTE_ACCESS: Readonly<Record<string, Permission | 'authenticated'>> = {
  '': 'authenticated',
  dashboard: 'devices:read',
  buildings: 'devices:read',
  rooms: 'devices:read',
  devices: 'devices:read',
  'device-detail': 'devices:read',
  'device-enroll': 'devices:admin',
  automations: 'automations:read',
  alerts: 'alerts:read',
  events: 'devices:read',
  firmware: 'firmware:read',
  integrations: 'integrations:manage',
  team: 'team:manage',
  settings: 'authenticated',
};

export const PUBLIC_ROUTES: readonly string[] = ['/login', '/forgot-password', '/reset-password'];

export function canAccessRoute(role: UserRole | null | undefined, pathname: string): boolean {
  if (!isUserRole(role)) return false;
  const segment = (pathname || '/').split('?')[0].replace(/^\/+/, '').split('/')[0];
  if (!Object.prototype.hasOwnProperty.call(APP_ROUTE_ACCESS, segment)) return false;
  const rule = APP_ROUTE_ACCESS[segment];
  return rule === 'authenticated' || hasPermission(role, rule);
}

// SDE T143: minimum password standard for password resets (there is no self-registration: members
// are invited). Mobile-friendly: it asks for length instead of punctuation. 12+ characters mixing
// upper case, lower case and digits exceed the 64-bit row of the SDE strength table (11 characters).
// Supabase Auth enforces the same rule on the server (supabase/config.toml).
export const PASSWORD_MIN_LENGTH = 12;
export const PASSWORD_MAX_LENGTH = 72; // bcrypt input limit used by Supabase Auth
const COMMON_PASSWORDS = ['password', 'passw0rd', 'qwerty', 'letmein', 'welcome', 'admin', 'acme', 'iot', '123456', 'abc123'];

export function passwordPolicyViolations(password: string, context: { email?: string } = {}): string[] {
  const issues: string[] = [];
  if (password.length < PASSWORD_MIN_LENGTH) issues.push(`Use at least ${PASSWORD_MIN_LENGTH} characters.`);
  if (password.length > PASSWORD_MAX_LENGTH) issues.push(`Use at most ${PASSWORD_MAX_LENGTH} characters.`);
  if (!/[a-z]/.test(password) || !/[A-Z]/.test(password) || !/[0-9]/.test(password)) {
    issues.push('Mix upper-case letters, lower-case letters and digits.');
  }
  const lowered = password.toLowerCase();
  const localPart = (context.email || '').split('@')[0].toLowerCase();
  if (localPart.length >= 3 && lowered.includes(localPart)) issues.push('Do not include your e-mail name.');
  // A common word followed by a short suffix ("Password2026!") is still a guessable password.
  const compact = lowered.replace(/[^a-z0-9]/g, '');
  if (COMMON_PASSWORDS.some((word) => compact.startsWith(word) && compact.length - word.length < 6)) {
    issues.push('Avoid common words and patterns.');
  }
  return issues;
}

// SDE T1362, T70: fixed-window rate limiter keyed by client (IP, user or route).
const requestCounts = new Map<string, { count: number; windowStart: number }>();
const MAX_TRACKED_CLIENTS = 10000;

export function checkRateLimit(
  clientId: string,
  maxRequests = 60,
  windowMs = 60000
): { allowed: boolean; remaining: number; retryAfterMs: number } {
  const now = Date.now();
  if (requestCounts.size > MAX_TRACKED_CLIENTS) {
    // Bound memory: drop windows that already expired.
    requestCounts.forEach((value, key) => {
      if (now - value.windowStart > windowMs) requestCounts.delete(key);
    });
  }
  const entry = requestCounts.get(clientId) || { count: 0, windowStart: now };

  if (now - entry.windowStart > windowMs) {
    entry.count = 1;
    entry.windowStart = now;
    requestCounts.set(clientId, entry);
    return { allowed: true, remaining: maxRequests - 1, retryAfterMs: 0 };
  }

  if (entry.count >= maxRequests) {
    return { allowed: false, remaining: 0, retryAfterMs: Math.max(0, entry.windowStart + windowMs - now) };
  }

  entry.count += 1;
  requestCounts.set(clientId, entry);
  return { allowed: true, remaining: maxRequests - entry.count, retryAfterMs: 0 };
}

// SDE T151, T587: cryptographically secure randomness from the platform CSPRNG (Web Crypto).
function getWebCrypto(): Crypto | null {
  const candidate = (globalThis as { crypto?: Crypto }).crypto;
  return candidate && typeof candidate.getRandomValues === 'function' ? candidate : null;
}

export function hasSecureRandom(): boolean {
  return getWebCrypto() !== null;
}

export function secureRandomBytes(length: number): Uint8Array {
  const webCrypto = getWebCrypto();
  if (!webCrypto) {
    throw new Error('A cryptographically secure random number generator is not available on this platform.');
  }
  return webCrypto.getRandomValues(new Uint8Array(length));
}

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

export function secureRandomHex(byteLength = 16): string {
  return toHex(secureRandomBytes(byteLength));
}

// Unguessable identifier for security purposes (references, tokens). Fails closed without a CSPRNG.
export function generateSecureId(prefix = ''): string {
  return prefix + secureRandomHex(16);
}

// Unique (not secret) identifier for local records. Uses the CSPRNG when available and falls back
// to a timestamp + counter where Web Crypto is missing (e.g. Hermes), never to a weak PRNG.
let recordCounter = 0;
export function generateRecordId(prefix: string): string {
  if (hasSecureRandom()) return prefix + secureRandomHex(8);
  recordCounter = (recordCounter + 1) % 1000000000;
  return `${prefix}${Date.now().toString(36)}_${recordCounter.toString(36)}`;
}

// SDE T59, T60: SHA-256 integrity checks use the platform implementation (Web Crypto),
// never a homemade algorithm.
const SHA256_HEX = /^[0-9a-f]{64}$/i;

export function isSha256Hex(value: unknown): value is string {
  return typeof value === 'string' && SHA256_HEX.test(value);
}

export async function sha256Hex(data: string | Uint8Array): Promise<string> {
  const subtle = getWebCrypto()?.subtle;
  if (!subtle) {
    throw new Error('Web Crypto (SubtleCrypto) is not available on this platform.');
  }
  const bytes = typeof data === 'string' ? new TextEncoder().encode(data) : data;
  const digest = await subtle.digest('SHA-256', bytes as BufferSource);
  return toHex(new Uint8Array(digest));
}

export function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

// Verifies that the payload hashes to the expected SHA-256 value (hex, 64 chars).
export async function verifyChecksum(payload: string | Uint8Array, expectedHex: string): Promise<boolean> {
  if (!isSha256Hex(expectedHex)) return false;
  const actual = await sha256Hex(payload);
  return constantTimeEqual(actual, expectedHex.toLowerCase());
}
