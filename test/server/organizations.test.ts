import { describe, expect, it } from '@jest/globals';
import { createSiServerClient, InvalidArgumentError, memoryLockStore, OrgAccessDeniedError } from '../../src/server';
import { fakeFetch, ok, silentLogger } from './helpers';

function si() {
  const fetch = fakeFetch(ok());
  return { si: createSiServerClient({ baseUrl: 'https://si.example.com', membershipKey: 'k', fetch, logger: silentLogger(), locks: memoryLockStore() }), fetch };
}

describe('organizations.resolve', () => {
  const kadiko = { id: 2, slug: 'kadiko', name: 'Kadiko', roles: ['client'], appGrant: 'organization' };

  it('resolves by slug', async () => {
    await expect(si().si.organizations.resolve(456, 'kadiko')).resolves.toEqual(kadiko);
  });

  it('resolves slugs case-insensitively and trims', async () => {
    await expect(si().si.organizations.resolve(456, ' Kadiko ')).resolves.toEqual(kadiko);
  });

  it('resolves by numeric id as a string or number', async () => {
    await expect(si().si.organizations.resolve(456, '2')).resolves.toEqual(kadiko);
    await expect(si().si.organizations.resolve(456, 29)).resolves.toMatchObject({ slug: 'supreme-group' });
  });

  it('denies orgs not in the membership, by slug or id, with the same error', async () => {
    const a = await si().si.organizations.resolve(456, 'acme').catch((e) => e);
    const b = await si().si.organizations.resolve(456, '7').catch((e) => e);
    expect(a).toBeInstanceOf(OrgAccessDeniedError);
    expect(b).toBeInstanceOf(OrgAccessDeniedError);
    expect(a.code).toBe('org_access_denied');
  });

  it('does not treat an id-looking slug as a slug', async () => {
    // "29" must match id 29, never an org whose slug is "29".
    await expect(si().si.organizations.resolve(456, '029')).resolves.toMatchObject({ id: 29 });
  });

  it('rejects empty input without calling SI', async () => {
    const { si: client, fetch } = si();
    await expect(client.organizations.resolve(456, '')).rejects.toBeInstanceOf(InvalidArgumentError);
    await expect(client.organizations.resolve(456, undefined as unknown as string)).rejects.toBeInstanceOf(InvalidArgumentError);
    expect(fetch).not.toHaveBeenCalled();
  });
});
