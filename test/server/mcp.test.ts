import { describe, expect, it, jest } from '@jest/globals';
import {
  AppInactiveError,
  annotations,
  createSiServerClient,
  errorResult,
  hashConversationKey,
  InvalidArgumentError,
  labelResult,
  LockStoreUnavailableError,
  memoryCache,
  memoryLockStore,
  MisconfiguredKeyError,
  OrgAccessDeniedError,
  OrgLockedError,
  SiUnavailableError,
  UserGoneError,
  type AuditEvent,
  type ScopeToolCallInput,
  type SiServerConfig,
} from '../../src/server';
import { clock, fakeFetch, ok, silentLogger, type Reply } from './helpers';

function setup(replies: Reply[] = [ok()], extra: Partial<SiServerConfig> = {}) {
  const c = clock();
  const events: AuditEvent[] = [];
  const fetch = fakeFetch(...replies);
  const si = createSiServerClient({
    baseUrl: 'https://si.example.com',
    membershipKey: 'k',
    fetch,
    logger: silentLogger(),
    now: c.now,
    cache: memoryCache({ now: c.now }),
    locks: memoryLockStore({ now: c.now }),
    onAudit: (e) => {
      events.push(e);
    },
    ...extra,
  });
  return { si, c, events, fetch };
}

const call = (over: Partial<ScopeToolCallInput> = {}): ScopeToolCallInput => ({
  userId: 456,
  clientId: 'chatgpt',
  conversationKey: null,
  organization: 'kadiko',
  tool: 'canvas_list',
  kind: 'read',
  ...over,
});

describe('scopeToolCall', () => {
  it('soft mode happy path returns the checked org, roles and grant', async () => {
    const { si, events } = setup();
    const scope = await si.mcp.scopeToolCall(call());
    expect(scope).toEqual({
      organization: { id: 2, slug: 'kadiko', name: 'Kadiko' },
      roles: ['client'],
      appGrant: 'organization',
      mode: 'soft',
      keyHash: null,
      warning: null,
      userId: '456',
      principalId: '456',
      clientId: 'chatgpt',
      tool: 'canvas_list',
      kind: 'read',
    });
    expect(events).toEqual([
      {
        principalId: '456',
        clientId: 'chatgpt',
        mode: 'soft',
        keyHash: null,
        organizationId: 2,
        tool: 'canvas_list',
        kind: 'read',
        outcome: 'allowed',
        occurredAt: '2026-10-05T12:00:00.000Z',
      },
    ]);
  });

  it('locked mode binds the conversation and blocks another org', async () => {
    const { si, events } = setup();
    const key = 'oa-session-1';
    const first = await si.mcp.scopeToolCall(call({ conversationKey: key }));
    expect(first.mode).toBe('locked');
    expect(first.keyHash).toBe(await hashConversationKey(key));

    await expect(si.mcp.scopeToolCall(call({ conversationKey: key, kind: 'write' }))).resolves.toMatchObject({ mode: 'locked' });

    const err = await si.mcp.scopeToolCall(call({ conversationKey: key, organization: 'supreme-group' })).catch((e) => e);
    expect(err).toBeInstanceOf(OrgLockedError);
    expect(err.lockedOrganization).toEqual({ id: 2, slug: 'kadiko', name: 'Kadiko' });
    expect(err.publicMessage).toBe(
      'This conversation is already working in Kadiko (kadiko). Start a new conversation to work in Supreme Group (supreme-group).'
    );

    // A different conversation can use the other org.
    await expect(si.mcp.scopeToolCall(call({ conversationKey: 'oa-session-2', organization: 'supreme-group' }))).resolves.toMatchObject({
      organization: { id: 29 },
    });

    const denied = events.find((e) => e.outcome === 'org_locked')!;
    expect(denied).toMatchObject({ mode: 'locked', organizationId: 29, keyHash: await hashConversationKey(key) });
    // The raw key never reaches audit.
    expect(JSON.stringify(events)).not.toContain('oa-session-1');
  });

  it('adds the detection warning to cross-org writes in soft mode, without blocking', async () => {
    const { si, c } = setup();
    await si.mcp.scopeToolCall(call({ organization: 'kadiko', kind: 'read' }));
    c.advance(120);
    const scope = await si.mcp.scopeToolCall(call({ organization: 'supreme-group', kind: 'write', tool: 'canvas_update' }));
    expect(scope.warning).toContain('read Kadiko (kadiko) 2 min ago');
  });

  it('audits and rethrows denials', async () => {
    const { si, events } = setup();
    await expect(si.mcp.scopeToolCall(call({ organization: 'acme' }))).rejects.toBeInstanceOf(OrgAccessDeniedError);
    expect(events[0]).toMatchObject({ outcome: 'org_access_denied', organizationId: null });
  });

  it('requires clientId and tool', async () => {
    const { si, fetch } = setup();
    await expect(si.mcp.scopeToolCall(call({ clientId: '' }))).rejects.toBeInstanceOf(InvalidArgumentError);
    await expect(si.mcp.scopeToolCall(call({ tool: ' ' }))).rejects.toBeInstanceOf(InvalidArgumentError);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('fails closed when the lock store is down and a key is present', async () => {
    const down = {
      get: async () => {
        throw new Error('down');
      },
      setIfAbsent: async () => {
        throw new Error('down');
      },
      touch: async () => false,
      delete: async () => undefined,
    };
    const { si } = setup([ok()], { locks: down });
    await expect(si.mcp.scopeToolCall(call({ conversationKey: 'k1' }))).rejects.toBeInstanceOf(LockStoreUnavailableError);
    await expect(si.mcp.scopeToolCall(call({ conversationKey: null }))).resolves.toMatchObject({ mode: 'soft' });
  });

  it('a lock to an org the user lost names only its id', async () => {
    const { si, c } = setup([ok(), ok(456, [{ id: 29, slug: 'supreme-group', name: 'Supreme Group', roles: [], app_grant: 'role' }])]);
    await si.mcp.scopeToolCall(call({ conversationKey: 'k' }));
    c.advance(301);
    const err = await si.mcp.scopeToolCall(call({ conversationKey: 'k', organization: 'supreme-group' })).catch((e) => e);
    expect(err).toBeInstanceOf(OrgLockedError);
    expect(err.lockedOrganization).toEqual({ id: 2 });
    expect(err.publicMessage).toContain('organization 2');
  });

  it('a throwing onAudit hook does not break the call', async () => {
    const { si } = setup([ok()], {
      onAudit: () => {
        throw new Error('hook bug');
      },
    });
    await expect(si.mcp.scopeToolCall(call())).resolves.toBeTruthy();
  });
});

describe('labelResult', () => {
  const scope = { organization: { id: 2, slug: 'kadiko', name: 'Kadiko' }, warning: null };

  it('puts the banner first, keeps the original blocks after it, adds no structuredContent', () => {
    const input = { content: [{ type: 'image', data: 'x' }, { type: 'text', text: 'hello' }] };
    const out = labelResult(input, scope);
    expect(out.content).toEqual([
      { type: 'text', text: '[Org: Kadiko (kadiko)]' },
      { type: 'image', data: 'x' },
      { type: 'text', text: 'hello' },
    ]);
    expect('structuredContent' in out).toBe(false);
    // input untouched
    expect(input.content).toEqual([{ type: 'image', data: 'x' }, { type: 'text', text: 'hello' }]);
  });

  it('passes caller-provided structuredContent through untouched', () => {
    const structured = { items: [1] };
    const out = labelResult({ content: [{ type: 'text', text: 'hello' }], structuredContent: structured }, scope);
    expect(out.structuredContent).toEqual({ items: [1] });
    expect(out.structuredContent).not.toHaveProperty('organization');
    expect(structured).toEqual({ items: [1] });
  });

  it('adds the warning as its own block after the banner', () => {
    const out = labelResult({ content: [{ type: 'text', text: 'done' }] }, { ...scope, warning: 'Warning: x' });
    expect(out.content).toEqual([
      { type: 'text', text: '[Org: Kadiko (kadiko)]' },
      { type: 'text', text: 'Warning: x' },
      { type: 'text', text: 'done' },
    ]);
  });

  it('labels an empty result with the banner alone', () => {
    const out = labelResult({ content: [] }, scope);
    expect(out.content).toEqual([{ type: 'text', text: '[Org: Kadiko (kadiko)]' }]);
    expect('structuredContent' in out).toBe(false);
  });

  it('keeps unknown result fields', () => {
    const out = labelResult({ content: [{ type: 'text', text: 'a' }], _meta: { x: 1 }, isError: false }, scope);
    expect(out._meta).toEqual({ x: 1 });
    expect(out.isError).toBe(false);
  });
});

describe('errorResult', () => {
  const cases: Array<[Error, string]> = [
    [new OrgAccessDeniedError('acme'), 'org_access_denied'],
    [new OrgLockedError({ id: 2, slug: 'kadiko', name: 'Kadiko' }, { id: 29, slug: 'sg', name: 'SG' }), 'org_locked'],
    [new UserGoneError(456), 'user_not_found'],
    [new SiUnavailableError('timeout'), 'si_unavailable'],
    [new MisconfiguredKeyError('x', 401), 'misconfigured_key'],
    [new AppInactiveError(), 'app_inactive'],
    [new LockStoreUnavailableError('x'), 'lock_store_unavailable'],
    [new InvalidArgumentError('bad'), 'invalid_argument'],
    [new Error('db password is hunter2'), 'internal_error'],
  ];

  it.each(cases)('%s → %s', (err, code) => {
    const r = errorResult(err);
    expect(r.isError).toBe(true);
    expect('structuredContent' in r).toBe(false);
    expect(r.content).toHaveLength(1);
    expect(r.content[0].text).toMatch(new RegExp(`^Error \\(${code}\\): `));
    // operator detail never leaks
    expect(JSON.stringify(r)).not.toContain('hunter2');
    expect(JSON.stringify(r)).not.toContain('HTTP');
  });

  it('org_locked names the locked org in the text', () => {
    const r = errorResult(new OrgLockedError({ id: 2, slug: 'kadiko', name: 'Kadiko' }, { id: 29, slug: 'sg', name: 'SG' }));
    expect(r.content[0].text).toContain('Kadiko (kadiko)');
  });

  it('every scopeToolCall failure maps to a stable code', async () => {
    const failures: Array<[Reply[], Partial<ScopeToolCallInput>, string]> = [
      [[ok()], { organization: 'acme' }, 'org_access_denied'],
      [[{ status: 404, body: { error: 'user_not_found' } }], {}, 'user_not_found'],
      [[{ status: 500 }], {}, 'si_unavailable'],
      [[{ status: 401 }], {}, 'misconfigured_key'],
      [[{ status: 403, body: { error: 'app_inactive' } }], {}, 'app_inactive'],
      [[ok()], { userId: 'nope' }, 'invalid_argument'],
    ];
    for (const [replies, over, code] of failures) {
      const { si } = setup(replies);
      const err = await si.mcp.scopeToolCall(call(over)).catch((e) => e);
      expect(si.mcp.errorResult(err).content[0].text).toMatch(new RegExp(`^Error \\(${code}\\): `));
    }
  });
});

describe('annotations', () => {
  it('presets are correct and frozen', () => {
    expect(annotations.read).toEqual({ readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false });
    expect(annotations.write).toMatchObject({ readOnlyHint: false, destructiveHint: false });
    expect(annotations.destructive).toMatchObject({ readOnlyHint: false, destructiveHint: true });
    expect(Object.isFrozen(annotations.read)).toBe(true);
    expect(() => {
      (annotations.read as { readOnlyHint: boolean }).readOnlyHint = false;
    }).toThrow();
  });
});

describe('listOrganizationsTool', () => {
  it('has a read-only definition and returns SI-shaped data', async () => {
    const { si } = setup();
    const tool = si.mcp.listOrganizationsTool();
    expect(tool.definition.name).toBe('list_organizations');
    expect(tool.definition.annotations).toBe(annotations.read);
    expect(tool.definition.inputSchema).toEqual({ type: 'object', properties: {}, additionalProperties: false });
    const result = await tool.handler({ userId: 456 });
    const expected = {
      data: [
        { organization_id: 2, slug: 'kadiko', name: 'Kadiko', roles: ['client'], app_grant: 'organization' },
        { organization_id: 29, slug: 'supreme-group', name: 'Supreme Group', roles: ['orgadmin'], app_grant: 'role' },
      ],
      meta: { count: 2 },
    };
    expect('structuredContent' in result).toBe(false);
    expect(result.content).toHaveLength(1);
    expect(JSON.parse(result.content[0].text!)).toEqual(expected);
  });

  it('returns an error result instead of throwing', async () => {
    const { si } = setup([{ status: 500 }]);
    const result = await si.mcp.listOrganizationsTool().handler({ userId: 456 });
    expect(result.isError).toBe(true);
    expect('structuredContent' in result).toBe(false);
    expect(result.content[0].text).toMatch(/^Error \(si_unavailable\): /);
  });
});

describe('conversationKey via the client', () => {
  it('uses configured header names', () => {
    const { si } = setup([ok()], { conversation: { siHeader: 'x-app-conv' } });
    expect(si.mcp.conversationKey({ headers: { 'x-app-conv': 'z' } })).toBe('z');
    expect(si.mcp.conversationKey({ headers: { 'x-si-conversation': 'z' } })).toBeNull();
  });
});

jest.setTimeout(20000);
