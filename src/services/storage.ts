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
  INITIAL_USERS,
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
};

// In-memory fallback for environments without localStorage or while initializing
const memoryStore: Record<string, string> = {};

function rawGet(key: string): string | null {
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
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      window.localStorage.removeItem(key);
    }
  } catch (e) {
    // ignore
  }
  delete memoryStore[key];
}

export class AppStorage {
  static getOrganizations(): Organization[] {
    const raw = rawGet(STORAGE_KEYS.ORGANIZATIONS);
    if (!raw) {
      this.setOrganizations(INITIAL_ORGANIZATIONS);
      return INITIAL_ORGANIZATIONS;
    }
    try {
      return JSON.parse(raw);
    } catch {
      return INITIAL_ORGANIZATIONS;
    }
  }

  static setOrganizations(orgs: Organization[]): void {
    rawSet(STORAGE_KEYS.ORGANIZATIONS, JSON.stringify(orgs));
  }

  static getBuildings(): Building[] {
    const raw = rawGet(STORAGE_KEYS.BUILDINGS);
    if (!raw) {
      this.setBuildings(INITIAL_BUILDINGS);
      return INITIAL_BUILDINGS;
    }
    try {
      return JSON.parse(raw);
    } catch {
      return INITIAL_BUILDINGS;
    }
  }

  static setBuildings(b: Building[]): void {
    rawSet(STORAGE_KEYS.BUILDINGS, JSON.stringify(b));
  }

  static getRooms(): Room[] {
    const raw = rawGet(STORAGE_KEYS.ROOMS);
    if (!raw) {
      this.setRooms(INITIAL_ROOMS);
      return INITIAL_ROOMS;
    }
    try {
      return JSON.parse(raw);
    } catch {
      return INITIAL_ROOMS;
    }
  }

  static setRooms(r: Room[]): void {
    rawSet(STORAGE_KEYS.ROOMS, JSON.stringify(r));
  }

  static getDevices(): Device[] {
    const raw = rawGet(STORAGE_KEYS.DEVICES);
    if (!raw) {
      this.setDevices(INITIAL_DEVICES);
      return INITIAL_DEVICES;
    }
    try {
      return JSON.parse(raw);
    } catch {
      return INITIAL_DEVICES;
    }
  }

  static setDevices(d: Device[]): void {
    rawSet(STORAGE_KEYS.DEVICES, JSON.stringify(d));
  }

  static getAutomations(): Automation[] {
    const raw = rawGet(STORAGE_KEYS.AUTOMATIONS);
    if (!raw) {
      this.setAutomations(INITIAL_AUTOMATIONS);
      return INITIAL_AUTOMATIONS;
    }
    try {
      return JSON.parse(raw);
    } catch {
      return INITIAL_AUTOMATIONS;
    }
  }

  static setAutomations(a: Automation[]): void {
    rawSet(STORAGE_KEYS.AUTOMATIONS, JSON.stringify(a));
  }

  static getAlerts(): Alert[] {
    const raw = rawGet(STORAGE_KEYS.ALERTS);
    if (!raw) {
      this.setAlerts(INITIAL_ALERTS);
      return INITIAL_ALERTS;
    }
    try {
      return JSON.parse(raw);
    } catch {
      return INITIAL_ALERTS;
    }
  }

  static setAlerts(al: Alert[]): void {
    rawSet(STORAGE_KEYS.ALERTS, JSON.stringify(al));
  }

  static getEvents(): EventLog[] {
    const raw = rawGet(STORAGE_KEYS.EVENTS);
    if (!raw) {
      this.setEvents(INITIAL_EVENTS);
      return INITIAL_EVENTS;
    }
    try {
      return JSON.parse(raw);
    } catch {
      return INITIAL_EVENTS;
    }
  }

  static setEvents(ev: EventLog[]): void {
    rawSet(STORAGE_KEYS.EVENTS, JSON.stringify(ev));
  }

  static addEvent(event: Omit<EventLog, 'id' | 'createdAt'>): EventLog {
    const full: EventLog = {
      ...event,
      id: 'ev_' + Date.now() + '_' + Math.random().toString(36).substring(2, 7),
      createdAt: new Date().toISOString(),
    };
    const current = this.getEvents();
    const updated = [full, ...current].slice(0, 100); // keep recent 100
    this.setEvents(updated);
    return full;
  }

  static getFirmwarePackages(): FirmwarePackage[] {
    const raw = rawGet(STORAGE_KEYS.FIRMWARE_PACKAGES);
    if (!raw) {
      this.setFirmwarePackages(INITIAL_FIRMWARE_PACKAGES);
      return INITIAL_FIRMWARE_PACKAGES;
    }
    try {
      return JSON.parse(raw);
    } catch {
      return INITIAL_FIRMWARE_PACKAGES;
    }
  }

  static setFirmwarePackages(f: FirmwarePackage[]): void {
    rawSet(STORAGE_KEYS.FIRMWARE_PACKAGES, JSON.stringify(f));
  }

  static getFirmwareRollouts(): FirmwareRollout[] {
    const raw = rawGet(STORAGE_KEYS.FIRMWARE_ROLLOUTS);
    if (!raw) {
      this.setFirmwareRollouts(INITIAL_FIRMWARE_ROLLOUTS);
      return INITIAL_FIRMWARE_ROLLOUTS;
    }
    try {
      return JSON.parse(raw);
    } catch {
      return INITIAL_FIRMWARE_ROLLOUTS;
    }
  }

  static setFirmwareRollouts(ro: FirmwareRollout[]): void {
    rawSet(STORAGE_KEYS.FIRMWARE_ROLLOUTS, JSON.stringify(ro));
  }

  static getIntegrations(): Integration[] {
    const raw = rawGet(STORAGE_KEYS.INTEGRATIONS);
    if (!raw) {
      this.setIntegrations(INITIAL_INTEGRATIONS);
      return INITIAL_INTEGRATIONS;
    }
    try {
      return JSON.parse(raw);
    } catch {
      return INITIAL_INTEGRATIONS;
    }
  }

  static setIntegrations(i: Integration[]): void {
    rawSet(STORAGE_KEYS.INTEGRATIONS, JSON.stringify(i));
  }

  static getCurrentUser(): UserProfile {
    const raw = rawGet(STORAGE_KEYS.CURRENT_USER);
    if (!raw) {
      this.setCurrentUser(INITIAL_USERS[0]);
      return INITIAL_USERS[0];
    }
    try {
      return JSON.parse(raw);
    } catch {
      return INITIAL_USERS[0];
    }
  }

  static setCurrentUser(user: UserProfile): void {
    rawSet(STORAGE_KEYS.CURRENT_USER, JSON.stringify(user));
  }

  static getActiveOrgId(): string {
    const raw = rawGet(STORAGE_KEYS.ACTIVE_ORG_ID);
    if (raw) return raw;
    const user = this.getCurrentUser();
    return user.organizationId;
  }

  static setActiveOrgId(orgId: string): void {
    rawSet(STORAGE_KEYS.ACTIVE_ORG_ID, orgId);
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
    this.setCurrentUser(INITIAL_USERS[0]);
    this.setActiveOrgId(INITIAL_ORGANIZATIONS[0].id);
    this.setScenario('normal');
    this.setOfflineMode(false);
  }
}
