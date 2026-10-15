import { describe, expect, it } from '@jest/globals';
import { createSiActions, SiActionError, type SiActionDefinition, type SiActionRequest } from '../../src/server';
import { fakeFetch, silentLogger, type Reply } from './helpers';

const NOW = 1_800_000_000_000;

function token(claims: Record<string, unknown>): string {
  const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url');
  return `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64(claims)}.sig`;
}

const goodClaims = (over: Record<string, unknown> = {}) => ({
  type: 'service', iss: 'supreme-intelligence', aud: ['si-actions', 'si-actions:data-library'],
  exp: NOW / 1000 + 300, org_id: 18, org_slug: 'acme', user_id: 7, sub: '7',
  workflow_id: 3, run_id: 55, node_id: 'n_search', attempt: 2, ...over,
});

const verified = (claims = goodClaims()): Reply => ({ status: 200, body: { valid: true, claims } });

const search: SiActionDefinition = {
  id: 'search_library',
  name: 'Search library',
  description: 'Find records.',
  inputSchema: { type: 'object', properties: { query: { type: 'string', maxLength: 50 }, limit: { type: 'integer', minimum: 1 } }, required: ['query'], additionalProperties: false },
  outputSchema: { type: 'object', properties: { count: { type: 'integer' } }, required: ['count'] },
  annotations: { readOnlyHint: true, idempotentHint: true },
  handler: async (input, ctx) => ({ count: String(input.query).length + ctx.organizationId }),
};

function setup(replies: Reply[], actions: SiActionDefinition[] = [search]) {
  const fetch = fakeFetch(...replies);
  const si = createSiActions({
    app: 'data-library', baseUrl: 'https://library.example.com/ignored', hubUrl: 'https://hub.example.com',
    actions, fetch, logger: silentLogger(), now: () => NOW,
  });
  return { si, fetch };
}

function req(method: string, path: string, opts: { auth?: string; body?: unknown; headers?: Record<string, string> } = {}): SiActionRequest {
  const headers: Record<string, string> = { ...(opts.auth ? { authorization: `Bearer ${opts.auth}` } : {}), ...(opts.headers ?? {}) };
  return {
    method,
    url: `https://library.example.com${path}`,
    headers: { get: (n) => headers[n.toLowerCase()] ?? null },
    text: async () => (opts.body === undefined ? '' : typeof opts.body === 'string' ? opts.body : JSON.stringify(opts.body)),
  };
}

const parse = (r: { body: string }) => JSON.parse(r.body);

describe('createSiActions', () => {
  it('serves a manifest the hub importer accepts', async () => {
    const { si } = setup([verified()]);
    const res = await si.handle(req('GET', '/.well-known/si-actions.json'));
    expect(res.status).toBe(200);
    expect(res.headers['Cache-Control']).toContain('max-age');
    const m = parse(res);
    expect(m).toMatchObject({ si_actions_version: '1', app: 'data-library', base_url: 'https://library.example.com' });
    expect(m.actions[0]).toMatchObject({
      id: 'search_library',
      execution: { mode: 'sync', typical_seconds: 10, max_seconds: 120 },
      annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: true },
    });
  });

  it('runs the action with context taken from the verified token, not the body', async () => {
    let seen: unknown;
    const action = { ...search, handler: async (_i: Record<string, unknown>, ctx: unknown) => { seen = ctx; return { count: 1 }; } };
    const { si, fetch } = setup([verified()], [action]);
    const res = await si.handle(req('POST', '/si/actions/search_library', {
      auth: token(goodClaims()),
      body: { action_id: 'search_library', input: { query: 'oncology' }, context: { organization_id: 999 } },
      headers: { 'x-si-idempotency-key': '55:n_search' },
    }));
    expect(res.status).toBe(200);
    expect(parse(res)).toEqual({ status: 'completed', output: { count: 1 } });
    expect(seen).toEqual({ organizationId: 18, organizationSlug: 'acme', userId: 7, workflowId: 3, runId: 55, nodeId: 'n_search', attempt: 2, idempotencyKey: '55:n_search' });
    expect(fetch.calls[0].url).toBe('https://hub.example.com/api/verify-session-jwt');
    expect(JSON.parse(fetch.calls[0].init.body as string)).toEqual({ token: token(goodClaims()) });
  });

  it.each([
    ['missing token', undefined],
    ['session token', token(goodClaims({ type: 'access' }))],
    ['wrong issuer', token(goodClaims({ iss: 'someone' }))],
    ['wrong audience', token(goodClaims({ aud: 'other' }))],
    ['scoped to another app', token(goodClaims({ aud: ['si-actions', 'si-actions:volta'] }))],
    ['expired', token(goodClaims({ exp: NOW / 1000 - 1 }))],
    ['malformed', 'not-a-jwt'],
  ])('rejects a %s with 401 before calling the hub', async (_label, auth) => {
    const { si, fetch } = setup([verified()]);
    const res = await si.handle(req('POST', '/si/actions/search_library', { auth, body: { input: { query: 'x' } } }));
    expect(res.status).toBe(401);
    expect(parse(res).error.code).toBe('unauthenticated');
    expect(fetch.calls).toHaveLength(0);
  });

  it('accepts the legacy plain si-actions audience', async () => {
    const { si } = setup([verified(goodClaims({ aud: 'si-actions' }))]);
    const res = await si.handle(req('POST', '/si/actions/search_library', { auth: token(goodClaims({ aud: 'si-actions' })), body: { input: { query: 'x' } } }));
    expect(res.status).toBe(200);
  });

  it('maps hub verifier answers: rejected is 401, unreachable is a retryable 503, mismatched claims are 401', async () => {
    const call = (r: Reply) => setup([r]).si.handle(req('POST', '/si/actions/search_library', { auth: token(goodClaims()), body: { input: { query: 'x' } } }));
    expect((await call({ status: 401, body: { valid: false } })).status).toBe(401);
    const down = await call({ status: 502, raw: 'bad gateway' });
    expect(down.status).toBe(503);
    expect(parse(down).error.retryable).toBe(true);
    expect((await call(new Error('ECONNREFUSED'))).status).toBe(503);
    expect((await call(verified(goodClaims({ org_id: 99 })))).status).toBe(401);
  });

  it('validates input against the schema with a 422 naming the field', async () => {
    const { si } = setup([verified()]);
    const run = (input: unknown) => si.handle(req('POST', '/si/actions/search_library', { auth: token(goodClaims()), body: { input } }));
    const missing = await run({});
    expect(missing.status).toBe(422);
    expect(parse(missing).error.message).toBe('input.query: is required');
    expect(parse(await run({ query: 'x', extra: 1 })).error.details.errors).toContain('input.extra: is not allowed');
    expect(parse(await run({ query: 'x', limit: 0 })).error.message).toBe('input.limit: must be >= 1');
    expect(parse(await run({ query: 'x'.repeat(51) })).error.message).toContain('at most 50');
  });

  it('turns handler errors into contract errors and hides unexpected ones', async () => {
    const throwing = (e: unknown) => ({ ...search, handler: async () => { throw e; } });
    const run = async (e: unknown) => {
      const { si } = setup([verified()], [throwing(e)]);
      return si.handle(req('POST', '/si/actions/search_library', { auth: token(goodClaims()), body: { input: { query: 'x' } } }));
    };
    const notYours = await run(new SiActionError('validation_failed', 'Unknown record.', { field: 'record_id' }));
    expect(notYours.status).toBe(422);
    expect(parse(notYours).error).toEqual({ code: 'validation_failed', message: 'Unknown record.', retryable: false, details: { field: 'record_id' } });
    const crash = await run(new Error('db password in here'));
    expect(crash.status).toBe(500);
    expect(parse(crash).error.message).toBe('The action failed.');
  });

  it('refuses output that breaks the declared schema', async () => {
    const { si } = setup([verified()], [{ ...search, handler: async () => ({ count: 'many' }) }]);
    const res = await si.handle(req('POST', '/si/actions/search_library', { auth: token(goodClaims()), body: { input: { query: 'x' } } }));
    expect(res.status).toBe(500);
  });

  it('answers unknown actions, job polls and bad bodies with contract errors', async () => {
    const { si } = setup([verified()]);
    expect(parse(await si.handle(req('POST', '/si/actions/nope', { auth: token(goodClaims()), body: {} }))).error.code).toBe('unknown_action');
    expect((await si.handle(req('GET', '/si/actions/search_library/jobs/job_1'))).status).toBe(404);
    expect((await si.handle(req('POST', '/si/actions/search_library', { auth: token(goodClaims()), body: '{bad' }))).status).toBe(400);
    expect((await si.handle(req('POST', '/si/actions/search_library', { auth: token(goodClaims()), body: { action_id: 'other', input: { query: 'x' } } }))).status).toBe(400);
  });

  it('rejects invalid configuration', () => {
    const make = (over: Record<string, unknown>) => () => createSiActions({ app: 'data-library', baseUrl: 'https://a.example.com', hubUrl: 'https://h.example.com', actions: [search], ...over } as never);
    expect(make({ app: 'Data Library' })).toThrow('app');
    expect(make({ actions: [search, search] })).toThrow('duplicate');
    expect(make({ actions: [{ ...search, id: 'Bad-Id' }] })).toThrow('must match');
    expect(make({ hubUrl: 'not a url' })).toThrow('hubUrl');
  });
});
