// Single entry point for the domain reads and writes made by the screens (SDE T17, T145, T378).
// - Server mode (a Supabase backend is configured): the authenticated /api functions are the source of
//   truth. They authorize every object access with the caller's verified token and Postgres RLS, so
//   the client-side permission checks in the screens only shape the UI. Tenant data is kept in memory.
// - Demo mode: the local simulation (AppStorage + SimulationEngine) as before.
import { AppStorage } from './storage';
import type { ServerSnapshot } from './storage';
import { SimulationEngine, notifyDataChanged } from './simulation';
import { apiRequest } from './apiClient';
import { isServerDataMode } from '../config/runtime';
import { canAssignRole, generateRecordId, logAuditEvent, sessionHasPermission } from './security';
import { INITIAL_USERS } from '../mock/initialData';
import { CONSENT_NOTICE_VERSION, CONSENT_PURPOSES } from './privacyNotice';
import type { ConsentDecision, ConsentPurpose } from './privacyNotice';
import type { Automation, AutomationAction, AutomationCondition, Device, DeviceDesiredState, Integration, UserProfile, UserRole } from '../types';

export type GatewayResult = { success: true } | { success: false; error: string };

export interface AuditTrailStatus {
  verified: boolean;
  checkedEntries: number;
}

export interface NewAutomation {
  name: string;
  triggerCondition: AutomationCondition;
  action: AutomationAction;
  intervalSeconds: number;
}

export interface NewIntegration {
  name: string;
  type: Integration['type'];
  endpointUrl?: string;
}

export interface NewTeamMember {
  fullName: string;
  email: string;
  role: UserRole;
}

const SYNC_INTERVAL_MS = 15000;
// SDE T148: the in-memory copy of tenant data expires when it could not be refreshed for this long.
const DEFAULT_CACHE_TTL_MS = 5 * 60 * 1000;

let syncTimer: ReturnType<typeof setInterval> | null = null;
let auditTrail: AuditTrailStatus | null = null;
let lastSyncError: string | null = null;
let localTeam: UserProfile[] | null = null;
let cacheTtlMs = DEFAULT_CACHE_TTL_MS;
let lastRefreshAt: number | null = null;
let stepUpRequired = false;
let consents: ConsentDecision[] = [];

// Monotonic clock: changing the device date or time cannot extend the life of cached data.
function monotonicNow(): number {
  return typeof performance !== 'undefined' && typeof performance.now === 'function' ? performance.now() : Date.now();
}

const ok: GatewayResult = { success: true };
const fail = (error: string): GatewayResult => ({ success: false, error });

// Server mode: every change is a command the API authorizes; the server copy is reloaded afterwards.
// Once the command succeeded it is reported as done; a failed reload shows in the sync banner instead
// (so users do not retry and create duplicates).
async function sendCommand(command: string, input: Record<string, unknown>): Promise<GatewayResult> {
  const response = await apiRequest('POST', 'commands', { command, input });
  if (!response.ok) return fail(response.error || 'The request failed.');
  await DataGateway.refresh();
  return ok;
}

export class DataGateway {
  static isServerMode(): boolean {
    return isServerDataMode();
  }

  // Loads the caller's tenant data from /api/data into the in-memory cache.
  static async refresh(): Promise<GatewayResult> {
    if (!isServerDataMode()) {
      notifyDataChanged();
      return ok;
    }
    const response = await apiRequest<
      ServerSnapshot & { auditTrail?: AuditTrailStatus; profile?: UserProfile; stepUpRequired?: boolean; privacy?: { consents: ConsentDecision[] } }
    >('GET', 'data');
    if (!response.ok || !response.data) {
      lastSyncError = response.error || 'Could not load data from the server.';
      if (lastRefreshAt !== null && monotonicNow() - lastRefreshAt > cacheTtlMs) {
        AppStorage.clearServerData();
        auditTrail = null;
        lastRefreshAt = null;
      }
      notifyDataChanged();
      return fail(lastSyncError);
    }
    AppStorage.applyServerSnapshot(response.data);
    lastRefreshAt = monotonicNow();
    // The profile served by the API (same role and tenant, otherwise the API answers 401) carries
    // the latest name and e-mail.
    const sessionUser = AppStorage.getSessionUser();
    const served = response.data.profile;
    if (sessionUser && served && served.id === sessionUser.id) {
      AppStorage.setCurrentUser({ ...sessionUser, fullName: served.fullName, email: served.email });
    }
    auditTrail = response.data.auditTrail ?? null;
    stepUpRequired = response.data.stepUpRequired === true;
    consents = Array.isArray(response.data.privacy?.consents) ? response.data.privacy!.consents : [];
    lastSyncError = null;
    notifyDataChanged();
    return ok;
  }

  static startSync(intervalMs = SYNC_INTERVAL_MS): void {
    if (!isServerDataMode()) return;
    DataGateway.stopSync();
    void DataGateway.refresh();
    syncTimer = setInterval(() => {
      void DataGateway.refresh();
    }, intervalMs);
  }

  static stopSync(): void {
    if (syncTimer) clearInterval(syncTimer);
    syncTimer = null;
  }

  // Called on logout: stops polling and forgets everything kept in memory for the session.
  static reset(): void {
    DataGateway.stopSync();
    auditTrail = null;
    lastSyncError = null;
    localTeam = null;
    lastRefreshAt = null;
    stepUpRequired = false;
    consents = [];
  }

  static setCacheTtl(ttlMs: number): void {
    cacheTtlMs = ttlMs > 0 ? ttlMs : DEFAULT_CACHE_TTL_MS;
  }

  static getLastSyncError(): string | null {
    return lastSyncError;
  }

  static getAuditTrailStatus(): AuditTrailStatus | null {
    return auditTrail;
  }

  // SDE T338: the server withheld team or integration data until the session is verified with a second factor.
  static isStepUpRequired(): boolean {
    return stepUpRequired;
  }

  static async updateDesiredState(deviceId: string, updates: Partial<DeviceDesiredState>): Promise<GatewayResult> {
    if (isServerDataMode()) return sendCommand('device.setDesiredState', { deviceId, desiredState: updates });
    const result = SimulationEngine.updateDesiredState(deviceId, updates);
    return result.success ? ok : fail(result.error || 'The command failed.');
  }

  static async enrollDevice(data: {
    name: string;
    code: string;
    type: Device['type'];
    buildingId: string;
    roomId: string;
    organizationId: string;
  }): Promise<GatewayResult> {
    if (isServerDataMode()) {
      // The organization is taken from the verified token on the server.
      const response = await apiRequest('POST', 'devices', {
        name: data.name,
        code: data.code,
        type: data.type,
        buildingId: data.buildingId,
        roomId: data.roomId,
      });
      if (!response.ok) return fail(response.error || 'Failed to enroll device');
      await DataGateway.refresh();
      return ok;
    }
    const result = SimulationEngine.enrollDevice(data);
    return result.success ? ok : fail(result.error || 'Failed to enroll device');
  }

  static async setAlertStatus(alertId: string, status: 'acknowledged' | 'resolved'): Promise<GatewayResult> {
    if (isServerDataMode()) return sendCommand('alert.setStatus', { alertId, status });
    if (!sessionHasPermission('alerts:update')) return fail('Your role is not allowed to update alerts.');
    const all = AppStorage.getAlerts();
    const target = all.find((a) => a.id === alertId && a.organizationId === AppStorage.getActiveOrgId());
    if (!target) return fail('Alert not found');
    target.status = status;
    if (status === 'resolved') target.resolvedAt = new Date().toISOString();
    AppStorage.setAlerts(all);
    logAuditEvent(status === 'resolved' ? 'alert_resolved' : 'alert_acknowledged', { alertId, title: target.title });
    notifyDataChanged();
    return ok;
  }

  static async setAutomationEnabled(automationId: string, enabled: boolean): Promise<GatewayResult> {
    if (isServerDataMode()) return sendCommand('automation.setEnabled', { automationId, enabled });
    if (!sessionHasPermission('automations:write')) return fail('Your role is not allowed to change automations.');
    const all = AppStorage.getAutomations();
    const target = all.find((a) => a.id === automationId && a.organizationId === AppStorage.getActiveOrgId());
    if (!target) return fail('Automation not found');
    target.enabled = enabled;
    AppStorage.setAutomations(all);
    notifyDataChanged();
    return ok;
  }

  static async createAutomation(input: NewAutomation): Promise<GatewayResult> {
    if (isServerDataMode()) {
      return sendCommand('automation.create', {
        name: input.name,
        triggerCondition: input.triggerCondition,
        action: input.action,
        intervalSeconds: input.intervalSeconds,
      });
    }
    if (!sessionHasPermission('automations:write')) return fail('Your role is not allowed to change automations.');
    const rule: Automation = {
      id: generateRecordId('a_'),
      organizationId: AppStorage.getActiveOrgId(),
      name: input.name,
      enabled: true,
      triggerType: input.action.command === 'set_target_temp' ? 'temperature_threshold' : 'power_threshold',
      triggerCondition: input.triggerCondition,
      action: input.action,
      intervalSeconds: input.intervalSeconds,
      executionCount: 0,
      notifyOnRun: true,
      createdAt: new Date().toISOString(),
    };
    AppStorage.setAutomations([rule, ...AppStorage.getAutomations()]);
    notifyDataChanged();
    return ok;
  }

  static async setIntegrationActive(integrationId: string, active: boolean): Promise<GatewayResult> {
    if (isServerDataMode()) return sendCommand('integration.setActive', { integrationId, active });
    if (!sessionHasPermission('integrations:manage')) return fail('Your role is not allowed to manage integrations.');
    const all = AppStorage.getIntegrations();
    const item = all.find((x) => x.id === integrationId && x.organizationId === AppStorage.getActiveOrgId());
    if (!item) return fail('Integration not found');
    item.active = active;
    AppStorage.setIntegrations(all);
    logAuditEvent('integration_toggled', { id: integrationId, name: item.name, active });
    notifyDataChanged();
    return ok;
  }

  static async createIntegration(input: NewIntegration): Promise<GatewayResult> {
    if (isServerDataMode()) {
      return sendCommand('integration.create', {
        name: input.name,
        type: input.type,
        ...(input.endpointUrl ? { endpointUrl: input.endpointUrl } : {}),
      });
    }
    if (!sessionHasPermission('integrations:manage')) return fail('Your role is not allowed to manage integrations.');
    const integration: Integration = {
      id: generateRecordId('i_'),
      organizationId: AppStorage.getActiveOrgId(),
      name: input.name,
      type: input.type,
      endpointUrl: input.endpointUrl,
      apiKeyMasked: 'acme_live_••••••••••••' + generateRecordId('').slice(-4),
      active: true,
      createdAt: new Date().toISOString(),
    };
    AppStorage.setIntegrations([integration, ...AppStorage.getIntegrations()]);
    logAuditEvent('integration_created', { name: integration.name, type: integration.type });
    notifyDataChanged();
    return ok;
  }

  static async startRollout(firmwareId: string): Promise<GatewayResult> {
    if (isServerDataMode()) return sendCommand('firmware.startRollout', { firmwareId });
    const result = SimulationEngine.startRollout(firmwareId);
    return result.success ? ok : fail(result.error || 'The rollout could not be started.');
  }

  static async rollbackRollout(rolloutId: string): Promise<GatewayResult> {
    if (isServerDataMode()) return sendCommand('firmware.rollback', { rolloutId });
    const result = SimulationEngine.rollbackRollout(rolloutId);
    return result.success ? ok : fail(result.error || 'The rollout could not be rolled back.');
  }

  // SDE T742: self-service correction of the signed-in member's name.
  static async updateOwnProfile(fullName: string): Promise<GatewayResult> {
    const name = fullName.trim();
    if (name.length < 2 || name.length > 100) return fail('Enter a name between 2 and 100 characters.');
    if (isServerDataMode()) return sendCommand('profile.update', { fullName: name });
    const user = AppStorage.getSessionUser();
    if (!user) return fail('Sign in required.');
    AppStorage.setCurrentUser({ ...user, fullName: name });
    notifyDataChanged();
    return ok;
  }

  // SDE T604: the member's current consent decisions (server: their own records for the current notice).
  static getConsents(): ConsentDecision[] {
    return consents.filter((c) => c.noticeVersion === CONSENT_NOTICE_VERSION);
  }

  // SDE T178, T604: records the member's choices (opt-in or withdrawal) for the purposes that changed.
  static async recordConsents(choices: Partial<Record<ConsentPurpose, boolean>>, locale: 'en' | 'pt-BR' = 'en'): Promise<GatewayResult> {
    const current = new Map(DataGateway.getConsents().map((c) => [c.purpose, c.granted]));
    const changed = CONSENT_PURPOSES.filter((purpose) => purpose in choices && current.get(purpose) !== choices[purpose]);
    if (!isServerDataMode()) {
      const decidedAt = new Date().toISOString();
      const kept = consents.filter((c) => !changed.includes(c.purpose));
      consents = [...kept, ...changed.map((purpose) => ({ purpose, granted: Boolean(choices[purpose]), noticeVersion: CONSENT_NOTICE_VERSION, decidedAt }))];
      notifyDataChanged();
      return ok;
    }
    for (const purpose of changed) {
      const response = await apiRequest('POST', 'commands', {
        command: 'consent.record',
        input: { purpose, granted: Boolean(choices[purpose]), noticeVersion: CONSENT_NOTICE_VERSION, locale },
      });
      if (!response.ok) return fail(response.error || 'Your choice could not be saved.');
    }
    await DataGateway.refresh();
    return ok;
  }

  static getTeamMembers(): UserProfile[] {
    if (isServerDataMode()) return AppStorage.getServerTeam();
    return localTeam ?? INITIAL_USERS;
  }

  static async inviteTeamMember(input: NewTeamMember): Promise<GatewayResult> {
    if (isServerDataMode()) return sendCommand('team.invite', { fullName: input.fullName, email: input.email, role: input.role });
    // SDE T14: administrators cannot grant owner/administrator; only owners can.
    if (!canAssignRole(AppStorage.getSessionUser()?.role, input.role)) return fail('Your role cannot assign this role.');
    const member: UserProfile = {
      id: generateRecordId('u_'),
      email: input.email,
      fullName: input.fullName,
      organizationId: AppStorage.getActiveOrgId(),
      role: input.role,
      createdAt: new Date().toISOString(),
    };
    localTeam = [...(localTeam ?? INITIAL_USERS), member];
    logAuditEvent('team_member_invited', { email: member.email, role: member.role });
    notifyDataChanged();
    return ok;
  }
}
