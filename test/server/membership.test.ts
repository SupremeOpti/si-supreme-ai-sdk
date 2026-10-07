import { describe, expect, it } from '@jest/globals';
import {
  AppInactiveError,
  createSiServerClient,
  InvalidArgumentError,
  memoryLockStore,
  MisconfiguredKeyError,
  OrgAccessDeniedError,
  SiUnavailableError,
  UserGoneError,
} from '../../src/server';
import type { SiServerConfig } from '../../src/server';
import { clock, fakeFetch, membershipBody, ok, ORGS, silentLogger, type Reply } from './helpers';

function client(replies: Reply[], extra: Partial<SiServerConfig> = {}) {
  const fetch = fakeFetch(...replies);
  const c = clock();
  const logger = silentLogger();
  const si = createSiServerClient({
    baseUrl: 'https://si.example.com/',
    membershipKey: 'si-test-key',
    fetch,
    logger,
    now: c.now,
    locks: memoryLockStore({ now: c.now }),
    timeoutMs: 50,
    ...extra,
  });
  return { si, fetch, clock: c, logger };
}

describe('membership.get', () => {
  it('calls the contract endpoint with the bearer key and normalizes the body', async () => {
    const { si, fetch } = client([ok()]);
    const m = await si.membership.get(456);
    expect(fetch.calls[0].url).toBe('https://si.example.com/api/membership/users/456/organizations');
    expect(fetch.calls[0].init.method).toBe('GET');
    expect(fetch.calls[0].init.headers).toMatchObject({ Authorization: 'Bearer si-test-key', Accept: 'application/json' });
    expect(m).toEqual({
      user: { id: 456 },
      app: { id: 12, name: 'Studio Canvas' },
      isSuperadmin: false,
      organizations: [
        { id: 2, slug: 'kadiko', name: 'Kadiko', roles: ['client'], appGrant: 'organization' },
        { id: 29, slug: 'supreme-group', name: 'Supreme Group', roles: ['orgadmin'], appGrant: 'role' },
      ],
      generatedAt: '2026-10-02T15:04:05Z',
      fromCache: false,
    });
  });

  it('rejects non-integer user ids without calling SI', async () => {
    const { si, fetch } = client([ok()]);
    await expect(si.membership.get('abc')).rejects.toBeInstanceOf(InvalidArgumentError);
    await expect(si.membership.get('../1')).rejects.toBeInstanceOf(InvalidArgumentError);
    await expect(si.membership.get(0)).rejects.toBeInstanceOf(InvalidArgumentError);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('dedupes concurrent lookups for the same user', async () => {
    const { si, fetch } = client([ok()]);
    await Promise.all([si.membership.get(456), si.membership.get('456'), si.membership.get(456)]);
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});

describe('fail closed', () => {
  const cases: Array<[string, Reply[], new (...args: never[]) => Error, string]> = [
    ['network error (after one retry)', [new Error('ECONNRESET')], SiUnavailableError, 'network'],
    ['timeout', ['hang'], SiUnavailableError, 'timeout'],
    ['500', [{ status: 500, body: { error: 'boom' } }], SiUnavailableError, 'server_error'],
    ['502 with HTML body', [{ status: 502, raw: '<html>bad gateway</html>' }], SiUnavailableError, 'server_error'],
    ['429 without cache', [{ status: 429, body: { message: 'Too Many Attempts.' } }], SiUnavailableError, 'rate_limited'],
    ['malformed JSON', [{ status: 200, raw: '{"data": ' }], SiUnavailableError, 'malformed_response'],
    ['empty 200', [{ status: 200, raw: '' }], SiUnavailableError, 'malformed_response'],
    ['string org id', [{ status: 200, body: membershipBody(456, [{ ...ORGS[0], id: '2' }]) }], SiUnavailableError, 'malformed_response'],
    ['missing roles', [{ status: 200, body: membershipBody(456, [{ id: 2, slug: 'k', name: 'K', app_grant: 'role' }]) }], SiUnavailableError, 'malformed_response'],
    ['answer for another user', [ok(999)], SiUnavailableError, 'malformed_response'],
    ['unexpected 3xx', [{ status: 302 }], SiUnavailableError, 'unexpected_status'],
    ['403 without app_inactive', [{ status: 403, body: { error: 'forbidden' } }], SiUnavailableError, 'unexpected_status'],
    ['401', [{ status: 401, body: { error: 'Unauthorized' } }], MisconfiguredKeyError, ''],
    ['500 misconfigured_key', [{ status: 500, body: { error: 'misconfigured_key', message: 'x' } }], MisconfiguredKeyError, ''],
    ['403 app_inactive', [{ status: 403, body: { error: 'app_inactive', message: 'x' } }], AppInactiveError, ''],
    ['404 user_not_found', [{ status: 404, body: { error: 'user_not_found', message: 'x' } }], UserGoneError, ''],
  ];

  it.each(cases)('%s → deny', async (_name, replies, ErrorClass, reason) => {
    const { si } = client(replies);
    const err = await si.membership.get(456).catch((e) => e);
    expect(err).toBeInstanceOf(ErrorClass);
    if (reason) expect((err as SiUnavailableError).reason).toBe(reason);

    const { si: si2 } = client(replies);
    await expect(si2.organizations.resolve(456, 'kadiko')).rejects.toBeInstanceOf(ErrorClass);
    const { si: si3 } = client(replies);
    await expect(si3.membership.requireOrg(456, 2)).rejects.toBeInstanceOf(ErrorClass);
  });

  it('retries once on network error / 5xx, never on 4xx or misconfigured_key', async () => {
    const net = client([new Error('reset'), ok()]);
    await expect(net.si.membership.get(456)).resolves.toBeTruthy();
    expect(net.fetch).toHaveBeenCalledTimes(2);

    const five = client([{ status: 503 }, ok()]);
    await expect(five.si.membership.get(456)).resolves.toBeTruthy();
    expect(five.fetch).toHaveBeenCalledTimes(2);

    const twice = client([{ status: 503 }, { status: 503 }, ok()]);
    await expect(twice.si.membership.get(456)).rejects.toBeInstanceOf(SiUnavailableError);
    expect(twice.fetch).toHaveBeenCalledTimes(2);

    for (const status of [400, 401, 403, 404, 429]) {
      const c = client([{ status, body: { error: 'x' } }, ok()]);
      await c.si.membership.get(456).catch(() => undefined);
      expect(c.fetch).toHaveBeenCalledTimes(1);
    }

    const mk = client([{ status: 500, body: { error: 'misconfigured_key' } }, ok()]);
    await mk.si.membership.get(456).catch(() => undefined);
    expect(mk.fetch).toHaveBeenCalledTimes(1);
  });

  it('does not retry when Retry-After exceeds the retry budget', async () => {
    const c = client([{ status: 503, headers: { 'Retry-After': '30' } }, ok()]);
    await expect(c.si.membership.get(456)).rejects.toBeInstanceOf(SiUnavailableError);
    expect(c.fetch).toHaveBeenCalledTimes(1);
  });

  it('never caches errors other than user_not_found', async () => {
    const c = client([{ status: 500 }, { status: 500 }, ok()]);
    await expect(c.si.membership.get(456)).rejects.toBeInstanceOf(SiUnavailableError);
    await expect(c.si.membership.get(456)).resolves.toMatchObject({ fromCache: false });
  });
});

describe('cache TTLs', () => {
  it('caches allow answers for 300 s by default', async () => {
    const c = client([ok()]);
    await c.si.membership.get(456);
    c.clock.advance(299);
    await expect(c.si.membership.get(456)).resolves.toMatchObject({ fromCache: true });
    c.clock.advance(2);
    await expect(c.si.membership.get(456)).resolves.toMatchObject({ fromCache: false });
    expect(c.fetch).toHaveBeenCalledTimes(2);
  });

  it('callers cannot raise the allow TTL above 300 s', async () => {
    const c = client([ok()], { membership: { allowTtlSeconds: 3600 } });
    await c.si.membership.get(456);
    c.clock.advance(301);
    await expect(c.si.membership.get(456)).resolves.toMatchObject({ fromCache: false });
  });

  it('callers can lower the allow TTL', async () => {
    const c = client([ok()], { membership: { allowTtlSeconds: 60 } });
    await c.si.membership.get(456);
    c.clock.advance(61);
    await expect(c.si.membership.get(456)).resolves.toMatchObject({ fromCache: false });
  });

  it('caches user_not_found for 30 s at most, even if asked for more', async () => {
    const c = client([{ status: 404, body: { error: 'user_not_found' } }, ok()], { membership: { denyTtlSeconds: 600 } });
    await expect(c.si.membership.get(456)).rejects.toBeInstanceOf(UserGoneError);
    c.clock.advance(29);
    await expect(c.si.membership.get(456)).rejects.toBeInstanceOf(UserGoneError);
    expect(c.fetch).toHaveBeenCalledTimes(1);
    c.clock.advance(2);
    await expect(c.si.membership.get(456)).resolves.toMatchObject({ fromCache: false });
  });

  it('caches an empty org list as a deny (30 s)', async () => {
    const c = client([ok(456, []), ok()]);
    await expect(c.si.membership.requireOrg(456, 2)).rejects.toBeInstanceOf(OrgAccessDeniedError);
    c.clock.advance(31);
    await expect(c.si.membership.requireOrg(456, 2)).resolves.toMatchObject({ id: 2 });
  });

  it('a TTL of 0 disables caching', async () => {
    const c = client([ok()], { membership: { allowTtlSeconds: 0 } });
    await c.si.membership.get(456);
    await c.si.membership.get(456);
    expect(c.fetch).toHaveBeenCalledTimes(2);
  });

  it('treats cache read failures as a miss and ignores write failures', async () => {
    const broken = {
      get: async () => {
        throw new Error('down');
      },
      set: async () => {
        throw new Error('down');
      },
      delete: async () => undefined,
    };
    const c = client([ok()], { cache: broken });
    await expect(c.si.membership.get(456)).resolves.toMatchObject({ fromCache: false });
  });

  it('ignores corrupt cache entries', async () => {
    const corrupt = { get: async () => ({ v: 1, kind: 'allow', at: 0, data: 'nope' }), set: async () => undefined, delete: async () => undefined };
    const c = client([ok()], { cache: corrupt });
    await expect(c.si.membership.get(456)).resolves.toMatchObject({ fromCache: false });
  });
});

describe('requireOrg', () => {
  it('returns roles and app grant when the org is present', async () => {
    const { si } = client([ok()]);
    await expect(si.membership.requireOrg(456, 29)).resolves.toEqual({
      id: 29,
      slug: 'supreme-group',
      name: 'Supreme Group',
      roles: ['orgadmin'],
      appGrant: 'role',
    });
  });

  it('throws OrgAccessDeniedError when absent', async () => {
    const { si } = client([ok()]);
    await expect(si.membership.requireOrg(456, 7)).rejects.toBeInstanceOf(OrgAccessDeniedError);
  });

  it('rejects non-numeric org ids', async () => {
    const { si } = client([ok()]);
    await expect(si.membership.requireOrg(456, 'kadiko')).rejects.toBeInstanceOf(InvalidArgumentError);
  });

  it('refetches on a miss once the cached answer is older than the deny TTL', async () => {
    const c = client([ok(456, [ORGS[0]]), ok()]);
    await expect(c.si.membership.requireOrg(456, 29)).rejects.toBeInstanceOf(OrgAccessDeniedError);
    expect(c.fetch).toHaveBeenCalledTimes(1);
    c.clock.advance(10);
    await expect(c.si.membership.requireOrg(456, 29)).rejects.toBeInstanceOf(OrgAccessDeniedError);
    expect(c.fetch).toHaveBeenCalledTimes(1);
    c.clock.advance(25);
    await expect(c.si.membership.requireOrg(456, 29)).resolves.toMatchObject({ id: 29 });
    expect(c.fetch).toHaveBeenCalledTimes(2);
  });

  it('serves the fresh cached answer when the refetch hits 429', async () => {
    const c = client([ok(456, [ORGS[0]]), { status: 429 }]);
    await c.si.membership.requireOrg(456, 2);
    c.clock.advance(60);
    await expect(c.si.membership.requireOrg(456, 29)).rejects.toBeInstanceOf(OrgAccessDeniedError);
    await expect(c.si.membership.requireOrg(456, 2)).resolves.toMatchObject({ id: 2 });
  });

  it('removal shows up after the allow TTL', async () => {
    const c = client([ok(), ok(456, [ORGS[1]])]);
    await expect(c.si.membership.requireOrg(456, 2)).resolves.toMatchObject({ id: 2 });
    c.clock.advance(301);
    await expect(c.si.membership.requireOrg(456, 2)).rejects.toBeInstanceOf(OrgAccessDeniedError);
  });

  it('invalidate drops the cached answer', async () => {
    const c = client([ok()]);
    await c.si.membership.get(456);
    await c.si.membership.invalidate(456);
    await c.si.membership.get(456);
    expect(c.fetch).toHaveBeenCalledTimes(2);
  });
});

describe('version policy', () => {
  it('warns once when SI requires a newer server SDK', async () => {
    const c = client([{ status: 200, body: membershipBody(), headers: { 'X-SI-Min-Server-SDK': '9.0.0' } }]);
    await c.si.membership.get(456);
    await c.si.membership.invalidate(456);
    await c.si.membership.get(456);
    const warnings = c.logger.warn.mock.calls.filter((args) => String(args[0]).includes('9.0.0'));
    expect(warnings).toHaveLength(1);
  });

  it('stays quiet when this version satisfies the minimum', async () => {
    const c = client([{ status: 200, body: membershipBody(), headers: { 'X-SI-Min-Server-SDK': '1.2.0' } }]);
    await c.si.membership.get(456);
    expect(c.logger.warn.mock.calls.filter((args) => String(args[0]).includes('requires'))).toHaveLength(0);
  });
});
