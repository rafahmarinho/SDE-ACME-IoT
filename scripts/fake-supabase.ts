// Local stand-in for the Supabase endpoints used by the API routes (no network, no real database).
// - GET /auth/v1/user answers like Supabase Auth: 200 for live sessions, 403 session_not_found once a
//   session was revoked (logout), 500 while the server is marked as down.
// - /rest/v1/<table> and /rest/v1/rpc/<fn> emulate the PostgREST subset the API uses (select, eq/in
//   filters, order, limit, insert and update with return=representation) over in-memory tables.
// Row-level security is deliberately NOT emulated: the checks prove that the API itself authorizes
// every object access. Every request is recorded so the checks can inspect the queries.
import http from 'http';
import crypto from 'crypto';
import type { AddressInfo } from 'net';

export type Row = Record<string, any>;

export interface RecordedRequest {
  method: string;
  table: string;
  params: URLSearchParams;
  authorization: string;
  apikey: string;
  prefer: string;
  body: any;
}

export interface FakeSupabase {
  url: string;
  tables: Record<string, Row[]>;
  requests: RecordedRequest[];
  revokedSessions: Set<string>;
  // Explicit profile per user id; null means the membership was removed. Users without an entry and
  // without a user_profiles row get a profile that matches their token (a consistent database).
  memberships: Map<string, Row | null>;
  rpcResults: Record<string, unknown>;
  setAuthDown(down: boolean): void;
  close(): Promise<void>;
}

const CONTROL_PARAMS = new Set(['select', 'order', 'limit']);
// Like Supabase's PostgREST max_rows (supabase/config.toml): no response carries more rows than this.
export const FAKE_MAX_ROWS = 1000;

function decodeClaims(authorization: string): Row {
  try {
    const payload = authorization.replace(/^Bearer /, '').split('.')[1] || '';
    return JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
  } catch {
    return {};
  }
}

function matcher(expression: string): ((value: unknown) => boolean) | null {
  const dot = expression.indexOf('.');
  const op = expression.slice(0, dot);
  const operand = expression.slice(dot + 1);
  if (op === 'eq') return (v) => v !== null && v !== undefined && String(v) === operand;
  if (op === 'neq') return (v) => String(v) !== operand;
  if (op === 'in') {
    const list = operand.replace(/^\(|\)$/g, '').split(',').filter(Boolean);
    return (v) => list.includes(String(v));
  }
  return null;
}

function project(row: Row, select: string | null): Row {
  if (!select || select === '*') return { ...row };
  const out: Row = {};
  select.split(',').forEach((col) => {
    out[col] = row[col] === undefined ? null : row[col];
  });
  return out;
}

function sortRows(rows: Row[], order: string | null): Row[] {
  if (!order) return rows;
  const keys = order.split(',').map((part) => {
    const [column, direction] = part.split('.');
    return { column, desc: direction === 'desc' };
  });
  return rows.slice().sort((a, b) => {
    for (const { column, desc } of keys) {
      const left = a[column];
      const right = b[column];
      if (left === right) continue;
      const result = left === undefined || left === null ? -1 : right === undefined || right === null ? 1 : left < right ? -1 : 1;
      return desc ? -result : result;
    }
    return 0;
  });
}

// Distinct, increasing server timestamps (Postgres now() differs between transactions).
let lastStamp = 0;
const nextTimestamp = () => {
  lastStamp = Math.max(Date.now(), lastStamp + 1);
  return new Date(lastStamp).toISOString();
};

const INSERT_DEFAULTS: Record<string, () => Row> = {
  devices: () => ({
    status: 'online',
    battery_level: 100,
    rssi: -65,
    firmware_version: 'v1.0.0',
    desired_state: {},
    reported_state: {},
    last_seen_at: new Date().toISOString(),
  }),
  automations: () => ({ execution_count: 0, last_executed_at: null, enabled: true, notify_on_run: true }),
  firmware_rollouts: () => ({ updated_devices: 0, failed_devices: 0 }),
  team_invitations: () => ({ status: 'pending' }),
  integrations: () => ({ active: true, api_key_hash: null }),
  privacy_consents: () => ({ decided_at: nextTimestamp() }),
};

const TABLES = [
  'organizations',
  'user_profiles',
  'buildings',
  'rooms',
  'devices',
  'automations',
  'alerts',
  'events_log',
  'firmware_packages',
  'firmware_rollouts',
  'integrations',
  'team_invitations',
  'privacy_consents',
];

export async function startFakeSupabase(): Promise<FakeSupabase> {
  const tables: Record<string, Row[]> = Object.fromEntries(TABLES.map((t) => [t, [] as Row[]]));
  const requests: RecordedRequest[] = [];
  const revokedSessions = new Set<string>();
  const memberships = new Map<string, Row | null>();
  const rpcResults: Record<string, unknown> = {};
  let authDown = false;

  const send = (res: http.ServerResponse, status: number, body?: unknown) => {
    res.statusCode = status;
    res.setHeader('Content-Type', 'application/json');
    res.end(body === undefined ? '' : JSON.stringify(body));
  };

  const server = http.createServer((req, res) => {
    let raw = '';
    req.on('data', (chunk) => (raw += chunk));
    req.on('end', () => {
      const url = new URL(req.url || '/', 'http://127.0.0.1');
      const authorization = String(req.headers.authorization || '');
      const apikey = String(req.headers.apikey || '');

      if (url.pathname === '/auth/v1/user') {
        const sessionId = decodeClaims(authorization).session_id || '';
        if (authDown) return send(res, 500, {});
        if (!apikey) return send(res, 401, {});
        if (revokedSessions.has(sessionId)) return send(res, 403, { code: 'session_not_found' });
        return send(res, 200, {});
      }

      if (!url.pathname.startsWith('/rest/v1/')) return send(res, 404, {});
      if (!apikey || !/^Bearer [\w-]+\.[\w-]+\.[\w-]+$/.test(authorization)) {
        return send(res, 401, { code: 'PGRST301', message: 'JWT missing' });
      }

      let body: any = null;
      if (raw) {
        try {
          body = JSON.parse(raw);
        } catch {
          return send(res, 400, { code: 'PGRST102', message: 'invalid JSON' });
        }
      }
      const name = url.pathname.slice('/rest/v1/'.length);
      requests.push({ method: req.method || 'GET', table: name, params: url.searchParams, authorization, apikey, prefer: String(req.headers.prefer || ''), body });

      if (name.startsWith('rpc/')) {
        const fn = name.slice(4);
        if (fn in rpcResults) return send(res, 200, rpcResults[fn]);
        if (fn === 'verify_events_log_chain') {
          const org = decodeClaims(authorization).org_id;
          const entries = (tables.events_log || []).filter((e) => e.organization_id === org).length;
          return send(res, 200, [{ verified: true, checked_entries: entries, first_invalid_id: null }]);
        }
        return send(res, 404, { code: 'PGRST202', message: 'function not found' });
      }

      if (!tables[name]) return send(res, 404, { code: '42P01', message: 'relation does not exist' });
      const filters: Array<[string, (value: unknown) => boolean]> = [];
      for (const [column, expression] of url.searchParams.entries()) {
        if (CONTROL_PARAMS.has(column)) continue;
        const test = matcher(expression);
        if (!test) return send(res, 400, { code: 'PGRST100', message: 'unsupported filter' });
        filters.push([column, test]);
      }
      const select = url.searchParams.get('select');
      const matches = (row: Row) => filters.every(([column, test]) => test(row[column]));
      const returnRows = String(req.headers.prefer || '').includes('return=representation');

      if (req.method === 'GET') {
        let rows = tables[name].filter(matches);
        if (name === 'user_profiles') {
          const idFilter = url.searchParams.get('id');
          const sub = idFilter && idFilter.startsWith('eq.') ? idFilter.slice(3) : '';
          if (sub && rows.length === 0 && !tables.user_profiles.some((p) => p.id === sub)) {
            const claims = decodeClaims(authorization);
            const explicit = memberships.get(sub);
            const profile =
              explicit === null
                ? null
                : explicit ?? (claims.sub === sub
                    ? { id: sub, email: `${sub.slice(0, 8)}@example.test`, full_name: 'Test User', organization_id: claims.org_id, role: claims.user_role, created_at: '2026-10-01T00:00:00.000Z' }
                    : null);
            rows = profile ? [profile].filter(matches) : [];
          }
        }
        rows = sortRows(rows, url.searchParams.get('order'));
        const total = rows.length;
        const limit = url.searchParams.get('limit');
        if (limit !== null) rows = rows.slice(0, Number(limit));
        rows = rows.slice(0, FAKE_MAX_ROWS);
        // Prefer: count=exact reports the full match count in Content-Range (206 when cut short).
        if (String(req.headers.prefer || '').includes('count=exact')) {
          res.setHeader('Content-Range', rows.length > 0 ? `0-${rows.length - 1}/${total}` : `*/${total}`);
          return send(res, rows.length < total ? 206 : 200, rows.map((row) => project(row, select)));
        }
        return send(res, 200, rows.map((row) => project(row, select)));
      }

      if (req.method === 'POST') {
        const items: Row[] = Array.isArray(body) ? body : [body];
        const inserted = items.map((item) => {
          const row: Row = {
            ...(INSERT_DEFAULTS[name]?.() ?? {}),
            // Columns defaulting to auth.uid() in the schema get the caller's id.
            ...(name === 'privacy_consents' ? { user_id: decodeClaims(authorization).sub } : {}),
            ...item,
            id: item?.id ?? crypto.randomUUID(),
            created_at: item?.created_at ?? new Date().toISOString(),
          };
          tables[name].push(row);
          return row;
        });
        return send(res, 201, returnRows ? inserted.map((row) => project(row, select)) : undefined);
      }

      if (req.method === 'PATCH') {
        const updated = tables[name].filter(matches).map((row) => Object.assign(row, body));
        return send(res, 200, returnRows ? updated.map((row) => project(row, select)) : undefined);
      }

      return send(res, 405, {});
    });
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}`,
    tables,
    requests,
    revokedSessions,
    memberships,
    rpcResults,
    setAuthDown: (down: boolean) => {
      authDown = down;
    },
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}
