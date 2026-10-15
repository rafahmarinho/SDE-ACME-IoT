// ACME IoT TypeScript Domain Models

export type UserRole = 'owner' | 'administrator' | 'operator' | 'viewer';

export interface UserProfile {
  id: string;
  email: string;
  fullName: string;
  organizationId: string;
  role: UserRole;
  createdAt: string;
}

export interface Organization {
  id: string;
  name: string;
  slug: string;
  plan: 'enterprise' | 'industrial' | 'standard';
  createdAt: string;
}

export interface Building {
  id: string;
  organizationId: string;
  name: string;
  code: string;
  address: string;
  totalFloors: number;
  createdAt: string;
}

export type RoomType = 'office' | 'server_room' | 'conference' | 'lab' | 'warehouse' | 'cold_storage';

export interface Room {
  id: string;
  buildingId: string;
  name: string;
  floor: number;
  roomNumber: string;
  type: RoomType;
  dimensions: {
    width: number;
    length: number;
    height: number;
  };
  createdAt: string;
}

export type DeviceType =
  | 'thermostat'
  | 'smart_plug'
  | 'temperature_sensor'
  | 'humidity_sensor'
  | 'occupancy_sensor';

export type DeviceStatus = 'online' | 'offline' | 'warning' | 'updating';

export interface DeviceDesiredState {
  target_temp?: number;
  mode?: 'cooling' | 'heating' | 'eco' | 'off';
  power?: 'on' | 'off';
  sampling_rate?: number;
  sensitivity?: 'low' | 'medium' | 'high';
}

export interface DeviceReportedState {
  current_temp?: number;
  target_temp?: number;
  mode?: string;
  fan_speed?: string;
  power?: 'on' | 'off';
  power_watts?: number;
  voltage?: number;
  humidity?: number;
  occupied?: boolean;
  motion_detected_at?: string;
  sampling_rate?: number;
}

export interface Device {
  id: string;
  organizationId: string;
  buildingId: string;
  roomId: string;
  name: string;
  code: string;
  type: DeviceType;
  status: DeviceStatus;
  batteryLevel: number; // 0-100
  rssi: number; // dBm e.g. -65
  firmwareVersion: string;
  desiredState: DeviceDesiredState;
  reportedState: DeviceReportedState;
  lastSeenAt: string;
  createdAt: string;
}

export interface TelemetryReading {
  id: string;
  deviceId: string;
  temperature?: number;
  humidity?: number;
  occupancy?: boolean;
  powerWatts?: number;
  voltage?: number;
  recordedAt: string;
}

export type TriggerType =
  | 'temperature_threshold'
  | 'occupancy_change'
  | 'schedule'
  | 'power_threshold';

export interface AutomationCondition {
  deviceId: string;
  metric: string;
  operator: '>' | '<' | '>=' | '<=' | '==' | '!=';
  value: number | boolean | string;
}

export interface AutomationAction {
  targetDeviceId: string;
  command: 'set_target_temp' | 'set_power' | 'set_mode';
  value: any;
}

export interface Automation {
  id: string;
  organizationId: string;
  name: string;
  enabled: boolean;
  triggerType: TriggerType;
  triggerCondition: AutomationCondition;
  action: AutomationAction;
  intervalSeconds: number;
  lastExecutedAt?: string;
  executionCount: number;
  notifyOnRun: boolean;
  createdAt: string;
}

export type AlertSeverity = 'critical' | 'warning' | 'info';
export type AlertStatus = 'active' | 'acknowledged' | 'resolved';

export interface Alert {
  id: string;
  organizationId: string;
  deviceId?: string;
  severity: AlertSeverity;
  title: string;
  message: string;
  status: AlertStatus;
  acknowledgedBy?: string;
  resolvedAt?: string;
  createdAt: string;
}

export interface EventLog {
  id: string;
  organizationId: string;
  deviceId?: string;
  eventType:
    | 'telemetry'
    | 'state_change'
    | 'alert_triggered'
    | 'firmware_updated'
    | 'enrollment'
    | 'security_audit'
    | 'user_action';
  actorId?: string;
  actorRole?: string;
  payload: Record<string, any>;
  createdAt: string;
}

export interface FirmwarePackage {
  id: string;
  version: string;
  deviceType: DeviceType;
  checksumSha256: string;
  fileSizeBytes: number;
  fileUrl: string;
  status: 'released' | 'testing' | 'deprecated';
  changelog: string;
  createdAt: string;
}

export interface FirmwareRollout {
  id: string;
  firmwareId: string;
  targetType: DeviceType;
  totalDevices: number;
  updatedDevices: number;
  failedDevices: number;
  status: 'in_progress' | 'completed' | 'paused' | 'rolled_back';
  progressPercent: number;
  createdAt: string;
}

export interface Integration {
  id: string;
  organizationId: string;
  name: string;
  type: 'webhook' | 'rest_api_key' | 'simulated_mqtt';
  endpointUrl?: string;
  apiKeyMasked?: string;
  active: boolean;
  createdAt: string;
}

export type SimulationScenario =
  | 'normal'
  | 'heatwave'
  | 'network_jitter'
  | 'battery_drain'
  | 'firmware_wave';

export interface SimulationState {
  currentScenario: SimulationScenario;
  tickCount: number;
  autoAdvance: boolean;
  speedMs: number;
  isOnline: boolean;
}
