// Client storage abstraction with offline persistence and reload survival
import { Platform } from 'react-native';
import {
  Organization,
  Building,
  Room,
  Device,
  Automation,
  Alert,
  EventLog,
  FirmwarePackage,
  FirmwareRollout,
  Integration,
  UserProfile,
  SimulationScenario,
} from '../types';
import {
  INITIAL_ORGANIZATIONS,
  INITIAL_BUILDINGS,
  INITIAL_ROOMS,
  INITIAL_DEVICES,
  INITIAL_AUTOMATIONS,
  INITIAL_ALERTS,
  INITIAL_EVENTS,
  INITIAL_FIRMWARE_PACKAGES,
  INITIAL_FIRMWARE_ROLLOUTS,
  INITIAL_INTEGRATIONS,
} from '../mock/initialData';
import { isDemoModeEnabled, isServerDataMode } from '../config/runtime';
import { generateRecordId } from './securityCore';

const KEY_PREFIX = 'acme_iot_';

const STORAGE_KEYS = {
  ORGANIZATIONS: 'acme_iot_organizations_v1',
  BUILDINGS: 'acme_iot_buildings_v1',
  ROOMS: 'acme_iot_rooms_v1',
  DEVICES: 'acme_iot_devices_v1',
  AUTOMATIONS: 'acme_iot_automations_v1',
  ALERTS: 'acme_iot_alerts_v1',
  EVENTS: 'acme_iot_events_v1',
  FIRMWARE_PACKAGES: 'acme_iot_firmware_packages_v1',
  FIRMWARE_ROLLOUTS: 'acme_iot_firmware_rollouts_v1',
  INTEGRATIONS: 'acme_iot_integrations_v1',
  CURRENT_USER: 'acme_iot_current_user_v1',
  ACTIVE_ORG_ID: 'acme_iot_active_org_id_v1',
  SCENARIO: 'acme_iot_scenario_v1',
  OFFLINE_STATUS: 'acme_iot_offline_status_v1',
  SESSION_MARKER: 'acme_iot_session_open_v1',
  LOGOUT_REMINDER: 'acme_iot_logout_reminder_v1',
  TEAM: 'acme_iot_team_v1',
};

// Tenant data received from the API in server mode, as served by /api/data.
export interface ServerSnapshot {
  organization: Organization | null;
  buildings: Building[];
  rooms: Room[];
  devices: Device[];
  automations: Automation[];
  alerts: Alert[];
  events: EventLog[];
  firmwarePackages: FirmwarePackage[];
  firmwareRollouts: FirmwareRollout[];
  integrations?: Integration[];
  team?: { members: UserProfile[] };
}

// Least-privileged placeholder returned when no session exists (never the Owner persona).
const ANONYMOUS_PROFILE: UserProfile = {
  id: 'anonymous',
  email: '',
  fullName: 'Signed-out user',
  organizationId: '',
  role: 'viewer',
  createdAt: '1970-01-01T00:00:00.000Z',
};

// In-memory fallback for environments without localStorage or while initializing
const memoryStore: Record<string, string> = {};

// SDE T148, T1468, T295: in server mode nothing confidential is written to browser storage. Tenant
// data from the API and the session profile live only in this memory cache, which is replaced on every
// refresh and wiped on logout or when the tab closes. Only the non-sensitive "session open" marker is
// persisted. Demo builds keep their fictitious seed data in localStorage as before.
const serverCache: Record<string, string> = {};

function isPersistentMarker(key: string): boolean {
  return key === STORAGE_KEYS.SESSION_MARKER;
}

function rawGet(key: string): string | null {
  if (isServerDataMode() && !isPersistentMarker(key)) return serverCache[key] ?? null;
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      return window.localStorage.getItem(key);
    }
  } catch (e) {
    // ignore
  }
  return memoryStore[key] || null;
}

function rawSet(key: string, value: string): void {
  if (isServerDataMode() && !isPersistentMarker(key)) {
    serverCache[key] = value;
    return;
  }
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      window.localStorage.setItem(key, value);
    }
  } catch (e) {
    // ignore
  }
  memoryStore[key] = value;
}

function rawRemove(key: string): void {
  delete serverCache[key];
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      window.localStorage.removeItem(key);
    }
  } catch (e) {
    // ignore
  }
  delete memoryStore[key];
}

// SDE T148, T164, T295: identity, role and tenant of the signed-in user are session-scoped.
// On web they live in sessionStorage (dropped when the tab closes) instead of localStorage.
const sessionMemoryStore: Record<string, string> = {};

function getSessionStorage(): Storage | null {
  try {
    if (typeof window !== 'undefined' && window.sessionStorage) return window.sessionStorage;
  } catch (e) {
    // ignore
  }
  return null;
}

function sessionGet(key: string): string | null {
  const store = isServerDataMode() ? null : getSessionStorage();
  if (store) {
    try {
      return store.getItem(key);
    } catch (e) {
      // ignore
    }
  }
  return sessionMemoryStore[key] || null;
}

function sessionSet(key: string, value: string): void {
  const store = isServerDataMode() ? null : getSessionStorage();
  if (store) {
    try {
      store.setItem(key, value);
    } catch (e) {
      // ignore
    }
  }
  sessionMemoryStore[key] = value;
}

function isAppKey(key: string): boolean {
  return key.startsWith(KEY_PREFIX);
}

// Supabase auth persists tokens under "sb-<project-ref>-auth-token" (plus PKCE helpers).
function isSupabaseAuthKey(key: string): boolean {
  return key.startsWith('sb-') && key.includes('-auth-token');
}

function removeKeysFrom(store: Storage | null, predicate: (key: string) => boolean): void {
  if (!store) return;
  try {
    const keys: string[] = [];
    for (let i = 0; i < store.length; i++) {
      const key = store.key(i);
      if (key && predicate(key)) keys.push(key);
    }
    keys.forEach((key) => store.removeItem(key));
  } catch (e) {
    // ignore
  }
}

function getLocalStorage(): Storage | null {
  try {
    if (typeof window !== 'undefined' && window.localStorage) return window.localStorage;
  } catch (e) {
    // ignore
  }
  return null;
}

function isValidProfile(value: any): value is UserProfile {
  return (
    value !== null &&
    typeof value === 'object' &&
    typeof value.id === 'string' &&
    typeof value.email === 'string' &&
    typeof value.organizationId === 'string' &&
    ['owner', 'administrator', 'operator', 'viewer'].includes(value.role)
  );
}

// Reads a collection. Demo builds seed it with the bundled fictitious dataset; server mode never
// falls back to it (an empty list is shown until /api/data answers).
function readList<T>(key: string, seed: T[]): T[] {
  const raw = rawGet(key);
  if (!raw) {
    if (isServerDataMode()) return [];
    rawSet(key, JSON.stringify(seed));
    return seed;
  }
  try {
    return JSON.parse(raw);
  } catch {
    return isServerDataMode() ? [] : seed;
  }
}

export class AppStorage {
  static getOrganizations(): Organization[] {
    return readList(STORAGE_KEYS.ORGANIZATIONS, INITIAL_ORGANIZATIONS);
  }

  static setOrganizations(orgs: Organization[]): void {
    rawSet(STORAGE_KEYS.ORGANIZATIONS, JSON.stringify(orgs));
  }

  static getBuildings(): Building[] {
    return readList(STORAGE_KEYS.BUILDINGS, INITIAL_BUILDINGS);
  }

  static setBuildings(b: Building[]): void {
    rawSet(STORAGE_KEYS.BUILDINGS, JSON.stringify(b));
  }

  static getRooms(): Room[] {
    return readList(STORAGE_KEYS.ROOMS, INITIAL_ROOMS);
  }

  static setRooms(r: Room[]): void {
    rawSet(STORAGE_KEYS.ROOMS, JSON.stringify(r));
  }

  static getDevices(): Device[] {
    return readList(STORAGE_KEYS.DEVICES, INITIAL_DEVICES);
  }

  static setDevices(d: Device[]): void {
    rawSet(STORAGE_KEYS.DEVICES, JSON.stringify(d));
  }

  static getAutomations(): Automation[] {
    return readList(STORAGE_KEYS.AUTOMATIONS, INITIAL_AUTOMATIONS);
  }

  static setAutomations(a: Automation[]): void {
    rawSet(STORAGE_KEYS.AUTOMATIONS, JSON.stringify(a));
  }

  static getAlerts(): Alert[] {
    return readList(STORAGE_KEYS.ALERTS, INITIAL_ALERTS);
  }

  static setAlerts(al: Alert[]): void {
    rawSet(STORAGE_KEYS.ALERTS, JSON.stringify(al));
  }

  static getEvents(): EventLog[] {
    return readList(STORAGE_KEYS.EVENTS, INITIAL_EVENTS);
  }

  static setEvents(ev: EventLog[]): void {
    rawSet(STORAGE_KEYS.EVENTS, JSON.stringify(ev));
  }

  static addEvent(event: Omit<EventLog, 'id' | 'createdAt'>): EventLog {
    const full: EventLog = {
      ...event,
      id: generateRecordId('ev_'),
      createdAt: new Date().toISOString(),
    };
    const current = this.getEvents();
    const updated = [full, ...current].slice(0, 100); // keep recent 100
    this.setEvents(updated);
    return full;
  }

  static getFirmwarePackages(): FirmwarePackage[] {
    return readList(STORAGE_KEYS.FIRMWARE_PACKAGES, INITIAL_FIRMWARE_PACKAGES);
  }

  static setFirmwarePackages(f: FirmwarePackage[]): void {
    rawSet(STORAGE_KEYS.FIRMWARE_PACKAGES, JSON.stringify(f));
  }

  static getFirmwareRollouts(): FirmwareRollout[] {
    return readList(STORAGE_KEYS.FIRMWARE_ROLLOUTS, INITIAL_FIRMWARE_ROLLOUTS);
  }

  static setFirmwareRollouts(ro: FirmwareRollout[]): void {
    rawSet(STORAGE_KEYS.FIRMWARE_ROLLOUTS, JSON.stringify(ro));
  }

  static getIntegrations(): Integration[] {
    return readList(STORAGE_KEYS.INTEGRATIONS, INITIAL_INTEGRATIONS);
  }

  static setIntegrations(i: Integration[]): void {
    rawSet(STORAGE_KEYS.INTEGRATIONS, JSON.stringify(i));
  }

  // Signed-in user, or null when there is no session (authorization decisions use this).
  static getSessionUser(): UserProfile | null {
    const raw = sessionGet(STORAGE_KEYS.CURRENT_USER);
    if (!raw) return null;
    try {
      const parsed = JSON.parse(raw);
      return isValidProfile(parsed) ? parsed : null;
    } catch {
      return null;
    }
  }

  // Display helper for screens behind the route guard. Without a session it returns a
  // least-privileged anonymous placeholder; it never falls back to the Owner persona.
  static getCurrentUser(): UserProfile {
    return this.getSessionUser() ?? ANONYMOUS_PROFILE;
  }

  static setCurrentUser(user: UserProfile): void {
    sessionSet(STORAGE_KEYS.CURRENT_USER, JSON.stringify(user));
  }

  static getActiveOrgId(): string {
    const user = this.getSessionUser();
    const raw = sessionGet(STORAGE_KEYS.ACTIVE_ORG_ID);
    if (raw && (isDemoModeEnabled() || raw === user?.organizationId)) return raw;
    return user?.organizationId ?? '';
  }

  // Real sessions are pinned to the user's organization; switching tenants is a demo-only aid.
  static setActiveOrgId(orgId: string): boolean {
    const user = this.getSessionUser();
    if (!isDemoModeEnabled() && orgId !== user?.organizationId) return false;
    sessionSet(STORAGE_KEYS.ACTIVE_ORG_ID, orgId);
    return true;
  }

  // SDE T26: remember that a session was opened so the next login can remind the user
  // when the previous session was never closed with an explicit logout.
  static markSessionOpen(): void {
    rawSet(STORAGE_KEYS.SESSION_MARKER, 'true');
  }

  static hasUnclosedSession(): boolean {
    return rawGet(STORAGE_KEYS.SESSION_MARKER) === 'true';
  }

  static markSessionClosed(): void {
    rawRemove(STORAGE_KEYS.SESSION_MARKER);
  }

  static setLogoutReminder(show: boolean): void {
    sessionSet(STORAGE_KEYS.LOGOUT_REMINDER, show ? 'true' : 'false');
  }

  static shouldShowLogoutReminder(): boolean {
    return sessionGet(STORAGE_KEYS.LOGOUT_REMINDER) === 'true';
  }

  // SDE T164, T1539, T148: wipe every app key (session and cached domain data) from
  // localStorage, sessionStorage and the in-memory fallbacks. The session marker survives
  // so an expired or abandoned session still triggers the reminder on the next login.
  static clearAppData(): void {
    const keep = (key: string) => key === STORAGE_KEYS.SESSION_MARKER;
    removeKeysFrom(getLocalStorage(), (key) => isAppKey(key) && !keep(key));
    removeKeysFrom(getSessionStorage(), (key) => isAppKey(key) && !keep(key));
    Object.keys(memoryStore).forEach((key) => {
      if (isAppKey(key) && !keep(key)) delete memoryStore[key];
    });
    Object.keys(sessionMemoryStore).forEach((key) => {
      if (isAppKey(key) && !keep(key)) delete sessionMemoryStore[key];
    });
    Object.keys(serverCache).forEach((key) => delete serverCache[key]);
  }

  // Server mode: replaces the in-memory copy with the tenant data the API returned. Collections the
  // caller may not see (integrations, team) are cleared instead of kept from an earlier snapshot.
  static applyServerSnapshot(snapshot: ServerSnapshot): void {
    this.setOrganizations(snapshot.organization ? [snapshot.organization] : []);
    this.setBuildings(snapshot.buildings);
    this.setRooms(snapshot.rooms);
    this.setDevices(snapshot.devices);
    this.setAutomations(snapshot.automations);
    this.setAlerts(snapshot.alerts);
    this.setEvents(snapshot.events);
    this.setFirmwarePackages(snapshot.firmwarePackages);
    this.setFirmwareRollouts(snapshot.firmwareRollouts);
    this.setIntegrations(snapshot.integrations ?? []);
    rawSet(STORAGE_KEYS.TEAM, JSON.stringify(snapshot.team?.members ?? []));
  }

  // Server mode: drops the expired in-memory copy of tenant data (the session itself is kept).
  static clearServerData(): void {
    [
      STORAGE_KEYS.ORGANIZATIONS,
      STORAGE_KEYS.BUILDINGS,
      STORAGE_KEYS.ROOMS,
      STORAGE_KEYS.DEVICES,
      STORAGE_KEYS.AUTOMATIONS,
      STORAGE_KEYS.ALERTS,
      STORAGE_KEYS.EVENTS,
      STORAGE_KEYS.FIRMWARE_PACKAGES,
      STORAGE_KEYS.FIRMWARE_ROLLOUTS,
      STORAGE_KEYS.INTEGRATIONS,
      STORAGE_KEYS.TEAM,
    ].forEach((key) => delete serverCache[key]);
  }

  // Team members as last served by the API (server mode only).
  static getServerTeam(): UserProfile[] {
    const raw = rawGet(STORAGE_KEYS.TEAM);
    if (!raw) return [];
    try {
      return JSON.parse(raw);
    } catch {
      return [];
    }
  }

  // Same as clearAppData plus any Supabase auth token left in browser storage.
  static clearAll(): void {
    this.clearAppData();
    removeKeysFrom(getLocalStorage(), isSupabaseAuthKey);
    removeKeysFrom(getSessionStorage(), isSupabaseAuthKey);
  }

  static getScenario(): SimulationScenario {
    const raw = rawGet(STORAGE_KEYS.SCENARIO);
    if (raw) return raw as SimulationScenario;
    return 'normal';
  }

  static setScenario(scenario: SimulationScenario): void {
    rawSet(STORAGE_KEYS.SCENARIO, scenario);
  }

  static isOfflineMode(): boolean {
    const raw = rawGet(STORAGE_KEYS.OFFLINE_STATUS);
    return raw === 'true';
  }

  static setOfflineMode(offline: boolean): void {
    rawSet(STORAGE_KEYS.OFFLINE_STATUS, offline ? 'true' : 'false');
  }

  static resetToDemoData(): void {
    this.setOrganizations(INITIAL_ORGANIZATIONS);
    this.setBuildings(INITIAL_BUILDINGS);
    this.setRooms(INITIAL_ROOMS);
    this.setDevices(INITIAL_DEVICES);
    this.setAutomations(INITIAL_AUTOMATIONS);
    this.setAlerts(INITIAL_ALERTS);
    this.setEvents(INITIAL_EVENTS);
    this.setFirmwarePackages(INITIAL_FIRMWARE_PACKAGES);
    this.setFirmwareRollouts(INITIAL_FIRMWARE_ROLLOUTS);
    this.setIntegrations(INITIAL_INTEGRATIONS);
    // Resetting demo data never changes who is signed in (it used to switch to the Owner persona).
    this.setScenario('normal');
    this.setOfflineMode(false);
  }
}
