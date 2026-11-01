// ACME IoT Functional and Integration Test Runner
import assert from 'assert';
import http from 'http';
import type { AddressInfo } from 'net';
import {
  INITIAL_ORGANIZATIONS,
  INITIAL_USERS,
  INITIAL_BUILDINGS,
  INITIAL_ROOMS,
  INITIAL_DEVICES,
  INITIAL_AUTOMATIONS,
  INITIAL_ALERTS,
  INITIAL_FIRMWARE_PACKAGES,
  INITIAL_FIRMWARE_ROLLOUTS,
} from '../src/mock/initialData';
import { AppStorage } from '../src/services/storage';
import { SimulationEngine } from '../src/services/simulation';
import {
  hasPermission,
  sanitizeString,
  checkRateLimit,
  canAccessRoute,
  canAssignRole,
  getPublicReference,
  resolveInternalId,
} from '../src/services/security';
import { AuthService, GENERIC_AUTH_ERROR, isSecureBackendUrl } from '../src/services/supabase';
import { configureApiClient } from '../src/services/apiClient';
import { DataGateway } from '../src/services/dataGateway';
import { PASSWORD_MIN_LENGTH, passwordPolicyViolations } from '../src/services/securityCore';
import { CONSENT_NOTICE_VERSION } from '../src/services/privacyNotice';

console.log('--- STARTING ACME IOT TEST SUITE ---');

// Test 1: Verify Seed Data Integrity
console.log('\n[Test 1] Validating Seed Data & Domain Models...');
assert(INITIAL_ORGANIZATIONS.length === 2, 'Must have 2 organizations');
assert(INITIAL_DEVICES.length === 20, 'Must have 20 initial devices');
assert(INITIAL_USERS.length === 4, 'Must have 4 persona users covering RBAC');
assert(INITIAL_BUILDINGS.length === 4, 'Must have 4 buildings across organizations');
assert(INITIAL_ROOMS.length === 6, 'Must have 6 rooms across buildings');
assert(INITIAL_AUTOMATIONS.length >= 3, 'Must have initial automations');
assert(INITIAL_FIRMWARE_PACKAGES.length >= 3, 'Must have firmware packages');
console.log('✓ Seed data verified: 2 organizations, 20 devices, 4 roles, 4 buildings, 6 rooms.');

// Test 2: Device Types and States
console.log('\n[Test 2] Validating Device Types and Desired vs Reported State Separation...');
const deviceTypes = new Set(INITIAL_DEVICES.map((d) => d.type));
assert(deviceTypes.has('thermostat'), 'Must support thermostats');
assert(deviceTypes.has('smart_plug'), 'Must support smart plugs');
assert(deviceTypes.has('temperature_sensor'), 'Must support temperature sensors');
assert(deviceTypes.has('humidity_sensor'), 'Must support humidity sensors');
assert(deviceTypes.has('occupancy_sensor'), 'Must support occupancy sensors');

INITIAL_DEVICES.forEach((dev) => {
  assert(dev.desiredState !== undefined, `Device ${dev.code} missing desiredState`);
  assert(dev.reportedState !== undefined, `Device ${dev.code} missing reportedState`);
});
console.log('✓ All 5 device types present with distinct desired and reported states.');

// Test 3: RBAC Roles and Permission Matrix
console.log('\n[Test 3] Validating Role-Based Access Control (RBAC)...');
assert(hasPermission('owner', 'devices:control') === true, 'Owner should control devices');
assert(hasPermission('owner', 'team:manage') === true, 'Owner should manage team');
assert(hasPermission('administrator', 'firmware:manage') === true, 'Admin should manage firmware');
assert(hasPermission('operator', 'devices:control') === true, 'Operator should control devices');
assert(hasPermission('operator', 'team:manage') === false, 'Operator should NOT manage team');
assert(hasPermission('viewer', 'devices:read') === true, 'Viewer should read devices');
assert(hasPermission('viewer', 'devices:control') === false, 'Viewer should NOT control devices');
console.log('✓ RBAC enforcement validated: Owner, Admin, Operator, Viewer constraints hold.');

// Test 4: Simulation Engine & Scenarios
console.log('\n[Test 4] Validating Simulation Engine Tick and Advance...');
AppStorage.resetToDemoData();
const advanceResult = SimulationEngine.advanceTick();
assert(advanceResult.updatedDevices === 20, 'Should tick all 20 devices');
console.log(`✓ Simulation advanced 1 tick: ${advanceResult.updatedDevices} devices updated, ${advanceResult.triggeredAutomations} automations evaluated.`);

// Test 5: Offline Mode Behavior
console.log('\n[Test 5] Validating Offline Resilience and Control Action Rejection...');
// Device control requires an authenticated operator (or higher) session in the device's organization.
const operator = INITIAL_USERS.find((u) => u.role === 'operator')!;
AppStorage.setCurrentUser(operator);
AppStorage.setActiveOrgId(operator.organizationId);
AppStorage.setOfflineMode(true);
assert(AppStorage.isOfflineMode() === true, 'Should be in offline mode');
const offlineAttempt = SimulationEngine.updateDesiredState(INITIAL_DEVICES[0].id, { target_temp: 24.5 });
assert(offlineAttempt.success === false, 'Control actions must fail when offline');
assert(offlineAttempt.error?.includes('offline mode'), 'Error message must specify offline restriction');
AppStorage.setOfflineMode(false);
const onlineAttempt = SimulationEngine.updateDesiredState(INITIAL_DEVICES[0].id, { target_temp: 24.5 });
assert(onlineAttempt.success === true, 'Control actions must succeed when online');
console.log('✓ Offline mode correctly locks mutations and resumes on reconnect.');

// Test 6: Security Helpers (Sanitization & Rate Limiter)
console.log('\n[Test 6] Validating Security Controls (Sanitization & Rate Limiting)...');
const rawXSS = '<script>alert("xss")</script>';
const sanitized = sanitizeString(rawXSS);
assert(!sanitized.includes('<script>'), 'Sanitization must escape tags');
assert(sanitized.includes('&lt;script&gt;'), 'Sanitization must produce entity encoding');

const rl1 = checkRateLimit('test_client_ip', 5, 10000);
assert(rl1.allowed === true, 'First request within rate limit must pass');
for (let i = 0; i < 4; i++) checkRateLimit('test_client_ip', 5, 10000);
const rlBlocked = checkRateLimit('test_client_ip', 5, 10000);
assert(rlBlocked.allowed === false, 'Excessive requests must be throttled');
console.log('✓ Input sanitization (XSS) and Rate limiting (DoS) verified.');

// Test 7: Firmware Checksums & OTA Rollback
console.log('\n[Test 7] Validating Firmware Checksum & OTA Rollout Integrity...');
INITIAL_FIRMWARE_PACKAGES.forEach((pkg) => {
  assert(pkg.checksumSha256 && pkg.checksumSha256.length === 64, `Firmware ${pkg.version} invalid SHA-256`);
});
const rolloutId = INITIAL_FIRMWARE_ROLLOUTS[0].id;
// Rollbacks require firmware:manage (owner/administrator).
const administrator = INITIAL_USERS.find((u) => u.role === 'administrator')!;
AppStorage.setCurrentUser(administrator);
AppStorage.setActiveOrgId(administrator.organizationId);
const rollbackResult = SimulationEngine.rollbackRollout(rolloutId);
assert(rollbackResult.success === true, 'Administrators can roll back a rollout');
const rollouts = AppStorage.getFirmwareRollouts();
const rolledBack = rollouts.find((r) => r.id === rolloutId);
assert(rolledBack?.status === 'rolled_back', 'Rollout should transition to rolled_back');
console.log('✓ Firmware signatures and OTA rollback simulation verified.');

// In-memory Web Storage used to observe what the client keeps in localStorage/sessionStorage.
class MemoryStorage {
  private data = new Map<string, string>();
  get length(): number {
    return this.data.size;
  }
  clear(): void {
    this.data.clear();
  }
  getItem(key: string): string | null {
    return this.data.has(key) ? (this.data.get(key) as string) : null;
  }
  key(index: number): string | null {
    return Array.from(this.data.keys())[index] ?? null;
  }
  removeItem(key: string): void {
    this.data.delete(key);
  }
  setItem(key: string, value: string): void {
    this.data.set(key, String(value));
  }
  keys(): string[] {
    return Array.from(this.data.keys());
  }
}

const isSessionArtifact = (key: string) => key.startsWith('acme_iot_') || key.startsWith('sb-');

async function main(): Promise<void> {
  const local = new MemoryStorage();
  const session = new MemoryStorage();
  (globalThis as any).window = { localStorage: local, sessionStorage: session };
  const owner = INITIAL_USERS.find((u) => u.role === 'owner')!;
  const viewer = INITIAL_USERS.find((u) => u.role === 'viewer')!;
  const ownDevice = INITIAL_DEVICES[0];
  const foreignDevice = INITIAL_DEVICES.find((d) => d.organizationId !== ownDevice.organizationId)!;
  const thermostatPackage = INITIAL_FIRMWARE_PACKAGES.find((p) => p.deviceType === 'thermostat')!;

  // Test 8: Least-privileged defaults
  console.log('\n[Test 8] Validating least-privileged defaults when nobody is signed in (T14, T2349, T61)...');
  AppStorage.clearAll();
  assert(AppStorage.getSessionUser() === null, 'No session may exist before sign-in');
  const anonymous = AppStorage.getCurrentUser();
  assert(anonymous.role === 'viewer' && anonymous.id === 'anonymous' && anonymous.organizationId === '', 'Without a session the fallback profile is least privileged (never Owner)');
  const anonControl = SimulationEngine.updateDesiredState(ownDevice.id, { target_temp: 21 });
  assert(anonControl.success === false && anonControl.error === 'Sign in required.', 'Signed-out users cannot control devices');
  assert(canAccessRoute(null, '/dashboard') === false, 'Signed-out users cannot open app pages');
  console.log('✓ No implicit Owner session: signed-out users get no permissions and no pages.');

  // Test 9: Default/demo accounts are gated
  console.log('\n[Test 9] Validating that demo personas and passwordless login are disabled by default (T61, T49, T8)...');
  delete process.env.EXPO_PUBLIC_DEMO_MODE;
  const noBackend = await AuthService.signIn(owner.email, 'any-password');
  assert(noBackend.user === null && noBackend.error === 'Authentication service is not configured.', 'Without a backend and outside demo mode nobody can sign in');
  assert(AuthService.signInDemoPersona(owner.email).user === null, 'Persona shortcut is refused outside demo mode');
  assert(AppStorage.getSessionUser() === null, 'Failed sign-ins create no session');
  process.env.EXPO_PUBLIC_DEMO_MODE = 'true';
  const unknown = await AuthService.signIn('intruder@evil.example', 'whatever');
  assert(unknown.user === null && unknown.error === GENERIC_AUTH_ERROR, 'Unknown e-mails are rejected with the generic message (no default Owner)');
  const emptyPassword = await AuthService.signIn(owner.email, '');
  assert(emptyPassword.user === null && emptyPassword.error === GENERIC_AUTH_ERROR, 'Empty passwords are rejected');
  const viewerLogin = await AuthService.signIn(viewer.email, 'demo-only');
  assert(viewerLogin.user?.role === 'viewer' && AppStorage.getSessionUser()?.id === viewer.id, 'Demo personas keep their own role');
  assert(local.getItem('acme_iot_current_user_v1') === null && session.getItem('acme_iot_current_user_v1') !== null, 'The session profile lives in sessionStorage, not localStorage');
  assert(isSecureBackendUrl('https://abc.supabase.co') && isSecureBackendUrl('http://localhost:54321'), 'TLS backends (and local dev) are accepted');
  assert(!isSecureBackendUrl('http://abc.supabase.co') && !isSecureBackendUrl('ftp://abc') && !isSecureBackendUrl('not a url'), 'Plain-http backends are refused');
  console.log('✓ Demo personas require an explicit non-production flag; unknown users and empty passwords are refused.');

  // Test 10: Tenant pinning and domain-layer authorization
  console.log('\n[Test 10] Validating tenant isolation and RBAC in the domain layer (T378, T18, T145, T2606)...');
  delete process.env.EXPO_PUBLIC_DEMO_MODE;
  const viewerControl = SimulationEngine.updateDesiredState(ownDevice.id, { target_temp: 23 });
  assert(viewerControl.success === false && !!viewerControl.error?.includes('viewer'), 'Viewers cannot control devices');
  AppStorage.setCurrentUser(operator);
  AppStorage.setActiveOrgId(operator.organizationId);
  assert(AppStorage.setActiveOrgId(foreignDevice.organizationId) === false, 'Real sessions cannot switch to another tenant');
  assert(AppStorage.getActiveOrgId() === operator.organizationId, 'Active tenant stays the user organization');
  assert(SimulationEngine.updateDesiredState(ownDevice.id, { target_temp: 23 }).success === true, 'Operators control devices of their tenant');
  assert(SimulationEngine.updateDesiredState(foreignDevice.id, { power: 'off' }).error === 'Device not found', 'Devices of another tenant are not reachable');
  const enrollInput = {
    name: 'QA Probe',
    code: 'QA-TM-901',
    type: 'temperature_sensor' as const,
    buildingId: ownDevice.buildingId,
    roomId: ownDevice.roomId,
    organizationId: operator.organizationId,
  };
  assert(SimulationEngine.enrollDevice(enrollInput).success === false, 'Operators cannot enroll devices');
  assert(SimulationEngine.startRollout(thermostatPackage.id).success === false, 'Operators cannot start rollouts');
  assert(SimulationEngine.rollbackRollout(rolloutId).success === false, 'Operators cannot roll back rollouts');
  AppStorage.setCurrentUser(administrator);
  AppStorage.setActiveOrgId(administrator.organizationId);
  assert(SimulationEngine.enrollDevice({ ...enrollInput, organizationId: foreignDevice.organizationId }).success === false, 'Enrollment into another tenant is refused');
  const enrolled = SimulationEngine.enrollDevice(enrollInput);
  assert(enrolled.success === true && enrolled.device?.organizationId === administrator.organizationId, 'Administrators enroll devices into their own tenant');
  assert(/^d_[0-9a-f]{16}$/.test(enrolled.device!.id), 'Record ids come from the CSPRNG');
  const started = SimulationEngine.startRollout(thermostatPackage.id);
  const ownThermostats = AppStorage.getDevices().filter((d) => d.type === 'thermostat' && d.organizationId === administrator.organizationId).length;
  assert(started.success === true && started.rollout?.totalDevices === ownThermostats, 'Rollouts only target devices of the active tenant');
  const auditEntry = AppStorage.getEvents()[0];
  assert(auditEntry.payload.action === 'firmware_rollout_started' && auditEntry.actorId === administrator.id, 'Rollout start is audited with the real actor');
  AppStorage.resetToDemoData();
  assert(AppStorage.getSessionUser()?.id === administrator.id, 'Reset Demo never switches the signed-in user to Owner');
  console.log('✓ Domain actions check the central RBAC matrix and the session tenant.');

  // Test 11: Page-level authorization map
  console.log('\n[Test 11] Validating page-level authorization and role assignment rules (T16, T84, T14)...');
  assert(canAccessRoute('viewer', '/team') === false && canAccessRoute('viewer', '/integrations') === false, 'Viewers cannot open admin pages');
  assert(canAccessRoute('operator', '/device-enroll') === false && canAccessRoute('administrator', '/device-enroll') === true, 'Enrollment page requires devices:admin');
  assert(canAccessRoute('administrator', '/team') === true && canAccessRoute('viewer', '/dashboard') === true && canAccessRoute('viewer', '/settings') === true, 'Allowed pages stay reachable');
  assert(canAccessRoute('owner', '/admin-console') === false, 'Unknown pages are denied by default');
  assert(canAssignRole('administrator', 'owner') === false && canAssignRole('administrator', 'administrator') === false, 'Administrators cannot grant owner/administrator');
  assert(canAssignRole('administrator', 'viewer') === true && canAssignRole('owner', 'administrator') === true && canAssignRole('operator', 'viewer') === false, 'Role assignment follows least privilege');
  console.log('✓ Every app page has an explicit permission (deny by default) and role grants follow least privilege.');

  // Test 12: Logout clears the client
  console.log('\n[Test 12] Validating that logout clears session and cached data from the client (T164, T1539, T26, T308, T93)...');
  local.setItem('sb-unit-test-auth-token', '{"access_token":"placeholder"}');
  session.setItem('sb-unit-test-auth-token', '{"access_token":"placeholder"}');
  local.setItem('unrelated_key', 'keep');
  AppStorage.getDevices();
  SimulationEngine.start(60000);
  assert(SimulationEngine.isActive(), 'Simulation runs during the session');
  assert(local.keys().some((k) => k.startsWith('acme_iot_')) && session.keys().some((k) => k.startsWith('acme_iot_')), 'Session and cached data exist before logout');
  await AuthService.signOut();
  assert(!SimulationEngine.isActive(), 'Session processes stop on logout');
  assert(local.keys().filter(isSessionArtifact).length === 0, 'localStorage holds no app data or auth tokens after logout');
  assert(session.keys().filter(isSessionArtifact).length === 0, 'sessionStorage holds no app data or auth tokens after logout');
  assert(local.getItem('unrelated_key') === 'keep', 'Only this application keys are removed');
  assert(AppStorage.getSessionUser() === null && AppStorage.getCurrentUser().id === 'anonymous', 'No user remains signed in after logout');
  console.log('✓ Logout stops the simulation and wipes profile, role, tenant, cached data and Supabase tokens.');

  // Test 13: Reminder after a session that was never closed
  console.log('\n[Test 13] Validating the reminder after a session that was not explicitly closed (T26)...');
  process.env.EXPO_PUBLIC_DEMO_MODE = 'true';
  await AuthService.signIn(operator.email, 'demo-only');
  assert(AppStorage.shouldShowLogoutReminder() === false, 'No reminder after an explicit logout');
  session.clear(); // tab closed without logging out
  assert(AppStorage.getSessionUser() === null && AppStorage.hasUnclosedSession() === true, 'Abandoned sessions leave only the open-session marker');
  await AuthService.signIn(operator.email, 'demo-only');
  assert(AppStorage.shouldShowLogoutReminder() === true, 'The next login reminds the user to log out');
  await AuthService.signOut();
  assert(AppStorage.hasUnclosedSession() === false, 'Explicit logout closes the session marker');
  delete process.env.EXPO_PUBLIC_DEMO_MODE;
  console.log('✓ Users are reminded to log out when their previous session was abandoned.');

  // Test 14: Server mode (a Supabase backend is configured): the API is the source of truth.
  console.log('\n[Test 14] Validating the server-authoritative client data path (T17, T145, T378, T1468, T148, T295, T2600, T20, T338)...');
  {
    const ORG = '11111111-1111-1111-1111-111111111111';
    const serverDevice = { ...INITIAL_DEVICES[0], id: 'da000000-0000-4000-8000-000000000001', organizationId: ORG, name: 'Server Thermostat', desiredState: { target_temp: 21.5, mode: 'cooling' as const } };
    const snapshot = {
      success: true,
      profile: { id: 'a1000000-0000-4000-8000-000000000003', email: 'operator@acme.example', fullName: 'Op', organizationId: ORG, role: 'operator', createdAt: '2026-10-01T00:00:00.000Z' },
      organization: INITIAL_ORGANIZATIONS[0],
      buildings: [], rooms: [], devices: [serverDevice], automations: [], alerts: [], events: [],
      firmwarePackages: [], firmwareRollouts: [],
      auditTrail: { verified: true, checkedEntries: 3 },
      limits: { maxRows: 1000, recentEvents: 200 },
    };
    const calls: Array<{ method: string; path: string; authorization: string; body: any }> = [];
    let dataStatus = 200;
    const forbiddenFor = new Set<string>();
    const api = http.createServer((req, res) => {
      let raw = '';
      req.on('data', (chunk) => (raw += chunk));
      req.on('end', () => {
        const body = raw ? JSON.parse(raw) : null;
        const authorization = String(req.headers.authorization || '');
        calls.push({ method: req.method || '', path: req.url || '', authorization, body });
        res.setHeader('Content-Type', 'application/json');
        if (authorization === 'Bearer expired.session.token') {
          res.statusCode = 401;
          return res.end(JSON.stringify({ error: 'Authentication required' }));
        }
        if (req.url === '/api/data') {
          res.statusCode = dataStatus;
          return res.end(JSON.stringify(dataStatus === 200 ? snapshot : { error: 'Result set exceeds the allowed size' }));
        }
        if (req.url === '/api/commands' && forbiddenFor.has(authorization)) {
          res.statusCode = 403;
          return res.end(JSON.stringify({ error: 'Forbidden' }));
        }
        res.statusCode = req.url === '/api/devices' ? 201 : 200;
        res.end(JSON.stringify({ success: true }));
      });
    });
    await new Promise<void>((resolve) => api.listen(0, '127.0.0.1', () => resolve()));
    const apiPort = (api.address() as AddressInfo).port;
    let currentSession = 'operator.session.token';
    let unauthorizedCalls = 0;
    configureApiClient({
      baseUrl: `http://127.0.0.1:${apiPort}`,
      getAccessToken: async () => currentSession,
      onUnauthorized: () => {
        unauthorizedCalls += 1;
      },
    });

    try {
      AppStorage.clearAll();
      local.clear();
      session.clear();
      process.env.EXPO_PUBLIC_SUPABASE_URL = 'https://unit-test.supabase.co';
      process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY = 'public-anon-key';
      assert(DataGateway.isServerMode(), 'A configured TLS backend switches the app to server mode');
      AppStorage.setCurrentUser(snapshot.profile as any);
      assert(AppStorage.getDevices().length === 0, 'Server mode never falls back to the bundled demo dataset');

      const refreshed = await DataGateway.refresh();
      assert(refreshed.success && AppStorage.getDevices().map((d) => d.id).join() === serverDevice.id, 'Tenant data comes from GET /api/data');
      assert(AppStorage.getActiveOrgId() === ORG && DataGateway.getAuditTrailStatus()?.verified === true, 'The tenant and the audit-trail status come from the server');
      assert(calls[0].method === 'GET' && calls[0].authorization === 'Bearer operator.session.token', 'Requests carry the access token in the Authorization header');
      assert(local.keys().filter(isSessionArtifact).length === 0 && session.keys().filter(isSessionArtifact).length === 0,
        'T1468/T148/T295: no tenant data, profile, role or token is written to localStorage or sessionStorage');
      (snapshot as Record<string, unknown>).stepUpRequired = true;
      await DataGateway.refresh();
      assert(DataGateway.isStepUpRequired(), 'T338: the app learns when the server withholds team or integration data until a second factor is verified');
      (snapshot as Record<string, unknown>).stepUpRequired = false;
      await DataGateway.refresh();
      assert(!DataGateway.isStepUpRequired(), 'T338: the notice disappears once the session is verified');

      calls.length = 0;
      const results = [
        await DataGateway.updateDesiredState(serverDevice.id, { target_temp: 23 }),
        await DataGateway.setAlertStatus('ea000000-0000-4000-8000-000000000001', 'acknowledged'),
        await DataGateway.setAutomationEnabled('aa000000-0000-4000-8000-000000000001', false),
        await DataGateway.createAutomation({
          name: 'Guard',
          triggerCondition: { deviceId: serverDevice.id, metric: 'current_temp', operator: '>=', value: 26 },
          action: { targetDeviceId: serverDevice.id, command: 'set_target_temp', value: 19 },
          intervalSeconds: 60,
        }),
        await DataGateway.setIntegrationActive('8a000000-0000-4000-8000-000000000001', false),
        await DataGateway.createIntegration({ name: 'Pager', type: 'webhook', endpointUrl: 'https://hooks.acme.example/p' }),
        await DataGateway.startRollout('f0000000-0000-4000-8000-000000000001'),
        await DataGateway.rollbackRollout('9a000000-0000-4000-8000-000000000001'),
        await DataGateway.inviteTeamMember({ fullName: 'Pat Doe', email: 'pat@acme.example', role: 'viewer' }),
        await DataGateway.enrollDevice({ name: 'Probe', code: 'QA-901', type: 'temperature_sensor', buildingId: 'ba000000-0000-4000-8000-000000000001', roomId: 'ca000000-0000-4000-8000-000000000001', organizationId: 'someone-else' }),
      ];
      assert(results.every((r) => r.success), 'Every operation succeeds through the API');
      const commands = calls.filter((c) => c.path === '/api/commands').map((c) => c.body.command);
      assert.deepStrictEqual(commands, [
        'device.setDesiredState', 'alert.setStatus', 'automation.setEnabled', 'automation.create', 'integration.setActive',
        'integration.create', 'firmware.startRollout', 'firmware.rollback', 'team.invite',
      ], 'T17/T145: every change is sent to the server as an authorized command');
      const enrollCall = calls.find((c) => c.path === '/api/devices')!;
      assert(enrollCall.method === 'POST' && !('organizationId' in enrollCall.body), 'T378: the client never chooses the tenant; the server takes it from the token');
      assert(calls.filter((c) => c.path === '/api/data').length === results.length, 'After each change the server copy is reloaded');
      assert(AppStorage.getDevices()[0].desiredState.target_temp === 21.5, 'T17: the client does not apply changes locally; it shows what the server returns');
      assert(local.keys().filter(isSessionArtifact).length === 0, 'Operations leave nothing in browser storage');

      calls.length = 0;
      const consentSaved = await DataGateway.recordConsents({ incident_alert_emails: true, daily_digest_emails: false }, 'pt-BR');
      const consentCalls = calls.filter((c) => c.path === '/api/commands');
      assert(consentSaved.success && consentCalls.length === 2 && consentCalls.every((c) => c.body.command === 'consent.record' && c.body.input.noticeVersion === CONSENT_NOTICE_VERSION && c.body.input.locale === 'pt-BR'),
        'T178/T604: consent choices are recorded on the server against the current notice and language');

      forbiddenFor.add('Bearer viewer.session.token');
      currentSession = 'viewer.session.token';
      const refused = await DataGateway.updateDesiredState(serverDevice.id, { target_temp: 30 });
      assert(!refused.success && refused.error === 'Forbidden', 'T145: the server decides; its refusal reaches the user');

      dataStatus = 422;
      const limited = await DataGateway.refresh();
      assert(!limited.success && DataGateway.getLastSyncError() === 'Result set exceeds the allowed size', 'T2600: an oversized result set is shown as an error message');
      assert(AppStorage.getDevices().length === 1, 'A failed refresh keeps the copy while it is still fresh');
      dataStatus = 200;

      // T148: cached tenant data expires (monotonic clock) when it cannot be refreshed in time.
      DataGateway.setCacheTtl(30);
      assert((await DataGateway.refresh()).success && AppStorage.getDevices().length === 1, 'Fresh data is cached in memory');
      await new Promise((resolve) => setTimeout(resolve, 60));
      dataStatus = 503;
      await DataGateway.refresh();
      assert(AppStorage.getDevices().length === 0 && DataGateway.getAuditTrailStatus() === null, 'T148: expired cached data is wiped when the server cannot refresh it');
      dataStatus = 200;
      DataGateway.setCacheTtl(0);

      currentSession = 'expired.session.token';
      const expired = await DataGateway.refresh();
      assert(!expired.success && unauthorizedCalls === 1, 'T20: a session refused by the server ends the local session so the user signs in again');

      await AuthService.signOut();
      assert(AppStorage.getDevices().length === 0 && AppStorage.getSessionUser() === null && DataGateway.getAuditTrailStatus() === null,
        'Logout drops the in-memory tenant data and session');
    } finally {
      delete process.env.EXPO_PUBLIC_SUPABASE_URL;
      delete process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;
      await new Promise<void>((resolve) => api.close(() => resolve()));
    }
  }
  console.log('✓ In server mode the client reads and changes data only through the authenticated API and keeps nothing in browser storage.');

  // Test 15: Minimum password standard used by the reset flow (Supabase Auth enforces the same rule).
  console.log('\n[Test 15] Validating the minimum password standard and the reset flow guards (T143, T2)...');
  assert.deepStrictEqual(passwordPolicyViolations('Correct1Horse7Battery'), [], 'A long password mixing cases and digits is accepted');
  assert(passwordPolicyViolations('Short1Ab').length > 0, `Passwords shorter than ${PASSWORD_MIN_LENGTH} characters are refused`);
  assert(passwordPolicyViolations('alllowercaseletters1').length > 0, 'Passwords need upper-case letters');
  assert(passwordPolicyViolations('NoDigitsInThisPhrase').length > 0, 'Passwords need digits');
  assert(passwordPolicyViolations('Password2026!').length > 0, 'A common word with a short suffix is refused');
  assert(passwordPolicyViolations('Operator7Lamp9Tree', { email: 'operator@acme.example' }).length > 0, 'Passwords containing the e-mail name are refused');
  assert(passwordPolicyViolations('A1' + 'b'.repeat(80)).length > 0, 'Passwords above the 72-character bcrypt limit are refused');
  const resetWithoutLink = await AuthService.completePasswordReset('Correct1Horse7Battery', true);
  // Without an authentication backend in this process the reset is refused outright; the recovery-session and
  // second-factor guards of the real flow are verified in Check 15.
  assert(!resetWithoutLink.success && (await AuthService.hasRecoverySession()) === false, 'Without an authentication backend no password can be changed');
  console.log('✓ Password resets require a valid recovery session and a password meeting the minimum standard.');

  // Test 16: Indirect object references in URLs.
  console.log('\n[Test 16] Validating indirect object references for device pages (T50)...');
  const [firstDevice, secondDevice] = INITIAL_DEVICES;
  const firstRef = getPublicReference(firstDevice.id);
  assert(/^ref_[0-9a-f]{32}$/.test(firstRef) && !firstRef.includes(firstDevice.id), 'References are random 128-bit values unrelated to the internal id');
  assert(getPublicReference(firstDevice.id) === firstRef && getPublicReference(secondDevice.id) !== firstRef, 'A reference is stable within the session and unique per object');
  assert(resolveInternalId(firstRef) === firstDevice.id && resolveInternalId('ref_' + '0'.repeat(32)) === null, 'Only issued references resolve');
  await AuthService.signOut();
  assert(resolveInternalId(firstRef) === null, 'References issued in a session stop resolving after logout');
  console.log('✓ Device pages are addressed by per-session random references that are forgotten on logout.');

  // Test 17: Opt-in consent and withdrawal (demo/local path; the server path is covered by Test 14 and Check 13).
  console.log('\n[Test 17] Validating opt-in consent capture and withdrawal (T178, T604, T754)...');
  assert(DataGateway.getConsents().length === 0, 'Nothing is consented until the member decides (no preselected items)');
  assert((await DataGateway.recordConsents({ incident_alert_emails: true })).success, 'An opt-in is saved');
  const optIn = DataGateway.getConsents().find((c) => c.purpose === 'incident_alert_emails');
  assert(optIn?.granted === true && optIn.noticeVersion === CONSENT_NOTICE_VERSION && !Number.isNaN(Date.parse(optIn.decidedAt)), 'The decision records the notice version and the time');
  await DataGateway.recordConsents({ incident_alert_emails: false });
  assert(DataGateway.getConsents().find((c) => c.purpose === 'incident_alert_emails')?.granted === false, 'A withdrawal becomes the current decision');
  await AuthService.signOut();
  assert(DataGateway.getConsents().length === 0, 'Session data about decisions is dropped on logout');
  console.log('✓ Consent is opt-in, recorded with notice version and time, and can be withdrawn.');

  console.log('\n=============================================');
  console.log('ALL ACME IOT TEST SUITES PASSED SUCCESSFULLY!');
  console.log('=============================================\n');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
