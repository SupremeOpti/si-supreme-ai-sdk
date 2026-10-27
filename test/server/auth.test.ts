import { describe, expect, it, jest } from '@jest/globals';
import {
  AppInactiveError,
  bearerChallenge,
  bearerToken,
  canonicalResourceUri,
  createSiServerClient,
  hashConversationKey,
  InsufficientScopeError,
  InvalidArgumentError,
  InvalidTokenError,
  isVerifiedPrincipal,
  memoryCache,
  memoryLockStore,
  MisconfiguredKeyError,
  OrgAccessDeniedError,
  OrgLockedError,
  requireScope,
  SiUnavailableError,
  SiValidationError,
  type CacheAdapter,
  type IntrospectionPrincipal,
  type SiServerConfig,
} from '../../src/server';
import { clock, fakeFetch, ORGS, silentLogger, type Reply } from './helpers';

const RESOURCE = 'https://studio-canvas.supremegroup.ai/mcp';
const TOKEN = 'si-oauth-access-token-abc123';

function activeBody(nowMs: number, over: Record<string, unknown> = {}) {
  return {
    active: true,
    iss: 'https://si.example.com',
    sub: '456',
    aud: RESOURCE,
    client_id: 'https://claude.ai/oauth/claude-code-client-metadata',
    client_name: 'Claude Code',
    scope: 'mcp:canva:base mcp:canva:storyboards',
    token_type: 'Bearer',
    exp: Math.floor(nowMs / 1000) + 3600,
    iat: Math.floor(nowMs / 1000) - 10,
    grant_id: '0199a6c2-7e1b-7c3a-9f4e-2b8d6c1a0e55',
    requested_resource: `${RESOURCE}?instance=broth`,
    is_superadmin: false,
    email: 'ada@example.com',
    name: 'Ada Lovelace',
    organizations: ORGS,
    ...over,
  };
}

/** A cache adapter that records every call. */
function spyCache(now: () => number) {
  const inner = memoryCache({ now });
  const sets: Array<{ key: string; value: unknown; ttl: number }> = [];
  const gets: string[] = [];
  const cache: CacheAdapter = {
    get: async (k) => {
      gets.push(k);
      return inner.get(k);
    },
    set: async (k, v, ttl) => {
      sets.push({ key: k, value: v, ttl });
      return inner.set(k, v, ttl);
    },
    delete: (k) => inner.delete(k),
  };
  return { cache, sets, gets };
}

function setup(replies: (now: number) => Reply[], extra: Partial<SiServerConfig> = {}, auth: SiServerConfig['auth'] = {}) {
  const c = clock();
  const fetch = fakeFetch(...replies(c.now()));
  const logger = silentLogger();
  const spy = spyCache(c.now);
  const si = createSiServerClient({
    baseUrl: 'https://si.example.com',
    membershipKey: 'si-app-key',
    fetch,
    logger,
    now: c.now,
    locks: memoryLockStore({ now: c.now }),
    cache: memoryCache({ now: c.now }),
    timeoutMs: 50,
    ...extra,
    auth: { resource: RESOURCE, cache: spy.cache, ...auth },
  });
  return { si, fetch, c, logger, spy };
}

const active = (over: Record<string, unknown> = {}) => (now: number): Reply[] => [{ status: 200, body: activeBody(now, over) }];

describe('auth.introspect', () => {
  it('POSTs the token to SI with the membership key and returns a typed principal', async () => {
    const { si, fetch, c } = setup(active());
    const p = await si.auth.introspect(TOKEN);
    expect(fetch.calls[0].url).toBe('https://si.example.com/api/oauth/introspect');
    expect(fetch.calls[0].init.method).toBe('POST');
    expect(fetch.calls[0].init.headers).toMatchObject({ Authorization: 'Bearer si-app-key', 'Content-Type': 'application/json' });
    expect(JSON.parse(fetch.calls[0].init.body as string)).toEqual({ token: TOKEN });
    expect(p).toEqual({
      sub: '456',
      aud: RESOURCE,
      scope: ['mcp:canva:base', 'mcp:canva:storyboards'],
      clientId: 'https://claude.ai/oauth/claude-code-client-metadata',
      clientName: 'Claude Code',
      grantId: '0199a6c2-7e1b-7c3a-9f4e-2b8d6c1a0e55',
      requestedResource: `${RESOURCE}?instance=broth`,
      isSuperadmin: false,
      organizations: [
        { id: 2, slug: 'kadiko', name: 'Kadiko', logoUrl: 'https://si.example.com/org-icon/kadiko.png', roles: ['client'], appGrant: 'organization' },
        { id: 29, slug: 'supreme-group', name: 'Supreme Group', logoUrl: null, roles: ['orgadmin'], appGrant: 'role' },
      ],
      exp: Math.floor(c.now() / 1000) + 3600,
      iat: Math.floor(c.now() / 1000) - 10,
      iss: 'https://si.example.com',
      email: 'ada@example.com',
      name: 'Ada Lovelace',
      fromCache: false,
    });
  });

  it('accepts a "Bearer " prefixed value', async () => {
    const { si, fetch } = setup(active());
    await si.auth.introspect(`Bearer ${TOKEN}`);
    expect(JSON.parse(fetch.calls[0].init.body as string)).toEqual({ token: TOKEN });
  });

  it('email and name are optional', async () => {
    const { si } = setup((now) => {
      const body: Record<string, unknown> = activeBody(now);
      delete body.email;
      delete body.name;
      return [{ status: 200, body }];
    });
    const p = await si.auth.introspect(TOKEN);
    expect(p).not.toHaveProperty('email');
    expect(p).not.toHaveProperty('name');
  });

  it('returns a frozen, verified principal; copies are not verified', async () => {
    const { si } = setup(active());
    const p = await si.auth.introspect(TOKEN);
    expect(Object.isFrozen(p)).toBe(true);
    expect(Object.isFrozen(p.organizations[0])).toBe(true);
    expect(isVerifiedPrincipal(p)).toBe(true);
    expect(isVerifiedPrincipal({ ...p })).toBe(false);
  });

  it('missing token → InvalidTokenError(missing) without calling SI', async () => {
    const { si, fetch } = setup(active());
    for (const t of [undefined, null, '', '   ', 'Bearer ']) {
      await expect(si.auth.introspect(t)).rejects.toMatchObject({ code: 'invalid_token', reason: 'missing' });
    }
    expect(fetch).not.toHaveBeenCalled();
  });

  it('active:false → InvalidTokenError(inactive)', async () => {
    const { si } = setup(() => [{ status: 200, body: { active: false } }]);
    const err = await si.auth.introspect(TOKEN).catch((e) => e);
    expect(err).toBeInstanceOf(InvalidTokenError);
    expect(err.reason).toBe('inactive');
  });

  it('aud ≠ configured resource → InvalidTokenError(audience_mismatch)', async () => {
    const { si, logger } = setup(active({ aud: 'https://other-app.example.com/mcp' }));
    await expect(si.auth.introspect(TOKEN)).rejects.toMatchObject({ code: 'invalid_token', reason: 'audience_mismatch' });
    expect(logger.warn).toHaveBeenCalled();
  });

  it('aud check is not fooled by a path prefix or a query variant', async () => {
    for (const aud of [`${RESOURCE}-evil`, `${RESOURCE}/sub`, `${RESOURCE}?instance=broth`, 'https://studio-canvas.supremegroup.ai.evil.com/mcp']) {
      const { si } = setup(active({ aud }));
      await expect(si.auth.introspect(TOKEN)).rejects.toMatchObject({ reason: 'audience_mismatch' });
    }
  });

  it('aud comparison is canonical (host case, trailing slash, default port)', async () => {
    const { si } = setup(active({ aud: 'https://Studio-Canvas.supremegroup.ai:443/mcp/' }));
    await expect(si.auth.introspect(TOKEN)).resolves.toMatchObject({ sub: '456' });
  });

  it('per-call resource overrides the configured one', async () => {
    const { si } = setup(active());
    await expect(si.auth.introspect(TOKEN, { resource: 'https://other.example.com/mcp' })).rejects.toMatchObject({ reason: 'audience_mismatch' });
  });

  it('no resource anywhere → InvalidArgumentError before calling SI', async () => {
    const { si, fetch } = setup(active(), {}, { resource: undefined });
    await expect(si.auth.introspect(TOKEN)).rejects.toBeInstanceOf(InvalidArgumentError);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('a bad configured resource fails at construction', () => {
    expect(() => setup(active(), {}, { resource: 'http://studio-canvas.example.com/mcp' })).toThrow(InvalidArgumentError);
    expect(() => setup(active(), {}, { resource: 'https://x.example.com/mcp#frag' })).toThrow(InvalidArgumentError);
  });

  it('exp in the past by the local clock → InvalidTokenError(expired)', async () => {
    const { si } = setup((now) => [{ status: 200, body: activeBody(now, { exp: Math.floor(now / 1000) - 1 }) }]);
    await expect(si.auth.introspect(TOKEN)).rejects.toMatchObject({ reason: 'expired' });
  });

  it('dedupes concurrent introspections of one token', async () => {
    const c = clock();
    let release: () => void = () => undefined;
    const gate = new Promise<void>((r) => (release = r));
    const fetch = jest.fn(async () => {
      await gate;
      const text = JSON.stringify(activeBody(c.now()));
      return { status: 200, headers: { get: () => null }, text: async () => text };
    });
    const si = createSiServerClient({
      baseUrl: 'https://si.example.com',
      membershipKey: 'k',
      fetch,
      now: c.now,
      logger: silentLogger(),
      locks: memoryLockStore({ now: c.now }),
      auth: { resource: RESOURCE, introspectionTtlSeconds: 0 },
    });
    const both = Promise.all([si.auth.introspect(TOKEN), si.auth.introspect(TOKEN)]);
    await new Promise((r) => setTimeout(r, 20));
    release();
    const [a, b] = await both;
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(a).toEqual(b);
    expect(a).not.toBe(b);
  });
});

describe('auth.introspect cache', () => {
  it('caches active:true for 60 s, then asks SI again', async () => {
    const { si, fetch, c } = setup(active());
    expect((await si.auth.introspect(TOKEN)).fromCache).toBe(false);
    c.advance(59);
    const cached = await si.auth.introspect(TOKEN);
    expect(cached.fromCache).toBe(true);
    expect(isVerifiedPrincipal(cached)).toBe(true);
    expect(fetch).toHaveBeenCalledTimes(1);
    c.advance(1);
    expect((await si.auth.introspect(TOKEN)).fromCache).toBe(false);
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('keys the cache on a SHA-256 of the token, never the token', async () => {
    const { si, spy } = setup(active());
    await si.auth.introspect(TOKEN);
    expect(spy.sets).toHaveLength(1);
    expect(spy.sets[0].key).toBe(`si:i:${await hashConversationKey(TOKEN)}`);
    for (const k of [...spy.gets, ...spy.sets.map((s) => s.key)]) expect(k).not.toContain(TOKEN);
    expect(JSON.stringify(spy.sets[0].value)).not.toContain(TOKEN);
  });

  it('never caches active:false', async () => {
    const { si, fetch, spy } = setup(() => [{ status: 200, body: { active: false } }]);
    await expect(si.auth.introspect(TOKEN)).rejects.toBeInstanceOf(InvalidTokenError);
    await expect(si.auth.introspect(TOKEN)).rejects.toBeInstanceOf(InvalidTokenError);
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(spy.sets).toHaveLength(0);
  });

  it('a token that was inactive a moment ago is asked about again', async () => {
    const { si, fetch } = setup((now) => [{ status: 200, body: { active: false } }, { status: 200, body: activeBody(now) }]);
    await expect(si.auth.introspect(TOKEN)).rejects.toBeInstanceOf(InvalidTokenError);
    await expect(si.auth.introspect(TOKEN)).resolves.toMatchObject({ fromCache: false });
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('never caches errors or aud mismatches', async () => {
    const { si, spy } = setup(() => [{ status: 500, body: {} }]);
    await expect(si.auth.introspect(TOKEN)).rejects.toBeInstanceOf(SiUnavailableError);
    expect(spy.sets).toHaveLength(0);
  });

  it('TTL ≤ min(60 s, exp): a token expiring in 20 s is cached for 20 s at most', async () => {
    const { si, fetch, c, spy } = setup((now) => [{ status: 200, body: activeBody(now, { exp: Math.floor(now / 1000) + 20 }) }]);
    await si.auth.introspect(TOKEN);
    expect(spy.sets[0].ttl).toBe(20);
    c.advance(19);
    expect((await si.auth.introspect(TOKEN)).fromCache).toBe(true);
    c.advance(1);
    // Past exp: not served from cache; SI is asked again (and the local exp check rejects).
    await expect(si.auth.introspect(TOKEN)).rejects.toMatchObject({ reason: 'expired' });
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('a token with < 1 s left is not cached', async () => {
    const { si, spy, c } = setup((now) => [{ status: 200, body: activeBody(now, { exp: Math.floor(now / 1000) + 1 }) }]);
    c.advance(0.5);
    await si.auth.introspect(TOKEN);
    expect(spy.sets).toHaveLength(0);
  });

  it('callers can lower the TTL but not raise it; 0 disables', async () => {
    const raised = setup(active(), {}, { introspectionTtlSeconds: 600 });
    await raised.si.auth.introspect(TOKEN);
    expect(raised.spy.sets[0].ttl).toBe(60);

    const lowered = setup(active(), {}, { introspectionTtlSeconds: 10 });
    await lowered.si.auth.introspect(TOKEN);
    expect(lowered.spy.sets[0].ttl).toBe(10);

    const off = setup(active(), {}, { introspectionTtlSeconds: 0 });
    await off.si.auth.introspect(TOKEN);
    await off.si.auth.introspect(TOKEN);
    expect(off.spy.sets).toHaveLength(0);
    expect(off.fetch).toHaveBeenCalledTimes(2);
  });

  it('ignores a cache entry older than 60 s even if the adapter keeps it longer', async () => {
    const c = clock();
    const store = new Map<string, unknown>();
    const forever: CacheAdapter = { get: async (k) => store.get(k), set: async (k, v) => void store.set(k, v), delete: async (k) => void store.delete(k) };
    const fetch = fakeFetch({ status: 200, body: activeBody(c.now()) });
    const si = createSiServerClient({
      baseUrl: 'https://si.example.com',
      membershipKey: 'k',
      fetch,
      now: c.now,
      logger: silentLogger(),
      locks: memoryLockStore({ now: c.now }),
      auth: { resource: RESOURCE, cache: forever },
    });
    await si.auth.introspect(TOKEN);
    c.advance(61);
    await si.auth.introspect(TOKEN);
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('re-checks aud on cached answers', async () => {
    const c = clock();
    const shared = memoryCache({ now: c.now });
    const mk = (resource: string) =>
      createSiServerClient({
        baseUrl: 'https://si.example.com',
        membershipKey: 'k',
        fetch: fakeFetch({ status: 200, body: activeBody(c.now()) }),
        now: c.now,
        logger: silentLogger(),
        locks: memoryLockStore({ now: c.now }),
        auth: { resource, cache: shared },
      });
    await mk(RESOURCE).auth.introspect(TOKEN);
    await expect(mk('https://other.example.com/mcp').auth.introspect(TOKEN)).rejects.toMatchObject({ reason: 'audience_mismatch' });
  });

  it('a cache adapter that throws is a miss, never an allow', async () => {
    const broken: CacheAdapter = {
      get: async () => {
        throw new Error('down');
      },
      set: async () => {
        throw new Error('down');
      },
      delete: async () => undefined,
    };
    const { si, fetch } = setup(active(), {}, { cache: broken });
    await expect(si.auth.introspect(TOKEN)).resolves.toMatchObject({ sub: '456' });
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});

describe('auth.introspect fails closed', () => {
  const cases: Array<[string, (now: number) => Reply[], new (...args: never[]) => Error, Record<string, unknown>]> = [
    ['network error (after one retry)', () => [new Error('ECONNRESET')], SiUnavailableError, { reason: 'network' }],
    ['timeout', () => ['hang'], SiUnavailableError, { reason: 'timeout' }],
    ['500', () => [{ status: 500, body: { error: 'boom' } }], SiUnavailableError, { reason: 'server_error' }],
    ['502 HTML', () => [{ status: 502, raw: '<html>' }], SiUnavailableError, { reason: 'server_error' }],
    ['malformed JSON', () => [{ status: 200, raw: '{"active": ' }], SiUnavailableError, { reason: 'malformed_response' }],
    ['empty 200', () => [{ status: 200, raw: '' }], SiUnavailableError, { reason: 'malformed_response' }],
    ['active missing', (n) => [{ status: 200, body: { ...activeBody(n), active: undefined } }], SiUnavailableError, { reason: 'malformed_response' }],
    ['active "true" string', (n) => [{ status: 200, body: { ...activeBody(n), active: 'true' } }], SiUnavailableError, { reason: 'malformed_response' }],
    ['non-numeric sub', (n) => [{ status: 200, body: activeBody(n, { sub: 'abc' }) }], SiUnavailableError, { reason: 'malformed_response' }],
    ['missing grant_id', (n) => [{ status: 200, body: activeBody(n, { grant_id: undefined }) }], SiUnavailableError, { reason: 'malformed_response' }],
    ['string exp', (n) => [{ status: 200, body: activeBody(n, { exp: '1790000000' }) }], SiUnavailableError, { reason: 'malformed_response' }],
    ['bad organizations', (n) => [{ status: 200, body: activeBody(n, { organizations: [{ id: '2' }] }) }], SiUnavailableError, { reason: 'malformed_response' }],
    ['missing organizations', (n) => [{ status: 200, body: activeBody(n, { organizations: undefined }) }], SiUnavailableError, { reason: 'malformed_response' }],
    ['unexpected 3xx', () => [{ status: 302 }], SiUnavailableError, { reason: 'unexpected_status' }],
    ['401', () => [{ status: 401, body: { error: 'Unauthorized', message: 'Invalid API key' } }], MisconfiguredKeyError, { status: 401 }],
    ['403 app_inactive', () => [{ status: 403, body: { error: 'app_inactive' } }], AppInactiveError, {}],
    ['403 other', () => [{ status: 403, body: { error: 'nope' } }], SiUnavailableError, { reason: 'unexpected_status' }],
    ['422', () => [{ status: 422, body: { error: 'validation_failed', errors: { token: ['required'] } } }], SiValidationError, { errors: { token: ['required'] } }],
    ['429', () => [{ status: 429, headers: { 'Retry-After': '7' } }], SiUnavailableError, { reason: 'rate_limited', retryAfterSeconds: 7 }],
    ['500 misconfigured_key (no resource)', () => [{ status: 500, body: { error: 'misconfigured_key', message: "This API key's app has no MCP resource." } }], MisconfiguredKeyError, { status: 500 }],
  ];

  it.each(cases)('%s → deny', async (_name, replies, type, fields) => {
    const { si } = setup(replies);
    const err = await si.auth.introspect(TOKEN).catch((e) => e);
    expect(err).toBeInstanceOf(type);
    expect(err).toMatchObject(fields);
  });

  it('500 misconfigured_key is not retried; a plain 500 is retried once', async () => {
    const a = setup(() => [{ status: 500, body: { error: 'misconfigured_key' } }]);
    await a.si.auth.introspect(TOKEN).catch(() => undefined);
    expect(a.fetch).toHaveBeenCalledTimes(1);
    const b = setup((n) => [{ status: 503 }, { status: 200, body: activeBody(n) }]);
    await expect(b.si.auth.introspect(TOKEN)).resolves.toMatchObject({ sub: '456' });
    expect(b.fetch).toHaveBeenCalledTimes(2);
  });

  it('429 is never retried and backs off for Retry-After before calling SI again', async () => {
    const { si, fetch, c } = setup((n) => [{ status: 429, headers: { 'Retry-After': '5' } }, { status: 200, body: activeBody(n) }]);
    await expect(si.auth.introspect(TOKEN)).rejects.toMatchObject({ reason: 'rate_limited', retryAfterSeconds: 5 });
    expect(fetch).toHaveBeenCalledTimes(1);
    c.advance(2);
    await expect(si.auth.introspect(TOKEN)).rejects.toMatchObject({ reason: 'rate_limited', retryAfterSeconds: 3 });
    expect(fetch).toHaveBeenCalledTimes(1);
    c.advance(3);
    await expect(si.auth.introspect(TOKEN)).resolves.toMatchObject({ sub: '456' });
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('back-off is capped at 60 s; a cached active answer is still served during it', async () => {
    const OTHER = 'other-token';
    const { si, fetch, c } = setup((n) => [{ status: 200, body: activeBody(n) }, { status: 429, headers: { 'Retry-After': '3600' } }, { status: 200, body: activeBody(n) }]);
    await si.auth.introspect(TOKEN);
    await expect(si.auth.introspect(OTHER)).rejects.toMatchObject({ reason: 'rate_limited' });
    expect((await si.auth.introspect(TOKEN)).fromCache).toBe(true);
    c.advance(60);
    await expect(si.auth.introspect(OTHER)).resolves.toMatchObject({ sub: '456' });
    expect(fetch).toHaveBeenCalledTimes(3);
  });

  it('X-SI-Min-Server-SDK on an introspection answer logs an upgrade warning', async () => {
    const { si, logger } = setup((n) => [{ status: 200, body: activeBody(n), headers: { 'X-SI-Min-Server-SDK': '9.0.0' } }]);
    await si.auth.introspect(TOKEN);
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('>= 9.0.0'));
  });

  it('429 with an HTTP-date Retry-After', async () => {
    const c0 = clock();
    const date = new Date(c0.now() + 10_000).toUTCString();
    const { si } = setup(() => [{ status: 429, headers: { 'Retry-After': date } }]);
    await expect(si.auth.introspect(TOKEN)).rejects.toMatchObject({ retryAfterSeconds: 10 });
  });
});

describe('auth.grantStatus', () => {
  const ids = (n: number, prefix = 'g') => Array.from({ length: n }, (_, i) => `${prefix}-${i}`);

  /** fetch that answers each chunk with `status` for every id it was asked about. */
  function chunkFetch(statusFor: (id: string) => string = () => 'active') {
    const calls: string[][] = [];
    const fn = jest.fn(async (_url: string, init: { body?: string } = {}) => {
      const body = JSON.parse(init.body ?? '{}') as { grant_ids: string[] };
      calls.push(body.grant_ids);
      const text = JSON.stringify(Object.fromEntries(body.grant_ids.map((id) => [id, statusFor(id)])));
      return { status: 200, headers: { get: () => null }, text: async () => text };
    });
    return Object.assign(fn, { chunks: calls });
  }

  function client(fetch: SiServerConfig['fetch'], auth: SiServerConfig['auth'] = {}) {
    const c = clock();
    return {
      c,
      si: createSiServerClient({
        baseUrl: 'https://si.example.com',
        membershipKey: 'si-app-key',
        fetch,
        now: c.now,
        logger: silentLogger(),
        locks: memoryLockStore({ now: c.now }),
        timeoutMs: 50,
        auth: { resource: RESOURCE, ...auth },
      }),
    };
  }

  it('POSTs grant_ids and returns { id: status }', async () => {
    const fetch = fakeFetch({ status: 200, body: { a: 'active', b: 'revoked', c: 'expired', d: 'unknown' } });
    const { si } = client(fetch);
    await expect(si.auth.grantStatus(['a', 'b', 'c', 'd'])).resolves.toEqual({ a: 'active', b: 'revoked', c: 'expired', d: 'unknown' });
    expect(fetch.calls[0].url).toBe('https://si.example.com/api/oauth/grants/status');
    expect(fetch.calls[0].init.method).toBe('POST');
    expect(fetch.calls[0].init.headers).toMatchObject({ Authorization: 'Bearer si-app-key' });
    expect(JSON.parse(fetch.calls[0].init.body as string)).toEqual({ grant_ids: ['a', 'b', 'c', 'd'] });
  });

  it('chunks to 100 ids per request', async () => {
    const fetch = chunkFetch((id) => (id.endsWith('7') ? 'revoked' : 'active'));
    const { si } = client(fetch);
    const out = await si.auth.grantStatus(ids(250));
    expect(fetch.chunks.map((c) => c.length)).toEqual([100, 100, 50]);
    expect(Object.keys(out)).toHaveLength(250);
    expect(out['g-17']).toBe('revoked');
    expect(out['g-249']).toBe('active');
  });

  it('dedupes ids (and exactly 100 is one request)', async () => {
    const fetch = chunkFetch();
    const { si } = client(fetch);
    await si.auth.grantStatus([...ids(100), ...ids(100)]);
    expect(fetch.chunks.map((c) => c.length)).toEqual([100]);
  });

  it('empty input → {} without calling SI', async () => {
    const fetch = chunkFetch();
    const { si } = client(fetch);
    await expect(si.auth.grantStatus([])).resolves.toEqual({});
    expect(fetch).not.toHaveBeenCalled();
  });

  it('rejects bad ids before calling SI', async () => {
    const fetch = chunkFetch();
    const { si } = client(fetch);
    for (const bad of [[''], ['x'.repeat(65)], [42], 'abc'] as unknown[]) {
      await expect(si.auth.grantStatus(bad as string[])).rejects.toBeInstanceOf(InvalidArgumentError);
    }
    expect(fetch).not.toHaveBeenCalled();
  });

  it('fails closed on a missing id or an unknown status (no partial answers)', async () => {
    const { si: a } = client(fakeFetch({ status: 200, body: { a: 'active' } }));
    await expect(a.auth.grantStatus(['a', 'b'])).rejects.toMatchObject({ reason: 'malformed_response' });
    const { si: b } = client(fakeFetch({ status: 200, body: { a: 'paused' } }));
    await expect(b.auth.grantStatus(['a'])).rejects.toMatchObject({ reason: 'malformed_response' });
    const { si: c } = client(fakeFetch({ status: 200, body: ['active'] }));
    await expect(c.auth.grantStatus(['a'])).rejects.toMatchObject({ reason: 'malformed_response' });
  });

  it('a failed later chunk fails the whole call', async () => {
    let n = 0;
    const ok = chunkFetch();
    const fetch = jest.fn(async (url: string, init: { body?: string } = {}) => {
      if (++n === 2) return { status: 429, headers: { get: (h: string) => (h === 'retry-after' ? '2' : null) }, text: async () => '' };
      return ok(url, init);
    });
    const { si } = client(fetch);
    await expect(si.auth.grantStatus(ids(150))).rejects.toMatchObject({ reason: 'rate_limited', retryAfterSeconds: 2 });
  });

  it('maps 401 / 403 app_inactive / 422 / 500 misconfigured_key', async () => {
    const cases: Array<[Reply, new (...a: never[]) => Error]> = [
      [{ status: 401, body: { error: 'Unauthorized' } }, MisconfiguredKeyError],
      [{ status: 403, body: { error: 'app_inactive' } }, AppInactiveError],
      [{ status: 422, body: { error: 'validation_failed', errors: { grant_ids: ['too many'] } } }, SiValidationError],
      [{ status: 500, body: { error: 'misconfigured_key' } }, MisconfiguredKeyError],
    ];
    for (const [reply, type] of cases) {
      const { si } = client(fakeFetch(reply));
      await expect(si.auth.grantStatus(['a'])).rejects.toBeInstanceOf(type);
    }
  });

  it('is not cached by default', async () => {
    const fetch = chunkFetch();
    const { si } = client(fetch);
    await si.auth.grantStatus(['a']);
    await si.auth.grantStatus(['a']);
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('optional cache keeps only `active`, for at most 60 s', async () => {
    const fetch = chunkFetch((id) => (id === 'r' ? 'revoked' : 'active'));
    const { si, c } = client(fetch, { grantStatusTtlSeconds: 600 });
    await si.auth.grantStatus(['a', 'r']);
    await expect(si.auth.grantStatus(['a', 'r'])).resolves.toEqual({ a: 'active', r: 'revoked' });
    expect(fetch.chunks[1]).toEqual(['r']);
    c.advance(60);
    await si.auth.grantStatus(['a']);
    expect(fetch.chunks[2]).toEqual(['a']);
  });
});

describe('requireScope', () => {
  const p = { scope: ['mcp:canva:base', 'mcp:canva:storyboards'] };

  it('passes when every scope is granted', () => {
    expect(() => requireScope(p, 'mcp:canva:base')).not.toThrow();
    expect(() => requireScope(p, ['mcp:canva:base', 'mcp:canva:storyboards'])).not.toThrow();
  });

  it('throws InsufficientScopeError carrying every required scope', () => {
    const err = (() => {
      try {
        requireScope(p, ['mcp:canva:base', 'mcp:canva:runs']);
      } catch (e) {
        return e as InsufficientScopeError;
      }
    })();
    expect(err).toBeInstanceOf(InsufficientScopeError);
    expect(err?.code).toBe('insufficient_scope');
    expect(err?.requiredScopes).toEqual(['mcp:canva:base', 'mcp:canva:runs']);
    expect(err?.missingScopes).toEqual(['mcp:canva:runs']);
  });

  it('no scopes → InvalidArgumentError (never a silent pass)', () => {
    expect(() => requireScope(p, [])).toThrow(InvalidArgumentError);
    expect(() => requireScope(p, '  ')).toThrow(InvalidArgumentError);
  });

  it('a principal without scopes fails', () => {
    expect(() => requireScope({} as IntrospectionPrincipal, 'mcp:canva:base')).toThrow(InsufficientScopeError);
  });
});

describe('challenges and PRM', () => {
  const META = 'https://studio-canvas.supremegroup.ai/.well-known/oauth-protected-resource/mcp';

  it('bearerChallenge formats and escapes auth-params', () => {
    expect(bearerChallenge({ error: 'insufficient_scope', scope: ['a', 'b'], resourceMetadata: 'https://x/y' })).toBe(
      'Bearer error="insufficient_scope", scope="a b", resource_metadata="https://x/y"'
    );
    expect(bearerChallenge({ realm: 'MCP', errorDescription: 'say "hi" \\' })).toBe('Bearer realm="MCP", error_description="say \\"hi\\" \\\\"');
  });

  it('401 for a missing token has no error code', () => {
    const { si } = setup(active());
    const r = si.auth.challenge(new InvalidTokenError('missing'));
    expect(r.status).toBe(401);
    expect(r.headers['WWW-Authenticate']).toBe(`Bearer resource_metadata="${META}"`);
  });

  it('401 invalid_token echoes the client query in resource_metadata', () => {
    const { si } = setup(active());
    const r = si.auth.challenge(new InvalidTokenError('inactive'), { requestUrl: `${RESOURCE}?instance=broth` });
    expect(r.status).toBe(401);
    expect(r.headers['WWW-Authenticate']).toBe(`Bearer error="invalid_token", resource_metadata="${META}?instance=broth"`);
    expect(r.body.error).toBe('invalid_token');
  });

  it('403 insufficient_scope lists every required scope', () => {
    const { si } = setup(active());
    const r = si.auth.challenge(new InsufficientScopeError(['mcp:canva:base', 'mcp:canva:runs'], ['mcp:canva:runs']));
    expect(r.status).toBe(403);
    expect(r.headers['WWW-Authenticate']).toBe(`Bearer error="insufficient_scope", scope="mcp:canva:base mcp:canva:runs", resource_metadata="${META}"`);
  });

  it('SI unavailable → 503 with Retry-After, never 401', () => {
    const { si } = setup(active());
    const r = si.auth.challenge(new SiUnavailableError('rate_limited', undefined, 429, 9));
    expect(r.status).toBe(503);
    expect(r.headers['Retry-After']).toBe('9');
    expect(r.headers['WWW-Authenticate']).toBeUndefined();
    expect(si.auth.challenge(new Error('x')).status).toBe(500);
  });

  it('protectedResourceMetadata: root variant', () => {
    const { si } = setup(active(), {}, { scopesSupported: ['mcp:canva:base'], resourceName: 'Studio Canvas' });
    expect(si.auth.protectedResourceMetadata()).toEqual({
      resource: RESOURCE,
      authorization_servers: ['https://si.example.com'],
      bearer_methods_supported: ['header'],
      scopes_supported: ['mcp:canva:base'],
      resource_name: 'Studio Canvas',
    });
  });

  it('protectedResourceMetadata echoes ?instance= from the path-suffixed request', () => {
    const { si } = setup(active(), {}, { issuer: 'https://app.supremegroup.ai' });
    const doc = si.auth.protectedResourceMetadata(`${META}?instance=broth`);
    expect(doc.resource).toBe(`${RESOURCE}?instance=broth`);
    expect(doc.authorization_servers).toEqual(['https://app.supremegroup.ai']);
  });

  it('protectedResourceMetadata uses the configured origin and path, not the request host (proxies)', () => {
    const { si } = setup(active());
    const doc = si.auth.protectedResourceMetadata('http://internal.supabase.local/functions/v1/mcp/.well-known/oauth-protected-resource?instance=a');
    expect(doc.resource).toBe(`${RESOURCE}?instance=a`);
  });

  it('resourceMetadataUrl is path-suffixed', () => {
    const { si } = setup(active());
    expect(si.auth.resourceMetadataUrl()).toBe(META);
    const root = setup(active(), {}, { resource: 'https://app.example.com' });
    expect(root.si.auth.resourceMetadataUrl()).toBe('https://app.example.com/.well-known/oauth-protected-resource');
  });

  it('bearerToken reads Authorization from Headers or a plain object', () => {
    expect(bearerToken({ authorization: 'Bearer abc' })).toBe('abc');
    expect(bearerToken({ Authorization: 'bearer abc' })).toBe('abc');
    expect(bearerToken({ get: (n: string) => (n === 'authorization' ? 'Bearer xyz' : null) })).toBe('xyz');
    expect(bearerToken({ authorization: 'Basic abc' })).toBeNull();
    expect(bearerToken({ authorization: 'Bearer a b' })).toBeNull();
    expect(bearerToken({})).toBeNull();
    expect(bearerToken(null)).toBeNull();
  });

  it('canonicalResourceUri', () => {
    expect(canonicalResourceUri('HTTPS://Studio-Canvas.supremegroup.ai:443/mcp/')).toBe(RESOURCE);
    expect(canonicalResourceUri(`${RESOURCE}?instance=broth`)).toBe(`${RESOURCE}?instance=broth`);
    expect(canonicalResourceUri('http://localhost:3000/mcp')).toBe('http://localhost:3000/mcp');
    expect(() => canonicalResourceUri('mcp')).toThrow(InvalidArgumentError);
  });
});

describe('org resolution from the principal', () => {
  const call = { conversationKey: null, organization: 'kadiko', tool: 'canvas_list', kind: 'read' as const };

  it('scopeToolCall takes the principal: no membership call, userId/clientId from the token', async () => {
    const { si, fetch } = setup(active());
    const principal = await si.auth.introspect(TOKEN);
    const scope = await si.mcp.scopeToolCall({ ...call, principal });
    expect(fetch).toHaveBeenCalledTimes(1); // the introspection only
    expect(scope).toMatchObject({
      organization: { id: 2, slug: 'kadiko', name: 'Kadiko' },
      roles: ['client'],
      appGrant: 'organization',
      mode: 'soft',
      userId: '456',
      principalId: '456',
      clientId: 'https://claude.ai/oauth/claude-code-client-metadata',
    });
    await expect(si.mcp.scopeToolCall({ ...call, principal, organization: 29 })).resolves.toMatchObject({ organization: { slug: 'supreme-group' } });
    await expect(si.mcp.scopeToolCall({ ...call, principal, organization: 'SUPREME-GROUP' })).resolves.toMatchObject({ organization: { id: 29 } });
  });

  it('an org not in the principal → OrgAccessDeniedError', async () => {
    const { si } = setup(active());
    const principal = await si.auth.introspect(TOKEN);
    await expect(si.mcp.scopeToolCall({ ...call, principal, organization: 'acme' })).rejects.toBeInstanceOf(OrgAccessDeniedError);
    await expect(si.mcp.scopeToolCall({ ...call, principal, organization: 7 })).rejects.toBeInstanceOf(OrgAccessDeniedError);
  });

  it('an empty organizations list denies every org', async () => {
    const { si } = setup(active({ organizations: [] }));
    const principal = await si.auth.introspect(TOKEN);
    await expect(si.mcp.scopeToolCall({ ...call, principal })).rejects.toBeInstanceOf(OrgAccessDeniedError);
  });

  it('rejects a look-alike principal that did not come from introspect', async () => {
    const { si, fetch } = setup(active());
    const principal = await si.auth.introspect(TOKEN);
    const forged = { ...principal, organizations: [...principal.organizations, { id: 7, slug: 'acme', name: 'Acme', logoUrl: null, roles: [], appGrant: 'organization' }] };
    await expect(si.mcp.scopeToolCall({ ...call, principal: forged, organization: 'acme' })).rejects.toBeInstanceOf(InvalidArgumentError);
    await expect(si.organizations.resolve(forged, 'acme')).rejects.toBeInstanceOf(InvalidArgumentError);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('an expired principal is rejected', async () => {
    const { si, c } = setup(active());
    const principal = await si.auth.introspect(TOKEN);
    c.advance(3600);
    await expect(si.mcp.scopeToolCall({ ...call, principal })).rejects.toMatchObject({ code: 'invalid_token', reason: 'expired' });
  });

  it('userId must match principal.sub when both are passed', async () => {
    const { si } = setup(active());
    const principal = await si.auth.introspect(TOKEN);
    await expect(si.mcp.scopeToolCall({ ...call, principal, userId: 999 })).rejects.toBeInstanceOf(InvalidArgumentError);
    await expect(si.mcp.scopeToolCall({ ...call, principal, userId: '456' })).resolves.toMatchObject({ userId: '456' });
  });

  it('neither userId nor principal → InvalidArgumentError', async () => {
    const { si } = setup(active());
    await expect(si.mcp.scopeToolCall({ ...call, clientId: 'x' })).rejects.toBeInstanceOf(InvalidArgumentError);
  });

  it('the conversation lock still applies and names the locked org from the principal', async () => {
    const { si } = setup(active());
    const principal = await si.auth.introspect(TOKEN);
    await si.mcp.scopeToolCall({ ...call, principal, conversationKey: 'conv-1' });
    const err = await si.mcp.scopeToolCall({ ...call, principal, conversationKey: 'conv-1', organization: 'supreme-group', kind: 'write' }).catch((e) => e);
    expect(err).toBeInstanceOf(OrgLockedError);
    expect(err.lockedOrganization).toEqual({ id: 2, slug: 'kadiko', name: 'Kadiko' });
  });

  it('labels the result with the banner and no structuredContent', async () => {
    const { si } = setup(active());
    const principal = await si.auth.introspect(TOKEN);
    const scope = await si.mcp.scopeToolCall({ ...call, principal });
    const r = si.mcp.labelResult({ content: [{ type: 'text', text: 'ok' }] }, scope);
    expect(r.content[0]).toEqual({ type: 'text', text: '[Org: Kadiko (kadiko)]' });
    expect(r).not.toHaveProperty('structuredContent');
  });

  it('listOrganizationsTool accepts the principal', async () => {
    const { si, fetch } = setup(active());
    const principal = await si.auth.introspect(TOKEN);
    const r = await si.mcp.listOrganizationsTool().handler({ principal });
    expect(JSON.parse(r.content[0].text as string)).toEqual({
      data: [
        { organization_id: 2, slug: 'kadiko', name: 'Kadiko', roles: ['client'], app_grant: 'organization' },
        { organization_id: 29, slug: 'supreme-group', name: 'Supreme Group', roles: ['orgadmin'], app_grant: 'role' },
      ],
      meta: { count: 2 },
    });
    expect(fetch).toHaveBeenCalledTimes(1);
    const forged = await si.mcp.listOrganizationsTool().handler({ principal: { ...principal } });
    expect(forged.isError).toBe(true);
  });
});
