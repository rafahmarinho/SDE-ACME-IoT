import { z } from 'zod';
import { ApiError, createRoute, logActivityEvent, requireStepUp, validateInput } from './_lib/security';
import type { Principal } from './_lib/security';
import { TenantStore } from './_lib/store';
import { canAssignRole, hasPermission, isSha256Hex } from '../src/services/securityCore';
import { CONSENT_LOCALES, CONSENT_NOTICE_VERSION, CONSENT_PURPOSES } from '../src/services/privacyNotice';
import type { Permission } from '../src/services/securityCore';
import {
  AutomationDto,
  COLUMNS,
  FirmwareRolloutDto,
  IntegrationDto,
  InvitationDto,
  PRINTABLE_TEXT,
  toAutomation,
  toFirmwareRollout,
  toIntegration,
  toInvitation,
} from './_lib/tenantData';

type Row = Record<string, any>;

interface CommandOutcome<O> {
  result: O;
  objectType: string;
  objectId: string;
  changes?: Record<string, unknown>;
}

interface CommandDefinition<I, O> {
  // Checked against the caller's role before the input is even parsed (deny by default).
  permission: Permission;
  // SDE T338: personal or secret-bearing data also needs a session verified with a second factor.
  stepUp?: boolean;
  input: z.ZodType<I>;
  result: z.ZodType<O>;
  run: (input: I, store: TenantStore, principal: Principal) => Promise<CommandOutcome<O>>;
}

function command<I, O>(definition: CommandDefinition<I, O>): CommandDefinition<unknown, unknown> {
  return definition as unknown as CommandDefinition<unknown, unknown>;
}

const notFound = (what: string) => new ApiError(404, 'Not found', `${what} is not in the caller organization`);
const asObject = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};

const Name = z.string().trim().min(2).max(100).regex(PRINTABLE_TEXT);
const Id = z.string().uuid();

// Desired-state properties each device type accepts (property-level authorization, SDE T378).
const DESIRED_STATE_KEYS: Record<string, readonly string[]> = {
  thermostat: ['target_temp', 'mode'],
  smart_plug: ['power'],
  temperature_sensor: ['sampling_rate'],
  humidity_sensor: ['sampling_rate'],
  occupancy_sensor: ['sensitivity', 'sampling_rate'],
};

const DesiredStateSchema = z
  .object({
    target_temp: z.number().min(-40).max(60).optional(),
    mode: z.enum(['cooling', 'heating', 'eco', 'off']).optional(),
    power: z.enum(['on', 'off']).optional(),
    sampling_rate: z.number().int().min(1).max(3600).optional(),
    sensitivity: z.enum(['low', 'medium', 'high']).optional(),
  })
  .strict()
  .refine((state) => Object.keys(state).length > 0, 'at least one property is required');

// Metrics an automation can watch, the device types that report them and the trigger type stored.
const METRICS = {
  current_temp: { sources: ['thermostat', 'temperature_sensor'], triggerType: 'temperature_threshold', valueType: 'number' },
  occupied: { sources: ['occupancy_sensor'], triggerType: 'occupancy_change', valueType: 'boolean' },
  power_watts: { sources: ['smart_plug'], triggerType: 'power_threshold', valueType: 'number' },
} as const;
const ACTIONS = {
  set_target_temp: { target: 'thermostat' },
  set_power: { target: 'smart_plug' },
} as const;

// Loopback, private, link-local and carrier-grade NAT ranges, and every IP literal in brackets (IPv6).
const PRIVATE_HOST = /^(localhost|127\.|10\.|0\.|169\.254\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\.|\[)/i;
const ExternalHttpsUrl = z
  .string()
  .trim()
  .max(2048)
  .url()
  .refine((value) => {
    try {
      const url = new URL(value);
      return url.protocol === 'https:' && !url.username && !url.password && !PRIVATE_HOST.test(url.hostname);
    } catch {
      return false;
    }
  }, 'endpoint must be an external https URL without credentials');

const COMMANDS: Record<string, CommandDefinition<unknown, unknown>> = {
  'device.setDesiredState': command({
    permission: 'devices:control',
    input: z.object({ deviceId: Id, desiredState: DesiredStateSchema }).strict(),
    result: z.object({ id: z.string(), desiredState: z.record(z.unknown()) }).strict(),
    run: async (input, store) => {
      const device = await store.findOne<Row>('devices', 'id,type,desired_state', { id: input.deviceId, organization_id: store.organizationId });
      if (!device) throw notFound('device');
      const allowed = DESIRED_STATE_KEYS[device.type] ?? [];
      const unsupported = Object.keys(input.desiredState).filter((key) => !allowed.includes(key));
      if (unsupported.length > 0) {
        throw new ApiError(400, 'Invalid request', `desired state keys not supported by ${device.type}: ${unsupported.join(', ')}`);
      }
      const desiredState = { ...asObject(device.desired_state), ...input.desiredState };
      const updated = await store.update<Row>('devices', { id: device.id, organization_id: store.organizationId }, { desired_state: desiredState }, 'id,desired_state');
      if (!updated) throw notFound('device');
      return { result: { id: updated.id, desiredState: asObject(updated.desired_state) }, objectType: 'device', objectId: device.id, changes: input.desiredState };
    },
  }),

  'alert.setStatus': command({
    permission: 'alerts:update',
    input: z.object({ alertId: Id, status: z.enum(['acknowledged', 'resolved']) }).strict(),
    result: z.object({ id: z.string(), status: z.enum(['active', 'acknowledged', 'resolved']) }).strict(),
    run: async (input, store) => {
      const alert = await store.findOne<Row>('alerts', 'id,status', { id: input.alertId, organization_id: store.organizationId });
      if (!alert) throw notFound('alert');
      if (alert.status === 'resolved' || alert.status === input.status) {
        throw new ApiError(409, 'Conflict', `alert cannot move from ${alert.status} to ${input.status}`);
      }
      // Who acknowledged and when it was resolved are set by the database (trigger), never by the client.
      const updated = await store.update<Row>('alerts', { id: alert.id, organization_id: store.organizationId }, { status: input.status }, 'id,status');
      if (!updated) throw notFound('alert');
      return { result: { id: updated.id, status: updated.status }, objectType: 'alert', objectId: alert.id, changes: { status: input.status } };
    },
  }),

  'automation.create': command({
    permission: 'automations:write',
    input: z
      .object({
        name: Name,
        triggerCondition: z
          .object({
            deviceId: Id,
            metric: z.enum(['current_temp', 'occupied', 'power_watts']),
            operator: z.enum(['>', '<', '>=', '<=', '==', '!=']),
            value: z.union([z.number().min(-100).max(100000), z.boolean()]),
          })
          .strict(),
        action: z
          .object({
            targetDeviceId: Id,
            command: z.enum(['set_target_temp', 'set_power']),
            value: z.union([z.number().min(-40).max(60), z.enum(['on', 'off'])]),
          })
          .strict(),
        intervalSeconds: z.number().int().min(10).max(86400),
      })
      .strict(),
    result: AutomationDto,
    run: async (input, store) => {
      const metric = METRICS[input.triggerCondition.metric];
      if (typeof input.triggerCondition.value !== metric.valueType) {
        throw new ApiError(400, 'Invalid request', 'condition value does not match the metric');
      }
      if ((input.action.command === 'set_target_temp') !== (typeof input.action.value === 'number')) {
        throw new ApiError(400, 'Invalid request', 'action value does not match the command');
      }
      const ids = Array.from(new Set([input.triggerCondition.deviceId, input.action.targetDeviceId]));
      const devices = await store.list<Row>('devices', 'id,type', { organization_id: store.organizationId, id: ids });
      const source = devices.find((d) => d.id === input.triggerCondition.deviceId);
      const target = devices.find((d) => d.id === input.action.targetDeviceId);
      if (!source || !target) throw notFound('device');
      if (!(metric.sources as readonly string[]).includes(source.type) || target.type !== ACTIONS[input.action.command].target) {
        throw new ApiError(400, 'Invalid request', 'device types do not support this rule');
      }
      const row = await store.insert<Row>(
        'automations',
        {
          organization_id: store.organizationId,
          name: input.name,
          enabled: true,
          trigger_type: metric.triggerType,
          trigger_condition: {
            device_id: source.id,
            metric: input.triggerCondition.metric,
            operator: input.triggerCondition.operator,
            value: input.triggerCondition.value,
          },
          action: { target_device_id: target.id, command: input.action.command, value: input.action.value },
          interval_seconds: input.intervalSeconds,
          notify_on_run: true,
        },
        COLUMNS.automations
      );
      return {
        result: toAutomation(row),
        objectType: 'automation',
        objectId: row.id,
        changes: { name: input.name, metric: input.triggerCondition.metric, command: input.action.command },
      };
    },
  }),

  'automation.setEnabled': command({
    permission: 'automations:write',
    input: z.object({ automationId: Id, enabled: z.boolean() }).strict(),
    result: z.object({ id: z.string(), enabled: z.boolean() }).strict(),
    run: async (input, store) => {
      const automation = await store.findOne<Row>('automations', 'id', { id: input.automationId, organization_id: store.organizationId });
      if (!automation) throw notFound('automation');
      const updated = await store.update<Row>('automations', { id: automation.id, organization_id: store.organizationId }, { enabled: input.enabled }, 'id,enabled');
      if (!updated) throw notFound('automation');
      return { result: { id: updated.id, enabled: Boolean(updated.enabled) }, objectType: 'automation', objectId: automation.id, changes: { enabled: input.enabled } };
    },
  }),

  'integration.create': command({
    permission: 'integrations:manage',
    stepUp: true,
    input: z
      .object({ name: Name, type: z.enum(['webhook', 'rest_api_key', 'simulated_mqtt']), endpointUrl: ExternalHttpsUrl.optional() })
      .strict()
      .refine((value) => value.type !== 'webhook' || Boolean(value.endpointUrl), 'webhooks need an endpoint'),
    result: IntegrationDto,
    run: async (input, store) => {
      const row = await store.insert<Row>(
        'integrations',
        { organization_id: store.organizationId, name: input.name, type: input.type, endpoint_url: input.endpointUrl ?? null, active: true },
        COLUMNS.integrations
      );
      return { result: toIntegration(row), objectType: 'integration', objectId: row.id, changes: { name: input.name, type: input.type } };
    },
  }),

  'integration.setActive': command({
    permission: 'integrations:manage',
    stepUp: true,
    input: z.object({ integrationId: Id, active: z.boolean() }).strict(),
    result: z.object({ id: z.string(), active: z.boolean() }).strict(),
    run: async (input, store) => {
      const integration = await store.findOne<Row>('integrations', 'id', { id: input.integrationId, organization_id: store.organizationId });
      if (!integration) throw notFound('integration');
      const updated = await store.update<Row>('integrations', { id: integration.id, organization_id: store.organizationId }, { active: input.active }, 'id,active');
      if (!updated) throw notFound('integration');
      return { result: { id: updated.id, active: Boolean(updated.active) }, objectType: 'integration', objectId: integration.id, changes: { active: input.active } };
    },
  }),

  'firmware.startRollout': command({
    permission: 'firmware:manage',
    input: z.object({ firmwareId: Id }).strict(),
    result: FirmwareRolloutDto,
    run: async (input, store) => {
      // Firmware packages are a platform-wide catalog; the rollout itself belongs to the caller's tenant.
      const pkg = await store.findOne<Row>('firmware_packages', 'id,version,device_type,checksum_sha256,status', { id: input.firmwareId });
      if (!pkg) throw new ApiError(404, 'Not found', 'firmware package does not exist');
      if (pkg.status === 'deprecated') throw new ApiError(409, 'Conflict', 'deprecated firmware cannot be rolled out');
      if (!isSha256Hex(pkg.checksum_sha256)) throw new ApiError(409, 'Conflict', 'firmware package has no valid SHA-256 checksum');
      const targets = await store.list<Row>('devices', 'id', { organization_id: store.organizationId, type: String(pkg.device_type) });
      const row = await store.insert<Row>(
        'firmware_rollouts',
        {
          organization_id: store.organizationId,
          firmware_id: pkg.id,
          target_type: pkg.device_type,
          total_devices: targets.length,
          status: 'in_progress',
          progress_percent: 0,
        },
        COLUMNS.firmwareRollouts
      );
      return {
        result: toFirmwareRollout(row),
        objectType: 'firmware_rollout',
        objectId: row.id,
        changes: { firmwareId: pkg.id, version: pkg.version, totalDevices: targets.length },
      };
    },
  }),

  'firmware.rollback': command({
    permission: 'firmware:manage',
    input: z.object({ rolloutId: Id }).strict(),
    result: FirmwareRolloutDto,
    run: async (input, store) => {
      const rollout = await store.findOne<Row>('firmware_rollouts', 'id,status', { id: input.rolloutId, organization_id: store.organizationId });
      if (!rollout) throw notFound('rollout');
      if (rollout.status === 'rolled_back') throw new ApiError(409, 'Conflict', 'rollout was already rolled back');
      const updated = await store.update<Row>(
        'firmware_rollouts',
        { id: rollout.id, organization_id: store.organizationId },
        { status: 'rolled_back', progress_percent: 0 },
        COLUMNS.firmwareRollouts
      );
      if (!updated) throw notFound('rollout');
      return { result: toFirmwareRollout(updated), objectType: 'firmware_rollout', objectId: rollout.id, changes: { status: 'rolled_back' } };
    },
  }),

  'team.invite': command({
    permission: 'team:manage',
    stepUp: true,
    input: z
      .object({
        fullName: Name,
        email: z.string().trim().toLowerCase().max(254).email(),
        role: z.enum(['administrator', 'operator', 'viewer']),
      })
      .strict(),
    result: InvitationDto,
    run: async (input, store, principal) => {
      // SDE T14: administrators may only grant operator/viewer (same rule as the RLS policy).
      if (!canAssignRole(principal.role, input.role)) {
        throw new ApiError(403, 'Forbidden', `role ${principal.role} cannot grant ${input.role}`);
      }
      // SDE T742: no duplicate people (existing member or pending invitation).
      const member = await store.findOne<Row>('user_profiles', 'id', { organization_id: store.organizationId, email: input.email });
      const pending = await store.findOne<Row>('team_invitations', 'id', { organization_id: store.organizationId, email: input.email, status: 'pending' });
      if (member || pending) throw new ApiError(409, 'Conflict', 'person is already a member or invited');
      const row = await store.insert<Row>(
        'team_invitations',
        { organization_id: store.organizationId, email: input.email, full_name: input.fullName, role: input.role, invited_by: principal.userId },
        COLUMNS.invitations
      );
      // The e-mail address is personal data: only the granted role is logged.
      return { result: toInvitation(row), objectType: 'team_invitation', objectId: row.id, changes: { role: input.role } };
    },
  }),

  // SDE T742: members correct their own name (e-mail changes go through Supabase Auth and are
  // propagated to the profile by the database). The target row is always the caller's own profile.
  'profile.update': command({
    permission: 'profile:self',
    input: z.object({ fullName: Name }).strict(),
    result: z.object({ id: z.string(), fullName: z.string() }).strict(),
    run: async (input, store, principal) => {
      const updated = await store.update<Row>(
        'user_profiles',
        { id: principal.userId, organization_id: store.organizationId },
        { full_name: input.fullName },
        'id,full_name'
      );
      if (!updated) throw notFound('profile');
      return { result: { id: updated.id, fullName: updated.full_name }, objectType: 'user_profile', objectId: principal.userId, changes: { fullName: '[changed]' } };
    },
  }),

  // SDE T178, T604, T754: records the member's own consent decision (opt-in or withdrawal) for the
  // current notice; the database adds the user id and the server time and never edits past decisions.
  'consent.record': command({
    permission: 'profile:self',
    input: z
      .object({
        purpose: z.enum(CONSENT_PURPOSES),
        granted: z.boolean(),
        noticeVersion: z.literal(CONSENT_NOTICE_VERSION),
        locale: z.enum(CONSENT_LOCALES),
      })
      .strict(),
    result: z.object({ purpose: z.string(), granted: z.boolean(), noticeVersion: z.string(), decidedAt: z.string() }).strict(),
    run: async (input, store, principal) => {
      const row = await store.insert<Row>(
        'privacy_consents',
        { organization_id: store.organizationId, purpose: input.purpose, granted: input.granted, notice_version: input.noticeVersion, locale: input.locale },
        'id,user_id,purpose,granted,notice_version,decided_at'
      );
      if (row.user_id !== principal.userId) throw new ApiError(500, 'Internal server error', 'consent stored for another user');
      return {
        result: { purpose: row.purpose, granted: Boolean(row.granted), noticeVersion: row.notice_version, decidedAt: row.decided_at },
        objectType: 'privacy_consent',
        objectId: row.id,
        changes: { purpose: input.purpose, granted: input.granted, noticeVersion: input.noticeVersion },
      };
    },
  }),
};

export const COMMAND_PERMISSIONS: Readonly<Record<string, Permission>> = Object.fromEntries(
  Object.entries(COMMANDS).map(([name, definition]) => [name, definition.permission])
);
export const STEP_UP_COMMANDS: readonly string[] = Object.keys(COMMANDS).filter((name) => COMMANDS[name].stepUp);

const CommandEnvelope = z.object({ command: z.string().max(64), input: z.unknown() }).strict();

// POST /api/commands: every change the app makes to tenant data.
// SDE T17, T145, T378: the server authorizes each command (central RBAC per command), loads the target
// object with the caller's organization from the verified token (objects of other tenants answer 404),
// only touches the properties the command allows, and records the change (T2602).
export default createRoute({
  name: 'commands',
  cors: true,
  rateLimit: { max: 60, windowMs: 60000 },
  methods: {
    POST: {
      auth: 'required',
      // Baseline: any member; each command then requires its own permission.
      permission: 'devices:read',
      handler: async (ctx) => {
        const envelope = await ctx.readBody(CommandEnvelope);
        const definition = Object.prototype.hasOwnProperty.call(COMMANDS, envelope.command) ? COMMANDS[envelope.command] : undefined;
        if (!definition) throw new ApiError(400, 'Invalid request', 'unknown command');
        const principal = ctx.principal!;
        if (!hasPermission(principal.role, definition.permission)) {
          throw new ApiError(403, 'Forbidden', `role ${principal.role} lacks ${definition.permission} for ${envelope.command}`);
        }
        if (definition.stepUp) requireStepUp(principal, envelope.command);
        const input = validateInput(definition.input, envelope.input);
        const store = TenantStore.forCaller(ctx);
        const outcome = await definition.run(input, store, principal);
        logActivityEvent(envelope.command, {
          route: 'commands',
          method: 'POST',
          userId: principal.userId,
          organizationId: principal.organizationId,
          objectType: outcome.objectType,
          objectId: outcome.objectId,
          changes: outcome.changes,
        });
        const responseSchema = z.object({ success: z.literal(true), command: z.string(), result: definition.result }).strict();
        ctx.send(200, responseSchema, { success: true, command: envelope.command, result: outcome.result });
      },
    },
  },
});
