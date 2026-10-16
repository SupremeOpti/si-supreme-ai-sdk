import type { CacheAdapter } from './adapters/types';
import { readHeader, sha256Hex, type HeadersInput } from './conversation';
import {
  AppInactiveError,
  InsufficientScopeError,
  InvalidArgumentError,
  InvalidTokenError,
  isSiServerError,
  MisconfiguredKeyError,
  SiUnavailableError,
  SiValidationError,
} from './errors';
import type { HttpClient, HttpResult } from './http';
import { clampTtl, errorCode, parseOrganizations, retryAfterSeconds } from './membership';
import { canonicalResourceUri } from './resource';
import { SCOPE_MANIFEST_VERSION, scopeManifest as buildScopeManifest, type ScopeManifest, type ScopeManifestResponse } from './scopes';
import type { AuthConfig, GrantStatus, IntrospectionPrincipal, Logger } from './types';

export { canonicalResourceUri } from './resource';

export const INTROSPECT_PATH = '/api/oauth/introspect';
export const GRANT_STATUS_PATH = '/api/oauth/grants/status';
export const PROTECTED_RESOURCE_METADATA_PATH = '/.well-known/oauth-protected-resource';

/** SI's caching rule for `active: true` (and `active` grant statuses). */
export const MAX_INTROSPECTION_TTL_SECONDS = 60;
export const MAX_GRANT_STATUS_TTL_SECONDS = 60;
/** SI's batch limit for `grants/status`; larger inputs are chunked. */
export const GRANT_STATUS_CHUNK_SIZE = 100;
/** Longest local back-off after a `429` with `Retry-After`. */
const MAX_BACKOFF_SECONDS = 60;
const GRANT_STATUSES: readonly GrantStatus[] = ['active', 'revoked', 'expired', 'unknown'];

export interface IntrospectOptions {
  /** Canonical resource URI to check `aud` against. Default `config.auth.resource`. */
  resource?: string;
}

/** RFC 9728 protected-resource metadata. */
export interface ProtectedResourceMetadata {
  resource: string;
  authorization_servers: string[];
  bearer_methods_supported: string[];
  scopes_supported?: string[];
  resource_name?: string;
  resource_documentation?: string;
  logo_uri?: string;
}

/** A ready-to-send HTTP error answer for an MCP request. Runtime-neutral: build your own `Response` from it. */
export interface AuthChallenge {
  status: 401 | 403 | 500 | 503;
  headers: Record<string, string>;
  body: { error: string; error_description: string };
}

export interface ChallengeOptions {
  /** The MCP URL the client used (e.g. `req.url`); its query (`?instance=…`) is echoed into `resource_metadata`. */
  requestUrl?: string;
  /** Override the `resource_metadata` URL entirely. */
  resourceMetadataUrl?: string;
}

export interface AuthApi {
  /**
   * Introspect an MCP client's bearer token against SI. Returns the verified
   * principal, or throws: `InvalidTokenError` (missing, inactive, wrong `aud`,
   * expired), `SiUnavailableError` (network, timeout, 5xx, 429, malformed),
   * `MisconfiguredKeyError`, `AppInactiveError`, `SiValidationError`. There is
   * no path that returns a principal without SI's `active: true`.
   */
  introspect(bearer: string | null | undefined, options?: IntrospectOptions): Promise<IntrospectionPrincipal>;
  /** Live grant states, chunked by 100. Throws on any failed chunk (no partial answers). */
  grantStatus(grantIds: readonly string[]): Promise<Record<string, GrantStatus>>;
  /**
   * Throws `InsufficientScopeError` unless the principal has every scope.
   * With `auth.scopes` declared, a name outside the declaration is an
   * `InvalidArgumentError` (a programming error, never a 403 step-up).
   */
  requireScope(principal: Pick<IntrospectionPrincipal, 'scope'>, scope: string | readonly string[]): void;
  /** JSON for `/.well-known/oauth-protected-resource` (root and path-suffixed). `scopes_supported` comes from `auth.scopes` unless `auth.scopesSupported` narrows it. */
  protectedResourceMetadata(requestUrl?: string): ProtectedResourceMetadata;
  /** The SI scope manifest (contract v1) from `auth.scopes`: `{ version: 1, resource, scopes }`. Throws `InvalidArgumentError` without a declaration. */
  scopeManifest(): ScopeManifest;
  /** A ready-to-send `200` for `GET /.well-known/si-mcp-scopes.json`: the manifest as JSON text plus `Content-Type` and `Cache-Control: public, max-age=300`. */
  scopeManifestResponse(): ScopeManifestResponse;
  /** The path-suffixed PRM URL for the 401 `resource_metadata` parameter. */
  resourceMetadataUrl(requestUrl?: string): string;
  /** Map an error from `introspect` / `requireScope` to a 401 / 403 / 503 answer with `WWW-Authenticate`. */
  challenge(err: unknown, options?: ChallengeOptions): AuthChallenge;
  /** The bearer token from an `Authorization` header, or null. */
  bearerToken(headers: HeadersInput | null | undefined): string | null;
}

export interface AuthDeps {
  http: HttpClient;
  logger: Logger;
  now: () => number;
  baseUrl: string;
  config?: AuthConfig;
  cache: CacheAdapter;
}

// Principals created by `introspect`. `scopeToolCall` only trusts these.
const verified = new WeakSet<object>();

/** True for a principal returned by `si.auth.introspect` (not a copy or a look-alike). */
export function isVerifiedPrincipal(value: unknown): value is IntrospectionPrincipal {
  return typeof value === 'object' && value !== null && verified.has(value);
}

const quote = (v: string) => `"${v.replace(/["\\]/g, (c) => `\\${c}`)}"`;

/**
 * `WWW-Authenticate` value for a Bearer challenge (RFC 6750 §3, RFC 9728 §5.1),
 * e.g. `Bearer error="insufficient_scope", scope="a b", resource_metadata="https://…"`.
 */
export function bearerChallenge(params: {
  realm?: string;
  error?: 'invalid_token' | 'insufficient_scope' | 'invalid_request';
  errorDescription?: string;
  scope?: string | readonly string[];
  resourceMetadata?: string;
}): string {
  const parts: string[] = [];
  if (params.realm) parts.push(`realm=${quote(params.realm)}`);
  if (params.error) parts.push(`error=${quote(params.error)}`);
  if (params.errorDescription) parts.push(`error_description=${quote(params.errorDescription)}`);
  const scope = typeof params.scope === 'string' ? params.scope : params.scope?.join(' ');
  if (scope) parts.push(`scope=${quote(scope)}`);
  if (params.resourceMetadata) parts.push(`resource_metadata=${quote(params.resourceMetadata)}`);
  return parts.length ? `Bearer ${parts.join(', ')}` : 'Bearer';
}

/** The token of an `Authorization: Bearer <token>` header, or null. */
export function bearerToken(headers: HeadersInput | null | undefined): string | null {
  if (!headers) return null;
  const value = readHeader(headers, 'authorization');
  const match = value ? /^Bearer\s+(\S+)$/i.exec(value) : null;
  return match ? match[1] : null;
}

/**
 * Throws `InsufficientScopeError` unless `principal.scope` contains every
 * scope in `scope`. The error carries all of them (for the challenge's
 * `scope`), not only the missing ones.
 */
export function requireScope(principal: Pick<IntrospectionPrincipal, 'scope'>, scope: string | readonly string[]): void {
  const required = (typeof scope === 'string' ? [scope] : [...scope]).map((s) => s.trim()).filter(Boolean);
  if (required.length === 0) throw new InvalidArgumentError('requireScope needs at least one scope');
  const granted = new Set(Array.isArray(principal?.scope) ? principal.scope : []);
  const missing = required.filter((s) => !granted.has(s));
  if (missing.length) throw new InsufficientScopeError(required, missing);
}

const isStr = (v: unknown): v is string => typeof v === 'string';
const isInt = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v);

type ActiveBody = Omit<IntrospectionPrincipal, 'fromCache'>;

/** Validate SI's `active: true` body. Anything unexpected → null (caller fails closed). */
export function parseActiveIntrospection(body: unknown): ActiveBody | null {
  if (!body || typeof body !== 'object') return null;
  const b = body as Record<string, unknown>;
  if (b.active !== true) return null;
  if (!isStr(b.sub) || !/^[1-9]\d{0,18}$/.test(b.sub)) return null;
  if (!isStr(b.aud) || !isStr(b.iss) || !isStr(b.client_id) || !b.client_id) return null;
  if (!(b.client_name === null || isStr(b.client_name))) return null;
  if (!isStr(b.scope) || !isStr(b.grant_id) || !b.grant_id || !isStr(b.requested_resource)) return null;
  if (!isInt(b.exp) || !isInt(b.iat) || typeof b.is_superadmin !== 'boolean') return null;
  if (b.email !== undefined && b.email !== null && !isStr(b.email)) return null;
  if (b.name !== undefined && b.name !== null && !isStr(b.name)) return null;
  const organizations = parseOrganizations(b.organizations);
  if (!organizations) return null;

  const principal: { -readonly [K in keyof ActiveBody]: ActiveBody[K] } = {
    sub: b.sub,
    aud: b.aud,
    scope: b.scope.split(/\s+/).filter(Boolean),
    clientId: b.client_id,
    clientName: b.client_name as string | null,
    grantId: b.grant_id,
    requestedResource: b.requested_resource,
    isSuperadmin: b.is_superadmin,
    organizations,
    exp: b.exp,
    iat: b.iat,
    iss: b.iss,
  };
  if (isStr(b.email)) principal.email = b.email;
  if (isStr(b.name)) principal.name = b.name;
  return principal;
}

function freezePrincipal(data: ActiveBody, fromCache: boolean): IntrospectionPrincipal {
  const principal = Object.freeze({
    ...data,
    scope: Object.freeze([...data.scope]),
    organizations: Object.freeze(data.organizations.map((o) => Object.freeze({ ...o, roles: Object.freeze([...o.roles]) as string[] }))),
    fromCache,
  });
  verified.add(principal);
  return principal;
}

interface IntrospectionCacheEntry {
  v: 1;
  /** When SI answered, ms. */
  at: number;
  /** Cache lifetime chosen at write time, ms. */
  ttlMs: number;
  /** SI's raw `active: true` body (re-validated on read). */
  body: unknown;
}

interface GrantCacheEntry {
  v: 1;
  at: number;
  ttlMs: number;
  status: 'active';
}

export function createAuth(deps: AuthDeps): AuthApi {
  const cfg = deps.config ?? {};
  const introspectionTtl = clampTtl(cfg.introspectionTtlSeconds, MAX_INTROSPECTION_TTL_SECONDS);
  const grantTtl = cfg.grantStatusTtlSeconds === undefined ? 0 : clampTtl(cfg.grantStatusTtlSeconds, MAX_GRANT_STATUS_TTL_SECONDS);
  const defaultResource = cfg.resource === undefined ? undefined : canonicalResourceUri(cfg.resource);
  const issuer = cfg.issuer ?? deps.baseUrl;
  // SI-419: validated once, at construction; served many times.
  const declaration = cfg.scopes === undefined ? undefined : buildScopeManifest(cfg);
  const declaredNames = declaration === undefined ? undefined : new Set(declaration.scopes.map((s) => s.name));
  if (declaredNames && cfg.scopesSupported) {
    const undeclared = cfg.scopesSupported.filter((s) => !declaredNames.has(s));
    if (undeclared.length) {
      throw new InvalidArgumentError(`auth.scopesSupported must be a subset of the declared auth.scopes (undeclared: ${undeclared.join(', ')})`);
    }
  }
  const scopesSupported = cfg.scopesSupported?.length ? [...cfg.scopesSupported] : declaration?.scopes.map((s) => s.name);
  const inflight = new Map<string, Promise<ActiveBody>>();
  let blockedUntil = 0;

  const resourceFor = (override?: string): string => {
    if (override !== undefined) return canonicalResourceUri(override);
    if (defaultResource === undefined) {
      throw new InvalidArgumentError('no resource configured: set auth.resource or pass { resource } (your canonical MCP resource URI)');
    }
    return defaultResource;
  };

  const checkBackoff = () => {
    const remaining = blockedUntil - deps.now();
    if (remaining > 0) {
      throw new SiUnavailableError('rate_limited', 'backing off after 429 (Retry-After)', 429, Math.ceil(remaining / 1000));
    }
  };

  /** Non-200 answers from both endpoints. Never returns: every one is a deny. */
  const fail = (result: HttpResult): never => {
    const code = errorCode(result);
    switch (result.status) {
      case 401:
        throw new MisconfiguredKeyError('SI rejected the membership key (401)', 401);
      case 403:
        if (code === 'app_inactive') throw new AppInactiveError();
        throw new SiUnavailableError('unexpected_status', code, 403);
      case 422: {
        const errors = (result.body as { errors?: unknown } | undefined)?.errors;
        throw new SiValidationError(errors && typeof errors === 'object' ? (errors as Record<string, unknown>) : {});
      }
      case 429: {
        const retryAfter = retryAfterSeconds(result, deps.now());
        if (retryAfter !== undefined && retryAfter > 0) {
          blockedUntil = Math.max(blockedUntil, deps.now() + Math.min(retryAfter, MAX_BACKOFF_SECONDS) * 1000);
        }
        throw new SiUnavailableError('rate_limited', undefined, 429, retryAfter);
      }
      default: {
        if (result.status === 500 && code === 'misconfigured_key') {
          const message = (result.body as { message?: unknown } | undefined)?.message;
          throw new MisconfiguredKeyError(`500 misconfigured_key${isStr(message) ? `: ${message}` : ''}`, 500);
        }
        if (result.status >= 500) throw new SiUnavailableError('server_error', code, result.status);
        throw new SiUnavailableError('unexpected_status', code, result.status);
      }
    }
  };

  /** aud and exp checks, on fresh and cached answers alike. */
  const accept = (data: ActiveBody, resource: string): void => {
    let aud: string;
    try {
      aud = canonicalResourceUri(data.aud);
    } catch {
      throw new InvalidTokenError('audience_mismatch');
    }
    if (aud !== resource) {
      deps.logger.warn('[si-sdk/server] introspection: SI answered active for another audience; rejected', { aud: data.aud, expected: resource });
      throw new InvalidTokenError('audience_mismatch');
    }
    if (data.exp * 1000 <= deps.now()) throw new InvalidTokenError('expired');
  };

  const readCached = async (key: string): Promise<ActiveBody | null> => {
    try {
      const v = (await deps.cache.get(key)) as IntrospectionCacheEntry | undefined;
      if (!v || typeof v !== 'object' || v.v !== 1 || typeof v.at !== 'number' || typeof v.ttlMs !== 'number') return null;
      const age = deps.now() - v.at;
      if (age < 0 || age >= Math.min(v.ttlMs, introspectionTtl * 1000)) return null;
      return parseActiveIntrospection(v.body);
    } catch {
      return null;
    }
  };

  const fetchActive = async (token: string, key: string): Promise<ActiveBody> => {
    checkBackoff();
    const result = await deps.http({
      method: 'POST',
      path: INTROSPECT_PATH,
      body: { token },
      noRetryOn: (r) => errorCode(r) === 'misconfigured_key',
    });
    if (result.status !== 200) return fail(result);
    const body = result.body as { active?: unknown } | undefined;
    if (body && typeof body === 'object' && body.active === false) throw new InvalidTokenError('inactive');
    const data = parseActiveIntrospection(body);
    if (!data) throw new SiUnavailableError('malformed_response', 'introspection body did not match the contract', 200);

    // ≤ 60 s and never past exp. Whole seconds, rounded down.
    const ttlSeconds = Math.min(introspectionTtl, Math.floor((data.exp * 1000 - deps.now()) / 1000));
    if (ttlSeconds > 0) {
      const entry: IntrospectionCacheEntry = { v: 1, at: deps.now(), ttlMs: ttlSeconds * 1000, body };
      try {
        await deps.cache.set(key, entry, ttlSeconds);
      } catch {
        // A cache write failure only costs an extra SI call next time.
      }
    }
    return data;
  };

  const introspect: AuthApi['introspect'] = async (bearer, options = {}) => {
    const raw = typeof bearer === 'string' ? bearer.trim().replace(/^Bearer(\s+|$)/i, '').trim() : '';
    if (!raw) throw new InvalidTokenError('missing');
    const resource = resourceFor(options.resource);
    const key = `si:i:${await sha256Hex(raw)}`;

    const cached = await readCached(key);
    if (cached) {
      accept(cached, resource);
      return freezePrincipal(cached, true);
    }

    // Concurrent calls for one token share a request (never its result later: nothing negative is kept).
    let pending = inflight.get(key);
    if (!pending) {
      pending = fetchActive(raw, key).finally(() => inflight.delete(key));
      inflight.set(key, pending);
    }
    const data = await pending;
    accept(data, resource);
    return freezePrincipal(data, false);
  };

  const grantStatus: AuthApi['grantStatus'] = async (grantIds) => {
    if (!Array.isArray(grantIds)) throw new InvalidArgumentError('grantIds must be an array of grant ids');
    const ids: string[] = [];
    const seen = new Set<string>();
    for (const id of grantIds) {
      if (typeof id !== 'string' || !id || id.length > 64) throw new InvalidArgumentError('each grant id must be a non-empty string of at most 64 characters');
      if (!seen.has(id)) {
        seen.add(id);
        ids.push(id);
      }
    }

    const out = new Map<string, GrantStatus>();
    const pending: string[] = [];
    for (const id of ids) {
      if (grantTtl > 0) {
        try {
          const v = (await deps.cache.get(`si:g:${id}`)) as GrantCacheEntry | undefined;
          const age = v && v.v === 1 && v.status === 'active' ? deps.now() - v.at : -1;
          if (v && age >= 0 && age < Math.min(v.ttlMs, grantTtl * 1000)) {
            out.set(id, 'active');
            continue;
          }
        } catch {
          // miss
        }
      }
      pending.push(id);
    }

    for (let i = 0; i < pending.length; i += GRANT_STATUS_CHUNK_SIZE) {
      const chunk = pending.slice(i, i + GRANT_STATUS_CHUNK_SIZE);
      checkBackoff();
      const result = await deps.http({
        method: 'POST',
        path: GRANT_STATUS_PATH,
        body: { grant_ids: chunk },
        noRetryOn: (r) => errorCode(r) === 'misconfigured_key',
      });
      if (result.status !== 200) fail(result);
      const body = result.body as Record<string, unknown> | undefined;
      if (!body || typeof body !== 'object' || Array.isArray(body)) {
        throw new SiUnavailableError('malformed_response', 'grant status body is not an object', 200);
      }
      for (const id of chunk) {
        const status = Object.prototype.hasOwnProperty.call(body, id) ? body[id] : undefined;
        if (!GRANT_STATUSES.includes(status as GrantStatus)) {
          throw new SiUnavailableError('malformed_response', 'grant status missing or unknown for a requested id', 200);
        }
        out.set(id, status as GrantStatus);
        if (status === 'active' && grantTtl > 0) {
          const entry: GrantCacheEntry = { v: 1, at: deps.now(), ttlMs: grantTtl * 1000, status: 'active' };
          try {
            await deps.cache.set(`si:g:${id}`, entry, grantTtl);
          } catch {
            // ignore
          }
        }
      }
    }

    return Object.fromEntries(ids.map((id) => [id, out.get(id) as GrantStatus]));
  };

  const queryOf = (requestUrl?: string): string => {
    if (requestUrl === undefined) return '';
    try {
      return new URL(requestUrl).search;
    } catch {
      throw new InvalidArgumentError('requestUrl must be an absolute URL');
    }
  };

  const baseResource = (): { origin: string; path: string; query: string } => {
    const r = new URL(resourceFor());
    return { origin: `${r.protocol}//${r.host}`, path: r.pathname === '/' ? '' : r.pathname, query: r.search };
  };

  const protectedResourceMetadata: AuthApi['protectedResourceMetadata'] = (requestUrl) => {
    const { origin, path, query } = baseResource();
    // Echo the client's query (`?instance=…`): clients compare `resource` with the URL they used.
    const resource = `${origin}${path}${queryOf(requestUrl) || query}`;
    const doc: ProtectedResourceMetadata = {
      resource,
      authorization_servers: [issuer],
      bearer_methods_supported: ['header'],
    };
    if (scopesSupported?.length) doc.scopes_supported = [...scopesSupported];
    if (cfg.resourceName) doc.resource_name = cfg.resourceName;
    if (cfg.resourceDocumentation) doc.resource_documentation = cfg.resourceDocumentation;
    if (cfg.logoUri) doc.logo_uri = cfg.logoUri;
    return doc;
  };

  const declared = (): ScopeManifest => {
    if (declaration === undefined) throw new InvalidArgumentError('no scopes declared: set auth.scopes to serve the SI scope manifest');
    return declaration;
  };

  const scopeManifest: AuthApi['scopeManifest'] = () => {
    const m = declared();
    return { version: SCOPE_MANIFEST_VERSION, resource: m.resource, scopes: m.scopes.map((s) => ({ ...s })) };
  };

  const scopeManifestResponse: AuthApi['scopeManifestResponse'] = () => ({
    status: 200,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=300' },
    body: JSON.stringify(declared()),
  });

  const requireDeclaredScope: AuthApi['requireScope'] = (principal, scope) => {
    if (declaredNames) {
      for (const s of (typeof scope === 'string' ? [scope] : [...scope]).map((v) => v.trim()).filter(Boolean)) {
        if (!declaredNames.has(s)) throw new InvalidArgumentError(`requireScope: "${s}" is not a declared scope (auth.scopes)`);
      }
    }
    requireScope(principal, scope);
  };

  const resourceMetadataUrl: AuthApi['resourceMetadataUrl'] = (requestUrl) => {
    const { origin, path, query } = baseResource();
    return `${origin}${PROTECTED_RESOURCE_METADATA_PATH}${path}${queryOf(requestUrl) || query}`;
  };

  const challenge: AuthApi['challenge'] = (err, options = {}) => {
    const json = { 'Content-Type': 'application/json' };
    const metadata = () => options.resourceMetadataUrl ?? resourceMetadataUrl(options.requestUrl);
    if (err instanceof InvalidTokenError) {
      // No error code when the request had no token (RFC 6750 §3.1).
      const error = err.reason === 'missing' ? undefined : 'invalid_token';
      return {
        status: 401,
        headers: { ...json, 'WWW-Authenticate': bearerChallenge({ error, resourceMetadata: metadata() }) },
        body: { error: error ?? 'unauthorized', error_description: err.publicMessage },
      };
    }
    if (err instanceof InsufficientScopeError) {
      return {
        status: 403,
        headers: {
          ...json,
          'WWW-Authenticate': bearerChallenge({ error: 'insufficient_scope', scope: err.requiredScopes, resourceMetadata: metadata() }),
        },
        body: { error: 'insufficient_scope', error_description: err.publicMessage },
      };
    }
    if (isSiServerError(err)) {
      // SI couldn't answer: not the client's token's fault, so no 401 (that would restart OAuth).
      const headers: Record<string, string> = { ...json };
      if (err instanceof SiUnavailableError && err.retryAfterSeconds !== undefined) headers['Retry-After'] = String(err.retryAfterSeconds);
      return { status: 503, headers, body: { error: 'temporarily_unavailable', error_description: err.publicMessage } };
    }
    return { status: 500, headers: json, body: { error: 'server_error', error_description: 'Unexpected error.' } };
  };

  return {
    introspect,
    grantStatus,
    requireScope: requireDeclaredScope,
    protectedResourceMetadata,
    scopeManifest,
    scopeManifestResponse,
    resourceMetadataUrl,
    challenge,
    bearerToken,
  };
}
