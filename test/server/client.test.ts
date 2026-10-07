import { describe, expect, it } from '@jest/globals';
import { readFileSync } from 'fs';
import { join } from 'path';
import { createSiServerClient, InvalidArgumentError, memoryLockStore, MisconfiguredKeyError, SERVER_SDK_VERSION, SUPABASE_LOCK_STORE_SQL } from '../../src/server';
import { parseRetryAfter } from '../../src/server/http';
import { fakeFetch, ok, silentLogger } from './helpers';

const root = join(__dirname, '..', '..');

describe('createSiServerClient', () => {
  const base = { baseUrl: 'https://si.example.com', membershipKey: 'k', logger: silentLogger(), locks: memoryLockStore() };

  it('rejects a missing membership key', () => {
    expect(() => createSiServerClient({ ...base, membershipKey: '' })).toThrow(MisconfiguredKeyError);
    expect(() => createSiServerClient({ ...base, membershipKey: '   ' })).toThrow(MisconfiguredKeyError);
    expect(() => createSiServerClient({ ...base, membershipKey: undefined as unknown as string })).toThrow(MisconfiguredKeyError);
  });

  it('requires https except for localhost', () => {
    expect(() => createSiServerClient({ ...base, baseUrl: 'http://si.example.com' })).toThrow(InvalidArgumentError);
    expect(() => createSiServerClient({ ...base, baseUrl: 'not a url' })).toThrow(InvalidArgumentError);
    expect(() => createSiServerClient({ ...base, baseUrl: 'http://localhost:8000' })).not.toThrow();
  });

  it('keeps a base path and strips trailing slashes', async () => {
    const fetch = fakeFetch(ok());
    const si = createSiServerClient({ ...base, baseUrl: 'https://si.example.com/v2/', fetch });
    await si.membership.get(456);
    expect(fetch.calls[0].url).toBe('https://si.example.com/v2/api/membership/users/456/organizations');
  });

  it('warns when falling back to the per-process lock store', () => {
    const logger = silentLogger();
    createSiServerClient({ baseUrl: 'https://si.example.com', membershipKey: 'k', logger });
    expect(String(logger.warn.mock.calls[0][0])).toContain('memoryLockStore');
  });

  it('never logs the membership key', async () => {
    const logger = silentLogger();
    const fetch = fakeFetch(new Error('down'));
    const si = createSiServerClient({ baseUrl: 'https://si.example.com', membershipKey: 'si-secret-123', logger, fetch, auditForwarding: { enabled: true } });
    await si.membership.get(456).catch(() => undefined);
    si.audit.emit({
      principalId: '1', clientId: 'c', mode: 'soft', keyHash: null, organizationId: 2, tool: 't', kind: 'read', outcome: 'allowed', occurredAt: '',
    });
    await si.audit.flush();
    expect(JSON.stringify(logger.warn.mock.calls)).not.toContain('si-secret-123');
  });

  it('SERVER_SDK_VERSION matches package.json', () => {
    const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
    expect(SERVER_SDK_VERSION).toBe(pkg.version);
  });
});

describe('parseRetryAfter', () => {
  it('parses seconds and HTTP dates', () => {
    expect(parseRetryAfter('2')).toBe(2000);
    expect(parseRetryAfter(null)).toBeNull();
    expect(parseRetryAfter('soon')).toBeNull();
    const now = Date.UTC(2026, 9, 5, 12, 0, 0);
    expect(parseRetryAfter('Mon, 05 Oct 2026 12:00:03 GMT', now)).toBe(3000);
  });
});

describe('docs/SERVER.md', () => {
  it('carries the exact Supabase lock store migration', () => {
    const doc = readFileSync(join(root, 'docs', 'SERVER.md'), 'utf8');
    const body = SUPABASE_LOCK_STORE_SQL.split('\n').slice(1).join('\n').trim();
    expect(doc).toContain(body);
  });
});
