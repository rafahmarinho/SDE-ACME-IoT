import { z } from 'zod';
import { ApiError, createRoute } from './_lib/security';
import { MAX_RESULT_ROWS, TenantStore } from './_lib/store';
import { hasPermission } from '../src/services/securityCore';
import { CONSENT_NOTICE_VERSION } from '../src/services/privacyNotice';
import {
  AlertDto,
  AutomationDto,
  BuildingDto,
  COLUMNS,
  DeviceDto,
  EventDto,
  FirmwarePackageDto,
  FirmwareRolloutDto,
  IntegrationDto,
  InvitationDto,
  MemberDto,
  OrganizationDto,
  toAlert,
  toAutomation,
  toBuilding,
  toDevice,
  toEvent,
  toFirmwarePackage,
  toFirmwareRollout,
  toIntegration,
  toInvitation,
  toMember,
  toOrganization,
  toRoom,
  RoomDto,
} from './_lib/tenantData';

const RECENT_EVENTS = 200;
// Closed alerts and finished rollouts only grow: the newest ones are served as a fixed window.
const RECENT_CLOSED = 200;
// Audit entries about these tables follow the rules of the data itself (RLS events_sensitive_read_policy).
const MANAGER_AUDIT_TABLES = new Set(['integrations', 'team_invitations', 'user_profiles']);

const SnapshotSchema = z
  .object({
    success: z.literal(true),
    profile: MemberDto,
    organization: OrganizationDto.nullable(),
    buildings: z.array(BuildingDto),
    rooms: z.array(RoomDto),
    devices: z.array(DeviceDto),
    automations: z.array(AutomationDto),
    alerts: z.array(AlertDto),
    events: z.array(EventDto),
    firmwarePackages: z.array(FirmwarePackageDto),
    firmwareRollouts: z.array(FirmwareRolloutDto),
    integrations: z.array(IntegrationDto).optional(),
    team: z.object({ members: z.array(MemberDto), invitations: z.array(InvitationDto) }).strict().optional(),
    auditTrail: z.object({ verified: z.boolean(), checkedEntries: z.number() }).strict(),
    // True when the role may see team or integration data but the session lacks a second factor.
    stepUpRequired: z.boolean(),
    // The caller's own current consent decisions for the current notice (SDE T604).
    privacy: z
      .object({
        noticeVersion: z.string(),
        consents: z.array(z.object({ purpose: z.string(), granted: z.boolean(), noticeVersion: z.string(), decidedAt: z.string() }).strict()),
      })
      .strict(),
    limits: z.object({ maxRows: z.number(), recentEvents: z.number() }).strict(),
  })
  .strict();

type Row = Record<string, any>;

// GET /api/data: the caller's tenant data, which is the app's source of truth in server mode.
// SDE T17, T145, T378, T2598, T2600: the organization comes from the verified token; every table read
// is filtered by it (and by RLS, because the caller's token is forwarded); integrations and team data
// are only included for roles allowed to manage them; every result set is bounded.
export default createRoute({
  name: 'data',
  cors: true,
  // Every member polls every 15 s: allow many members behind one office address (per-user limit still applies).
  rateLimit: { max: 240, windowMs: 60000 },
  methods: {
    GET: {
      auth: 'required',
      permission: 'devices:read',
      handler: async (ctx) => {
        const store = TenantStore.forCaller(ctx);
        const tenant = { organization_id: store.organizationId };
        const role = store.principal.role;
        // SDE T338: team (personal data) and integrations (secret-bearing endpoints) also need aal2.
        const verified = store.principal.aal === 'aal2';
        const mayManageIntegrations = hasPermission(role, 'integrations:manage');
        const mayManageTeam = hasPermission(role, 'team:manage');
        const canManageIntegrations = mayManageIntegrations && verified;
        const canManageTeam = mayManageTeam && verified;

        const [organization, buildings, devices, automations, openAlerts, closedAlerts, events, firmwarePackages, activeRollouts, pastRollouts] = await Promise.all([
          store.findOne<Row>('organizations', COLUMNS.organizations, { id: store.organizationId }),
          store.list<Row>('buildings', COLUMNS.buildings, tenant, { order: 'name.asc' }),
          store.list<Row>('devices', COLUMNS.devices, tenant, { order: 'name.asc' }),
          store.list<Row>('automations', COLUMNS.automations, tenant, { order: 'created_at.desc' }),
          // Every open alert is served (refused if abnormally many); resolved ones as the newest window.
          store.list<Row>('alerts', COLUMNS.alerts, { ...tenant, status: ['active', 'acknowledged'] }, { order: 'created_at.desc' }),
          store.latest<Row>('alerts', COLUMNS.alerts, { ...tenant, status: 'resolved' }, 'created_at.desc', RECENT_CLOSED),
          store.latest<Row>('events_log', COLUMNS.events, tenant, 'created_at.desc', RECENT_EVENTS),
          store.list<Row>('firmware_packages', COLUMNS.firmwarePackages, {}, { order: 'created_at.desc' }),
          store.list<Row>('firmware_rollouts', COLUMNS.firmwareRollouts, { ...tenant, status: ['in_progress', 'paused'] }, { order: 'created_at.desc' }),
          store.latest<Row>('firmware_rollouts', COLUMNS.firmwareRollouts, { ...tenant, status: ['completed', 'rolled_back'] }, 'created_at.desc', RECENT_CLOSED),
        ]);
        const alerts = [...openAlerts, ...closedAlerts];
        const firmwareRollouts = [...activeRollouts, ...pastRollouts];
        // Rooms have no organization column: only rooms of the tenant's buildings are read.
        const rooms = await store.list<Row>('rooms', COLUMNS.rooms, { building_id: buildings.map((b) => String(b.id)) }, { order: 'floor.asc' });

        const [integrations, members, invitations] = await Promise.all([
          canManageIntegrations ? store.list<Row>('integrations', COLUMNS.integrations, tenant, { order: 'created_at.desc' }) : null,
          canManageTeam ? store.list<Row>('user_profiles', COLUMNS.members, tenant, { order: 'full_name.asc' }) : null,
          canManageTeam
            ? store.list<Row>('team_invitations', COLUMNS.invitations, { ...tenant, status: 'pending' }, { order: 'created_at.desc' })
            : null,
        ]);

        // SDE T349, T338, T604: audit entries about integrations, team invitations and profiles are only
        // served to managers with a second factor, and entries about consents only to the member who decided.
        const visibleEvents = events.filter((e) => {
          const table = typeof e.payload?.table === 'string' ? e.payload.table : '';
          if (table === 'privacy_consents') return e.actor_id === store.principal.userId;
          if (MANAGER_AUDIT_TABLES.has(table)) return (mayManageTeam || mayManageIntegrations) && verified;
          return true;
        });

        // SDE T604: latest decision per purpose of the caller (own rows only) for the current notice.
        const decisions = await store.list<Row>(
          'privacy_consents',
          'purpose,granted,notice_version,decided_at',
          { user_id: store.principal.userId, notice_version: CONSENT_NOTICE_VERSION },
          { order: 'decided_at.desc' }
        );
        const latest = new Map<string, Row>();
        decisions.forEach((d) => {
          if (!latest.has(String(d.purpose))) latest.set(String(d.purpose), d);
        });

        // SDE T349: the audit entries being served are re-verified against their hash chain.
        let auditTrail = { verified: false, checkedEntries: 0 };
        try {
          const rows = await store.rpc<Row[]>('verify_events_log_chain', { max_entries: RECENT_EVENTS });
          const result = Array.isArray(rows) ? rows[0] : undefined;
          if (result) auditTrail = { verified: result.verified === true, checkedEntries: Number(result.checked_entries) || 0 };
        } catch (err) {
          if (!(err instanceof ApiError)) throw err;
        }

        ctx.send(200, SnapshotSchema, {
          success: true,
          profile: ctx.profile!,
          organization: organization ? toOrganization(organization) : null,
          buildings: buildings.map(toBuilding),
          rooms: rooms.map(toRoom),
          devices: devices.map(toDevice),
          automations: automations.map(toAutomation),
          alerts: alerts.map(toAlert),
          events: visibleEvents.map(toEvent),
          firmwarePackages: firmwarePackages.map(toFirmwarePackage),
          firmwareRollouts: firmwareRollouts.map(toFirmwareRollout),
          integrations: integrations ? integrations.map(toIntegration) : undefined,
          team: members && invitations ? { members: members.map(toMember), invitations: invitations.map(toInvitation) } : undefined,
          auditTrail,
          stepUpRequired: (mayManageIntegrations || mayManageTeam) && !verified,
          privacy: {
            noticeVersion: CONSENT_NOTICE_VERSION,
            consents: Array.from(latest.values()).map((d) => ({
              purpose: String(d.purpose),
              granted: Boolean(d.granted),
              noticeVersion: String(d.notice_version),
              decidedAt: String(d.decided_at),
            })),
          },
          limits: { maxRows: MAX_RESULT_ROWS, recentEvents: RECENT_EVENTS },
        });
      },
    },
  },
});
