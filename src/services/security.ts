// ACME IoT Security Services & Controls (Aligned with SD Elements Countermeasures)
import { EventLog, UserProfile } from '../types';
import { AppStorage } from './storage';
import { generateSecureId, hasPermission, Permission } from './securityCore';

// RBAC matrix, route access map, rate limiter, CSPRNG and SHA-256 helpers live in the
// framework-agnostic core so the API routes run exactly the same checks as the client.
export * from './securityCore';

// Central RBAC decision for the signed-in user (false when nobody is signed in).
export function sessionHasPermission(permission: Permission): boolean {
  return hasPermission(AppStorage.getSessionUser()?.role, permission);
}

// SDE T50: Indirect object reference mapping (prevents exposing internal IDs directly)
const objectRefMap = new Map<string, string>();
const reverseRefMap = new Map<string, string>();

export function getPublicReference(internalId: string): string {
  if (objectRefMap.has(internalId)) {
    return objectRefMap.get(internalId)!;
  }
  // SDE T151: references must be unguessable, so they come from the CSPRNG (128 bits).
  const ref = generateSecureId('ref_');
  objectRefMap.set(internalId, ref);
  reverseRefMap.set(ref, internalId);
  return ref;
}

export function resolveInternalId(publicRef: string): string | null {
  return reverseRefMap.get(publicRef) || null;
}

// References are valid for one session only: logout forgets them.
export function clearPublicReferences(): void {
  objectRefMap.clear();
  reverseRefMap.clear();
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

// SDE T2602, T349, T755: Audit logging engine with integrity
export function logAuditEvent(
  action: string,
  details: Record<string, any>,
  user: UserProfile | null = AppStorage.getSessionUser()
): EventLog {
  return AppStorage.addEvent({
    organizationId: user?.organizationId ?? AppStorage.getActiveOrgId(),
    eventType: 'security_audit',
    actorId: user?.id,
    actorRole: user?.role,
    payload: {
      action,
      ...details,
      timestamp: new Date().toISOString(),
    },
  });
}
