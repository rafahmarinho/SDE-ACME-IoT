// Production stand-in for src/mock/initialData.ts. metro.config.js swaps it in when a bundle is built
// without EXPO_PUBLIC_DEMO_MODE=true (SDE T49), so no demo personas or demo dataset ship to production.
// Same exports as the demo module, all empty.
import {
  Alert,
  Automation,
  Building,
  Device,
  EventLog,
  FirmwarePackage,
  FirmwareRollout,
  Integration,
  Organization,
  Room,
  UserProfile,
} from '../types';

export const INITIAL_ORGANIZATIONS: Organization[] = [];
export const INITIAL_USERS: UserProfile[] = [];
export const INITIAL_BUILDINGS: Building[] = [];
export const INITIAL_ROOMS: Room[] = [];
export const INITIAL_DEVICES: Device[] = [];
export const INITIAL_AUTOMATIONS: Automation[] = [];
export const INITIAL_ALERTS: Alert[] = [];
export const INITIAL_EVENTS: EventLog[] = [];
export const INITIAL_FIRMWARE_PACKAGES: FirmwarePackage[] = [];
export const INITIAL_FIRMWARE_ROLLOUTS: FirmwareRollout[] = [];
export const INITIAL_INTEGRATIONS: Integration[] = [];
