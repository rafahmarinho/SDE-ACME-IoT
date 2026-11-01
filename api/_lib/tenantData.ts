// Columns, response schemas and row mappers for the tenant data served by the API.
// SDE T378, T2139: only the listed columns are read and only the listed properties leave the API
// (for example integrations.api_key_hash and firmware_packages.file_url are never selected).
import { z } from 'zod';

export const DEVICE_TYPES = ['thermostat', 'smart_plug', 'temperature_sensor', 'humidity_sensor', 'occupancy_sensor'] as const;
export const USER_ROLE_VALUES = ['owner', 'administrator', 'operator', 'viewer'] as const;

// Rejects control, format and unassigned characters.
export const PRINTABLE_TEXT = /^[^\p{C}]+$/u;

export const COLUMNS = {
  organizations: 'id,name,slug,plan,created_at',
  buildings: 'id,organization_id,name,code,address,total_floors,created_at',
  rooms: 'id,building_id,name,floor,room_number,type,dimensions,created_at',
  devices:
    'id,organization_id,building_id,room_id,name,code,type,status,battery_level,rssi,firmware_version,desired_state,reported_state,last_seen_at,created_at',
  automations:
    'id,organization_id,name,enabled,trigger_type,trigger_condition,action,interval_seconds,last_executed_at,execution_count,notify_on_run,created_at',
  alerts: 'id,organization_id,device_id,severity,title,message,status,acknowledged_by,resolved_at,created_at',
  events: 'id,organization_id,device_id,event_type,actor_id,actor_role,payload,created_at',
  firmwarePackages: 'id,version,device_type,checksum_sha256,file_size_bytes,status,changelog,created_at',
  firmwareRollouts: 'id,organization_id,firmware_id,target_type,total_devices,updated_devices,failed_devices,status,progress_percent,created_at',
  integrations: 'id,organization_id,name,type,endpoint_url,active,created_at',
  members: 'id,email,full_name,organization_id,role,created_at',
  invitations: 'id,organization_id,email,full_name,role,status,created_at',
} as const;

type Row = Record<string, any>;

const json = z.record(z.unknown());
const optionalString = z.string().optional();

export const OrganizationDto = z
  .object({ id: z.string(), name: z.string(), slug: z.string(), plan: z.string(), createdAt: z.string() })
  .strict();

export const BuildingDto = z
  .object({
    id: z.string(),
    organizationId: z.string(),
    name: z.string(),
    code: z.string(),
    address: z.string(),
    totalFloors: z.number(),
    createdAt: z.string(),
  })
  .strict();

export const RoomDto = z
  .object({
    id: z.string(),
    buildingId: z.string(),
    name: z.string(),
    floor: z.number(),
    roomNumber: z.string(),
    type: z.string(),
    dimensions: z.object({ width: z.number(), length: z.number(), height: z.number() }).strict(),
    createdAt: z.string(),
  })
  .strict();

export const DeviceDto = z
  .object({
    id: z.string(),
    organizationId: z.string(),
    buildingId: z.string(),
    roomId: z.string(),
    name: z.string(),
    code: z.string(),
    type: z.enum(DEVICE_TYPES),
    status: z.enum(['online', 'offline', 'warning', 'updating']),
    batteryLevel: z.number(),
    rssi: z.number(),
    firmwareVersion: z.string(),
    desiredState: json,
    reportedState: json,
    lastSeenAt: z.string(),
    createdAt: z.string(),
  })
  .strict();

export const AutomationDto = z
  .object({
    id: z.string(),
    organizationId: z.string(),
    name: z.string(),
    enabled: z.boolean(),
    triggerType: z.string(),
    triggerCondition: z
      .object({ deviceId: z.string(), metric: z.string(), operator: z.string(), value: z.union([z.number(), z.boolean(), z.string()]) })
      .strict(),
    action: z.object({ targetDeviceId: z.string(), command: z.string(), value: z.unknown() }).strict(),
    intervalSeconds: z.number(),
    lastExecutedAt: optionalString,
    executionCount: z.number(),
    notifyOnRun: z.boolean(),
    createdAt: z.string(),
  })
  .strict();

export const AlertDto = z
  .object({
    id: z.string(),
    organizationId: z.string(),
    deviceId: optionalString,
    severity: z.enum(['critical', 'warning', 'info']),
    title: z.string(),
    message: z.string(),
    status: z.enum(['active', 'acknowledged', 'resolved']),
    acknowledgedBy: optionalString,
    resolvedAt: optionalString,
    createdAt: z.string(),
  })
  .strict();

export const EventDto = z
  .object({
    id: z.string(),
    organizationId: z.string(),
    deviceId: optionalString,
    eventType: z.string(),
    actorId: optionalString,
    actorRole: optionalString,
    payload: json,
    createdAt: z.string(),
  })
  .strict();

export const FirmwarePackageDto = z
  .object({
    id: z.string(),
    version: z.string(),
    // Platform-wide catalog: an unexpected type must not break every tenant's snapshot.
    deviceType: z.string(),
    checksumSha256: z.string(),
    fileSizeBytes: z.number(),
    status: z.enum(['released', 'testing', 'deprecated']),
    changelog: z.string(),
    createdAt: z.string(),
  })
  .strict();

export const FirmwareRolloutDto = z
  .object({
    id: z.string(),
    firmwareId: z.string(),
    targetType: z.string(),
    totalDevices: z.number(),
    updatedDevices: z.number(),
    failedDevices: z.number(),
    status: z.enum(['in_progress', 'completed', 'paused', 'rolled_back']),
    progressPercent: z.number(),
    createdAt: z.string(),
  })
  .strict();

export const IntegrationDto = z
  .object({
    id: z.string(),
    organizationId: z.string(),
    name: z.string(),
    type: z.enum(['webhook', 'rest_api_key', 'simulated_mqtt']),
    endpointUrl: optionalString,
    active: z.boolean(),
    createdAt: z.string(),
  })
  .strict();

export const MemberDto = z
  .object({
    id: z.string(),
    email: z.string(),
    fullName: z.string(),
    organizationId: z.string(),
    role: z.enum(USER_ROLE_VALUES),
    createdAt: z.string(),
  })
  .strict();

export const InvitationDto = z
  .object({
    id: z.string(),
    email: z.string(),
    fullName: z.string(),
    role: z.enum(USER_ROLE_VALUES),
    status: z.enum(['pending', 'accepted', 'revoked']),
    createdAt: z.string(),
  })
  .strict();

const opt = (value: unknown): string | undefined => (typeof value === 'string' && value ? value : undefined);
const num = (value: unknown, fallback = 0): number => (typeof value === 'number' && Number.isFinite(value) ? value : Number(value ?? fallback) || fallback);
const obj = (value: unknown): Record<string, unknown> => (value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {});

export const toOrganization = (r: Row) => ({ id: r.id, name: r.name, slug: r.slug, plan: r.plan ?? 'enterprise', createdAt: r.created_at });

export const toBuilding = (r: Row) => ({
  id: r.id,
  organizationId: r.organization_id,
  name: r.name,
  code: r.code,
  address: r.address,
  totalFloors: num(r.total_floors, 1),
  createdAt: r.created_at,
});

export const toRoom = (r: Row) => {
  const d = obj(r.dimensions);
  return {
    id: r.id,
    buildingId: r.building_id,
    name: r.name,
    floor: num(r.floor, 1),
    roomNumber: r.room_number,
    type: r.type,
    dimensions: { width: num(d.width, 8), length: num(d.length, 10), height: num(d.height, 3) },
    createdAt: r.created_at,
  };
};

export const toDevice = (r: Row) => ({
  id: r.id,
  organizationId: r.organization_id,
  buildingId: r.building_id,
  roomId: r.room_id,
  name: r.name,
  code: r.code,
  type: r.type,
  status: r.status,
  batteryLevel: num(r.battery_level),
  rssi: num(r.rssi),
  firmwareVersion: r.firmware_version,
  desiredState: obj(r.desired_state),
  reportedState: obj(r.reported_state),
  lastSeenAt: r.last_seen_at,
  createdAt: r.created_at,
});

export const toAutomation = (r: Row) => {
  const condition = obj(r.trigger_condition);
  const action = obj(r.action);
  return {
    id: r.id,
    organizationId: r.organization_id,
    name: r.name,
    enabled: Boolean(r.enabled),
    triggerType: r.trigger_type,
    triggerCondition: {
      deviceId: String(condition.device_id ?? ''),
      metric: String(condition.metric ?? ''),
      operator: String(condition.operator ?? ''),
      value: (condition.value ?? '') as number | boolean | string,
    },
    action: { targetDeviceId: String(action.target_device_id ?? ''), command: String(action.command ?? ''), value: action.value ?? null },
    intervalSeconds: num(r.interval_seconds, 60),
    lastExecutedAt: opt(r.last_executed_at),
    executionCount: num(r.execution_count),
    notifyOnRun: Boolean(r.notify_on_run),
    createdAt: r.created_at,
  };
};

export const toAlert = (r: Row) => ({
  id: r.id,
  organizationId: r.organization_id,
  deviceId: opt(r.device_id),
  severity: r.severity,
  title: r.title,
  message: r.message,
  status: r.status,
  acknowledgedBy: opt(r.acknowledged_by),
  resolvedAt: opt(r.resolved_at),
  createdAt: r.created_at,
});

export const toEvent = (r: Row) => ({
  id: r.id,
  organizationId: r.organization_id,
  deviceId: opt(r.device_id),
  eventType: r.event_type,
  actorId: opt(r.actor_id),
  actorRole: opt(r.actor_role),
  payload: obj(r.payload),
  createdAt: r.created_at,
});

export const toFirmwarePackage = (r: Row) => ({
  id: r.id,
  version: r.version,
  deviceType: r.device_type,
  checksumSha256: r.checksum_sha256,
  fileSizeBytes: num(r.file_size_bytes),
  status: r.status,
  changelog: r.changelog ?? '',
  createdAt: r.created_at,
});

export const toFirmwareRollout = (r: Row) => ({
  id: r.id,
  firmwareId: r.firmware_id,
  targetType: r.target_type,
  totalDevices: num(r.total_devices),
  updatedDevices: num(r.updated_devices),
  failedDevices: num(r.failed_devices),
  status: r.status,
  progressPercent: num(r.progress_percent),
  createdAt: r.created_at,
});

export const toIntegration = (r: Row) => ({
  id: r.id,
  organizationId: r.organization_id,
  name: r.name,
  type: r.type,
  endpointUrl: opt(r.endpoint_url),
  active: Boolean(r.active),
  createdAt: r.created_at,
});

export const toMember = (r: Row) => ({
  id: r.id,
  email: r.email,
  fullName: r.full_name,
  organizationId: r.organization_id,
  role: r.role,
  createdAt: r.created_at,
});

export const toInvitation = (r: Row) => ({
  id: r.id,
  email: r.email,
  fullName: r.full_name,
  role: r.role,
  status: r.status,
  createdAt: r.created_at,
});
