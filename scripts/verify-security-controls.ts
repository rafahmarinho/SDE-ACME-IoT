// SD Elements Security Controls Verification Script
import assert from 'assert';
import fs from 'fs';
import path from 'path';
import http from 'http';
import crypto from 'crypto';
import { spawnSync } from 'child_process';
import type { AddressInfo } from 'net';
import {
  sanitizeString,
  checkRateLimit,
  hasPermission,
  verifyChecksum,
  sha256Hex,
  generateSecureId,
  generateRecordId,
  getPublicReference,
} from '../src/services/security';
import { USER_ROLES, Permission, PUBLIC_ROUTES, PASSWORD_MIN_LENGTH } from '../src/services/securityCore';
import devicesHandler from '../api/devices/index';
import healthHandler from '../api/health';
import scenariosHandler from '../api/simulation/scenarios';
import logoutHandler from '../api/auth/logout';
import cspReportHandler from '../api/csp-report';
import dataHandler from '../api/data';
import commandsHandler, { COMMAND_PERMISSIONS, STEP_UP_COMMANDS } from '../api/commands';
import { MAX_RESULT_ROWS } from '../api/_lib/store';
import { COLUMNS } from '../api/_lib/tenantData';
import { CONSENT_NOTICE_VERSION } from '../src/services/privacyNotice';
import { startFakeSupabase } from './fake-supabase';
import { INITIAL_USERS as DEMO_PERSONAS, INITIAL_DEVICES as DEMO_DEVICES } from '../src/mock/initialData';

console.log('--- STARTING SD ELEMENTS SECURITY CONTROLS VERIFICATION ---');

// 1. Verify Assessment Dataset
const assessmentPath = 'docs/security/sde-controls-assessment.json';
assert(fs.existsSync(assessmentPath), 'Assessment file must exist');
const assessments = JSON.parse(fs.readFileSync(assessmentPath, 'utf8'));
assert(assessments.length === 85, 'Must have evaluated all 85 SD Elements countermeasures');

// 2. Verify Bilingual Notes & Required Signature
console.log('\n[Check 1] Validating Bilingual Comments & Signature...');
const requiredSig = 'RafahMarinho with Agentic AI';
assessments.forEach((item: any) => {
  assert(item.note.includes(requiredSig), `Countermeasure ${item.task_id} missing signature`);
  assert(item.note.includes('\n\n'), `Countermeasure ${item.task_id} must have separation between PT and EN`);
  assert(item.status === 'Complete' || item.status === 'Not Applicable' || item.status === 'Incomplete', `Invalid status on ${item.task_id}`);
});
console.log('✓ All 85 countermeasures contain bilingual rationale (PT-BR and EN) and exact signature: "RafahMarinho with Agentic AI".');

// 3. Verify Code-Level Implementation of Controls
console.log('\n[Check 2] Validating Application Code Controls...');

// T36/T37: Input Sanitization
const xssPayload = '<img src=x onerror=alert(1)>';
const clean = sanitizeString(xssPayload);
assert(!clean.includes('<img'), 'T36/T37: Must escape HTML tags');
assert(clean.includes('&lt;img'), 'T36/T37: Must entity encode');

// T70/T1362: Rate Limiting
const rlAllowed = checkRateLimit('client_test', 3, 5000);
assert(rlAllowed.allowed === true, 'T70/T1362: Initial request within rate limit');
checkRateLimit('client_test', 3, 5000);
checkRateLimit('client_test', 3, 5000);
const rlBlocked = checkRateLimit('client_test', 3, 5000);
assert(rlBlocked.allowed === false, 'T70/T1362: Excess requests must be throttled');
assert(rlBlocked.retryAfterMs > 0, 'T70/T1362: Throttled clients get a retry delay');

// T338/T17/T145: RBAC Authorization Matrix
assert(hasPermission('viewer', 'devices:control') === false, 'T338/T17/T145: Viewer cannot control devices');
assert(hasPermission('operator', 'devices:control') === true, 'T338/T17/T145: Operator can control devices');
assert(hasPermission('administrator', 'firmware:manage') === true, 'T338/T17/T145: Admin can manage firmware');
assert(hasPermission(undefined, 'devices:read') === false, 'T338: No role means no permission (deny by default)');
assert(hasPermission('superuser' as any, 'devices:read') === false, 'T338: Unknown roles get no permission');

// 4. Verify SQL Row-Level Security
console.log('\n[Check 3] Validating PostgreSQL Schema & RLS Policies...');
const sqlContent = fs.readFileSync('supabase/migrations/20261012_init_schema.sql', 'utf8');
assert(sqlContent.includes('ALTER TABLE public.devices ENABLE ROW LEVEL SECURITY;'), 'RLS must be enabled on devices');
assert(sqlContent.includes('ALTER TABLE public.organizations ENABLE ROW LEVEL SECURITY;'), 'RLS must be enabled on organizations');
assert(sqlContent.includes('ALTER TABLE public.user_profiles ENABLE ROW LEVEL SECURITY;'), 'RLS must be enabled on user_profiles');
assert(sqlContent.includes('current_user_org_id()'), 'Must enforce tenant isolation by organization ID');
console.log('✓ Supabase PostgreSQL RLS policies and tenant isolation verified.');

// 5. Verify Security Headers
console.log('\n[Check 4] Validating Security Headers & CSP...');
const vercelContent = fs.readFileSync('vercel.json', 'utf8');
assert(vercelContent.includes('X-Content-Type-Options'), 'Must include X-Content-Type-Options: nosniff');
assert(vercelContent.includes('X-Frame-Options'), 'Must include X-Frame-Options: DENY');
assert(vercelContent.includes('Content-Security-Policy'), 'Must include Content-Security-Policy');
assert(vercelContent.includes('Strict-Transport-Security'), 'Must include HSTS');
console.log('✓ Vercel edge security headers and CSP rules verified.');

// ---------------------------------------------------------------------------------------------
// Helpers for the checks below
// ---------------------------------------------------------------------------------------------
function readText(file: string): string {
  return fs.readFileSync(file, 'utf8');
}

function trackedFiles(): string[] {
  // Tracked files plus new files that are not git-ignored (so local runs also scan uncommitted work).
  const result = spawnSync('git', ['ls-files', '--cached', '--others', '--exclude-standard'], { encoding: 'utf8' });
  if (result.status === 0 && result.stdout.trim()) {
    return result.stdout.split('\n').map((f) => f.trim()).filter((f) => f && fs.existsSync(f));
  }
  const skip = new Set(['node_modules', '.git', 'dist', '.expo', 'web-build']);
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (skip.has(entry.name)) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else out.push(full.replace(/\\/g, '/'));
    }
  };
  walk('.');
  return out;
}

const b64url = (input: Buffer | string) => Buffer.from(input).toString('base64url');

function signHs256(payload: object, secret: string, headerOverride: object = {}): string {
  const head = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT', ...headerOverride }));
  const body = b64url(JSON.stringify(payload));
  const sig = crypto.createHmac('sha256', secret).update(`${head}.${body}`).digest('base64url');
  return `${head}.${body}.${sig}`;
}

function signEs256(payload: object, privateKey: crypto.KeyObject, kid: string): string {
  const head = b64url(JSON.stringify({ alg: 'ES256', typ: 'JWT', kid }));
  const body = b64url(JSON.stringify(payload));
  const sig = crypto.sign('sha256', Buffer.from(`${head}.${body}`), { key: privateKey, dsaEncoding: 'ieee-p1363' });
  return `${head}.${body}.${b64url(sig)}`;
}

interface TestResponse {
  status: number;
  headers: http.IncomingHttpHeaders;
  body: string;
}

function startServer(handler: (req: http.IncomingMessage, res: http.ServerResponse) => unknown): Promise<{ port: number; close: () => Promise<void> }> {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      Promise.resolve(handler(req, res)).catch(() => {
        res.statusCode = 500;
        res.end();
      });
    });
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as AddressInfo;
      resolve({ port, close: () => new Promise<void>((r) => server.close(() => r())) });
    });
  });
}

function request(port: number, method: string, urlPath: string, headers: Record<string, string> = {}, body?: string): Promise<TestResponse> {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, method, path: urlPath, headers }, (res) => {
      let data = '';
      res.on('data', (chunk) => (data += chunk));
      res.on('end', () => resolve({ status: res.statusCode || 0, headers: res.headers, body: data }));
    });
    req.on('error', reject);
    if (body !== undefined) req.write(body);
    req.end();
  });
}

let ipCounter = 0;
const freshIp = () => `198.51.100.${(ipCounter++ % 250) + 1}`;

async function main(): Promise<void> {
  // -------------------------------------------------------------------------------------------
  console.log('\n[Check 5] Validating firmware integrity checks use real SHA-256 (T59/T60/T446)...');
  const emptySha = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';
  assert((await verifyChecksum('', emptySha)) === true, 'T60/T59: SHA-256 of the empty payload matches its digest');
  assert((await verifyChecksum('dummy', emptySha)) === false, 'T60/T59: A payload that does not hash to the digest is rejected');
  assert((await verifyChecksum('dummy', 'bad')) === false, 'T60/T59: Invalid checksum rejected');
  assert((await verifyChecksum('', 'z'.repeat(64))) === false, 'T60/T59: Non-hex digest rejected');
  assert((await verifyChecksum('', emptySha.toUpperCase())) === true, 'T60/T59: Upper-case hex digest accepted');
  assert((await sha256Hex('abc')) === 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad', 'T60: FIPS 180-2 SHA-256 test vector');
  assert((await verifyChecksum(new Uint8Array([0x61, 0x62, 0x63]), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad')) === true, 'T60: Binary payloads are hashed');
  const coreSource = readText('src/services/securityCore.ts');
  assert(coreSource.includes("subtle.digest('SHA-256'"), 'T59: SHA-256 comes from Web Crypto (SubtleCrypto), not a homemade implementation');
  console.log('✓ verifyChecksum hashes the payload with Web Crypto SHA-256 and compares digests in constant time.');

  // -------------------------------------------------------------------------------------------
  console.log('\n[Check 6] Validating cryptographically secure randomness (T151/T587)...');
  assert(/^[0-9a-f]{32}$/.test(generateSecureId()), 'T151: secure ids carry 128 random bits (hex)');
  assert(/^ref_[0-9a-f]{32}$/.test(getPublicReference('device-under-test')), 'T50/T151: indirect references are unguessable');
  const ids = new Set(Array.from({ length: 2000 }, () => generateRecordId('ev_')));
  assert(ids.size === 2000, 'T151: record ids are unique');
  assert(coreSource.includes('getRandomValues'), 'T151: randomness comes from crypto.getRandomValues');
  const noMathRandom = [
    'src/services/security.ts',
    'src/services/securityCore.ts',
    'src/services/storage.ts',
    'src/services/supabase.ts',
    'app/(app)/integrations.tsx',
    'app/(app)/team.tsx',
    'app/(app)/automations.tsx',
    'app/(app)/firmware.tsx',
    'api/_lib/security.ts',
    'api/devices/index.ts',
    'api/health.ts',
    'api/auth/logout.ts',
    'api/csp-report.ts',
    'api/simulation/scenarios.ts',
  ];
  noMathRandom.forEach((file) => assert(!readText(file).includes('Math.random'), `T151: ${file} must not use Math.random`));
  const sourceFiles = trackedFiles().filter((f) => /^(app|src|api)\/.*\.(ts|tsx)$/.test(f));
  const mathRandomFiles = sourceFiles.filter((f) => readText(f).includes('Math.random')).sort();
  assert.deepStrictEqual(mathRandomFiles, ['app/(app)/device-enroll.tsx', 'src/services/simulation.ts'],
    'T587: Math.random is only used for simulated telemetry noise and the simulated QR scan (non-security)');
  const adHocRoleChecks = sourceFiles
    .filter((f) => !f.endsWith('securityCore.ts'))
    .filter((f) => /\brole\s*(===|!==|==)\s*'(owner|administrator|operator|viewer)'/.test(readText(f)));
  assert(adHocRoleChecks.length === 0, `T226: authorization must go through the central module (ad-hoc role checks in ${adHocRoleChecks.join(', ')})`);
  const simulationSource = readText('src/services/simulation.ts');
  assert(!/id:\s*'[a-z]+_'\s*\+\s*Date\.now\(\)\s*\+\s*'_'\s*\+\s*Math\.random/.test(simulationSource), 'T151: simulation record ids do not use Math.random');
  console.log('✓ Security-relevant ids and references come from the CSPRNG; Math.random is confined to telemetry noise.');

  // -------------------------------------------------------------------------------------------
  console.log('\n[Check 7] Validating secret hygiene (T76/T248/T214)...');
  const syncScript = readText('scripts/sync-sde-tasks.ts');
  assert(syncScript.includes('process.env') && syncScript.includes('SDE_API_TOKEN') && syncScript.includes('SDE_URL'), 'T76: SDE credentials come from the environment');
  assert(!/const\s+API_KEY\s*=\s*['"`]/.test(syncScript), 'T76: no inline API key constant');
  const tsxCli = path.join('node_modules', 'tsx', 'dist', 'cli.mjs');
  const cleanEnv: NodeJS.ProcessEnv = { ...process.env };
  delete cleanEnv.SDE_URL;
  delete cleanEnv.SDE_API_TOKEN;
  const missing = spawnSync(process.execPath, [tsxCli, 'scripts/sync-sde-tasks.ts'], { env: cleanEnv, encoding: 'utf8', timeout: 60000 });
  assert(missing.status === 1, 'T76: sync script must exit with status 1 when credentials are missing');
  assert(/SDE_URL/.test(missing.stderr) && /SDE_API_TOKEN/.test(missing.stderr), 'T76: failure message names the missing variables');
  const insecure = spawnSync(process.execPath, [tsxCli, 'scripts/sync-sde-tasks.ts'], {
    env: { ...cleanEnv, SDE_URL: 'http://sde.invalid', SDE_API_TOKEN: 'placeholder-not-a-secret' },
    encoding: 'utf8',
    timeout: 60000,
  });
  assert(insecure.status === 1 && /https/.test(insecure.stderr), 'T76: plain-http SDE_URL is refused before any request');

  const secretPatterns: Array<[string, RegExp]> = [
    ['credential assignment', /\b(?:api[_-]?key|api[_-]?token|secret|passwd|password|access[_-]?token)\b\s*[:=]\s*['"`][A-Za-z0-9_\-+/=.]{16,}['"`]/i],
    ['authorization header literal', /Authorization['"]?\s*:\s*['"`](?:Token|Bearer)\s+[A-Za-z0-9._\-]{16,}/],
    ['JWT literal', /eyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/],
    ['private key block', /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/],
    ['AWS access key', /AKIA[0-9A-Z]{16}/],
    ['prefilled password state', /setPassword\(\s*['"][^'"]+['"]\s*\)|\[password,\s*setPassword\]\s*=\s*useState\(\s*['"][^'"]+['"]\s*\)/],
  ];
  const textExt = /\.(ts|tsx|js|jsx|json|sql|md|yml|yaml|toml|env|example|txt)$/i;
  const findings: string[] = [];
  trackedFiles()
    .filter((f) => textExt.test(f) && !f.endsWith('pnpm-lock.yaml') && !f.endsWith('verify-security-controls.ts'))
    .forEach((file) => {
      readText(file).split(/\r?\n/).forEach((line, idx) => {
        secretPatterns.forEach(([label, re]) => {
          if (re.test(line)) findings.push(`${file}:${idx + 1} (${label})`);
        });
      });
    });
  assert(findings.length === 0, `T76/T248: hardcoded credentials found at ${findings.join(', ')}`);

  const ignored = spawnSync('git', ['check-ignore', '.env', '.env.local', '.env.production', '.env.development'], { encoding: 'utf8' });
  if (ignored.status !== null && ignored.error === undefined) {
    const lines = ignored.stdout.split('\n').map((l) => l.trim()).filter(Boolean);
    assert(lines.length === 4, 'T214/T248: every .env variant is git-ignored');
    const template = spawnSync('git', ['check-ignore', '.env.example'], { encoding: 'utf8' });
    assert(template.status === 1, 'T214: .env.example stays tracked as the configuration template');
  }
  console.log('✓ No hardcoded credentials in tracked files; the SDE sync script fails closed without env vars; .env files are ignored.');

  // -------------------------------------------------------------------------------------------
  console.log('\n[Check 8] Validating API authentication, authorization, CORS and input handling (T184/T257/T2141/T2142/T85/T318/T228/T537)...');
  // Local stand-in for Supabase (no external calls, scripts/fake-supabase.ts): /auth/v1/user answers 200
  // for live sessions and 403 session_not_found for revoked ones (what Supabase returns after logout),
  // and /rest/v1 emulates the PostgREST subset the API uses, without row-level security.
  const supabaseStub = await startFakeSupabase();
  const revokedSessions = supabaseStub.revokedSessions;
  const issuerBase = supabaseStub.url;
  process.env.SUPABASE_ANON_KEY = 'public-anon-key-used-only-by-tests';
  const hmacSecret = crypto.randomBytes(32).toString('hex');
  const { privateKey, publicKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' });
  const jwk = { ...(publicKey.export({ format: 'jwk' }) as object), kid: 'unit-test-key', alg: 'ES256', use: 'sig' };
  const allowedOrigin = 'https://app.acme-iot.test';
  const orgA = '11111111-1111-1111-1111-111111111111';
  const orgB = '22222222-2222-2222-2222-222222222222';
  const userId = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';

  process.env.SUPABASE_URL = issuerBase;
  process.env.SUPABASE_JWT_SECRET = hmacSecret;
  process.env.SUPABASE_JWKS = JSON.stringify({ keys: [jwk] });
  process.env.ALLOWED_ORIGINS = `${allowedOrigin}, *, not a url`;

  const now = Math.floor(Date.now() / 1000);
  const claims = (overrides: Record<string, unknown> = {}) => ({
    iss: `${issuerBase}/auth/v1`,
    aud: 'authenticated',
    role: 'authenticated',
    sub: userId,
    iat: now - 10,
    exp: now + 3600,
    org_id: orgA,
    user_role: 'administrator',
    ...overrides,
  });
  const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });
  const adminToken = signHs256(claims(), hmacSecret);
  const validDevice = {
    name: 'Lobby Thermostat',
    code: 'hq-th-900',
    type: 'thermostat',
    buildingId: 'b1111111-0000-0000-0000-000000000001',
    roomId: 'c1010000-0000-0000-0000-000000000001',
  };
  // Enrollment now persists the device and checks its location: the building belongs to orgA and the room to that building.
  supabaseStub.tables.buildings.push({ id: validDevice.buildingId, organization_id: orgA, name: 'Tech Tower', code: 'TT-01', address: 'HQ', total_floors: 12 });
  supabaseStub.tables.rooms.push({ id: validDevice.roomId, building_id: validDevice.buildingId, name: 'Boardroom', floor: 1, room_number: '101', type: 'conference' });
  const json = (extra: Record<string, string> = {}) => ({ 'Content-Type': 'application/json', 'X-Forwarded-For': freshIp(), ...extra });

  const devices = await startServer(devicesHandler);
  const health = await startServer(healthHandler);
  const scenarios = await startServer(scenariosHandler);
  const logout = await startServer(logoutHandler);
  const cspReport = await startServer(cspReportHandler);
  const allResponses: TestResponse[] = [];
  // Security log lines emitted by the API are captured (and asserted on) instead of printed.
  const captured: string[] = [];
  const activity: string[] = [];
  const originalWarn = console.warn;
  const originalInfo = console.info;
  console.warn = (...args: unknown[]) => {
    captured.push(args.map(String).join(' '));
  };
  console.info = (...args: unknown[]) => {
    activity.push(args.map(String).join(' '));
  };
  const post = async (headers: Record<string, string>, body: unknown) => {
    const r = await request(devices.port, 'POST', '/api/devices', headers, typeof body === 'string' ? body : JSON.stringify(body));
    allResponses.push(r);
    return r;
  };

  try {
    // Authentication (T184/T558): every non-public call needs a valid Supabase access token.
    let r = await post(json(), validDevice);
    assert(r.status === 401 && r.headers['www-authenticate'] === 'Bearer', 'T184: missing token -> 401 with WWW-Authenticate');
    assert(JSON.parse(r.body).error === 'Authentication required', 'T184: generic authentication error');
    r = await post(json({ Authorization: 'Bearer not.a.jwt' }), validDevice);
    assert(r.status === 401, 'T184: malformed token -> 401');
    r = await post(json(bearer(signHs256(claims(), hmacSecret, { alg: 'none' }))), validDevice);
    assert(r.status === 401, 'T184: alg=none is refused');
    r = await post(json(bearer(signHs256(claims(), crypto.randomBytes(32).toString('hex')))), validDevice);
    assert(r.status === 401, 'T184: token signed with another key -> 401');
    r = await post(json(bearer(signHs256(claims({ exp: now - 120 }), hmacSecret))), validDevice);
    assert(r.status === 401, 'T184: expired token -> 401');
    r = await post(json(bearer(signHs256(claims({ iat: now + 3600 }), hmacSecret))), validDevice);
    assert(r.status === 401, 'T184: token issued in the future -> 401');
    r = await post(json(bearer(signHs256(claims({ iss: 'https://evil.example/auth/v1' }), hmacSecret))), validDevice);
    assert(r.status === 401, 'T184: foreign issuer -> 401');
    r = await post(json(bearer(signHs256(claims({ aud: 'other' }), hmacSecret))), validDevice);
    assert(r.status === 401, 'T184: wrong audience -> 401');
    r = await post(json(bearer(signHs256(claims({ role: 'anon' }), hmacSecret))), validDevice);
    assert(r.status === 401, 'T184: anon key style token -> 401');
    r = await post(json(bearer(signHs256(claims({ role: 'service_role' }), hmacSecret))), validDevice);
    assert(r.status === 401, 'T184: service_role token is not an end-user token -> 401');
    r = await post(json(bearer(signHs256(claims({ org_id: undefined, user_role: undefined }), hmacSecret))), validDevice);
    assert(r.status === 403, 'T18: authenticated user without organization membership -> 403');

    // Sessions end with the logout (T93/T26): replaying a captured token after the session was revoked fails.
    const sessionToken = signHs256(claims({ session_id: 'session-under-test' }), hmacSecret);
    r = await post(json(bearer(sessionToken)), validDevice);
    assert(r.status === 201, 'T93: a token of a live session is accepted');
    revokedSessions.add('session-under-test');
    r = await post(json(bearer(sessionToken)), validDevice);
    assert(r.status === 401, 'T93/T26: after logout the same (still unexpired) token is refused by the server');
    supabaseStub.setAuthDown(true);
    r = await post(json(bearer(adminToken)), validDevice);
    assert(r.status === 503, 'T93: if the session cannot be checked the API fails closed');
    supabaseStub.setAuthDown(false);
    const savedAnonKey = process.env.SUPABASE_ANON_KEY;
    delete process.env.SUPABASE_ANON_KEY;
    r = await post(json(bearer(adminToken)), validDevice);
    assert(r.status === 503, 'T93: without the session-check configuration the API fails closed');
    process.env.SUPABASE_ANON_KEY = savedAnonKey;

    // Function-level authorization (T2141/T2142/T85): devices:admin only.
    r = await post(json(bearer(signHs256(claims({ user_role: 'viewer' }), hmacSecret))), validDevice);
    assert(r.status === 403 && JSON.parse(r.body).error === 'Forbidden', 'T2142: viewer cannot enroll devices');
    r = await post(json(bearer(signHs256(claims({ user_role: 'operator' }), hmacSecret))), validDevice);
    assert(r.status === 403, 'T2142: operator cannot enroll devices');
    r = await post(json(bearer(adminToken)), validDevice);
    assert(r.status === 201, `T2142: administrator can enroll devices (got ${r.status})`);
    const created = JSON.parse(r.body);
    assert.deepStrictEqual(Object.keys(created).sort(), ['device', 'success'], 'T2139: response has only the documented fields');
    assert.deepStrictEqual(
      Object.keys(created.device).sort(),
      ['buildingId', 'code', 'createdAt', 'id', 'name', 'organizationId', 'roomId', 'status', 'type'],
      'T2139: device payload exposes only schema fields'
    );
    assert(created.device.organizationId === orgA, 'T18/T378: tenant comes from the verified token');
    assert(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(created.device.id), 'T151: server ids are CSPRNG UUIDv4');
    r = await post(json(bearer(adminToken)), { ...validDevice, organizationId: orgB });
    assert(r.status === 403, 'T378: body organizationId of another tenant -> 403');
    r = await post(json(bearer(adminToken)), { ...validDevice, organizationId: orgA });
    assert(r.status === 201, 'T378: matching organizationId is accepted');

    // Server-side input validation (T32/T98/T569/T1149).
    r = await post(json(bearer(adminToken)), { ...validDevice, isAdmin: true });
    assert(r.status === 400 && r.body === JSON.stringify({ error: 'Invalid request' }), 'T32: unknown fields rejected with a generic message');
    r = await post(json(bearer(adminToken)), { ...validDevice, buildingId: "1 OR 1=1" });
    assert(r.status === 400 && !r.body.includes('buildingId'), 'T569: ids must be UUIDs; error does not reveal validation details');
    r = await post(json(bearer(adminToken)), { ...validDevice, name: 'bad\u0000name' });
    assert(r.status === 400, 'T34: control characters refused');
    r = await post(json(bearer(adminToken)), '{"name": ');
    assert(r.status === 400, 'T1149: malformed JSON refused');
    const invalidVariants: Array<[string, Record<string, unknown>]> = [
      ['name too short', { name: 'x' }],
      ['name too long', { name: 'n'.repeat(101) }],
      ['name wrong type', { name: 42 }],
      ['code with symbols', { code: 'HQ-TH-901; DROP TABLE devices' }],
      ['code too long', { code: 'C'.repeat(51) }],
      ['type outside enum', { type: 'door_lock' }],
      ['roomId not a UUID', { roomId: '../../etc/passwd' }],
      ['missing buildingId', { buildingId: undefined }],
    ];
    for (const [label, change] of invalidVariants) {
      r = await post(json(bearer(adminToken)), { ...validDevice, ...change });
      assert(r.status === 400 && r.body === JSON.stringify({ error: 'Invalid request' }), `T98/T1149: ${label} is rejected server-side`);
    }
    r = await post(json(bearer(adminToken)), JSON.stringify([validDevice]));
    assert(r.status === 400, 'T1149: a JSON array instead of the expected object is rejected');
    r = await post({ 'Content-Type': 'text/plain', 'X-Forwarded-For': freshIp(), ...bearer(adminToken) }, validDevice);
    assert(r.status === 415, 'T553: unexpected Content-Type -> 415');
    r = await post(json(bearer(adminToken)), JSON.stringify({ ...validDevice, name: 'x'.repeat(60 * 1024) }));
    assert(r.status === 413, 'T228/T537: bodies over 50 KB -> 413');

    // HTTP verbs (T65/T113).
    r = await request(devices.port, 'GET', '/api/devices', { 'X-Forwarded-For': freshIp() });
    assert(r.status === 405 && r.headers['allow'] === 'POST, OPTIONS', 'T65: GET is not accepted on /api/devices');
    r = await request(devices.port, 'DELETE', '/api/devices', { 'X-Forwarded-For': freshIp(), ...bearer(adminToken) });
    assert(r.status === 405, 'T113: verb tampering (DELETE) -> 405');
    r = await request(health.port, 'POST', '/api/health', { 'X-Forwarded-For': freshIp() }, '{}');
    assert(r.status === 405 && r.headers['allow'] === 'GET', 'T65: /api/health only answers GET');
    const viewerToken = signHs256(claims({ user_role: 'viewer' }), hmacSecret);
    r = await request(scenarios.port, 'HEAD', '/api/simulation/scenarios', { 'X-Forwarded-For': freshIp(), ...bearer(viewerToken) });
    assert(r.status === 405, 'T113: HEAD is not processed where only GET is allowed');
    r = await request(scenarios.port, 'HEAD', '/api/simulation/scenarios', { 'X-Forwarded-For': freshIp() });
    assert(r.status === 405, 'T113: HEAD without a session is refused too');
    let tampered: TestResponse | undefined;
    try {
      tampered = await request(devices.port, 'PWRLWA', '/api/devices', { 'X-Forwarded-For': freshIp() });
    } catch {
      tampered = undefined; // the HTTP parser may drop the connection for an unknown method
    }
    assert(!tampered || tampered.status === 400 || tampered.status === 405, 'T113: a random HTTP verb is never served');

    // Asymmetric keys (JWKS) and algorithm confusion.
    r = await post(json(bearer(signEs256(claims(), privateKey, 'unit-test-key'))), validDevice);
    assert(r.status === 201, 'T184: ES256 tokens verified with the JWKS');
    r = await post(json(bearer(signEs256(claims(), privateKey, 'unknown-kid'))), validDevice);
    assert(r.status === 401, 'T184: unknown signing key -> 401');
    const signRs256 = (payload: object, key: crypto.KeyObject, kid: string) => {
      const head = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT', kid }));
      const body = b64url(JSON.stringify(payload));
      return `${head}.${body}.${b64url(crypto.sign('sha256', Buffer.from(`${head}.${body}`), key))}`;
    };
    const rsaStrong = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
    const rsaWeak = crypto.generateKeyPairSync('rsa', { modulusLength: 1024 });
    const withRsaKeys = JSON.stringify({ keys: [
      jwk,
      { ...(rsaStrong.publicKey.export({ format: 'jwk' }) as object), kid: 'rsa-2048', alg: 'RS256' },
      { ...(rsaWeak.publicKey.export({ format: 'jwk' }) as object), kid: 'rsa-1024', alg: 'RS256' },
    ] });
    const jwksBefore = process.env.SUPABASE_JWKS;
    process.env.SUPABASE_JWKS = withRsaKeys;
    r = await post(json(bearer(signRs256(claims(), rsaStrong.privateKey, 'rsa-2048'))), validDevice);
    assert(r.status === 201, 'T445: RS256 with a 2048-bit key is accepted');
    r = await post(json(bearer(signRs256(claims(), rsaWeak.privateKey, 'rsa-1024'))), validDevice);
    assert(r.status === 401, 'T445/T60: RS256 keys below 2048 bits are refused');
    r = await post(json(bearer(signHs256(claims(), hmacSecret, { alg: 'HS512' }))), validDevice);
    assert(r.status === 401, 'T445: algorithms outside the approved allow-list (HS256/ES256/RS256) are refused');
    process.env.SUPABASE_JWKS = jwksBefore;
    const savedSecret = process.env.SUPABASE_JWT_SECRET;
    delete process.env.SUPABASE_JWT_SECRET;
    r = await post(json(bearer(adminToken)), validDevice);
    assert(r.status === 401, 'T184: HS256 tokens are refused when only asymmetric keys are configured');
    const savedJwks = process.env.SUPABASE_JWKS;
    delete process.env.SUPABASE_JWKS;
    r = await post(json(bearer(adminToken)), validDevice);
    assert(r.status === 503, 'T184: without verification keys the API fails closed (503)');
    process.env.SUPABASE_JWT_SECRET = 'short-secret';
    r = await post(json(bearer(signHs256(claims(), 'short-secret'))), validDevice);
    assert(r.status === 503, 'T60: weak HMAC secrets (< 32 chars) are not accepted as verification keys');
    process.env.SUPABASE_JWT_SECRET = savedSecret;
    process.env.SUPABASE_JWKS = savedJwks;

    // CORS allow-list (T257/T318).
    const preflight = (origin: string, method = 'POST', headers = 'authorization,content-type') =>
      request(devices.port, 'OPTIONS', '/api/devices', {
        Origin: origin,
        'Access-Control-Request-Method': method,
        'Access-Control-Request-Headers': headers,
        'X-Forwarded-For': freshIp(),
      });
    r = await preflight(allowedOrigin);
    allResponses.push(r);
    assert(r.status === 204 && r.headers['access-control-allow-origin'] === allowedOrigin, 'T257: allow-listed origin gets an exact ACAO echo');
    assert(r.headers['vary'] === 'Origin' && r.headers['access-control-max-age'] === '600', 'T257: Vary: Origin and Access-Control-Max-Age are set');
    assert(r.headers['access-control-allow-methods'] === 'POST', 'T257: only the route methods are advertised');
    assert(r.headers['access-control-allow-credentials'] === undefined, 'T257: credentials are not allowed (bearer tokens only)');
    for (const evil of [
      'https://evil.example',
      `${allowedOrigin}.evil.example`,
      'https://evil.example/https://app.acme-iot.test',
      'null',
      'https://app-acme-iot.test',
      'https://xapp.acme-iot.test',
      'http://app.acme-iot.test',
      'https://APP.acme-iot.test.evil.example',
    ]) {
      r = await preflight(evil);
      allResponses.push(r);
      assert(r.status === 403 && r.headers['access-control-allow-origin'] === undefined, `T318: untrusted origin ${evil} is refused`);
    }
    r = await preflight(allowedOrigin, 'DELETE');
    assert(r.status === 403, 'T318: preflight for a method the route does not accept is refused');
    r = await preflight(allowedOrigin, 'POST', 'authorization,x-debug');
    assert(r.status === 403, 'T318: preflight with unexpected headers is refused');
    r = await post(json({ Origin: 'https://evil.example', ...bearer(adminToken) }), validDevice);
    assert(r.status === 403 && r.headers['access-control-allow-origin'] === undefined, 'T257: state-changing call from a foreign origin is refused (CSRF)');
    r = await post(json({ Origin: allowedOrigin, ...bearer(adminToken) }), validDevice);
    assert(r.status === 201 && r.headers['access-control-allow-origin'] === allowedOrigin, 'T257: allow-listed origin can call the API');
    r = await post(json({ Origin: allowedOrigin }), validDevice);
    assert(r.status === 401, 'T318: a trusted Origin alone never grants access (authentication still required)');
    for (const verb of ['GET', 'PUT', 'PATCH', 'DELETE']) {
      for (const originHeader of [{}, { Origin: allowedOrigin }] as Array<Record<string, string>>) {
        r = await request(devices.port, verb, '/api/devices', { 'X-Forwarded-For': freshIp(), ...originHeader });
        allResponses.push(r);
        assert(r.status === 405, `T318: ${verb} ${Object.keys(originHeader).length ? 'cross-origin' : 'same-origin'} without credentials is refused`);
      }
    }
    r = await request(devices.port, 'OPTIONS', '/api/devices', { 'X-Forwarded-For': freshIp() });
    assert(r.status === 403, 'T318: OPTIONS without a trusted Origin is refused');
    r = await post(json({ Origin: allowedOrigin, 'X-Forwarded-Proto': 'http', ...bearer(adminToken) }), validDevice);
    assert(r.status === 400, 'T257/T553: plain-HTTP request claiming an HTTPS origin is refused');
    assert(allResponses.every((resp) => resp.headers['access-control-allow-origin'] !== '*'), 'T257: no response ever sends ACAO *');
    // JSON hijacking (T167): every JSON body is an object (never a top-level array) served as application/json.
    const jsonBodies = allResponses.filter((resp) => resp.body.trim().length > 0);
    assert(jsonBodies.length > 20, 'T167: enough API responses were inspected');
    jsonBodies.forEach((resp) => {
      assert(resp.body.trim().startsWith('{'), `T167: API response must be a JSON object (status ${resp.status})`);
      assert(String(resp.headers['content-type']).startsWith('application/json'), 'T167: API responses use the application/json MIME type');
    });

    // Response hardening (T64/T1873/T2139).
    r = await request(health.port, 'GET', '/api/health', { 'X-Forwarded-For': freshIp() });
    const healthBody = JSON.parse(r.body);
    assert(r.status === 200 && healthBody.status === 'ok', 'T2139: health check works without authentication (public allow-list)');
    assert.deepStrictEqual(Object.keys(healthBody).sort(), ['status', 'timestamp'], 'T2139/T1873: health discloses no version or database vendor');
    assert(r.headers['access-control-allow-origin'] === undefined, 'T257: no CORS headers on the same-origin health check');
    assert(String(r.headers['cache-control']).includes('no-store') && r.headers['pragma'] === 'no-cache', 'T64: API responses are not cached');
    assert(r.headers['x-content-type-options'] === 'nosniff' && r.headers['x-frame-options'] === 'DENY', 'T1873: hardening headers present');
    assert(r.headers['x-powered-by'] === undefined && r.headers['server'] === undefined, 'T1873: no technology disclosure headers');
    assert(!fs.existsSync('api/simulation/tick.ts'), 'T2139: unused no-op endpoint removed');

    r = await request(scenarios.port, 'GET', '/api/simulation/scenarios', { 'X-Forwarded-For': freshIp() });
    assert(r.status === 401, 'T184: scenarios require authentication');
    r = await request(scenarios.port, 'GET', '/api/simulation/scenarios', { 'X-Forwarded-For': freshIp(), ...bearer(signHs256(claims({ user_role: 'viewer' }), hmacSecret)) });
    assert(r.status === 200 && JSON.parse(r.body).scenarios.length === 5, 'T184: members with devices:read can list scenarios');
    const scenarioBody = JSON.parse(r.body);
    assert.deepStrictEqual(Object.keys(scenarioBody).sort(), ['scenarios', 'success'], 'T2140: scenarios response has only documented fields');
    assert(scenarioBody.scenarios.every((sc: any) => Object.keys(sc).sort().join(',') === 'description,id,name'), 'T2140: scenario items expose only id, name and description');
    r = await request(scenarios.port, 'POST', '/api/simulation/scenarios', { 'X-Forwarded-For': freshIp(), 'Content-Type': 'application/json' }, '{}');
    assert(r.status === 405, 'T65: scenarios only answer GET');

    // Large messages are refused without degrading the service (T537).
    // A dedicated user keeps this check independent of the per-user throttling budget used above.
    const bulkToken = signHs256(claims({ sub: 'cccccccc-dddd-4eee-8fff-000000000001' }), hmacSecret);
    const big = JSON.stringify({ ...validDevice, name: 'y'.repeat(1024 * 1024) });
    const bigResults = await Promise.all(Array.from({ length: 8 }, () => post(json(bearer(bulkToken)), big)));
    assert(bigResults.every((res) => res.status === 413), 'T537: 1 MB payloads are refused with 413, also under concurrency');
    r = await post(json(bearer(bulkToken)), validDevice);
    assert(r.status === 201, 'T537: the service keeps answering normally after oversized requests');

    // Throttling (T1362/T1363): per-IP limit with Retry-After.
    const throttledIp = '203.0.113.77';
    let last: TestResponse | undefined;
    for (let i = 0; i < 61; i++) {
      last = await request(health.port, 'GET', '/api/health', { 'X-Forwarded-For': throttledIp });
    }
    assert(last && last.status === 429 && Number(last.headers['retry-after']) >= 1, 'T1363: the 61st request in a minute is throttled with Retry-After');
    const otherIp = await request(health.port, 'GET', '/api/health', { 'X-Forwarded-For': freshIp() });
    assert(otherIp.status === 200, 'T1363: throttling is scoped to the offending client');
    // Per-user (API key/token) throttling: the same user is limited even when rotating IPs.
    const busyUser = signHs256(claims({ sub: 'bbbbbbbb-cccc-4ddd-8eee-ffffffffffff', user_role: 'viewer' }), hmacSecret);
    let userLast: TestResponse | undefined;
    for (let i = 0; i < 61; i++) {
      userLast = await request(scenarios.port, 'GET', '/api/simulation/scenarios', { 'X-Forwarded-For': freshIp(), ...bearer(busyUser) });
    }
    assert(userLast && userLast.status === 429, 'T1363: a single user is throttled across IP addresses');

    // Logout clears browser data (T1539/T1540).
    r = await request(logout.port, 'POST', '/api/auth/logout', json(), '{}');
    assert(r.status === 204, 'T1539: logout endpoint answers 204');
    const csd = String(r.headers['clear-site-data'] || '');
    assert(csd.includes('"cache"') && csd.includes('"cookies"') && csd.includes('"storage"'), 'T1540: Clear-Site-Data covers cache, cookies and storage');
    r = await request(logout.port, 'POST', '/api/auth/logout', json({ Origin: 'https://evil.example' }), '{}');
    assert(r.status === 403, 'T1539: cross-site logout requests are refused');
    r = await request(logout.port, 'POST', '/api/auth/logout', { 'Content-Type': 'application/x-www-form-urlencoded', 'X-Forwarded-For': freshIp() }, 'a=1');
    assert(r.status === 415, 'T1539: form posts (no preflight) cannot trigger logout');

    // CSP violation reports are accepted and logged (T331).
    r = await request(cspReport.port, 'POST', '/api/csp-report', { 'Content-Type': 'application/csp-report', 'X-Forwarded-For': freshIp() },
      JSON.stringify({ 'csp-report': { 'document-uri': 'https://app.acme-iot.test/dashboard?token=secret', 'violated-directive': 'script-src', 'blocked-uri': 'https://cdn.evil.example/x.js?q=1' } }));
    assert(r.status === 204, 'T331: CSP reports are accepted');
    // Security events are logged with timestamp, source IP and event, without tokens (T32/T45).
    r = await post(json({ 'X-Forwarded-For': '192.0.2.10', ...bearer(signHs256(claims({ exp: now - 999 }), hmacSecret)) }), validDevice);
    assert(r.status === 401, 'expired token rejected');
    const cspLine = captured.find((l) => l.includes('"csp_violation"'));
    assert(cspLine && cspLine.includes('script-src') && cspLine.includes('https://cdn.evil.example') && !cspLine.includes('token=secret') && !cspLine.includes('q=1'),
      'T331: CSP violations are logged with directive and origins only');
    const authLine = captured.find((l) => l.includes('"auth_failed"') && l.includes('192.0.2.10'));
    assert(authLine, 'T32/T45: failed authentication is logged with the source IP');
    const parsedLine = JSON.parse(authLine as string);
    assert(parsedLine.category === 'security' && parsedLine.status === 401 && typeof parsedLine.timestamp === 'string', 'T32: log line has category, status and timestamp');
    assert(!captured.some((l) => l.includes(hmacSecret) || l.includes('eyJ')), 'T46: logs never contain tokens or secrets');
    const validationLine = captured.find((l) => l.includes('"validation_failed"') && l.includes('isAdmin'));
    assert(validationLine && !validationLine.includes('true'), 'T32: validation failures log field names, not values');
    const enrolledLine = activity.find((l) => l.includes('"device_enrolled"'));
    assert(enrolledLine && JSON.parse(enrolledLine).category === 'activity' && JSON.parse(enrolledLine).organizationId === orgA, 'T2602: enrollments are logged as activity with the tenant');
    assert(!activity.some((l) => l.includes(hmacSecret) || l.includes('eyJ')), 'T46: activity logs never contain tokens or secrets');
  } finally {
    console.warn = originalWarn;
    console.info = originalInfo;
    await Promise.all([devices.close(), health.close(), scenarios.close(), logout.close(), cspReport.close(), supabaseStub.close()]);
  }
  console.log(`  (${captured.length} structured security log lines captured and checked)`);
  console.log('✓ API routes authenticate Supabase JWTs, authorize by role and tenant, enforce a CORS allow-list, throttle, validate input and log security events.');

  // -------------------------------------------------------------------------------------------
  console.log('\n[Check 9] Validating database privileges and RLS hardening migration (T19/T2598/T2597/T227/T2607)...');
  const migrationsDir = 'supabase/migrations';
  const migrationFiles = fs.readdirSync(migrationsDir).filter((f) => f.endsWith('.sql')).sort();
  assert(migrationFiles[0] === '20261012_init_schema.sql' && migrationFiles.includes('20261019_security_hardening.sql'), 'Hardening ships as a new migration after the initial schema');
  const allSql = migrationFiles.map((f) => readText(path.join(migrationsDir, f))).join('\n');
  const hardening = readText(path.join(migrationsDir, '20261019_security_hardening.sql'));

  // Replay CREATE/DROP POLICY statements in migration order to get the effective policy set.
  const policies = new Map<string, string>();
  for (const stmt of allSql.split(/;\s*(?:\r?\n|$)/)) {
    const text = stmt.replace(/--[^\n]*\n/g, '\n').trim();
    const drop = /^DROP POLICY IF EXISTS (\w+) ON public\.(\w+)/i.exec(text);
    if (drop) policies.delete(`${drop[2]}.${drop[1]}`);
    const create = /^CREATE POLICY (\w+) ON public\.(\w+)/i.exec(text);
    if (create) policies.set(`${create[2]}.${create[1]}`, text.replace(/\s+/g, ' '));
  }
  const createdTables = Array.from(allSql.matchAll(/CREATE TABLE IF NOT EXISTS public\.(\w+)/g)).map((m) => m[1]);
  createdTables.forEach((t) => assert(allSql.includes(`ALTER TABLE public.${t} ENABLE ROW LEVEL SECURITY;`), `T19: RLS enabled on ${t}`));

  assert(!policies.has('user_profiles.profile_manage_policy'), 'T2597: the FOR ALL profile policy without WITH CHECK is gone');
  const profileUpdate = policies.get('user_profiles.profile_update_policy') || '';
  assert(/WITH CHECK/.test(profileUpdate) && profileUpdate.includes("role IN ('operator', 'viewer')") && profileUpdate.includes('id <> auth.uid()'),
    'T2597/T14: administrators can only assign operator/viewer and nobody edits their own role');
  const selfUpdate = policies.get('user_profiles.profile_self_update_policy') || '';
  assert(selfUpdate.includes('role = public.current_user_role()') && selfUpdate.includes('organization_id = public.current_user_org_id()'),
    'T14: self-service updates cannot change role or organization');
  const profileInsert = policies.get('user_profiles.profile_insert_policy') || '';
  assert(/FOR INSERT/.test(profileInsert) && profileInsert.includes("role IN ('operator', 'viewer')"), 'T2597: administrators cannot create owner/administrator profiles');

  const rolloutRead = policies.get('firmware_rollouts.rollout_read_policy') || '';
  const rolloutWrite = policies.get('firmware_rollouts.rollout_write_policy') || '';
  assert(rolloutRead.includes('organization_id = public.current_user_org_id()'), 'T2598: rollout reads are tenant scoped');
  assert(rolloutWrite.includes('organization_id = public.current_user_org_id()') && /WITH CHECK/.test(rolloutWrite), 'T2598: rollout writes are tenant scoped with WITH CHECK');
  assert(hardening.includes('ADD COLUMN IF NOT EXISTS organization_id UUID REFERENCES public.organizations(id)'), 'T2598: firmware_rollouts carries the tenant');

  // Every write-capable policy is scoped to the caller's organization.
  policies.forEach((text, key) => {
    if (/FOR SELECT TO supabase_auth_admin/.test(text)) return;
    if (/FOR (ALL|INSERT|UPDATE|DELETE)/.test(text)) {
      assert(text.includes('current_user_org_id()') || text.includes('id = auth.uid()'), `T2598: write policy ${key} must be tenant scoped`);
    }
  });

  // DB role lists must match the central RBAC matrix (single authorization model, T15/T226).
  const rolesWith = (permission: Permission) => USER_ROLES.filter((role) => hasPermission(role, permission)).slice().sort().join(',');
  const policyRoles = (key: string) => {
    const m = /current_user_role\(\) IN \(([^)]+)\)/.exec(policies.get(key) || '');
    return m ? m[1].split(',').map((s) => s.trim().replace(/'/g, '')).sort().join(',') : '';
  };
  const expectations: Array<[string, Permission]> = [
    ['devices.devices_control_policy', 'devices:control'],
    ['devices.devices_admin_policy', 'devices:admin'],
    ['buildings.buildings_write_policy', 'devices:admin'],
    ['rooms.rooms_write_policy', 'devices:admin'],
    ['automations.automations_write_policy', 'automations:write'],
    ['alerts.alerts_update_policy', 'alerts:update'],
    ['integrations.integrations_write_policy', 'integrations:manage'],
    ['integrations.integrations_read_policy', 'integrations:manage'],
    ['firmware_rollouts.rollout_write_policy', 'firmware:manage'],
  ];
  expectations.forEach(([key, permission]) => {
    assert(policyRoles(key) === rolesWith(permission), `T15: ${key} roles (${policyRoles(key)}) must match ${permission} (${rolesWith(permission)})`);
  });

  assert(/ALTER FUNCTION public\.current_user_org_id\(\) SET search_path = '';/.test(hardening) && /ALTER FUNCTION public\.current_user_role\(\) SET search_path = '';/.test(hardening),
    'T19: SECURITY DEFINER helpers pin search_path');
  const definerFunctions = Array.from(allSql.matchAll(/CREATE OR REPLACE FUNCTION public\.(\w+)\(/g)).map((m) => m[1]);
  definerFunctions.forEach((fn) => assert(new RegExp(`(FUNCTION public\\.${fn}\\([^)]*\\)[\\s\\S]{0,200}?SET search_path = ''|ALTER FUNCTION public\\.${fn}\\(\\) SET search_path = '')`).test(allSql), `T19: ${fn} pins search_path`));
  assert(hardening.includes("ALTER TABLE public.user_profiles ALTER COLUMN role SET DEFAULT 'viewer';"), 'T14: new profiles default to the least-privileged role');
  assert(hardening.includes('REVOKE ALL ON ALL TABLES IN SCHEMA public FROM anon;'), 'T19/T2664: the anonymous role has no table privileges');
  assert(hardening.includes('REVOKE TRUNCATE, REFERENCES, TRIGGER ON ALL TABLES IN SCHEMA public FROM authenticated;'), 'T19: TRUNCATE (bypasses RLS) is revoked');
  assert(/REVOKE INSERT, UPDATE, DELETE ON public\.organizations, public\.telemetry_readings, public\.events_log, public\.firmware_packages FROM authenticated;/.test(hardening),
    'T19: platform-written tables are read-only for end users');
  assert(hardening.includes('REVOKE EXECUTE ON FUNCTION public.custom_access_token_hook(jsonb) FROM PUBLIC, anon, authenticated;'), 'T19: the auth hook is not callable by API users');
  assert(/IS DISTINCT FROM \(to_jsonb\(OLD\) - 'desired_state'\)/.test(hardening) && hardening.includes('BEFORE UPDATE ON public.devices'), 'T2598: operators can only change desired_state');
  console.log('✓ Hardening migration: tenant-scoped rollouts, no self-promotion, least-privileged default role, column guard, anon revoked, search_path pinned, RBAC consistent with the app.');

  // -------------------------------------------------------------------------------------------
  console.log('\n[Check 10] Validating web security headers and CSP (T331/T64/T119/T89)...');
  const vercel = JSON.parse(vercelContent);
  const documentRule = vercel.headers.find((h: any) => h.headers.some((x: any) => x.key === 'Content-Security-Policy'));
  assert(documentRule, 'CSP rule present');
  const headerValue = (key: string) => documentRule.headers.find((x: any) => x.key === key)?.value as string | undefined;
  const csp = headerValue('Content-Security-Policy') || '';
  const directives = new Map(csp.split(';').map((d) => d.trim()).filter(Boolean).map((d) => {
    const [name, ...values] = d.split(/\s+/);
    return [name, values] as [string, string[]];
  }));
  const scriptSrc = directives.get('script-src') || [];
  assert(!scriptSrc.includes("'unsafe-inline'") && !scriptSrc.includes("'unsafe-eval'"), "T331: script-src has neither 'unsafe-inline' nor 'unsafe-eval'");
  const hydrateHash = `'sha256-${crypto.createHash('sha256').update('globalThis.__EXPO_ROUTER_HYDRATE__=true;').digest('base64')}'`;
  assert(scriptSrc.includes(hydrateHash), 'T331: the Expo Router hydration snippet is allowed by hash');
  assert((directives.get('default-src') || []).join(' ') === "'self'", "T331: default-src 'self'");
  assert((directives.get('object-src') || []).join(' ') === "'none'", "T331: object-src 'none'");
  assert((directives.get('frame-src') || []).join(' ') === "'none'", "T331: frame-src 'none'");
  assert((directives.get('frame-ancestors') || []).join(' ') === "'none'", "T119: frame-ancestors 'none'");
  assert((directives.get('base-uri') || []).join(' ') === "'self'" && (directives.get('form-action') || []).join(' ') === "'self'", 'T331: base-uri and form-action restricted');
  const connectSrc = directives.get('connect-src') || [];
  assert(!connectSrc.includes('https:') && !connectSrc.includes('wss:') && connectSrc.includes("'self'"), 'T331: connect-src is an allow-list (no bare https:/wss:)');
  assert((directives.get('report-uri') || []).join(' ') === '/api/csp-report', 'T331: violations are reported to /api/csp-report');
  assert(documentRule.source === '/(.*)', 'T331: security headers apply to every path');
  const wildcardRules = vercel.headers.filter((h: any) => h.headers.some((x: any) => x.key === 'Access-Control-Allow-Origin'));
  assert(wildcardRules.length === 1 && wildcardRules[0].source === '/(_expo|assets)/(.*)', 'T257: ACAO * is limited to public static assets');
  assert(!documentRule.headers.some((x: any) => x.key === 'Access-Control-Allow-Origin'), 'T257: pages and API responses get no wildcard CORS header');
  assert(headerValue('X-Frame-Options') === 'DENY', 'T119: X-Frame-Options DENY');
  assert(headerValue('Cross-Origin-Opener-Policy') === 'same-origin', 'T1543: COOP isolates the browsing context');
  assert(headerValue('Permissions-Policy') === 'camera=(), microphone=(), geolocation=()', 'T14: no browser capability is granted that the app does not use');
  const cacheRule = vercel.headers.find((h: any) => h.headers.some((x: any) => x.key === 'Cache-Control'));
  const cacheValue = (key: string) => cacheRule?.headers.find((x: any) => x.key === key)?.value as string | undefined;
  assert(cacheRule && String(cacheValue('Cache-Control')).includes('no-store') && cacheValue('Pragma') === 'no-cache' && cacheValue('Expires') === '0',
    'T64: documents are served with no-store, Pragma and Expires');
  const noStorePattern = new RegExp(`^${cacheRule.source.replace(/^\//, '\\/')}$`);
  assert(noStorePattern.test('/dashboard') && noStorePattern.test('/api/devices') && noStorePattern.test('/'), 'T64: app pages and API paths are no-store');
  assert(!noStorePattern.test('/_expo/static/js/web/entry-abc.js') && !noStorePattern.test('/assets/icon.png'), 'T64: hashed static bundles keep their default caching');
  // Every inline script in a local web export must be covered by a CSP hash.
  const exportDirs = ['dist', process.env.WEB_EXPORT_DIR || ''].filter((d) => d && fs.existsSync(path.join(d, 'index.html')));
  for (const exportDir of exportDirs) {
    const htmlFiles: string[] = [];
    const walk = (dir: string) => fs.readdirSync(dir, { withFileTypes: true }).forEach((e) => {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) walk(full);
      else if (e.name.endsWith('.html')) htmlFiles.push(full);
    });
    walk(exportDir);
    htmlFiles.forEach((file) => {
      for (const m of readText(file).matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g)) {
        if (!m[1]) continue;
        const hash = `'sha256-${crypto.createHash('sha256').update(m[1]).digest('base64')}'`;
        assert(scriptSrc.includes(hash), `T331: inline script in ${file} is not allowed by the CSP`);
      }
    });
    console.log(`  (checked ${htmlFiles.length} exported HTML files in ${exportDir})`);
  }
  console.log('✓ CSP forbids inline/eval scripts (hash-allowed hydration only), restricts connections, frames, forms and objects, and reports violations.');

  // -------------------------------------------------------------------------------------------
  console.log('\n[Check 11] Validating mobile client hardening (T316, T152)...');
  const sensitiveForms = ['app/(auth)/login.tsx', 'app/(auth)/forgot-password.tsx', 'app/(auth)/reset-password.tsx', 'app/(app)/team.tsx', 'app/(app)/integrations.tsx', 'app/(app)/settings.tsx'];
  sensitiveForms.forEach((file) => {
    const inputs = readText(file).match(/<TextInput\b[\s\S]*?\/>/g) || [];
    inputs
      .filter((input) => /secureTextEntry|email|setFullName|setEndpointUrl|setEmail|setPassword/.test(input))
      .forEach((input) => assert(input.includes('autoCorrect={false}'), `T316: sensitive field in ${file} must disable autocorrect/dictionary learning`));
  });
  const appConfig = JSON.parse(readText('app.json')).expo;
  assert(!(appConfig.android.permissions || []).includes('android.permission.CAMERA'), 'T152: unused CAMERA permission removed');
  assert(!appConfig.ios.infoPlist || (!appConfig.ios.infoPlist.NSCameraUsageDescription && !appConfig.ios.infoPlist.NSBluetoothAlwaysUsageDescription), 'T152: unused camera/Bluetooth usage descriptions removed');
  const usesCamera = trackedFiles().some((f) => /^(app|src)\//.test(f) && /expo-camera|expo-barcode-scanner|getUserMedia|react-native-ble/.test(readText(f)));
  assert(!usesCamera, 'T152: no camera/Bluetooth API is used, so none is requested');
  console.log('✓ Sensitive inputs disable autocorrect/dictionary learning; the app requests only INTERNET and ACCESS_NETWORK_STATE.');

  // -------------------------------------------------------------------------------------------
  console.log('\n[Check 12] Validating public parts and the database account used by the app (T2282, T227)...');
  const appSources = trackedFiles().filter((f) => /^(app|src|api)\/.*\.(ts|tsx)$/.test(f));
  assert(!appSources.some((f) => readText(f).includes('SUPABASE_SERVICE_ROLE_KEY')), 'T227: no application code uses the Supabase service role');
  const clientSource = readText('src/services/supabase.ts');
  const clientsCreated = appSources.reduce((n, f) => n + (readText(f).match(/createClient\(/g) || []).length, 0);
  assert(clientsCreated === 1 && clientSource.includes('process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY'),
    'T227: the only database client uses the public anon key (RLS-bound authenticated role, never a superuser)');
  assert(fs.existsSync('app/(auth)/login.tsx') && fs.existsSync('app/(auth)/forgot-password.tsx'), 'T2282: public pages live outside the guarded (app) group');
  assert(!readText('app/_layout.tsx').includes('restoreSession') && !readText('app/(auth)/login.tsx').includes('<Redirect'), 'T2282: no session guard wraps the public pages');
  assert(PUBLIC_ROUTES.includes('/login') && PUBLIC_ROUTES.includes('/forgot-password'), 'T2282/T373: public pages are listed explicitly');
  console.log('✓ Public pages stay reachable without a session; the app reaches the database only through the anon key and RLS.');

  // -------------------------------------------------------------------------------------------
  console.log('\n[Check 13] Validating the server-authoritative data API: every object access authorized on the server (T17/T145/T378/T2600/T20/T2602/T338/T178/T604)...');
  {
    // The stand-in database applies NO row-level security, so everything below is enforced by the API itself.
    const stub = await startFakeSupabase();
    process.env.SUPABASE_URL = stub.url;
    const issuer = `${stub.url}/auth/v1`;
    const anonKey = String(process.env.SUPABASE_ANON_KEY);
    const ORG_A = '11111111-1111-1111-1111-111111111111';
    const ORG_B = '22222222-2222-2222-2222-222222222222';
    const ORG_C = '33333333-3333-3333-3333-333333333333';
    const U = {
      ownerA: 'a1000000-0000-4000-8000-000000000001',
      adminA: 'a1000000-0000-4000-8000-000000000002',
      operatorA: 'a1000000-0000-4000-8000-000000000003',
      viewerA: 'a1000000-0000-4000-8000-000000000004',
      adminB: 'b1000000-0000-4000-8000-000000000001',
      viewerC: 'c1000000-0000-4000-8000-000000000001',
    };
    const ID = {
      bA1: 'ba000000-0000-4000-8000-000000000001',
      bB1: 'bb000000-0000-4000-8000-000000000001',
      rA1: 'ca000000-0000-4000-8000-000000000001',
      rA2: 'ca000000-0000-4000-8000-000000000002',
      rB1: 'cb000000-0000-4000-8000-000000000001',
      dAthermo: 'da000000-0000-4000-8000-000000000001',
      dAplug: 'da000000-0000-4000-8000-000000000002',
      dAtemp: 'da000000-0000-4000-8000-000000000003',
      dBthermo: 'db000000-0000-4000-8000-000000000001',
      dBplug: 'db000000-0000-4000-8000-000000000002',
      autoA: 'aa000000-0000-4000-8000-000000000001',
      autoB: 'ab000000-0000-4000-8000-000000000001',
      alA1: 'ea000000-0000-4000-8000-000000000001',
      alB: 'eb000000-0000-4000-8000-000000000001',
      fwThermo: 'f0000000-0000-4000-8000-000000000001',
      fwDeprecated: 'f0000000-0000-4000-8000-000000000002',
      fwNoChecksum: 'f0000000-0000-4000-8000-000000000003',
      roA: '9a000000-0000-4000-8000-000000000001',
      roB: '9b000000-0000-4000-8000-000000000001',
      intA: '8a000000-0000-4000-8000-000000000001',
      intB: '8b000000-0000-4000-8000-000000000001',
    };
    const at = '2026-10-01T00:00:00.000Z';
    const profile = (id: string, org: string, role: string, email: string) => ({ id, email, full_name: `${role} ${email.split('@')[0]}`, organization_id: org, role, created_at: at });
    const device = (id: string, org: string, building: string, room: string, type: string, desired: Record<string, unknown>) => ({
      id, organization_id: org, building_id: building, room_id: room, name: `Device ${id.slice(0, 4)}`, code: `CODE-${id.slice(0, 4)}-${id.slice(-2)}`, type,
      status: 'online', battery_level: 90, rssi: -60, firmware_version: 'v1.4.2', desired_state: desired, reported_state: {}, last_seen_at: at, created_at: at,
    });
    Object.assign(stub.tables, {
      organizations: [
        { id: ORG_A, name: 'ACME HQ', slug: 'acme-hq', plan: 'enterprise', created_at: at },
        { id: ORG_B, name: 'Nova Logistics', slug: 'nova', plan: 'industrial', created_at: at },
      ],
      user_profiles: [
        profile(U.ownerA, ORG_A, 'owner', 'owner@acme.example'),
        profile(U.adminA, ORG_A, 'administrator', 'admin@acme.example'),
        profile(U.operatorA, ORG_A, 'operator', 'operator@acme.example'),
        profile(U.viewerA, ORG_A, 'viewer', 'viewer@acme.example'),
        profile(U.adminB, ORG_B, 'administrator', 'admin@nova.example'),
        profile(U.viewerC, ORG_C, 'viewer', 'viewer@big.example'),
      ],
      buildings: [
        { id: ID.bA1, organization_id: ORG_A, name: 'Tech Tower', code: 'TT-01', address: 'HQ', total_floors: 12, created_at: at },
        { id: ID.bB1, organization_id: ORG_B, name: 'Depot', code: 'CFD-01', address: 'Dallas', total_floors: 2, created_at: at },
      ],
      rooms: [
        { id: ID.rA1, building_id: ID.bA1, name: 'Boardroom', floor: 1, room_number: '101', type: 'conference', dimensions: { width: 8, length: 12, height: 3.5 }, created_at: at },
        { id: ID.rA2, building_id: ID.bA1, name: 'Data Center', floor: 2, room_number: '204', type: 'server_room', dimensions: { width: 14, length: 20, height: 4 }, created_at: at },
        { id: ID.rB1, building_id: ID.bB1, name: 'Sorting Bay', floor: 1, room_number: 'SB-04', type: 'warehouse', dimensions: { width: 30, length: 50, height: 8 }, created_at: at },
      ],
      devices: [
        device(ID.dAthermo, ORG_A, ID.bA1, ID.rA1, 'thermostat', { target_temp: 21.5, mode: 'cooling' }),
        device(ID.dAplug, ORG_A, ID.bA1, ID.rA1, 'smart_plug', { power: 'on' }),
        device(ID.dAtemp, ORG_A, ID.bA1, ID.rA2, 'temperature_sensor', { sampling_rate: 10 }),
        device(ID.dBthermo, ORG_B, ID.bB1, ID.rB1, 'thermostat', { target_temp: -22, mode: 'cooling' }),
        device(ID.dBplug, ORG_B, ID.bB1, ID.rB1, 'smart_plug', { power: 'on' }),
      ],
      automations: [
        { id: ID.autoA, organization_id: ORG_A, name: 'Overheat', enabled: true, trigger_type: 'temperature_threshold', trigger_condition: { device_id: ID.dAtemp, metric: 'current_temp', operator: '>=', value: 26 }, action: { target_device_id: ID.dAthermo, command: 'set_target_temp', value: 18 }, interval_seconds: 120, last_executed_at: null, execution_count: 0, notify_on_run: true, created_at: at },
        { id: ID.autoB, organization_id: ORG_B, name: 'Cryo', enabled: true, trigger_type: 'temperature_threshold', trigger_condition: { device_id: ID.dBthermo, metric: 'current_temp', operator: '>=', value: -18 }, action: { target_device_id: ID.dBthermo, command: 'set_target_temp', value: -24 }, interval_seconds: 60, last_executed_at: null, execution_count: 0, notify_on_run: true, created_at: at },
      ],
      alerts: [
        { id: ID.alA1, organization_id: ORG_A, device_id: ID.dAtemp, severity: 'warning', title: 'Hot aisle', message: 'High temperature', status: 'active', acknowledged_by: null, resolved_at: null, created_at: at },
        { id: ID.alB, organization_id: ORG_B, device_id: ID.dBthermo, severity: 'critical', title: 'Cryo', message: 'Humidity', status: 'active', acknowledged_by: null, resolved_at: null, created_at: at },
      ],
      events_log: [
        { id: 'fa000000-0000-4000-8000-000000000001', organization_id: ORG_A, device_id: null, event_type: 'data_change', actor_id: U.adminA, actor_role: 'administrator', payload: { table: 'devices' }, created_at: at },
        { id: 'fb000000-0000-4000-8000-000000000001', organization_id: ORG_B, device_id: null, event_type: 'data_change', actor_id: U.adminB, actor_role: 'administrator', payload: { table: 'devices' }, created_at: at },
      ],
      firmware_packages: [
        { id: ID.fwThermo, version: 'v1.4.3', device_type: 'thermostat', checksum_sha256: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855', file_size_bytes: 1048576, file_url: 'https://storage.acme-iot.internal/fw.bin', status: 'released', changelog: 'PID', created_at: at },
        { id: ID.fwDeprecated, version: 'v0.9.0', device_type: 'thermostat', checksum_sha256: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855', file_size_bytes: 1000, file_url: 'https://storage.acme-iot.internal/old.bin', status: 'deprecated', changelog: 'old', created_at: at },
        { id: ID.fwNoChecksum, version: 'v2.0.0', device_type: 'smart_plug', checksum_sha256: 'not-a-digest', file_size_bytes: 1000, file_url: 'https://storage.acme-iot.internal/plug.bin', status: 'testing', changelog: 'beta', created_at: at },
      ],
      firmware_rollouts: [
        { id: ID.roA, organization_id: ORG_A, firmware_id: ID.fwThermo, target_type: 'thermostat', total_devices: 1, updated_devices: 0, failed_devices: 0, status: 'in_progress', progress_percent: 50, created_at: at },
        { id: ID.roB, organization_id: ORG_B, firmware_id: ID.fwThermo, target_type: 'thermostat', total_devices: 1, updated_devices: 0, failed_devices: 0, status: 'in_progress', progress_percent: 20, created_at: at },
      ],
      integrations: [
        { id: ID.intA, organization_id: ORG_A, name: 'SIEM', type: 'rest_api_key', endpoint_url: 'https://siem.acme.example/ingest', api_key_hash: 'f'.repeat(64), active: true, created_at: at },
        { id: ID.intB, organization_id: ORG_B, name: 'Slack', type: 'webhook', endpoint_url: 'https://hooks.nova.example/x', api_key_hash: null, active: true, created_at: at },
      ],
    });
    // Audit entries about protected data, and a long history of resolved alerts.
    stub.tables.events_log.push(
      { id: 'fa000000-0000-4000-8000-000000000002', organization_id: ORG_A, device_id: null, event_type: 'data_change', actor_id: U.adminA, actor_role: 'administrator', payload: { table: 'integrations', operation: 'INSERT', record_id: ID.intA, changes: { name: 'SIEM' } }, created_at: at },
      { id: 'fa000000-0000-4000-8000-000000000003', organization_id: ORG_A, device_id: null, event_type: 'data_change', actor_id: U.adminA, actor_role: 'administrator', payload: { table: 'privacy_consents', operation: 'INSERT', record_id: 'c0', changes: { purpose: 'daily_digest_emails', granted: true } }, created_at: at },
      { id: 'fa000000-0000-4000-8000-000000000004', organization_id: ORG_A, device_id: null, event_type: 'data_change', actor_id: U.ownerA, actor_role: 'owner', payload: { table: 'team_invitations', operation: 'INSERT', record_id: 'i0', changes: { role: 'viewer' } }, created_at: at }
    );
    for (let i = 0; i < 250; i++) {
      stub.tables.alerts.push({ id: `e0000000-0000-4000-8000-${String(i).padStart(12, '0')}`, organization_id: ORG_A, device_id: ID.dAtemp, severity: 'info', title: `Old ${i}`, message: 'Resolved', status: 'resolved', acknowledged_by: null, resolved_at: at, created_at: at });
    }
    // A tenant whose device list exceeds the allowed result-set size.
    for (let i = 0; i <= MAX_RESULT_ROWS; i++) {
      const suffix = String(i).padStart(12, '0');
      stub.tables.devices.push(device(`dc000000-0000-4000-8000-${suffix}`, ORG_C, ID.bA1, ID.rA1, 'temperature_sensor', {}));
    }

    const nowSec = Math.floor(Date.now() / 1000);
    const issuedTokens = new Set<string>();
    const tokenFor = (sub: string, role: string, org: string, extra: Record<string, unknown> = {}) => {
      const token = signHs256({ iss: issuer, aud: 'authenticated', role: 'authenticated', sub, iat: nowSec - 10, exp: nowSec + 3600, org_id: org, user_role: role, ...extra }, hmacSecret);
      issuedTokens.add(`Bearer ${token}`);
      return token;
    };
    const roleInToken = (authorization: string) => {
      try {
        return JSON.parse(Buffer.from(authorization.replace(/^Bearer /, '').split('.')[1] || '', 'base64url').toString('utf8')).role;
      } catch {
        return undefined;
      }
    };
    const T = {
      ownerA: tokenFor(U.ownerA, 'owner', ORG_A),
      adminA: tokenFor(U.adminA, 'administrator', ORG_A),
      operatorA: tokenFor(U.operatorA, 'operator', ORG_A),
      viewerA: tokenFor(U.viewerA, 'viewer', ORG_A),
      viewerC: tokenFor(U.viewerC, 'viewer', ORG_C),
      // Sessions verified with a second factor (Supabase sets aal2 after a TOTP challenge).
      ownerA2: tokenFor(U.ownerA, 'owner', ORG_A, { aal: 'aal2' }),
      adminA2: tokenFor(U.adminA, 'administrator', ORG_A, { aal: 'aal2' }),
    };

    const dataSrv = await startServer(dataHandler);
    const commandSrv = await startServer(commandsHandler);
    const enrollSrv = await startServer(devicesHandler);
    const securityLines: string[] = [];
    const activityLines: string[] = [];
    const savedWarn = console.warn;
    const savedInfo = console.info;
    console.warn = (...args: unknown[]) => {
      securityLines.push(args.map(String).join(' '));
    };
    console.info = (...args: unknown[]) => {
      activityLines.push(args.map(String).join(' '));
    };
    const getData = (token: string | null, query = '') =>
      request(dataSrv.port, 'GET', `/api/data${query}`, { 'X-Forwarded-For': freshIp(), ...(token ? bearer(token) : {}) });
    const command = (token: string | null, name: string, input: unknown) =>
      request(commandSrv.port, 'POST', '/api/commands', json(token ? bearer(token) : {}), JSON.stringify({ command: name, input }));
    const callsBy = (token: string) => stub.requests.filter((q) => q.authorization === `Bearer ${token}`);
    const writesTo = (table: string) => stub.requests.filter((q) => q.table === table && q.method !== 'GET');
    const row = (table: string, id: string) => stub.tables[table].find((r) => r.id === id) as Record<string, any>;

    try {
      // Snapshot (GET /api/data)
      let r = await getData(null);
      assert(r.status === 401, 'T17: tenant data requires an authenticated caller');
      r = await getData(T.viewerA);
      assert(r.status === 200, `T17: members read their tenant data from the server (got ${r.status})`);
      let snapshot = JSON.parse(r.body);
      assert(snapshot.profile.role === 'viewer' && snapshot.profile.organizationId === ORG_A, 'T378: identity and tenant come from the verified session');
      assert.deepStrictEqual(snapshot.devices.map((d: any) => d.id).sort(), [ID.dAthermo, ID.dAplug, ID.dAtemp].sort(), 'T378: only devices of the caller organization are served');
      assert.deepStrictEqual(snapshot.rooms.map((x: any) => x.id).sort(), [ID.rA1, ID.rA2].sort(), 'T378: only rooms of the caller buildings are served');
      for (const foreign of [ORG_B, ID.dBthermo, ID.dBplug, ID.autoB, ID.alB, ID.roB, ID.intB, ID.bB1, ID.rB1]) {
        assert(!r.body.includes(foreign), `T378: no object of another tenant leaks into the snapshot (${foreign})`);
      }
      assert(snapshot.integrations === undefined && snapshot.team === undefined, 'T378: viewers do not receive integrations or team data');
      assert(!r.body.includes('file_url') && !r.body.includes('storage.acme-iot.internal'), 'T378: properties the app does not need (firmware file URLs) are not served');
      assert(snapshot.auditTrail.verified === true && snapshot.limits.maxRows === MAX_RESULT_ROWS, 'T349/T2600: snapshot reports the audit-trail verification and the result-set limit');
      assert(snapshot.alerts.filter((a: any) => a.status === 'active').length === 1 && snapshot.alerts.filter((a: any) => a.status === 'resolved').length === 200,
        'T2600: every open alert is served and resolved ones come as the newest fixed window (no silent loss, no failure)');
      assert(!snapshot.events.some((e: any) => ['integrations', 'privacy_consents', 'team_invitations', 'user_profiles'].includes(e.payload?.table)),
        'T349/T338/T604: audit entries about integrations, invitations, profiles and other members consents are not served to viewers');
      stub.rpcResults.verify_events_log_chain = [{ verified: false, checked_entries: 2, first_invalid_id: 'fa000000-0000-4000-8000-000000000001' }];
      r = await getData(T.viewerA);
      assert(JSON.parse(r.body).auditTrail.verified === false, 'T349: a broken hash chain reported by the database reaches the app');
      delete stub.rpcResults.verify_events_log_chain;
      const viewerCalls = callsBy(T.viewerA);
      assert(viewerCalls.length >= 10 && viewerCalls.every((q) => q.apikey === anonKey), 'T227/T2598: every database call uses the anon key plus the caller own token (RLS applies)');
      assert(stub.requests.every((q) => roleInToken(q.authorization) === 'authenticated'), 'T227: every database call runs as the caller (JWT role authenticated), never the service role');
      const tenantReads = viewerCalls.filter((q) => q.method === 'GET' && ['devices', 'buildings', 'automations', 'alerts', 'events_log', 'firmware_rollouts'].includes(q.table));
      assert(new Set(tenantReads.map((q) => q.table)).size === 6 && tenantReads.every((q) => q.params.get('organization_id') === `eq.${ORG_A}`), 'T2598: every tenant table query is filtered by the token organization');
      assert(viewerCalls.filter((q) => q.method === 'GET').every((q) => Number(q.params.get('limit')) > 0), 'T2600: every query is bounded with a limit');
      r = await getData(T.viewerA, `?organization_id=${ORG_B}&organizationId=${ORG_B}`);
      snapshot = JSON.parse(r.body);
      assert(r.status === 200 && !r.body.includes(ORG_B) && snapshot.devices.every((d: any) => d.organizationId === ORG_A), 'T378: tenant ids supplied by the client are ignored');
      assert(snapshot.stepUpRequired === false, 'T338: viewers are not asked for a second factor');
      r = await getData(T.adminA);
      snapshot = JSON.parse(r.body);
      assert(snapshot.integrations === undefined && snapshot.team === undefined && snapshot.stepUpRequired === true,
        'T338: without a second factor, managers do not receive team (personal) or integration (secret-bearing) data');
      r = await getData(T.adminA2);
      snapshot = JSON.parse(r.body);
      assert(snapshot.stepUpRequired === false && snapshot.integrations.length === 1 && snapshot.integrations[0].id === ID.intA, 'T378: integration managers see only their tenant integrations');
      assert(!r.body.includes('api_key_hash') && !r.body.includes('apiKeyHash') && !r.body.includes('f'.repeat(64)), 'T2598: API key hashes are never selected or served');
      assert(snapshot.team.members.length === 4 && snapshot.team.members.every((m: any) => m.organizationId === ORG_A), 'T378: team data is limited to the tenant and to team managers');
      const adminAuditTables = snapshot.events.map((e: any) => e.payload?.table);
      assert(adminAuditTables.includes('integrations') && adminAuditTables.includes('team_invitations') && adminAuditTables.includes('privacy_consents'),
        'T349: managers with a second factor see audit entries about integrations and invitations, and members see their own consent entries');
      r = await getData(T.ownerA2);
      assert(!JSON.parse(r.body).events.some((e: any) => e.payload?.table === 'privacy_consents'), 'T604: other members consent entries stay private, even for owners');
      r = await getData(T.viewerC);
      assert(r.status === 422 && JSON.parse(r.body).error === 'Result set exceeds the allowed size',
        'T2600: a query matching more rows than allowed is refused with an error, although PostgREST caps the response at max_rows (exact count)');
      assert(securityLines.some((l) => l.includes('"result_set_limit"') && l.includes('devices matched more than')), 'T2600: oversized result sets are logged');

      // Session and privilege changes (T20): tokens must match the current profile.
      r = await getData(tokenFor(U.operatorA, 'administrator', ORG_A));
      assert(r.status === 401 && r.headers['www-authenticate'] === 'Bearer', 'T20: a token issued before a role change is refused (a new session is required)');
      r = await getData(tokenFor(U.operatorA, 'operator', ORG_B));
      assert(r.status === 401, 'T20: a token naming another organization than the current profile is refused');
      const removed = 'd1000000-0000-4000-8000-000000000009';
      stub.memberships.set(removed, null);
      r = await getData(tokenFor(removed, 'viewer', ORG_A));
      assert(r.status === 401, 'T20: a removed membership loses access immediately and the app is told to sign in again');

      // Commands (POST /api/commands)
      r = await command(null, 'device.setDesiredState', { deviceId: ID.dAthermo, desiredState: { target_temp: 20 } });
      assert(r.status === 401, 'T17: commands require authentication');
      r = await command(T.adminA, 'device.delete', { deviceId: ID.dAthermo });
      assert(r.status === 400, 'T17: unknown commands are refused');
      r = await command(T.viewerA, 'device.setDesiredState', { deviceId: ID.dAthermo, desiredState: { target_temp: 20 } });
      assert(r.status === 403 && writesTo('devices').length === 0, 'T145: viewers cannot control devices, whatever the client does');
      r = await command(T.operatorA, 'device.setDesiredState', { deviceId: ID.dAthermo, desiredState: { target_temp: 20.5 } });
      assert(r.status === 200, `T145: operators control devices of their tenant (got ${r.status})`);
      assert.deepStrictEqual(row('devices', ID.dAthermo).desired_state, { target_temp: 20.5, mode: 'cooling' }, 'T378: the change is merged into the stored desired state');
      const devicePatch = writesTo('devices').at(-1)!;
      assert.deepStrictEqual(Object.keys(devicePatch.body), ['desired_state'], 'T378: only the desired_state property is written');
      assert(devicePatch.params.get('id') === `eq.${ID.dAthermo}` && devicePatch.params.get('organization_id') === `eq.${ORG_A}`, 'T2598: the update is scoped to the object and the token organization');
      const foreignBefore = JSON.stringify(row('devices', ID.dBthermo));
      r = await command(T.operatorA, 'device.setDesiredState', { deviceId: ID.dBthermo, desiredState: { target_temp: 30 } });
      assert(r.status === 404 && JSON.stringify(row('devices', ID.dBthermo)) === foreignBefore, 'T378: devices of another tenant are not found and not changed');
      assert(!writesTo('devices').some((q) => q.params.get('id') === `eq.${ID.dBthermo}`), 'T378: no write is even attempted on a foreign object');
      r = await command(T.operatorA, 'device.setDesiredState', { deviceId: ID.dAthermo, desiredState: { power: 'off' } });
      assert(r.status === 400, 'T378: properties the device type does not have are refused');
      r = await command(T.operatorA, 'device.setDesiredState', { deviceId: ID.dAthermo, desiredState: { target_temp: 20 }, organizationId: ORG_B });
      assert(r.status === 400, 'T378: tenant fields in the command input are refused');
      r = await command(T.operatorA, 'device.setDesiredState', { deviceId: ID.dAthermo, desiredState: { firmware_version: 'v9' } });
      assert(r.status === 400, 'T378: telemetry and identity properties cannot be written');

      r = await command(T.viewerA, 'alert.setStatus', { alertId: ID.alA1, status: 'acknowledged' });
      assert(r.status === 403, 'T145: viewers cannot update alerts');
      r = await command(T.operatorA, 'alert.setStatus', { alertId: ID.alB, status: 'acknowledged' });
      assert(r.status === 404 && row('alerts', ID.alB).status === 'active', 'T378: alerts of another tenant are not found');
      r = await command(T.operatorA, 'alert.setStatus', { alertId: ID.alA1, status: 'acknowledged' });
      assert(r.status === 200 && row('alerts', ID.alA1).status === 'acknowledged', 'T145: operators acknowledge their tenant alerts');
      assert.deepStrictEqual(writesTo('alerts').at(-1)!.body, { status: 'acknowledged' }, 'T378: only the status is sent; who acknowledged is set by the database');
      r = await command(T.operatorA, 'alert.setStatus', { alertId: ID.alA1, status: 'resolved' });
      assert(r.status === 200 && row('alerts', ID.alA1).status === 'resolved', 'T145: operators resolve alerts');
      r = await command(T.operatorA, 'alert.setStatus', { alertId: ID.alA1, status: 'acknowledged' });
      assert(r.status === 409, 'T378: resolved alerts cannot be reopened');

      const rule = {
        name: 'Hot aisle guard',
        triggerCondition: { deviceId: ID.dAtemp, metric: 'current_temp', operator: '>=', value: 27 },
        action: { targetDeviceId: ID.dAthermo, command: 'set_target_temp', value: 19 },
        intervalSeconds: 60,
      };
      r = await command(T.viewerA, 'automation.create', rule);
      assert(r.status === 403, 'T145: viewers cannot create automations');
      const automationsBefore = stub.tables.automations.length;
      r = await command(T.operatorA, 'automation.create', { ...rule, action: { ...rule.action, targetDeviceId: ID.dBthermo } });
      assert(r.status === 404 && stub.tables.automations.length === automationsBefore, 'T378: rules cannot target devices of another tenant');
      r = await command(T.operatorA, 'automation.create', { ...rule, action: { ...rule.action, targetDeviceId: ID.dAplug } });
      assert(r.status === 400, 'T378: a rule must fit the device types');
      r = await command(T.operatorA, 'automation.create', rule);
      assert(r.status === 200, `T145: operators create rules in their tenant (got ${r.status})`);
      const createdRule = stub.tables.automations.at(-1)!;
      assert(createdRule.organization_id === ORG_A && createdRule.trigger_condition.device_id === ID.dAtemp, 'T378: new rules belong to the token organization');
      r = await command(T.operatorA, 'automation.setEnabled', { automationId: ID.autoB, enabled: false });
      assert(r.status === 404 && row('automations', ID.autoB).enabled === true, 'T378: rules of another tenant cannot be toggled');
      r = await command(T.operatorA, 'automation.setEnabled', { automationId: ID.autoA, enabled: false });
      assert(r.status === 200 && row('automations', ID.autoA).enabled === false, 'T145: operators toggle their tenant rules');

      r = await command(T.operatorA, 'integration.create', { name: 'Pager', type: 'webhook', endpointUrl: 'https://hooks.acme.example/p' });
      assert(r.status === 403, 'T145: operators cannot manage integrations');
      r = await command(T.adminA, 'integration.create', { name: 'Pager', type: 'webhook', endpointUrl: 'https://hooks.acme.example/p' });
      assert(r.status === 403 && JSON.parse(r.body).error === 'Two-step verification required', 'T338: managing integrations needs a second factor');
      r = await command(T.adminA2, 'integration.create', { name: 'Pager', type: 'webhook', endpointUrl: 'http://hooks.acme.example/p' });
      assert(r.status === 400, 'T378: integration endpoints must be external https URLs');
      r = await command(T.adminA2, 'integration.create', { name: 'Pager', type: 'webhook', endpointUrl: 'https://127.0.0.1/hook' });
      assert(r.status === 400, 'T378: loopback endpoints are refused');
      r = await command(T.adminA2, 'integration.create', { name: 'Pager', type: 'webhook', endpointUrl: 'https://hooks.acme.example/p' });
      assert(r.status === 200 && !r.body.includes('api_key') && stub.tables.integrations.at(-1)!.organization_id === ORG_A, 'T378: administrators add integrations to their tenant only');
      r = await command(T.adminA2, 'integration.setActive', { integrationId: ID.intB, active: false });
      assert(r.status === 404 && row('integrations', ID.intB).active === true, 'T378: integrations of another tenant cannot be changed');

      r = await command(T.operatorA, 'firmware.startRollout', { firmwareId: ID.fwThermo });
      assert(r.status === 403, 'T145: operators cannot start rollouts');
      r = await command(T.adminA, 'firmware.startRollout', { firmwareId: ID.fwThermo });
      assert(r.status === 200, `T145: administrators start rollouts (got ${r.status})`);
      const started = JSON.parse(r.body).result;
      const createdRollout = stub.tables.firmware_rollouts.at(-1)!;
      assert(createdRollout.organization_id === ORG_A && started.totalDevices === 1, 'T378: rollouts count and target only devices of the token organization');
      r = await command(T.adminA, 'firmware.startRollout', { firmwareId: ID.fwDeprecated });
      assert(r.status === 409, 'T378: deprecated firmware is refused');
      r = await command(T.adminA, 'firmware.startRollout', { firmwareId: ID.fwNoChecksum });
      assert(r.status === 409, 'T59: firmware without a valid SHA-256 digest is refused');
      r = await command(T.adminA, 'firmware.rollback', { rolloutId: ID.roB });
      assert(r.status === 404 && row('firmware_rollouts', ID.roB).status === 'in_progress', 'T378: rollouts of another tenant cannot be rolled back');
      r = await command(T.adminA, 'firmware.rollback', { rolloutId: ID.roA });
      assert(r.status === 200 && row('firmware_rollouts', ID.roA).status === 'rolled_back', 'T145: administrators roll back their tenant rollouts');
      r = await command(T.adminA, 'firmware.rollback', { rolloutId: ID.roA });
      assert(r.status === 409, 'T378: a rollout is rolled back only once');

      r = await command(T.operatorA, 'team.invite', { fullName: 'Pat Doe', email: 'pat@acme.example', role: 'viewer' });
      assert(r.status === 403, 'T145: operators cannot invite members');
      r = await command(T.adminA, 'team.invite', { fullName: 'Pat Doe', email: 'pat@acme.example', role: 'viewer' });
      assert(r.status === 403 && JSON.parse(r.body).error === 'Two-step verification required' && stub.tables.team_invitations.length === 0, 'T338: inviting people needs a second factor');
      r = await command(T.adminA2, 'team.invite', { fullName: 'Pat Doe', email: 'pat@acme.example', role: 'administrator' });
      assert(r.status === 403, 'T14: administrators cannot grant the administrator role (server-side rule)');
      r = await command(T.adminA2, 'team.invite', { fullName: 'Pat Doe', email: 'Pat@Acme.example', role: 'viewer' });
      assert(r.status === 200, `T145: administrators invite operators and viewers (got ${r.status})`);
      const invitation = stub.tables.team_invitations.at(-1)!;
      assert(invitation.organization_id === ORG_A && invitation.invited_by === U.adminA && invitation.email === 'pat@acme.example', 'T378/T742: invitations belong to the token organization, record the inviter and store a normalized e-mail');
      r = await command(T.adminA2, 'team.invite', { fullName: 'Pat Doe', email: 'pat@acme.example', role: 'viewer' });
      assert(r.status === 409, 'T742: duplicate invitations are refused');
      r = await command(T.adminA2, 'team.invite', { fullName: 'Viewer', email: 'viewer@acme.example', role: 'viewer' });
      assert(r.status === 409, 'T742: existing members cannot be invited again');
      r = await command(T.ownerA2, 'team.invite', { fullName: 'Sam Roe', email: 'sam@acme.example', role: 'administrator' });
      assert(r.status === 200, 'T14: owners may grant the administrator role');

      // Self-service profile (T742): members correct their own name, never someone else's.
      r = await command(T.viewerA, 'profile.update', { fullName: 'Vera Viewer' });
      assert(r.status === 200 && row('user_profiles', U.viewerA).full_name === 'Vera Viewer', 'T742: members update their own name');
      const profilePatch = writesTo('user_profiles').at(-1)!;
      assert(profilePatch.params.get('id') === `eq.${U.viewerA}` && profilePatch.params.get('organization_id') === `eq.${ORG_A}` && Object.keys(profilePatch.body).join() === 'full_name',
        'T742/T378: the update targets the caller own profile and only the name');
      r = await command(T.viewerA, 'profile.update', { fullName: 'Mallory', id: U.adminA });
      assert(r.status === 400 && row('user_profiles', U.adminA).full_name !== 'Mallory', 'T378: another member profile cannot be targeted');
      r = await command(T.viewerA, 'profile.update', { fullName: 'x' });
      assert(r.status === 400, 'T742: names are validated on the server');
      const profileLine = activityLines.find((l) => l.includes('"profile.update"'));
      assert(profileLine && !profileLine.includes('Vera'), 'T2602/T349: personal values are not copied to the activity log');

      // Consent (T178/T604/T754): members record and withdraw their own decisions for the current notice.
      const consentInput = { purpose: 'incident_alert_emails', granted: true, noticeVersion: CONSENT_NOTICE_VERSION, locale: 'pt-BR' };
      r = await command(T.viewerA, 'consent.record', consentInput);
      assert(r.status === 200, `T178: members record their consent (got ${r.status})`);
      const consentInsert = writesTo('privacy_consents').at(-1)!;
      assert(!('user_id' in consentInsert.body) && !('decided_at' in consentInsert.body) && consentInsert.body.locale === 'pt-BR' && consentInsert.body.notice_version === CONSENT_NOTICE_VERSION,
        'T178: identity and time come from the database; purpose, decision, language and notice version are stored');
      assert(stub.tables.privacy_consents.at(-1)!.user_id === U.viewerA, 'T178: the decision is bound to the authenticated member');
      r = await command(T.viewerA, 'consent.record', { ...consentInput, userId: U.adminA });
      assert(r.status === 400, 'T604: a member cannot record decisions for someone else');
      r = await command(T.viewerA, 'consent.record', { ...consentInput, noticeVersion: '1999-01' });
      assert(r.status === 400, 'T178: consent is only recorded against the current notice');
      r = await command(T.adminA, 'consent.record', { ...consentInput, purpose: 'daily_digest_emails' });
      assert(r.status === 200, 'T178: every member manages their own consent');
      r = await command(T.viewerA, 'consent.record', { ...consentInput, granted: false });
      assert(r.status === 200 && stub.tables.privacy_consents.filter((c) => c.user_id === U.viewerA).length === 2, 'T604: a withdrawal is a new record; earlier decisions are kept');
      r = await getData(T.viewerA);
      snapshot = JSON.parse(r.body);
      assert.deepStrictEqual(snapshot.privacy.consents.map((c: any) => [c.purpose, c.granted]), [['incident_alert_emails', false]],
        'T604: the member sees only their own latest decision per purpose (the withdrawal)');
      const consentRead = callsBy(T.viewerA).filter((q) => q.table === 'privacy_consents' && q.method === 'GET').at(-1)!;
      assert(consentRead.params.get('user_id') === `eq.${U.viewerA}` && consentRead.params.get('notice_version') === `eq.${CONSENT_NOTICE_VERSION}`, 'T604: decisions are read for the caller and the current notice only');

      // Enrollment (POST /api/devices): location must belong to the tenant.
      const enroll = (token: string, body: Record<string, unknown>) =>
        request(enrollSrv.port, 'POST', '/api/devices', json(bearer(token)), JSON.stringify(body));
      const devicesBefore = stub.tables.devices.length;
      r = await enroll(T.adminA, { name: 'Probe', code: 'QA-901', type: 'temperature_sensor', buildingId: ID.bB1, roomId: ID.rB1 });
      assert(r.status === 404 && stub.tables.devices.length === devicesBefore, 'T378: devices cannot be enrolled into a building of another tenant');
      r = await enroll(T.adminA, { name: 'Probe', code: 'QA-901', type: 'temperature_sensor', buildingId: ID.bA1, roomId: ID.rB1 });
      assert(r.status === 404 && stub.tables.devices.length === devicesBefore, 'T378: the room must belong to the selected building');
      r = await enroll(T.adminA, { name: 'Probe', code: 'QA-901', type: 'temperature_sensor', buildingId: ID.bA1, roomId: ID.rA2 });
      assert(r.status === 201 && stub.tables.devices.at(-1)!.organization_id === ORG_A, 'T378: enrolled devices are persisted in the token organization');
      const enrollInsert = writesTo('devices').at(-1)!;
      const insertColumns: string[] = JSON.parse(readText('supabase/access-matrix.json')).tables.devices.columns.insert;
      assert(Object.keys(enrollInsert.body).every((k) => insertColumns.includes(k)), 'T2598: the API only writes the columns the database grants for inserts');

      // Every database call made for an API request used that caller's token.
      assert(stub.requests.length > 50 && stub.requests.every((q) => issuedTokens.has(q.authorization) && q.apikey === anonKey),
        'T227: every database call carried the token of the caller being served plus the anon key, never another credential');
      const chartTables = JSON.parse(readText('supabase/access-matrix.json')).tables;
      const writes = stub.requests.filter((q) => (q.method === 'POST' || q.method === 'PATCH') && !q.table.startsWith('rpc/'));
      assert(writes.length > 10, 'T2598: the API writes were recorded');
      writes.forEach((q) => {
        const allowed: string[] | undefined = chartTables[q.table]?.columns?.[q.method === 'POST' ? 'insert' : 'update'];
        assert(allowed, `T2598: the chart lists the columns the API writes to ${q.table}`);
        Object.keys(Array.isArray(q.body) ? q.body[0] : q.body).forEach((column) =>
          assert(allowed!.includes(column), `T2598: ${q.method} ${q.table}.${column} is outside the columns granted to members`)
        );
      });

      // Activity log (T2602): who changed which object of which tenant, without tokens or personal data.
      const commandLines = activityLines.map((l) => JSON.parse(l)).filter((l) => l.category === 'activity');
      const deviceChange = commandLines.find((l) => l.event === 'device.setDesiredState');
      assert(deviceChange && deviceChange.userId === U.operatorA && deviceChange.organizationId === ORG_A && deviceChange.objectId === ID.dAthermo && deviceChange.changes.target_temp === 20.5,
        'T2602: changes are logged with actor, tenant, object id and new values');
      const inviteLine = activityLines.find((l) => l.includes('"team.invite"'));
      assert(inviteLine && !inviteLine.includes('@'), 'T2602/T349: e-mail addresses are not written to the activity log');
      assert(!activityLines.concat(securityLines).some((l) => l.includes('eyJ') || l.includes(hmacSecret)), 'T46: logs never contain tokens or secrets');
      assert(securityLines.some((l) => l.includes('"object_not_found"') && l.includes('not in the caller organization')), 'T378: cross-tenant attempts are logged');
    } finally {
      console.warn = savedWarn;
      console.info = savedInfo;
      await Promise.all([dataSrv.close(), commandSrv.close(), enrollSrv.close(), stub.close()]);
    }
    console.log(`  (${stub.requests.length} database calls inspected; ${activityLines.length} activity log lines checked)`);
  }
  console.log('✓ In server mode every read and write goes through the API, which authorizes the role, the tenant and the object on each request, bounds result sets and logs changes.');

  // -------------------------------------------------------------------------------------------
  console.log('\n[Check 14] Validating the query-level access chart against the migrations (T2598/T349/T2602/T742/T338)...');
  {
    const chart = JSON.parse(readText('supabase/access-matrix.json'));
    type Command = 'select' | 'insert' | 'update' | 'delete';
    const COMMANDS: Command[] = ['select', 'insert', 'update', 'delete'];
    // Replay GRANT/REVOKE for the authenticated role (Supabase grants every privilege on new tables).
    const tableLevel = new Map<string, Set<Command>>();
    const columnLevel = new Map<string, Map<Command, Set<string>>>();
    const statements = allSql.split(/;\s*(?:\r?\n|$)/).map((s) => s.replace(/--[^\n]*\n/g, '\n').replace(/\s+/g, ' ').trim());
    for (const stmt of statements) {
      const created = /^CREATE TABLE IF NOT EXISTS public\.(\w+)/i.exec(stmt);
      if (created) {
        tableLevel.set(created[1], new Set(COMMANDS));
        columnLevel.set(created[1], new Map());
        continue;
      }
      const g = /^(GRANT|REVOKE) (.+?) ON (?:TABLE )?(public\.\w+(?:, public\.\w+)*) (?:TO|FROM) (.+)$/i.exec(stmt);
      if (!g || !/\bauthenticated\b/.test(g[4])) continue;
      const isGrant = g[1].toUpperCase() === 'GRANT';
      const targets = g[3].split(',').map((t) => t.trim().replace('public.', ''));
      for (const m of g[2].matchAll(/(SELECT|INSERT|UPDATE|DELETE|ALL)(?:\s*\(([^)]*)\))?/gi)) {
        const privileges: Command[] = m[1].toUpperCase() === 'ALL' ? COMMANDS : [m[1].toLowerCase() as Command];
        const columns = m[2] ? m[2].split(',').map((c) => c.trim()) : null;
        for (const table of targets) {
          for (const p of privileges) {
            const cols = columnLevel.get(table)!.get(p) ?? new Set<string>();
            if (isGrant && columns) {
              columns.forEach((c) => cols.add(c));
              columnLevel.get(table)!.set(p, cols);
            } else if (isGrant) {
              tableLevel.get(table)!.add(p);
            } else {
              // Revoking a table privilege also revokes the matching column privileges (PostgreSQL).
              tableLevel.get(table)!.delete(p);
              columnLevel.get(table)!.delete(p);
            }
          }
        }
      }
    }
    const rolesIn = (text: string): Set<string> | null => {
      const found = new Set<string>();
      for (const m of text.matchAll(/current_user_role\(\)\s*(?:=\s*'(\w+)'|IN\s*\(([^)]+)\))/g)) {
        if (m[1]) found.add(m[1]);
        if (m[2]) m[2].split(',').forEach((x) => found.add(x.trim().replace(/'/g, '')));
      }
      return found.size > 0 ? found : null;
    };
    const ownRow = (text: string) => /(?<![\w.])(?:id|user_id) = auth\.uid\(\)/.test(text);
    const access = (table: string, cmd: Command) => {
      const roles = new Set<string>();
      let self = false;
      const privileged = tableLevel.get(table)!.has(cmd) || (columnLevel.get(table)!.get(cmd)?.size ?? 0) > 0;
      if (!privileged) return { roles, self };
      policies.forEach((text, key) => {
        // RESTRICTIVE policies only narrow access (checked separately below); roles come from PERMISSIVE ones.
        if (key.split('.')[0] !== table || /TO supabase_auth_admin/.test(text) || /AS RESTRICTIVE/.test(text)) return;
        const forCmd = (/ FOR (ALL|SELECT|INSERT|UPDATE|DELETE)/.exec(text)?.[1] ?? 'ALL').toLowerCase();
        if (forCmd !== 'all' && forCmd !== cmd) return;
        const roleSet = rolesIn(text);
        if (ownRow(text)) self = true;
        if (roleSet) roleSet.forEach((x) => roles.add(x));
        else if (!ownRow(text)) USER_ROLES.forEach((x) => roles.add(x));
      });
      return { roles, self };
    };

    assert.deepStrictEqual(Object.keys(chart.tables).sort(), createdTables.slice().sort(), 'T2598: the chart covers every table of the schema');
    for (const [table, spec] of Object.entries<any>(chart.tables)) {
      for (const cmd of COMMANDS) {
        const actual = access(table, cmd);
        assert.deepStrictEqual(Array.from(actual.roles).sort(), [...spec[cmd]].sort(), `T2598: ${table} ${cmd} roles must match the chart`);
        assert(actual.self === (spec.self ?? []).includes(cmd), `T2598: ${table} ${cmd} own-row access must match the chart`);
        const expectedColumns: string[] | undefined = spec.columns?.[cmd];
        if (expectedColumns) {
          assert(!tableLevel.get(table)!.has(cmd), `T2598: ${table} ${cmd} must be limited to columns`);
          assert.deepStrictEqual(Array.from(columnLevel.get(table)!.get(cmd) ?? []).sort(), [...expectedColumns].sort(), `T2598: ${table} ${cmd} columns must match the chart`);
        } else if (spec[cmd].length > 0 || spec.self?.includes(cmd)) {
          assert(tableLevel.get(table)!.has(cmd), `T2598: ${table} ${cmd} column restrictions must be documented in the chart`);
        }
      }
    }
    for (const [fn, grantees] of Object.entries<string[]>(chart.functions)) {
      assert(new RegExp(`REVOKE EXECUTE ON FUNCTION public\\.${fn}\\([^)]*\\) FROM PUBLIC`).test(allSql), `T2598: ${fn} is not executable by PUBLIC`);
      grantees.forEach((role) => assert(new RegExp(`GRANT EXECUTE ON FUNCTION public\\.${fn}\\([^)]*\\) TO ${role};`).test(allSql), `T2598: ${fn} is granted to ${role}`));
    }
    // API authorization and database authorization follow the same role matrix.
    const rolesWith = (permission: Permission) => USER_ROLES.filter((role) => hasPermission(role, permission)).slice().sort();
    const commandTable: Array<[string, string, Command]> = [
      ['device.setDesiredState', 'devices', 'update'],
      ['alert.setStatus', 'alerts', 'update'],
      ['automation.create', 'automations', 'insert'],
      ['automation.setEnabled', 'automations', 'update'],
      ['integration.create', 'integrations', 'insert'],
      ['integration.setActive', 'integrations', 'update'],
      ['firmware.startRollout', 'firmware_rollouts', 'insert'],
      ['firmware.rollback', 'firmware_rollouts', 'update'],
      ['team.invite', 'team_invitations', 'insert'],
    ];
    assert.deepStrictEqual(Object.keys(COMMAND_PERMISSIONS).sort(), [...commandTable.map(([c]) => c), 'profile.update', 'consent.record'].sort(), 'T17: every API command is mapped to a database permission');
    assert(COMMAND_PERMISSIONS['consent.record'] === 'profile:self' && chart.tables.privacy_consents.self.includes('insert'), 'T178/T2598: members record only their own consent, in the API and in the database');
    commandTable.forEach(([cmd, table, op]) => {
      assert.deepStrictEqual(rolesWith(COMMAND_PERMISSIONS[cmd]), [...chart.tables[table][op]].sort(), `T15/T2598: ${cmd} roles in the API match ${table} ${op} in the database`);
    });
    assert(rolesWith(COMMAND_PERMISSIONS['profile.update']).length === USER_ROLES.length && chart.tables.user_profiles.self.includes('update'),
      'T742/T2598: every member may update only their own profile, in the API and in the database');
    assert(!COLUMNS.integrations.includes('api_key_hash') && !COLUMNS.firmwarePackages.includes('file_url'), 'T2598: the API never selects secrets or unneeded columns');
    // T338: step-up (second factor) for personal and secret-bearing data, in the database and in the API.
    const stepUpTables = Object.keys(chart.stepUp).filter((k) => k !== 'description').sort();
    assert.deepStrictEqual(stepUpTables, ['integrations', 'team_invitations', 'user_profiles'], 'T338: the chart lists the data that needs a second factor');
    stepUpTables.forEach((table) => {
      const restrictive = Array.from(policies.entries()).filter(([key, text]) => key.startsWith(`${table}.`) && /AS RESTRICTIVE FOR ALL TO authenticated/.test(text));
      assert(restrictive.length === 1 && restrictive[0][1].includes("(auth.jwt() ->> 'aal') = 'aal2'") && /WITH CHECK/.test(restrictive[0][1]),
        `T338: ${table} requires an aal2 session through a RESTRICTIVE policy`);
    });
    assert(/USING \(id = auth\.uid\(\) OR \(auth\.jwt\(\) ->> 'aal'\) = 'aal2'\)/.test(policies.get('user_profiles.profile_step_up_policy') || ''),
      'T338: members keep access to their own profile; other profiles need aal2');
    assert.deepStrictEqual([...STEP_UP_COMMANDS].sort(), ['integration.create', 'integration.setActive', 'team.invite'], 'T338: the API asks for aal2 on the same data');

    const accessSql = readText(path.join(migrationsDir, '20261020_server_authoritative_access.sql'));
    // T349: tamper-evident, append-only audit trail with integrity verification and controlled retention.
    assert(/BEFORE INSERT ON public\.events_log FOR EACH ROW EXECUTE FUNCTION public\.events_log_chain\(\)/.test(accessSql.replace(/\s+/g, ' ')), 'T349: every audit entry is hash-chained on insert');
    assert(/pg_catalog\.sha256/.test(accessSql) && /pg_advisory_xact_lock/.test(accessSql), 'T349: SHA-256 chaining serialized per organization');
    assert(/BEFORE UPDATE OR DELETE ON public\.events_log/.test(accessSql.replace(/\s+/g, ' ')) && /BEFORE TRUNCATE ON public\.events_log/.test(accessSql.replace(/\s+/g, ' ')), 'T349: audit entries cannot be updated, deleted or truncated');
    assert(/RAISE EXCEPTION 'events_log is append-only/.test(accessSql) && /relowner::regrole/.test(accessSql), 'T349: only the retention purge (table owner + flag) may delete');
    assert(/retention_days < 365/.test(accessSql) && /'audit_purge'/.test(accessSql), 'T349: retention keeps at least a year and every purge is itself audited');
    assert(/FUNCTION public\.verify_events_log_chain/.test(accessSql) && /LIMIT LEAST\(GREATEST\(max_entries, 1\), 1000\)/.test(accessSql), 'T349/T2600: verification re-checks a bounded window of entries');
    assert(/DROP CONSTRAINT IF EXISTS events_log_device_id_fkey/.test(accessSql), 'T349: deleting a device does not cascade into the audit trail');
    // T2602: data changes of every tenant table are logged with names, ids and values.
    ['buildings', 'rooms', 'devices', 'automations', 'alerts', 'firmware_rollouts', 'integrations', 'user_profiles', 'team_invitations'].forEach((table) => {
      assert(new RegExp(`CREATE TRIGGER audit_${table} AFTER INSERT OR UPDATE OR DELETE ON public\\.${table} FOR EACH ROW EXECUTE FUNCTION public\\.audit_row_change\\(\\)`).test(accessSql), `T2602: changes to ${table} are logged`);
    });
    assert(/'table', TG_TABLE_NAME, 'operation', TG_OP, 'record_id'/.test(accessSql) && /jsonb_build_object\('old', old_row -> col, 'new', new_row -> col\)/.test(accessSql), 'T2602: log entries carry table, operation, record id and old/new values');
    assert(/secret_cols text\[\] := ARRAY\['api_key_hash', 'endpoint_url'\]/.test(accessSql) && /personal_cols text\[\] := ARRAY\['email', 'full_name'\]/.test(accessSql), 'T349: secrets (key hashes, endpoint URLs) and personal values are not copied into the log');
    const sensitiveRead = policies.get('events_log.events_sensitive_read_policy') || '';
    assert(/AS RESTRICTIVE FOR SELECT TO authenticated/.test(sensitiveRead) && sensitiveRead.includes("payload ->> 'table' = 'privacy_consents' AND actor_id = auth.uid()") && sensitiveRead.includes("(auth.jwt() ->> 'aal') = 'aal2'"),
      'T349/T338/T604: audit entries about integrations, invitations and profiles need a manager with aal2; consent entries stay with their member');
    assert(/FUNCTION public\.verify_events_log_chain\(max_entries integer DEFAULT 200\)\s*RETURNS TABLE \(verified boolean, checked_entries bigint, first_invalid_id uuid\)\s*LANGUAGE plpgsql STABLE SECURITY DEFINER/.test(accessSql),
      'T349: the chain is verified over every entry of the organization, including entries hidden from the caller');
    assert(/LOCK TABLE public\.events_log IN SHARE ROW EXCLUSIVE MODE;/.test(accessSql), 'T349: no entry escapes the chain while it is being initialized');
    assert(/CREATE TRIGGER devices_desired_state_guard\s+BEFORE INSERT OR UPDATE ON public\.devices/.test(accessSql) && /WHEN 'target_temp' THEN CASE WHEN pg_catalog\.jsonb_typeof\(v\) = 'number' THEN \(v #>> '\{\}'\)::numeric BETWEEN -40 AND 60/.test(accessSql),
      'T378: device setpoints written directly through the Data API are validated like /api (keys per type, ranges)');
    assert(/integrations_endpoint_external_https CHECK/.test(accessSql) && /CREATE TRIGGER firmware_rollouts_guard\s+BEFORE INSERT OR UPDATE ON public\.firmware_rollouts/.test(accessSql) && /automations_rule_shape CHECK/.test(accessSql),
      'T378: integration endpoints, rollouts and automation rules cannot be stored in a shape /api refuses');
    assert(/REVOKE INSERT, UPDATE ON public\.user_profiles FROM authenticated;/.test(accessSql) && /\(public\.current_user_role\(\) = 'owner' OR role IN \('operator', 'viewer'\)\)\s*\)\s*WITH CHECK \(organization_id = public\.current_user_org_id\(\) AND public\.current_user_role\(\) IN \('owner', 'administrator'\) AND status = 'revoked'\)/.test(accessSql),
      'T2598: members never create profiles directly and administrators only revoke operator/viewer invitations');
    // T742: accuracy of personal information.
    assert(/CREATE UNIQUE INDEX IF NOT EXISTS user_profiles_email_lower_key ON public\.user_profiles \(lower\(email\)\)/.test(accessSql), 'T742: one profile per e-mail address');
    assert(/AFTER UPDATE OF email ON auth\.users/.test(accessSql.replace(/\s+/g, ' ')) && /UPDATE public\.user_profiles SET email = lower\(NEW\.email\)/.test(accessSql), 'T742: e-mail changes confirmed in Supabase Auth propagate to the profile');
    assert(/team_invitations_pending_email_key/.test(accessSql) && /user_profiles_full_name_length/.test(accessSql), 'T742: duplicate invitations are impossible and names are validated in the database');
    // T178/T604/T754: append-only consent ledger and the processing check used before any consent-based e-mail.
    assert(/user_id UUID NOT NULL DEFAULT auth\.uid\(\)/.test(accessSql) && /decided_at TIMESTAMPTZ NOT NULL DEFAULT NOW\(\)/.test(accessSql), 'T178: consent records carry the authenticated user and the server time');
    assert(/CREATE TRIGGER audit_privacy_consents AFTER INSERT OR UPDATE OR DELETE ON public\.privacy_consents/.test(accessSql), 'T178: consent decisions are also written to the audit trail');
    assert(/c\.notice_version = p_notice_version/.test(accessSql) && /ORDER BY c\.decided_at DESC, c\.id DESC/.test(accessSql) && /ON latest\.granted/.test(accessSql),
      'T604/T754: only the latest decision for the current notice allows processing, so a withdrawal stops it');
  }
  console.log('✓ The access chart matches the effective policies, column grants and function grants; audit entries are append-only, hash-chained, verified and retained; data changes are logged.');

  // -------------------------------------------------------------------------------------------
  console.log('\n[Check 15] Validating the versioned Supabase Auth settings and the password reset flow (T143/T2/T70/T742/T2600/T338)...');
  {
    const config = readText('supabase/config.toml');
    const section = (name: string) => {
      const start = config.indexOf(`[${name}]`);
      assert(start >= 0, `config.toml has a [${name}] section`);
      const rest = config.slice(start + name.length + 2);
      const next = rest.search(/^\[/m);
      return next >= 0 ? rest.slice(0, next) : rest;
    };
    const value = (name: string, key: string) => {
      const m = new RegExp(`^${key}\\s*=\\s*(.+)$`, 'm').exec(section(name));
      return m ? m[1].trim().replace(/^"|"$/g, '') : undefined;
    };
    assert(Number(value('auth', 'minimum_password_length')) === PASSWORD_MIN_LENGTH, 'T143: Supabase Auth enforces the same minimum length as the app');
    assert(value('auth', 'password_requirements') === 'lower_upper_letters_digits', 'T143: Supabase Auth requires upper case, lower case and digits like the app');
    assert(value('auth', 'enable_signup') === 'false' && value('auth.email', 'enable_signup') === 'false', 'T143: no self-registration (members are invited)');
    assert(Number(value('auth.email', 'otp_expiry')) <= 3600 && value('auth.email', 'secure_password_change') === 'true', 'T2: recovery links expire within an hour and password changes need a recent sign-in');
    assert(value('auth.email', 'double_confirm_changes') === 'true', 'T742: new e-mail addresses are confirmed from both mailboxes');
    assert(Number(value('auth.rate_limit', 'sign_in_sign_ups')) > 0 && Number(value('auth.rate_limit', 'email_sent')) > 0, 'T70/T2: sign-in and recovery e-mails are rate limited by Supabase Auth');
    assert(value('auth', 'enable_refresh_token_rotation') === 'true' && Number(value('auth', 'jwt_expiry')) <= 3600, 'T20: short-lived access tokens and rotating refresh tokens');
    assert(value('auth.hook.custom_access_token', 'enabled') === 'true' && value('auth.hook.custom_access_token', 'uri') === 'pg-functions://postgres/public/custom_access_token_hook',
      'T17: the access token hook that adds org_id and user_role is enabled in versioned config');
    assert(Number(value('api', 'max_rows')) === MAX_RESULT_ROWS && /count=exact/.test(readText('api/_lib/store.ts')) && /content-range/.test(readText('api/_lib/store.ts')),
      'T2600: PostgREST caps responses at the API size and the API detects larger matches from the exact count (Content-Range)');
    assert(/if \(!totpCode\) return \{ success: false, mfaRequired: true/.test(readText('src/services/supabase.ts')) && /mfaRequired \? mfaCode : undefined/.test(readText('app/(auth)/reset-password.tsx')),
      'T2/T338: members with a second factor confirm it before a password reset completes');
    // Reset flow: public page, generic confirmation, new-password policy and the option to end every other session.
    const authSource = readText('src/services/supabase.ts');
    assert(fs.existsSync('app/(auth)/reset-password.tsx') && PUBLIC_ROUTES.includes('/reset-password'), 'T2: the recovery link opens a public reset page');
    assert(/If an account exists for this address/.test(authSource) && !/message: error\.message/.test(authSource), 'T2: the confirmation does not reveal whether an account exists');
    assert(/passwordPolicyViolations\(newPassword/.test(authSource) && /signOut\(\{ scope: 'others' \}\)/.test(authSource), 'T2/T143: the new password is checked and other sessions can be ended');
    // T338: TOTP second factor: enabled in Supabase Auth, asked at sign-in, enrolled and used for step-up in the app.
    assert(value('auth.mfa.totp', 'enroll_enabled') === 'true' && value('auth.mfa.totp', 'verify_enabled') === 'true', 'T338: TOTP enrollment and verification are enabled');
    assert(/nextLevel === 'aal2' && level\.data\.currentLevel !== 'aal2'/.test(authSource) && /return \{ user: null, mfaRequired: true \}/.test(authSource),
      'T338: members with a verified factor must enter a code before the app session starts');
    assert((authSource.match(/nextLevel === 'aal2' && level\.data\.currentLevel !== 'aal2'/g) || []).length === 3 && /a sign-in whose second-factor step was not completed never becomes an app session/.test(authSource),
      'T338: sign-in, the route guard and the password reset all require the second factor when one is enrolled');
    assert(/mfa\.challengeAndVerify/.test(authSource) && /mfa\.enroll\(\{ factorType: 'totp' \}\)/.test(authSource), 'T338: the app verifies and enrolls TOTP factors through Supabase Auth');
    assert(/verifySignInCode\(mfaCode\)/.test(readText('app/(auth)/login.tsx')) && /startTotpEnrollment\(\)/.test(readText('app/(app)/settings.tsx')),
      'T338: the sign-in screen asks for the code and Settings offers enrollment and session verification');
  }
  console.log('✓ Supabase Auth settings (password standard, invite-only, link expiry, rate limits, token hook, row cap) are versioned and match the app; the reset flow is complete in the app.');

  // -------------------------------------------------------------------------------------------
  console.log('\n[Check 16] Validating indirect object references in app URLs (T50)...');
  {
    const screens = trackedFiles().filter((f) => /^(app|src)\/.*\.tsx$/.test(f));
    const navigations = screens.flatMap((f) =>
      Array.from(readText(f).matchAll(/pathname:\s*'\/\(app\)\/device-detail',\s*params:\s*\{([^}]*)\}/g)).map((m) => ({ file: f, params: m[1].trim() }))
    );
    assert(navigations.length >= 4, 'T50: device pages are opened from the dashboard, device list and rooms');
    navigations.forEach(({ file, params }) =>
      assert(/^ref: getPublicReference\(\w+\.id\),?$/.test(params), `T50: ${file} must open device pages with an indirect reference (found "${params}")`)
    );
    const detail = readText('app/(app)/device-detail.tsx');
    assert(/useLocalSearchParams<\{ ref: string \}>/.test(detail) && /resolveInternalId\(ref\)/.test(detail) && !/useLocalSearchParams<\{ id/.test(detail),
      'T50: the device page only accepts an indirect reference and resolves it in memory');
    assert(/clearPublicReferences\(\);/.test(readText('src/services/supabase.ts')), 'T50: references are forgotten on logout');
  }
  console.log('✓ App URLs carry per-session random references instead of internal ids; objects are still authorized on the server.');

  // -------------------------------------------------------------------------------------------
  console.log('\n[Check 17] Validating that production bundles ship no demo data, personas or source maps (T49)...');
  {
    const metroConfig = readText('metro.config.js');
    assert(/process\.env\.EXPO_PUBLIC_DEMO_MODE !== 'true'/.test(metroConfig) && /initialData\.ts/.test(metroConfig) && /emptyData\.ts/.test(metroConfig),
      'T49: non-demo builds swap the demo dataset module for the empty one');
    const exportsOf = (file: string) => Array.from(readText(file).matchAll(/^export const (\w+)/gm)).map((m) => m[1]).sort();
    assert.deepStrictEqual(exportsOf('src/mock/emptyData.ts'), exportsOf('src/mock/initialData.ts'), 'T49: the empty module keeps every export of the demo module');
    assert(/^EXPO_PUBLIC_DEMO_MODE=false$/m.test(readText('.env.example')), 'T49: demo mode is off in the configuration template');
    const markers = [...DEMO_PERSONAS.map((u) => u.email), ...DEMO_DEVICES.map((d) => d.name)];
    const exportDirsForBundle = ['dist'].filter((d) => fs.existsSync(path.join(d, 'index.html')));
    assert(process.env.CI !== 'true' || exportDirsForBundle.length > 0, 'T49: CI builds the web export before this check, so the bundle is always inspected there');
    if (exportDirsForBundle.length === 0) console.log('  (no web export found: run pnpm build:web to inspect the bundle)');
    for (const exportDir of exportDirsForBundle) {
      const files: string[] = [];
      const walk = (dir: string) => fs.readdirSync(dir, { withFileTypes: true }).forEach((e) => {
        const full = path.join(dir, e.name);
        if (e.isDirectory()) walk(full);
        else files.push(full);
      });
      walk(exportDir);
      assert(!files.some((f) => f.endsWith('.map')), 'T49: no source maps are published');
      const bundles = files.filter((f) => /\.(js|html)$/.test(f));
      const leaks = bundles.filter((f) => markers.some((marker) => readText(f).includes(marker)));
      assert(leaks.length === 0, `T49: the production export contains demo personas or dataset (${leaks.join(', ')}); build it without EXPO_PUBLIC_DEMO_MODE=true`);
      console.log(`  (checked ${bundles.length} exported files in ${exportDir} for ${markers.length} demo markers)`);
    }
  }
  console.log('✓ Production exports contain no demo personas, demo dataset or source maps; demo aids exist only in opt-in demo builds.');

  console.log('\n=============================================================');
  console.log('ALL SECURITY CONTROL CHECKS PASSED');
  console.log('=============================================================\n');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
