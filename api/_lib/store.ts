// Tenant-scoped data access for the API routes (SDE T378, T2598, T2600).
// - Every query runs with the caller's own token, so Postgres RLS applies, and the routes add an
//   explicit filter on the organization taken from the verified token (never from the request).
// - Filter values must be plain literals (UUIDs, enum values, e-mail addresses), so request data
//   can never change the shape of a query.
// - Reads are bounded: a query that returns more rows than allowed is refused, not truncated.
// - Updates always target a single row by primary key.
import { ApiError } from './security';
import type { Principal } from './security';
import { supabaseRest, UpstreamUnavailableError } from './supabaseRest';
import type { RestResponse } from './supabaseRest';

export const MAX_RESULT_ROWS = 1000;

export type Filters = Record<string, string | readonly string[]>;

const SAFE_LITERAL = /^[A-Za-z0-9_.:@+-]{1,320}$/;
const SAFE_IDENTIFIER = /^[a-z_][a-z0-9_]*$/;
const SAFE_COLUMNS = /^[a-z_][a-z0-9_]*(,[a-z_][a-z0-9_]*)*$/;
const SAFE_ORDER = /^[a-z_][a-z0-9_]*\.(asc|desc)(,[a-z_][a-z0-9_]*\.(asc|desc))*$/;

function literal(value: string): string {
  if (!SAFE_LITERAL.test(value)) throw new ApiError(400, 'Invalid request', 'unsafe filter value');
  return encodeURIComponent(value);
}

function buildQuery(columns: string, filters: Filters, options: { limit?: number; order?: string } = {}): string {
  if (!SAFE_COLUMNS.test(columns)) throw new Error('invalid column list');
  const parts = [`select=${columns}`];
  for (const [column, value] of Object.entries(filters)) {
    if (!SAFE_IDENTIFIER.test(column)) throw new Error('invalid filter column');
    if (typeof value === 'string') parts.push(`${column}=eq.${literal(value)}`);
    else parts.push(`${column}=in.(${value.map(literal).join(',')})`);
  }
  if (options.order) {
    if (!SAFE_ORDER.test(options.order)) throw new Error('invalid order');
    parts.push(`order=${options.order}`);
  }
  if (options.limit !== undefined) parts.push(`limit=${options.limit}`);
  return parts.join('&');
}

// Upstream details stay in the security log; the client only gets a generic message.
function fail(response: RestResponse, operation: string): never {
  switch (response.status) {
    case 401:
      throw new ApiError(401, 'Authentication required', `data store rejected the token on ${operation}`);
    case 403:
      throw new ApiError(403, 'Forbidden', `data store denied ${operation}`);
    case 409:
      throw new ApiError(409, 'Conflict', `data store conflict on ${operation}`);
    case 400:
    case 422:
      throw new ApiError(400, 'Invalid request', `data store rejected ${operation}`);
    default:
      throw new ApiError(502, 'Service temporarily unavailable', `data store answered ${response.status} on ${operation}`);
  }
}

export class TenantStore {
  private constructor(private readonly token: string, readonly principal: Principal) {}

  static forCaller(ctx: { accessToken: string | null; principal: Principal | null }): TenantStore {
    if (!ctx.accessToken || !ctx.principal) throw new ApiError(401, 'Authentication required', 'no authenticated caller');
    return new TenantStore(ctx.accessToken, ctx.principal);
  }

  get organizationId(): string {
    return this.principal.organizationId;
  }

  private async call(method: 'GET' | 'POST' | 'PATCH', path: string, body?: unknown, prefer?: string[]): Promise<RestResponse> {
    try {
      return await supabaseRest(method, path, this.token, { body, prefer });
    } catch (err) {
      if (err instanceof UpstreamUnavailableError) throw new ApiError(503, 'Service temporarily unavailable', err.message);
      throw err;
    }
  }

  // SDE T2600: refuses oversized result sets instead of truncating them. PostgREST caps responses at
  // max_rows, so the exact total from Content-Range (Prefer: count=exact) decides, not the rows received.
  async list<T>(table: string, columns: string, filters: Filters, options: { order?: string; max?: number } = {}): Promise<T[]> {
    const max = options.max ?? MAX_RESULT_ROWS;
    if (Object.values(filters).some((v) => typeof v !== 'string' && v.length === 0)) return [];
    const response = await this.call('GET', `${table}?${buildQuery(columns, filters, { order: options.order, limit: max + 1 })}`, undefined, ['count=exact']);
    if ((response.status !== 200 && response.status !== 206) || !Array.isArray(response.body)) fail(response, `read ${table}`);
    const rows = response.body as T[];
    const total = Number((response.headers.get('content-range') || '').split('/')[1]);
    if (rows.length > max || (Number.isFinite(total) && total > max)) {
      throw new ApiError(422, 'Result set exceeds the allowed size', `${table} matched more than ${max} rows`);
    }
    return rows;
  }

  // Newest entries of an append-only stream (a fixed window, e.g. the latest events).
  async latest<T>(table: string, columns: string, filters: Filters, order: string, limit: number): Promise<T[]> {
    const response = await this.call('GET', `${table}?${buildQuery(columns, filters, { order, limit })}`);
    if (response.status !== 200 || !Array.isArray(response.body)) fail(response, `read ${table}`);
    return response.body as T[];
  }

  async findOne<T>(table: string, columns: string, filters: Filters): Promise<T | null> {
    const response = await this.call('GET', `${table}?${buildQuery(columns, filters, { limit: 2 })}`);
    if (response.status !== 200 || !Array.isArray(response.body)) fail(response, `read ${table}`);
    if (response.body.length > 1) throw new ApiError(422, 'Result set exceeds the allowed size', `${table} lookup matched several rows`);
    return (response.body[0] as T | undefined) ?? null;
  }

  async insert<T>(table: string, row: Record<string, unknown>, columns: string): Promise<T> {
    const response = await this.call('POST', `${table}?${buildQuery(columns, {})}`, row, ['return=representation']);
    if (response.status !== 201 || !Array.isArray(response.body) || response.body.length !== 1) fail(response, `insert into ${table}`);
    return response.body[0] as T;
  }

  async update<T>(table: string, filters: Filters, patch: Record<string, unknown>, columns: string): Promise<T | null> {
    if (typeof filters.id !== 'string') throw new Error('updates must target a single row by id');
    const response = await this.call('PATCH', `${table}?${buildQuery(columns, filters)}`, patch, ['return=representation']);
    if (response.status !== 200 || !Array.isArray(response.body)) fail(response, `update ${table}`);
    return (response.body[0] as T | undefined) ?? null;
  }

  async rpc<T>(fn: string, args: Record<string, unknown> = {}): Promise<T> {
    if (!SAFE_IDENTIFIER.test(fn)) throw new Error('invalid function name');
    const response = await this.call('POST', `rpc/${fn}`, args);
    if (response.status !== 200) fail(response, `call ${fn}`);
    return response.body as T;
  }
}
