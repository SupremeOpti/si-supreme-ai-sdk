/**
 * SI-419: apps declare their MCP scopes once (`auth.scopes`). The declaration
 * feeds the PRM's `scopes_supported` and the SI scope manifest served at
 * `/.well-known/si-mcp-scopes.json` (contract v1).
 */
import { describe, expect, it } from '@jest/globals';
import {
  createSiServerClient,
  InsufficientScopeError,
  InvalidArgumentError,
  MAX_DECLARED_SCOPES,
  MAX_SCOPE_MANIFEST_BYTES,
  memoryLockStore,
  requireScope,
  SCOPE_MANIFEST_PATH,
  scopeManifest,
  type ScopeDeclaration,
  type SiServerConfig,
} from '../../src/server';
import { fakeFetch, silentLogger } from './helpers';

const RESOURCE = 'https://studio-canvas.supremegroup.ai/mcp';
const ADOBE = 'Inspect, create, edit and export content on the paired computer.';

/** Studio Canvas's eight scopes (SI docs/api/knowledge-lake-mcp-oauth.md § Registered app resources). */
const CANVA: ScopeDeclaration[] = [
  { name: 'mcp:canva:base', label: 'Use Studio Canvas', description: 'List and read flows, create flows, add and connect nodes, read the model catalogue.', kind: 'required' },
  { name: 'mcp:canva:storyboards', label: 'Storyboards', description: 'List, read and save storyboards.', kind: 'default' },
  { name: 'mcp:canva:photoshop', label: 'Photoshop', description: ADOBE, kind: 'default' },
  { name: 'mcp:canva:indesign', label: 'InDesign', description: ADOBE, kind: 'default' },
  { name: 'mcp:canva:after_effects', label: 'After Effects', description: ADOBE, kind: 'default' },
  { name: 'mcp:canva:premiere', label: 'Premiere', description: ADOBE, kind: 'default' },
  { name: 'mcp:canva:illustrator', label: 'Illustrator', description: ADOBE, kind: 'default' },
  { name: 'mcp:canva:runs', label: 'Run generations', description: "Run nodes, which spends the organization's credits.", kind: 'default' },
];
const NAMES = CANVA.map((s) => s.name);

type Auth = NonNullable<SiServerConfig['auth']>;

function client(auth: Auth) {
  return createSiServerClient({
    baseUrl: 'https://si.example.com',
    membershipKey: 'k',
    fetch: fakeFetch({ status: 200, body: {} }),
    logger: silentLogger(),
    locks: memoryLockStore(),
    auth,
  });
}

const declared = (over: Partial<Auth> = {}) => client({ resource: RESOURCE, resourceSlug: 'canva', scopes: CANVA, ...over });
const construct = (scopes: unknown, over: Partial<Auth> = {}) => () => client({ resource: RESOURCE, resourceSlug: 'canva', scopes: scopes as ScopeDeclaration[], ...over });
const base = (over: Record<string, unknown>) => ({ ...CANVA[0], ...over }) as ScopeDeclaration;
const many = (n: number, description?: string): ScopeDeclaration[] =>
  Array.from({ length: n }, (_, i) => ({ name: `mcp:canva:s${i}`, label: `Scope ${i}`, ...(description === undefined ? {} : { description }), kind: i === 0 ? 'required' : 'optional' }));

describe('scope declaration: contract v1 rules at construction', () => {
  it('accepts the Canva declaration', () => {
    expect(() => declared()).not.toThrow();
  });

  it('scopes must be an array of 1 to 50 declarations', () => {
    expect(MAX_DECLARED_SCOPES).toBe(50);
    expect(construct([])).toThrow(InvalidArgumentError);
    expect(construct([])).toThrow(/1 to 50/);
    expect(construct('mcp:canva:base')).toThrow(InvalidArgumentError);
    expect(construct(many(51))).toThrow(/1 to 50/);
    expect(construct(many(50))).not.toThrow();
  });

  it('needs auth.resource and auth.resourceSlug alongside auth.scopes', () => {
    expect(() => client({ resourceSlug: 'canva', scopes: CANVA })).toThrow(InvalidArgumentError);
    expect(() => client({ resourceSlug: 'canva', scopes: CANVA })).toThrow(/auth\.resource is required/);
    expect(() => client({ resource: RESOURCE, scopes: CANVA })).toThrow(/auth\.resourceSlug is required/);
  });

  it('resourceSlug is a lowercase slug', () => {
    expect(construct(CANVA, { resourceSlug: 'Canva' })).toThrow(/auth\.resourceSlug/);
    expect(construct(CANVA, { resourceSlug: 'mcp:canva:' })).toThrow(/auth\.resourceSlug/);
    expect(construct([base({ name: 'mcp:canva-2:base' })], { resourceSlug: 'canva-2' })).not.toThrow();
  });

  it('names match ^mcp:<slug>:[a-z0-9_]+$ with the declared slug', () => {
    for (const name of ['mcp:other:base', 'mcp:canva:Base', 'mcp:canva:', 'mcp:canva:a-b', 'canva:base', 'mcp:canva:base:x', ' mcp:canva:base', 123, undefined]) {
      expect(construct([base({ name })])).toThrow(InvalidArgumentError);
    }
    expect(construct([base({ name: 'mcp:other:base' })])).toThrow(/scopes\[0\]\.name "mcp:other:base" must match mcp:canva:<verb>/);
    expect(construct([base({ name: 'mcp:canva:after_effects2' })])).not.toThrow();
  });

  it('names are unique', () => {
    expect(construct([CANVA[0], { ...CANVA[1], name: 'mcp:canva:base' }])).toThrow(/scopes\[1\]\.name "mcp:canva:base" is declared twice/);
  });

  it('label is single-line plain text of 1 to 80 characters', () => {
    for (const label of [undefined, '', '   ', 'x'.repeat(81), 'two\nlines', 'tab\there', 42]) {
      expect(construct([base({ label })])).toThrow(InvalidArgumentError);
    }
    expect(construct([base({ label: '' })])).toThrow(/scopes\[0\]\.label must be plain text of 1 to 80 characters/);
    expect(construct([base({ label: 'x'.repeat(80) })])).not.toThrow();
  });

  it('description is optional single-line plain text of at most 500 characters', () => {
    for (const description of ['x'.repeat(501), 'two\nlines', 42, null]) {
      expect(construct([base({ description })])).toThrow(InvalidArgumentError);
    }
    expect(construct([base({ description: 'x'.repeat(501) })])).toThrow(/scopes\[0\]\.description must be plain text of at most 500 characters/);
    expect(construct([base({ description: 'x'.repeat(500) })])).not.toThrow();
    expect(construct([base({ description: undefined })])).not.toThrow();
  });

  it('kind is required, default or optional', () => {
    expect(construct([base({ kind: 'always' })])).toThrow(/scopes\[0\]\.kind must be "required", "default" or "optional"/);
    expect(construct([base({ kind: undefined })])).toThrow(InvalidArgumentError);
    expect(construct([base({ kind: 'optional' }), { ...CANVA[1], kind: 'required' }])).not.toThrow();
  });

  it('at least one scope is required', () => {
    expect(construct(CANVA.map((s) => ({ ...s, kind: 'default' as const })))).toThrow(/at least one "required" scope/);
  });

  it('status is SI-owned and refused', () => {
    expect(construct([base({ status: 'active' })])).toThrow(/scopes\[0\] must not set status/);
  });

  it('the serialized manifest must fit in 64 KB', () => {
    expect(MAX_SCOPE_MANIFEST_BYTES).toBe(65536);
    // 50 descriptions of 500 three-byte characters: within the character limits, over the byte limit.
    expect(construct(many(50, '€'.repeat(500)))).toThrow(/65536/);
    expect(construct(many(50, 'x'.repeat(500)))).not.toThrow();
  });

  it('an explicit scopesSupported must be a subset of the declaration', () => {
    expect(construct(CANVA, { scopesSupported: ['mcp:canva:base', 'mcp:canva:nope'] })).toThrow(/auth\.scopesSupported.*mcp:canva:nope/);
    expect(construct(CANVA, { scopesSupported: ['mcp:canva:base'] })).not.toThrow();
  });
});

describe('si.auth.scopeManifest()', () => {
  it('returns the contract JSON: version 1, the canonical resource, the declared scopes', () => {
    const manifest = declared().auth.scopeManifest();
    expect(manifest).toEqual({ version: 1, resource: RESOURCE, scopes: CANVA });
    expect(JSON.stringify(manifest).startsWith('{"version":1,"resource":"https://studio-canvas.supremegroup.ai/mcp","scopes":[{"name":"mcp:canva:base","label":"Use Studio Canvas","description":"')).toBe(true);
    expect(JSON.stringify(manifest.scopes[0]).endsWith('","kind":"required"}')).toBe(true);
  });

  it('canonicalises the resource', () => {
    expect(declared({ resource: 'HTTPS://Studio-Canvas.supremegroup.ai:443/mcp/' }).auth.scopeManifest().resource).toBe(RESOURCE);
  });

  it('emits only name, label, description and kind; trims text; omits an empty description', () => {
    const si = client({
      resource: RESOURCE,
      resourceSlug: 'canva',
      scopes: [
        { name: 'mcp:canva:base', label: '  Use Studio Canvas ', kind: 'required', icon: 'x' } as ScopeDeclaration,
        { name: 'mcp:canva:runs', label: 'Run generations', description: '   ', kind: 'default' },
      ],
    });
    expect(si.auth.scopeManifest().scopes).toEqual([
      { name: 'mcp:canva:base', label: 'Use Studio Canvas', kind: 'required' },
      { name: 'mcp:canva:runs', label: 'Run generations', kind: 'default' },
    ]);
    expect('description' in si.auth.scopeManifest().scopes[0]).toBe(false);
  });

  it('returns a fresh copy on every call', () => {
    const si = declared();
    const a = si.auth.scopeManifest();
    a.scopes[0].label = 'changed';
    a.scopes.pop();
    expect(si.auth.scopeManifest()).toEqual({ version: 1, resource: RESOURCE, scopes: CANVA });
  });

  it('without a declaration → InvalidArgumentError naming auth.scopes', () => {
    const si = client({ resource: RESOURCE, scopesSupported: NAMES });
    expect(() => si.auth.scopeManifest()).toThrow(InvalidArgumentError);
    expect(() => si.auth.scopeManifest()).toThrow(/auth\.scopes/);
    expect(() => si.auth.scopeManifestResponse()).toThrow(InvalidArgumentError);
  });

  it('the standalone scopeManifest() applies the same rules (build-time checks)', () => {
    expect(scopeManifest({ resource: RESOURCE, resourceSlug: 'canva', scopes: CANVA })).toEqual(declared().auth.scopeManifest());
    expect(() => scopeManifest({ resource: RESOURCE, resourceSlug: 'canva', scopes: [] })).toThrow(InvalidArgumentError);
    expect(() => scopeManifest({ resource: RESOURCE, resourceSlug: 'other', scopes: CANVA })).toThrow(/mcp:other:<verb>/);
    expect(() => scopeManifest({ resource: 'http://studio-canvas.supremegroup.ai/mcp', resourceSlug: 'canva', scopes: CANVA })).toThrow(/https/);
  });
});

describe('si.auth.scopeManifestResponse()', () => {
  it('serves the manifest body with the contract headers', () => {
    const si = declared();
    const r = si.auth.scopeManifestResponse();
    expect(r.status).toBe(200);
    expect(r.headers).toEqual({ 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=300' });
    expect(r.body).toBe(JSON.stringify(si.auth.scopeManifest()));
    expect(JSON.parse(r.body)).toEqual({ version: 1, resource: RESOURCE, scopes: CANVA });
  });

  it('the well-known path is a constant', () => {
    expect(SCOPE_MANIFEST_PATH).toBe('/.well-known/si-mcp-scopes.json');
  });
});

describe('PRM scopes_supported', () => {
  it('lists every declared scope name, in declaration order', () => {
    expect(declared().auth.protectedResourceMetadata().scopes_supported).toEqual(NAMES);
    expect(declared().auth.protectedResourceMetadata(`${RESOURCE}?instance=broth`).scopes_supported).toEqual(NAMES);
  });

  it('an explicit scopesSupported without a declaration still works (1.3.0)', () => {
    const si = client({ resource: RESOURCE, scopesSupported: ['mcp:canva:base', 'mcp:canva:runs'] });
    expect(si.auth.protectedResourceMetadata().scopes_supported).toEqual(['mcp:canva:base', 'mcp:canva:runs']);
  });

  it('an explicit scopesSupported narrows what the PRM advertises, not the manifest', () => {
    const si = declared({ scopesSupported: ['mcp:canva:base', 'mcp:canva:runs'] });
    expect(si.auth.protectedResourceMetadata().scopes_supported).toEqual(['mcp:canva:base', 'mcp:canva:runs']);
    expect(si.auth.scopeManifest().scopes).toHaveLength(8);
  });

  it('no scopes anywhere → no scopes_supported (1.3.0)', () => {
    expect(client({ resource: RESOURCE }).auth.protectedResourceMetadata().scopes_supported).toBeUndefined();
  });
});

describe('si.auth.requireScope with a declaration', () => {
  const principal = { scope: ['mcp:canva:base', 'mcp:canva:storyboards'] };

  it('checks declared scopes as in 1.3.0', () => {
    const si = declared();
    expect(() => si.auth.requireScope(principal, 'mcp:canva:base')).not.toThrow();
    expect(() => si.auth.requireScope(principal, ['mcp:canva:base', 'mcp:canva:runs'])).toThrow(InsufficientScopeError);
  });

  it('an undeclared name is a programming error, never a 403 step-up', () => {
    const si = declared();
    expect(() => si.auth.requireScope(principal, 'mcp:canva:run')).toThrow(InvalidArgumentError);
    expect(() => si.auth.requireScope(principal, ['mcp:canva:base', 'mcp:canva:run'])).toThrow(/"mcp:canva:run" is not a declared scope/);
    expect(() => si.auth.requireScope(principal, 'mcp:canva:run')).not.toThrow(InsufficientScopeError);
  });

  it('without a declaration any name is accepted (1.3.0)', () => {
    const si = client({ resource: RESOURCE });
    expect(() => si.auth.requireScope(principal, 'mcp:canva:run')).toThrow(InsufficientScopeError);
  });

  it('the standalone requireScope is unchanged', () => {
    expect(() => requireScope(principal, 'mcp:canva:run')).toThrow(InsufficientScopeError);
  });
});
