/**
 * SI-419: the app's MCP scopes, declared once in `auth.scopes`. The one list
 * feeds the PRM's `scopes_supported` and the SI scope manifest (contract v1)
 * served at `/.well-known/si-mcp-scopes.json`, which SI pulls into its
 * resource registry. New or changed scopes land there as `pending` until a
 * superadmin approves them; the SDK only validates and serves.
 */
import { InvalidArgumentError } from './errors';
import { canonicalResourceUri } from './resource';

/**
 * `required`: always granted. `default`: granted when the client asks for no
 * scope (pre-ticked on the consent screen). `optional`: only when asked for.
 */
export type ScopeKind = 'required' | 'default' | 'optional';

/** One scope of the app's MCP resource, as declared in `auth.scopes` and served in the manifest. */
export interface ScopeDeclaration {
  /** `mcp:<slug>:<verb>` with the SI resource slug (`auth.resourceSlug`), e.g. `mcp:canva:runs`. Unique. */
  name: string;
  /** Consent-screen label: single-line plain text, 1 to 80 characters. */
  label: string;
  /** Consent-screen detail: single-line plain text, at most 500 characters. */
  description?: string;
  kind: ScopeKind;
}

/** The SI scope manifest (contract v1), the body of `GET /.well-known/si-mcp-scopes.json`. */
export interface ScopeManifest {
  version: 1;
  /** The app's canonical resource URI; must equal SI's `mcp_resources.resource_uri`. */
  resource: string;
  scopes: ScopeDeclaration[];
}

/** A ready-to-send answer for `GET /.well-known/si-mcp-scopes.json`. Runtime-neutral: build your own `Response` from it. */
export interface ScopeManifestResponse {
  status: 200;
  /** `Content-Type: application/json` and `Cache-Control: public, max-age=300`. */
  headers: Record<string, string>;
  /** The manifest as JSON text (at most 64 KB). */
  body: string;
}

/** What `scopeManifest()` needs: the same three fields as `auth`. */
export interface ScopeManifestInput {
  resource?: string;
  resourceSlug?: string;
  scopes?: readonly ScopeDeclaration[];
}

export const SCOPE_MANIFEST_PATH = '/.well-known/si-mcp-scopes.json';
export const SCOPE_MANIFEST_VERSION = 1;
/** Contract v1: 1 to 50 scopes per manifest. */
export const MAX_DECLARED_SCOPES = 50;
/** Contract v1: the serialized manifest is at most 64 KB. */
export const MAX_SCOPE_MANIFEST_BYTES = 64 * 1024;

const MAX_LABEL_LENGTH = 80;
const MAX_DESCRIPTION_LENGTH = 500;
const SLUG = /^[a-z0-9][a-z0-9_-]*$/;
/** "Plain text" in the contract: no control characters, so no line breaks or tabs. */
const CONTROL = /[\u0000-\u001f\u007f]/;
const KINDS: readonly ScopeKind[] = ['required', 'default', 'optional'];

const quoted = (value: unknown) => (typeof value === 'string' ? `"${value}"` : String(value));
const isPlainText = (value: unknown, max: number): value is string => typeof value === 'string' && value.length <= max && !CONTROL.test(value);

/**
 * Validate a scope declaration against the SI-419 contract (v1) and return
 * the manifest. Throws `InvalidArgumentError` naming the first rule broken.
 * `createSiServerClient` runs this at construction when `auth.scopes` is set;
 * call it yourself for a build-time check.
 */
export function scopeManifest(input: ScopeManifestInput): ScopeManifest {
  if (!input || typeof input !== 'object') throw new InvalidArgumentError('scopeManifest needs { resource, resourceSlug, scopes }');
  const { resource, resourceSlug, scopes } = input;
  if (scopes === undefined) throw new InvalidArgumentError('no scopes declared: set auth.scopes to serve the SI scope manifest');
  if (!Array.isArray(scopes) || scopes.length < 1 || scopes.length > MAX_DECLARED_SCOPES) {
    throw new InvalidArgumentError(`auth.scopes must be an array of 1 to ${MAX_DECLARED_SCOPES} scope declarations`);
  }
  if (resource === undefined) throw new InvalidArgumentError('auth.resource is required when auth.scopes is set (the canonical MCP resource URI)');
  const canonical = canonicalResourceUri(resource);
  if (resourceSlug === undefined) throw new InvalidArgumentError('auth.resourceSlug is required when auth.scopes is set (the SI resource slug, e.g. "canva")');
  if (typeof resourceSlug !== 'string' || !SLUG.test(resourceSlug)) {
    throw new InvalidArgumentError(`auth.resourceSlug ${quoted(resourceSlug)} must be the SI resource slug (lowercase letters, digits, "_" or "-", e.g. "canva")`);
  }
  const namePattern = new RegExp(`^mcp:${resourceSlug.replace(/[-]/g, '\\$&')}:[a-z0-9_]+$`);

  const seen = new Set<string>();
  let hasRequired = false;
  const out = scopes.map((raw, i): ScopeDeclaration => {
    const at = `auth.scopes[${i}]`;
    if (!raw || typeof raw !== 'object') throw new InvalidArgumentError(`${at} must be an object { name, label, description?, kind }`);
    const s = raw as Record<string, unknown>;
    if ('status' in s) throw new InvalidArgumentError(`${at} must not set status: SI owns scope status (active, pending, deprecated)`);

    if (typeof s.name !== 'string' || !namePattern.test(s.name)) {
      throw new InvalidArgumentError(`${at}.name ${quoted(s.name)} must match mcp:${resourceSlug}:<verb> (${namePattern.source})`);
    }
    if (seen.has(s.name)) throw new InvalidArgumentError(`${at}.name "${s.name}" is declared twice`);
    seen.add(s.name);

    const label = isPlainText(s.label, MAX_LABEL_LENGTH) ? s.label.trim() : '';
    if (!label) throw new InvalidArgumentError(`${at}.label must be plain text of 1 to ${MAX_LABEL_LENGTH} characters`);

    let description: string | undefined;
    if (s.description !== undefined) {
      if (!isPlainText(s.description, MAX_DESCRIPTION_LENGTH)) {
        throw new InvalidArgumentError(`${at}.description must be plain text of at most ${MAX_DESCRIPTION_LENGTH} characters`);
      }
      description = s.description.trim() || undefined;
    }

    if (!KINDS.includes(s.kind as ScopeKind)) throw new InvalidArgumentError(`${at}.kind must be "required", "default" or "optional"`);
    const kind = s.kind as ScopeKind;
    if (kind === 'required') hasRequired = true;

    // Key order as in the contract example; unknown fields are dropped.
    return description === undefined ? { name: s.name, label, kind } : { name: s.name, label, description, kind };
  });
  if (!hasRequired) throw new InvalidArgumentError('auth.scopes must declare at least one "required" scope');

  const manifest: ScopeManifest = { version: SCOPE_MANIFEST_VERSION, resource: canonical, scopes: out };
  const bytes = new TextEncoder().encode(JSON.stringify(manifest)).length;
  if (bytes > MAX_SCOPE_MANIFEST_BYTES) {
    throw new InvalidArgumentError(`auth.scopes: the manifest is ${bytes} bytes; the SI contract allows at most ${MAX_SCOPE_MANIFEST_BYTES}`);
  }
  return manifest;
}
