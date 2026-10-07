import type { CacheAdapter } from './adapters/types';
import {
  AppInactiveError,
  InvalidArgumentError,
  MisconfiguredKeyError,
  OrgAccessDeniedError,
  SiUnavailableError,
  UserGoneError,
} from './errors';
import type { HttpClient, HttpResult } from './http';
import type { Logger, Membership, MembershipOrganization, ResolvedOrganization } from './types';

export const MAX_ALLOW_TTL_SECONDS = 300;
export const MAX_DENY_TTL_SECONDS = 30;

/** Clamp a caller TTL: callers may lower the cap, never raise it. */
export function clampTtl(value: number | undefined, cap: number): number {
  if (value === undefined || !Number.isFinite(value)) return cap;
  return Math.max(0, Math.min(cap, Math.floor(value)));
}

type CacheEntry =
  | { v: 1; kind: 'allow'; at: number; data: Omit<Membership, 'fromCache'> }
  | { v: 1; kind: 'user_not_found'; at: number };

export interface MembershipDeps {
  http: HttpClient;
  cache: CacheAdapter;
  logger: Logger;
  now: () => number;
  allowTtlSeconds: number;
  denyTtlSeconds: number;
}

export interface MembershipApi {
  /** The user's orgs for this app. Cached (allow ≤ 300 s; empty list / user_not_found ≤ 30 s). */
  get(userId: number | string): Promise<Membership>;
  /** Returns the org when the user may use it (by numeric id), else throws `OrgAccessDeniedError`. */
  requireOrg(userId: number | string, organizationId: number | string): Promise<ResolvedOrganization>;
  /** Finds an org in the membership, refetching once when the cached answer is older than the deny TTL. */
  findOrganization(
    userId: number | string,
    match: (org: MembershipOrganization) => boolean
  ): Promise<{ organization: MembershipOrganization | null; membership: Membership }>;
  /** Drop the cached answer for a user. */
  invalidate(userId: number | string): Promise<void>;
}

export function normalizeUserId(userId: number | string): string {
  const s = typeof userId === 'number' ? String(userId) : typeof userId === 'string' ? userId.trim() : '';
  if (!/^[1-9]\d{0,18}$/.test(s)) throw new InvalidArgumentError('userId must be a positive integer SI user id');
  return s;
}

const isInt = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v);
const isStr = (v: unknown): v is string => typeof v === 'string';

/** Validate SI's 200 body. Anything unexpected → null (caller fails closed). */
export function parseMembershipBody(body: unknown): Omit<Membership, 'fromCache'> | null {
  if (!body || typeof body !== 'object') return null;
  const data = (body as { data?: unknown }).data;
  if (!data || typeof data !== 'object') return null;
  const d = data as Record<string, unknown>;
  const user = d.user as Record<string, unknown> | undefined;
  const app = d.app as Record<string, unknown> | undefined;
  if (!user || !isInt(user.id)) return null;
  if (!app || !isInt(app.id) || !isStr(app.name)) return null;
  if (typeof d.is_superadmin !== 'boolean') return null;
  if (!Array.isArray(d.organizations)) return null;

  const organizations: MembershipOrganization[] = [];
  for (const raw of d.organizations) {
    if (!raw || typeof raw !== 'object') return null;
    const o = raw as Record<string, unknown>;
    if (!isInt(o.id) || !isStr(o.slug) || !isStr(o.name) || !isStr(o.app_grant)) return null;
    if (!Array.isArray(o.roles) || !o.roles.every(isStr)) return null;
    organizations.push({ id: o.id, slug: o.slug, name: o.name, roles: [...o.roles], appGrant: o.app_grant });
  }

  const meta = (body as { meta?: Record<string, unknown> }).meta;
  return {
    user: { id: user.id },
    app: { id: app.id, name: app.name },
    isSuperadmin: d.is_superadmin,
    organizations,
    generatedAt: meta && isStr(meta.generated_at) ? meta.generated_at : '',
  };
}

function errorCode(result: HttpResult): string | undefined {
  const body = result.body as { error?: unknown } | undefined;
  return body && typeof body === 'object' && isStr(body.error) ? body.error : undefined;
}

function isCacheEntry(v: unknown): v is CacheEntry {
  if (!v || typeof v !== 'object') return false;
  const e = v as Record<string, unknown>;
  if (e.v !== 1 || typeof e.at !== 'number') return false;
  if (e.kind === 'user_not_found') return true;
  return e.kind === 'allow' && !!e.data && typeof e.data === 'object' && Array.isArray((e.data as Membership).organizations);
}

export function createMembership(deps: MembershipDeps): MembershipApi {
  const inflight = new Map<string, Promise<CacheEntry>>();
  const cacheKey = (id: string) => `si:m:${id}`;

  const readCache = async (id: string): Promise<CacheEntry | undefined> => {
    try {
      const v = await deps.cache.get(cacheKey(id));
      return isCacheEntry(v) ? v : undefined;
    } catch {
      return undefined;
    }
  };

  const writeCache = async (id: string, entry: CacheEntry) => {
    const ttl =
      entry.kind === 'allow' && entry.data.organizations.length > 0 ? deps.allowTtlSeconds : deps.denyTtlSeconds;
    try {
      if (ttl > 0) await deps.cache.set(cacheKey(id), entry, ttl);
      else await deps.cache.delete(cacheKey(id));
    } catch {
      // A cache write failure only costs an extra SI call next time.
    }
  };

  const fetchEntry = async (id: string): Promise<CacheEntry> => {
    const result = await deps.http({
      path: `/api/membership/users/${encodeURIComponent(id)}/organizations`,
      noRetryOn: (r) => errorCode(r) === 'misconfigured_key',
    });
    const code = errorCode(result);

    switch (result.status) {
      case 200: {
        const data = parseMembershipBody(result.body);
        if (!data) throw new SiUnavailableError('malformed_response', 'membership body did not match the contract', 200);
        if (String(data.user.id) !== id) {
          throw new SiUnavailableError('malformed_response', 'membership answer is for another user', 200);
        }
        return { v: 1, kind: 'allow', at: deps.now(), data };
      }
      case 401:
        throw new MisconfiguredKeyError('SI rejected the membership key (401)', 401);
      case 403:
        if (code === 'app_inactive') throw new AppInactiveError();
        throw new SiUnavailableError('unexpected_status', code, 403);
      case 404:
        if (code === 'user_not_found') return { v: 1, kind: 'user_not_found', at: deps.now() };
        throw new SiUnavailableError('unexpected_status', code ?? 'unknown 404', 404);
      case 429:
        throw new SiUnavailableError('rate_limited', undefined, 429);
      default:
        if (result.status === 500 && code === 'misconfigured_key') {
          throw new MisconfiguredKeyError('the key is not linked to an SI app (500 misconfigured_key)', 500);
        }
        if (result.status >= 500) throw new SiUnavailableError('server_error', code, result.status);
        throw new SiUnavailableError('unexpected_status', code, result.status);
    }
  };

  const refresh = (id: string): Promise<CacheEntry> => {
    const pending = inflight.get(id);
    if (pending) return pending;
    const p = fetchEntry(id)
      .then(async (entry) => {
        await writeCache(id, entry);
        return entry;
      })
      .finally(() => inflight.delete(id));
    inflight.set(id, p);
    return p;
  };

  const toMembership = (id: string, entry: CacheEntry, fromCache: boolean): Membership => {
    if (entry.kind === 'user_not_found') throw new UserGoneError(id);
    return { ...entry.data, organizations: entry.data.organizations.map((o) => ({ ...o, roles: [...o.roles] })), fromCache };
  };

  const get = async (userId: number | string): Promise<Membership> => {
    const id = normalizeUserId(userId);
    const cached = await readCache(id);
    if (cached) return toMembership(id, cached, true);
    return toMembership(id, await refresh(id), false);
  };

  const findOrganization: MembershipApi['findOrganization'] = async (userId, match) => {
    const id = normalizeUserId(userId);
    const cached = await readCache(id);
    if (cached) {
      const membership = toMembership(id, cached, true);
      const organization = membership.organizations.find(match) ?? null;
      // A miss on an answer older than the deny TTL is a stale "not allowed":
      // refetch so a user just added to an org isn't locked out for 5 min.
      if (organization || deps.now() - cached.at < deps.denyTtlSeconds * 1000) return { organization, membership };
      try {
        const fresh = toMembership(id, await refresh(id), false);
        return { organization: fresh.organizations.find(match) ?? null, membership: fresh };
      } catch (err) {
        // 429 while the cached answer is still fresh: serve it (contract).
        if (err instanceof SiUnavailableError && err.reason === 'rate_limited') return { organization, membership };
        throw err;
      }
    }
    const membership = toMembership(id, await refresh(id), false);
    return { organization: membership.organizations.find(match) ?? null, membership };
  };

  return {
    get,
    findOrganization,
    async requireOrg(userId, organizationId) {
      const s = String(organizationId).trim();
      if (!/^\d+$/.test(s)) throw new InvalidArgumentError('organizationId must be a numeric org id');
      const orgId = Number(s);
      const { organization } = await findOrganization(userId, (o) => o.id === orgId);
      if (!organization) throw new OrgAccessDeniedError(s);
      return organization;
    },
    async invalidate(userId) {
      try {
        await deps.cache.delete(cacheKey(normalizeUserId(userId)));
      } catch {
        // ignore
      }
    },
  };
}
