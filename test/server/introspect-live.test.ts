/**
 * Live introspection against a real SI. Opt-in: set SI_TEST_INTROSPECT_KEY
 * (the app's membership_api key) and SI_TEST_BEARER (an access token issued
 * for that app's resource). Optional: SI_TEST_BASE_URL (default
 * https://v2.supremegroup.ai, staging), SI_TEST_RESOURCE (default
 * https://studio-canvas.supremegroup.ai/mcp), SI_TEST_GRANT_ID. Skipped otherwise.
 */
import { describe, expect, it } from '@jest/globals';
import { createSiServerClient, InvalidTokenError, memoryLockStore } from '../../src/server';

const key = process.env.SI_TEST_INTROSPECT_KEY;
const bearer = process.env.SI_TEST_BEARER;
const d = key && bearer ? describe : describe.skip;

d('live introspection (staging)', () => {
  const si = createSiServerClient({
    baseUrl: process.env.SI_TEST_BASE_URL ?? 'https://v2.supremegroup.ai',
    membershipKey: key ?? 'unused',
    locks: memoryLockStore(),
    timeoutMs: 10000,
    auth: { resource: process.env.SI_TEST_RESOURCE ?? 'https://studio-canvas.supremegroup.ai/mcp' },
  });

  it('introspects the bearer and caches the active answer', async () => {
    const p = await si.auth.introspect(bearer);
    expect(p.sub).toMatch(/^\d+$/);
    expect(p.grantId).toBeTruthy();
    expect(Array.isArray(p.organizations)).toBe(true);
    expect((await si.auth.introspect(bearer)).fromCache).toBe(true);
  }, 30000);

  it('an unknown token is inactive', async () => {
    await expect(si.auth.introspect('not-a-real-token-' + Date.now())).rejects.toBeInstanceOf(InvalidTokenError);
  }, 30000);

  it('grant status for the token grant (and an unknown one)', async () => {
    const p = await si.auth.introspect(bearer);
    const unknown = '00000000-0000-7000-8000-000000000000';
    const out = await si.auth.grantStatus([process.env.SI_TEST_GRANT_ID ?? p.grantId, unknown]);
    expect(out[unknown]).toBe('unknown');
  }, 30000);
});
