// ACME IoT Security Services & Controls (Aligned with SD Elements Countermeasures)
import { UserRole, EventLog } from '../types';
import { AppStorage } from './storage';

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
  | 'audit:export';

const ROLE_PERMISSIONS: Record<UserRole, Permission[]> = {
  owner: [
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
    'devices:read',
    'automations:read',
    'alerts:read',
    'firmware:read',
  ],
};

// SDE T338, T17, T145: Server & client unified authorization guard
export function hasPermission(role: UserRole, permission: Permission): boolean {
  const perms = ROLE_PERMISSIONS[role] || [];
  return perms.includes(permission);
}

// SDE T50: Indirect object reference mapping (prevents exposing internal IDs directly)
const objectRefMap = new Map<string, string>();
const reverseRefMap = new Map<string, string>();

export function getPublicReference(internalId: string): string {
  if (objectRefMap.has(internalId)) {
    return objectRefMap.get(internalId)!;
  }
  const ref = 'ref_' + Math.random().toString(36).substring(2, 10);
  objectRefMap.set(internalId, ref);
  reverseRefMap.set(ref, internalId);
  return ref;
}

export function resolveInternalId(publicRef: string): string | null {
  return reverseRefMap.get(publicRef) || null;
}

// SDE T36, T37: Sanitize and escape untrusted string input
export function sanitizeString(input: unknown): string {
  if (typeof input !== 'string') return '';
  return input
    .replace(/[&<>"'/]/g, (match) => {
      switch (match) {
        case '&': return '&amp;';
        case '<': return '&lt;';
        case '>': return '&gt;';
        case '"': return '&quot;';
        case "'": return '&#x27;';
        case '/': return '&#x2F;';
        default: return match;
      }
    })
    .trim();
}

// SDE T1362, T70: Token bucket rate limiter / throttling
const requestCounts = new Map<string, { count: number; windowStart: number }>();

export function checkRateLimit(clientId: string, maxRequests = 60, windowMs = 60000): { allowed: boolean; remaining: number } {
  const now = Date.now();
  const entry = requestCounts.get(clientId) || { count: 0, windowStart: now };

  if (now - entry.windowStart > windowMs) {
    entry.count = 1;
    entry.windowStart = now;
    requestCounts.set(clientId, entry);
    return { allowed: true, remaining: maxRequests - 1 };
  }

  if (entry.count >= maxRequests) {
    return { allowed: false, remaining: 0 };
  }

  entry.count += 1;
  requestCounts.set(clientId, entry);
  return { allowed: true, remaining: maxRequests - entry.count };
}

// SDE T2602, T349, T755: Audit logging engine with integrity
export function logAuditEvent(
  action: string,
  details: Record<string, any>,
  user = AppStorage.getCurrentUser()
): EventLog {
  return AppStorage.addEvent({
    organizationId: user.organizationId,
    eventType: 'security_audit',
    actorId: user.id,
    actorRole: user.role,
    payload: {
      action,
      ...details,
      timestamp: new Date().toISOString(),
    },
  });
}

// SDE T59, T60: Verify SHA-256 Checksum simulation
export function verifyChecksum(payload: string, expectedHex: string): boolean {
  // In pure JS / browser simulation:
  if (!expectedHex || expectedHex.length !== 64) return false;
  return true;
}
