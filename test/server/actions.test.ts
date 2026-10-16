import { describe, expect, it } from '@jest/globals';
import { acceptSiAction, createSiActions, SiActionError, type SiActionContext, type SiActionDefinition, type SiActionRequest } from '../../src/server';
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
    expect(seen).toEqual({ organizationId: 18, organizationSlug: 'acme', userId: 7, workflowId: 3, runId: 55, nodeId: 'n_search', attempt: 2, idempotencyKey: '55:n_search', callback: null });
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
    expect(make({ hubUrl: 'http://app.supremegroup.ai' })).toThrow('https');
    expect(make({ hubUrl: 'http://localhost:9999' })).not.toThrow();
  });
});

const HUB_CB = 'https://app.supremegroup.ai/api/workflows/callbacks/55/n_export';

const exportAction: SiActionDefinition = {
  id: 'export_report',
  name: 'Export report',
  description: 'Builds a report in the background.',
  inputSchema: { type: 'object', properties: { title: { type: 'string' } }, required: ['title'] },
  outputSchema: { type: 'object', properties: { url: { type: 'string' } }, required: ['url'] },
  execution: { mode: 'async' },
  handler: async () => acceptSiAction({ jobId: 'job_1', estimatedSeconds: 42.2 }),
  getJob: async (jobId, ctx) => (jobId === 'job_1' && ctx.organizationId === 18 ? { status: 'completed', output: { url: 'https://x/r.pdf' } } : null),
};

describe('read_only and idempotency', () => {
  it('emits read_only from readOnlyHint', () => {
    const write = { ...search, id: 'add_record', annotations: { readOnlyHint: false } };
    const plain = { ...search, id: 'tag_record', annotations: undefined };
    const m = setup([verified()], [search, write, plain]).si.manifest() as { actions: Array<Record<string, unknown>> };
    expect(m.actions.map((a) => a.read_only)).toEqual([true, false, false]);
  });

  it('runs a read-only action without an idempotency key, and passes null for a write action missing one', async () => {
    const seen: Array<string | null> = [];
    const write = { ...search, id: 'add_record', annotations: { readOnlyHint: false }, handler: async (_i: unknown, c: SiActionContext) => { seen.push(c.idempotencyKey); return { count: 1 }; } };
    const { si } = setup([verified()], [search, write]);
    const ro = await si.handle(req('POST', '/si/actions/search_library', { auth: token(goodClaims()), body: { input: { query: 'x' } } }));
    expect(ro.status).toBe(200);
    const w = await si.handle(req('POST', '/si/actions/add_record', { auth: token(goodClaims()), body: { input: { query: 'x' } } }));
    expect(w.status).toBe(200);
    expect(seen).toEqual([null]);
  });

  it('publishes the configured base_url, not a default', () => {
    const si = createSiActions({ app: 'data-library', baseUrl: 'http://localhost:3005', hubUrl: 'https://hub.example.com', actions: [search] });
    expect(si.manifest().base_url).toBe('http://localhost:3005');
    expect(() => createSiActions({ app: 'data-library', hubUrl: 'https://hub.example.com', actions: [search] } as never)).toThrow('baseUrl');
  });
});

describe('async actions', () => {
  const asyncBody = { input: { title: 'Q3' }, context: { callback_url: HUB_CB, callback_token: 'cbk_secret' } };

  it('declares async execution with async defaults', () => {
    const m = setup([verified()], [exportAction]).si.manifest() as { actions: Array<Record<string, unknown>> };
    expect(m.actions[0].execution).toEqual({ mode: 'async', typical_seconds: 60, max_seconds: 900 });
  });

  it('answers 202 with job_id and a same-host poll_url, and hands the handler the callback', async () => {
    let seen: SiActionContext | undefined;
    const action = { ...exportAction, handler: async (_i: unknown, c: SiActionContext) => { seen = c; return acceptSiAction({ jobId: 'job_1', estimatedSeconds: 42.2 }); } };
    const { si } = setup([verified()], [action]);
    const res = await si.handle(req('POST', '/si/actions/export_report', { auth: token(goodClaims()), body: asyncBody }));
    expect(res.status).toBe(202);
    expect(parse(res)).toEqual({ status: 'accepted', job_id: 'job_1', poll_url: 'https://library.example.com/si/actions/export_report/jobs/job_1', estimated_seconds: 43 });
    expect(seen?.callback).toEqual({ url: HUB_CB, token: 'cbk_secret' });
  });

  it('drops a poll_url on another host, resolves a relative one against the called host', async () => {
    const run = async (pollUrl: string) => {
      const action = { ...exportAction, getJob: undefined, handler: async () => acceptSiAction({ jobId: 'j', pollUrl }) };
      const { si } = setup([verified()], [action]);
      return parse(await si.handle(req('POST', '/si/actions/export_report', { auth: token(goodClaims()), body: asyncBody })));
    };
    expect(await run('https://evil.example.net/status/j')).toEqual({ status: 'accepted', job_id: 'j' });
    expect((await run('/jobs/j')).poll_url).toBe('https://library.example.com/jobs/j');
    expect(await run('https://library.example.com:8443/jobs/j')).toEqual({ status: 'accepted', job_id: 'j' });
    expect(await run('http://[bad')).toEqual({ status: 'accepted', job_id: 'j' });
  });

  it('builds the default poll_url from baseUrl, not an internal request host', async () => {
    const action = { ...exportAction, handler: async () => acceptSiAction({ jobId: 'job_1' }) };
    const { si } = setup([verified()], [action]);
    const internal = { ...req('POST', '/si/actions/export_report', { auth: token(goodClaims()), body: asyncBody }), url: 'http://127.0.0.1:3000/si/actions/export_report' };
    expect(parse(await si.handle(internal)).poll_url).toBe('https://library.example.com/si/actions/export_report/jobs/job_1');
  });

  it('refuses acceptSiAction from a sync action and an empty jobId; jobId is optional', async () => {
    const { si } = setup([verified()], [{ ...search, handler: async () => acceptSiAction({ jobId: 'j' }) }]);
    expect((await si.handle(req('POST', '/si/actions/search_library', { auth: token(goodClaims()), body: { input: { query: 'x' } } }))).status).toBe(500);
    expect(() => acceptSiAction({ jobId: '' })).toThrow('jobId');
    const bare = setup([verified()], [{ ...exportAction, handler: async () => acceptSiAction() }]).si;
    const res = await bare.handle(req('POST', '/si/actions/export_report', { auth: token(goodClaims()), body: { input: { title: 'Q3' } } }));
    expect(res.status).toBe(202);
    expect(parse(res)).toEqual({ status: 'accepted' });
  });

  it('serves job polls through getJob with token verification and output checks', async () => {
    const { si } = setup([verified()], [exportAction]);
    const poll = (id: string, auth?: string) => si.handle(req('GET', `/si/actions/export_report/jobs/${id}`, { auth }));
    expect((await poll('job_1')).status).toBe(401);
    const done = await poll('job_1', token(goodClaims()));
    expect(parse(done)).toEqual({ status: 'completed', job_id: 'job_1', output: { url: 'https://x/r.pdf' } });
    expect(parse(await poll('job_2', token(goodClaims()))).error.code).toBe('unknown_job');
    const running = setup([verified()], [{ ...exportAction, getJob: async () => ({ status: 'running' as const, progress: 0.5 }) }]).si;
    expect(parse(await running.handle(req('GET', '/si/actions/export_report/jobs/job_1', { auth: token(goodClaims()) })))).toEqual({ status: 'running', job_id: 'job_1', progress: 0.5 });
    expect(() => createSiActions({ app: 'data-library', baseUrl: 'https://a.example.com', hubUrl: 'https://h.example.com', actions: [{ ...search, getJob: exportAction.getJob }] })).toThrow('not async');
  });
});

describe('completeJob', () => {
  const cb = { url: HUB_CB, token: 'cbk_secret' };

  it('posts the completed result with the bearer token in the hub callback shape', async () => {
    const { si, fetch } = setup([{ status: 200, body: { ok: true, accepted: true } }], [exportAction]);
    const r = await si.completeJob('export_report', cb, { jobId: 'job_1', status: 'completed', output: { url: 'https://x/r.pdf' } });
    expect(r).toEqual({ delivered: true, accepted: true, status: 200 });
    expect(fetch.calls[0].url).toBe(HUB_CB);
    expect(fetch.calls[0].init.method).toBe('POST');
    expect(fetch.calls[0].init.headers).toMatchObject({ Authorization: 'Bearer cbk_secret', 'Content-Type': 'application/json' });
    expect(fetch.calls[0].init.signal).toBeDefined();
    expect(JSON.parse(fetch.calls[0].init.body as string)).toEqual({ status: 'completed', job_id: 'job_1', output: { url: 'https://x/r.pdf' } });
  });

  it('posts failures with a clipped error and reports hub-side output rejection', async () => {
    const { si, fetch } = setup([{ status: 200, body: { ok: true, accepted: false, reason: 'invalid_output', errors: ['output.url: is required'] } }], [exportAction]);
    const r = await si.completeJob('export_report', cb, { jobId: 'job_1', status: 'failed', error: { code: 'x'.repeat(80), message: 'm'.repeat(3000) } });
    expect(r).toEqual({ delivered: true, accepted: false, status: 200, code: 'invalid_output', errors: ['output.url: is required'] });
    const sent = JSON.parse(fetch.calls[0].init.body as string);
    expect(sent.status).toBe('failed');
    expect(sent.error.code).toHaveLength(64);
    expect(sent.error.message).toHaveLength(2000);
    expect(sent.error.retryable).toBe(false);
  });

  it('sends a failure instead of output that breaks the schema', async () => {
    const { si, fetch } = setup([{ status: 200, body: { ok: true, accepted: true } }], [exportAction]);
    await si.completeJob('export_report', cb, { jobId: 'job_1', status: 'completed', output: { nope: 1 } });
    expect(JSON.parse(fetch.calls[0].init.body as string)).toMatchObject({ status: 'failed', job_id: 'job_1', error: { code: 'internal_error' } });
  });

  it.each([
    [401, 'unauthenticated'], [404, 'unknown_job'], [409, 'idempotency_conflict'], [410, 'gone'],
  ])('treats HTTP %s as final', async (status, code) => {
    const once = setup([{ status, body: { error: { code, message: 'x' } } }], [exportAction]);
    expect(await once.si.completeJob('export_report', cb, { status: 'completed', output: { url: 'u' } }, { retries: 3 })).toEqual({ delivered: false, accepted: false, status, code });
    expect(once.fetch.calls).toHaveLength(1);
  });

  it('does not retry an accepted:false answer', async () => {
    const { si, fetch } = setup([{ status: 200, body: { ok: true, accepted: false, reason: 'invalid_output', errors: ['e'] } }], [exportAction]);
    expect((await si.completeJob('export_report', cb, { status: 'completed', output: { url: 'u' } })).accepted).toBe(false);
    expect(fetch.calls).toHaveLength(1);
  });

  it('retries 5xx, 429 and network errors', async () => {
    const race = setup([{ status: 503, raw: 'down' }, new Error('ECONNRESET'), { status: 200, body: { ok: true, accepted: true } }], [exportAction]);
    const r = await race.si.completeJob('export_report', cb, { status: 'completed', output: { url: 'u' } }, { retries: 2 });
    expect(r.delivered).toBe(true);
    expect(race.fetch.calls).toHaveLength(3);
  }, 10_000);

  it('honours Retry-After on 429 and treats any 2xx as delivered', async () => {
    const { si, fetch } = setup([{ status: 429, raw: '', headers: { 'Retry-After': '0' } }, { status: 204, raw: '' }], [exportAction]);
    const t = Date.now();
    const r = await si.completeJob('export_report', cb, { status: 'completed', output: { url: 'u' } }, { retries: 1 });
    expect(r).toEqual({ delivered: true, accepted: true, status: 204 });
    expect(fetch.calls).toHaveLength(2);
    expect(Date.now() - t).toBeLessThan(400);
  });

  it('times out a hung hub and gives up after the retries', async () => {
    const { si, fetch } = setup(['hang'], [exportAction]);
    const r = await si.completeJob('export_report', cb, { status: 'completed', output: { url: 'u' } }, { timeoutMs: 20, retries: 0 });
    expect(r).toEqual({ delivered: false, accepted: false, status: 0, code: 'upstream_unavailable' });
    expect(fetch.calls).toHaveLength(1);
  });

  it('sends callbacks only to supremegroup.ai over https, or to localhost', async () => {
    const { si, fetch } = setup([{ status: 200, body: { ok: true, accepted: true } }, { status: 200, body: { ok: true, accepted: true } }, { status: 200, body: { ok: true, accepted: true } }], [exportAction]);
    const ok = { status: 'completed' as const, output: { url: 'u' } };
    for (const url of ['http://app.supremegroup.ai/cb', 'https://hub.example.com/cb', 'https://supremegroup.ai.evil.com/cb', 'https://evilsupremegroup.ai/cb', 'https://10.0.0.5/cb']) {
      await expect(si.completeJob('export_report', { url, token: 't' }, ok)).rejects.toThrow('supremegroup.ai');
    }
    expect((await si.completeJob('export_report', { url: 'https://v2.supremegroup.ai/api/workflows/callbacks/1/n', token: 't' }, ok)).delivered).toBe(true);
    await expect(si.completeJob('export_report', { url: HUB_CB, token: '' }, ok)).rejects.toThrow('token');
    expect((await si.completeJob('export_report', { url: 'http://localhost:8000/api/workflows/callbacks/1/n', token: 't' }, ok)).delivered).toBe(true);
    expect((await si.completeJob('export_report', { url: 'http://127.0.0.1:8000/cb', token: 't' }, ok)).delivered).toBe(true);
    expect(fetch.calls).toHaveLength(3);
  });

  it('refuses to follow a redirect with the bearer token', async () => {
    const { si, fetch } = setup([{ status: 302, raw: '', headers: { Location: 'https://evil.example.net/' } }], [exportAction]);
    const r = await si.completeJob('export_report', cb, { status: 'completed', output: { url: 'u' } });
    expect(r).toEqual({ delivered: false, accepted: false, status: 302, code: 'redirect_refused' });
    expect(fetch.calls).toHaveLength(1);
    expect(fetch.calls[0].init.redirect).toBe('manual');
  });
});

describe('createSiActions token verification', () => {
  it('times out a hung hub verifier and answers upstream_unavailable', async () => {
    const fetch = fakeFetch('hang');
    const si = createSiActions({ app: 'data-library', baseUrl: 'https://library.example.com', hubUrl: 'https://hub.example.com', actions: [search], fetch, logger: silentLogger(), now: () => NOW, verifyTimeoutMs: 20 });
    const res = await si.handle(req('POST', '/si/actions/search_library', { auth: token(goodClaims()), body: { input: { query: 'x' } } }));
    expect(res.status).toBe(503);
    expect(parse(res).error.code).toBe('upstream_unavailable');
    expect(fetch.calls[0].init.redirect).toBe('manual');
  });
});
