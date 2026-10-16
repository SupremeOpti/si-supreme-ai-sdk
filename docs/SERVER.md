# `@supreme-ai/si-sdk/server`

Server-side helpers for app MCP servers and APIs that trust Supreme Intelligence (SI) for identity, membership, roles and app grants. Since 1.2.0 (SI-378); token introspection and grant status since 1.3.0; scope declaration and the SI scope manifest since 1.5.0 (SI-419).

- **Server-only.** It holds the app's secret `membership_api` key. The browser entry (`@supreme-ai/si-sdk`) never re-exports it, and bundlers that resolve the `browser` export condition get a stub that throws `@supreme-ai/si-sdk/server is server-only`.
- **Runtime-neutral.** Only `fetch`, Web Crypto, `URL`, `TextEncoder`, `AbortController`, `setTimeout`. Runs on Node 18+, Next.js route handlers / server actions (Node and Edge runtimes), Supabase edge functions (Deno) and Workers. No runtime dependencies.
- **Fails closed.** Network error, timeout, 5xx, `429` without a fresh cached answer, malformed body, rejected or misconfigured key, inactive app: every one is a deny (a thrown error). No code path returns "allowed" without a successful SI answer.

Contents: [Install](#install) · [Configuration](#configuration) · [Identity](#identity-who-userid-is) · [Org-isolation model](#org-isolation-model-in-app-terms) · [Worked MCP tool handler](#worked-mcp-tool-handler) · [Token introspection](#token-introspection-siauth) · [Declaring scopes](#declaring-scopes) · [API](#api) · [Errors](#errors) · [Adapters](#adapters) · [Supabase lock store SQL](#supabase-lock-store) · [Audit forwarding](#audit-forwarding) · [SI endpoints used](#si-endpoints-used) · [Not in the SDK](#not-in-the-sdk) · [Version policy](#version-policy)

---

## Install

### Next.js / Node

```bash
npm install github:SupremeOpti/si-supreme-ai-sdk#<tag-or-sha>
```

```ts
import { createSiServerClient } from '@supreme-ai/si-sdk/server';
```

### Supabase edge functions (Deno)

Deno's `npm:` specifier can't install from GitHub. The server bundle has no imports, so import the built ESM by URL from jsDelivr, **pinned to a commit SHA** (tags are mutable; this is auth code):

```jsonc
// supabase/functions/deno.json (or import_map.json)
{
  "imports": {
    "@si/server": "https://cdn.jsdelivr.net/gh/SupremeOpti/si-supreme-ai-sdk@<40-char-sha>/dist/server.mjs"
  }
}
```

```ts
// @ts-types="https://cdn.jsdelivr.net/gh/SupremeOpti/si-supreme-ai-sdk@<40-char-sha>/dist/server.d.mts"
import { createSiServerClient } from '@si/server';
```

Use the SHA of a merged commit on `main` that contains the `dist/` you want. Bump it deliberately, as you would a dependency.

### Environment variables

| Variable | Used for |
|---|---|
| `SI_MEMBERSHIP_KEY` | `membershipKey`. The app's `membership_api` key from SI (`php artisan apikey:generate --purpose=membership_api --app=<app>`). Server-side secret: never ship it to a browser or forward it to MCP clients. |
| `SI_BASE_URL` (suggested name) | `baseUrl`, e.g. `https://app.supremegroup.ai`. |
| `SI_MCP_RESOURCE` (suggested name) | `auth.resource`: the app's canonical MCP resource URI as registered in SI, e.g. `https://studio-canvas.supremegroup.ai/mcp`. Only for apps whose MCP server is an SI OAuth resource. |

The SDK reads no environment variables itself; pass values in.

---

## Configuration

```ts
import { createSiServerClient, supabaseLockStore } from '@supreme-ai/si-sdk/server';

const si = createSiServerClient({
  baseUrl: 'https://app.supremegroup.ai',
  membershipKey: Deno.env.get('SI_MEMBERSHIP_KEY')!,
  locks: supabaseLockStore(serviceRoleSupabase),
});
```

```ts
interface SiServerConfig {
  baseUrl: string;                 // https only (http allowed for localhost)
  membershipKey: string;           // empty → MisconfiguredKeyError at construction
  cache?: CacheAdapter;            // default memoryCache()
  locks?: LockStoreAdapter;        // default memoryLockStore() + a warning (per-process only)
  fetch?: FetchLike;               // default global fetch
  logger?: Logger;                 // default console; { warn, error? }
  timeoutMs?: number;              // per attempt, default 3000
  membership?: {
    allowTtlSeconds?: number;      // default and max 300
    denyTtlSeconds?: number;       // default and max 30
  };
  lockTtlSeconds?: number;         // sliding, default 86400 (24 h)
  detection?: {
    enabled?: boolean;             // default true
    windowSeconds?: number;        // default 900 (15 min)
  };
  conversation?: {
    codexHeaders?: string[];       // default ['x-codex-conversation-id', 'x-codex-session-id']
    siHeader?: string;             // default 'x-si-conversation'
  };
  auth?: {                         // si.auth (1.3.0), see Token introspection
    resource?: string;             // canonical MCP resource URI; required for introspect (or pass per call)
    issuer?: string;               // PRM authorization_servers[0], default baseUrl
    cache?: CacheAdapter;          // default: a separate in-process memoryCache()
    introspectionTtlSeconds?: number;  // active:true cache, default and max 60, never past exp
    grantStatusTtlSeconds?: number;    // 'active' cache, default 0 (off), max 60
    resourceSlug?: string;         // SI resource slug, e.g. 'canva'; required with scopes
    scopes?: ScopeDeclaration[];   // the app's MCP scopes, declared once (1.5.0, see Declaring scopes)
    scopesSupported?: string[];    // PRM scopes_supported; default: the names in scopes (with scopes: a subset of them)
    resourceName?: string;         // PRM resource_name
    resourceDocumentation?: string;// PRM resource_documentation
    logoUri?: string;              // PRM logo_uri
  };
  onAudit?: (event: AuditEvent) => void | Promise<void>;
  auditForwarding?: {
    enabled?: boolean;             // default false (see Audit forwarding)
    batchSize?: number;            // default 50, max 500
    flushIntervalMs?: number;      // default 5000
  };
  now?: () => number;              // clock override for tests
}
```

TTLs above the caps are clamped down. `0` disables that cache.

---

## Identity: who `userId` is

**Apps on SI OAuth (1.3.0+):** pass the `principal` from [`si.auth.introspect`](#token-introspection-siauth) to `scopeToolCall` and `listOrganizationsTool().handler`. The SDK then takes the identity (`sub`) and the org list from SI's answer for the bearer itself, and rejects any principal object that `introspect` didn't create.

**With `userId`:** the SDK does **not** authenticate the caller. `userId` (and `principalId`) passed to `scopeToolCall`, `listOrganizationsTool().handler`, `membership.*` and `organizations.resolve` is trusted as the identity to check. It **must** come from the token your server verified for this request (the Supreme JWT `sub` captured at consent, or your own session bound to it), never from tool arguments, query strings or headers the client controls. Passing a request-supplied id would let a caller act as any SI user.

## Org-isolation model in app terms

SI's model (`mcp-org-session-isolation-plan.md`, rev 3) applies to every app MCP. The SDK implements the shared parts; the app wires them into every org-scoped tool.

1. **Explicit org on every org-scoped tool.** Add an `organization` argument that takes the org **slug** (preferred: a human approving the call can read it) or the numeric id as a string. No server-side "current org", no `select_instance`.
2. **Membership on every call.** `scopeToolCall` resolves the argument against SI's live membership answer (cached ≤ 5 min, denials ≤ 30 s), or, with a `principal`, against the introspection answer's `organizations` (cached ≤ 60 s). Unknown and not-allowed orgs get the same `org_access_denied` error.
3. **Conversation-key lock where the client sends a key.** `conversationKey()` tries `_meta["openai/session"]` (ChatGPT) → Codex conversation header → `X-SI-Conversation` (Claude Code via `headersHelper`, SI's own agents) → `null`. With a key, the first org-scoped call binds `(principal, client, sha256(key))` to that org and another org is refused (`org_locked`: "Start a new conversation to work in X"). Without a key (Claude.ai / Desktop / mobile send none) the call runs in **soft mode**: no lock. The key guards against model confusion; it is never an authorization input. **Nothing uses `Mcp-Session-Id`**: Claude shares one MCP session across every conversation, and MCP `2026-07-28` removes sessions.
4. **Org on every result.** `labelResult` puts a banner text block `[Org: Kadiko (kadiko)]` first (and the detection warning, if any, as the second block), before the tool's own blocks. Results are text-only: see [No `structuredContent` for Claude](#no-structuredcontent-for-claude).
5. **Human-visible writes.** Annotate tools with `annotations.read` / `.write` / `.destructive` so clients auto-run reads and prompt before writes. Write tools take the slug, so the approval prompt shows the org.
6. **Detect, never block.** When the same principal + client read org A and then write org B within 15 min, the write still runs and its result carries a warning line. With audit forwarding on, SI runs the same detection across all apps.
7. **The app's own duties** (the SDK can't do these): resolve every id the tool receives to its owning org and refuse a mismatch with the checked org; make derive/copy tools take references only; scope every query with `scope.organization.id` (never the raw argument) in the data layer.

On clients that send a conversation key, a conversation can't touch two orgs. On Claude.ai / Desktop / mobile that guarantee isn't available yet; items 1, 2, 4, 5 and 6 still apply.

---

## Worked MCP tool handler

A Supabase edge function serving an MCP tool `canvas_update`. The MCP framework is up to the app; only the SDK calls matter.

```ts
import {
  annotations,
  createSiServerClient,
  supabaseLockStore,
} from '@si/server';
import { createClient } from 'npm:@supabase/supabase-js@2';

const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

const si = createSiServerClient({
  baseUrl: 'https://app.supremegroup.ai',
  membershipKey: Deno.env.get('SI_MEMBERSHIP_KEY')!,
  locks: supabaseLockStore(admin),
});

export const tools = [
  si.mcp.listOrganizationsTool().definition,
  {
    name: 'canvas_update',
    description: 'Update a canvas. `organization` is the org slug from list_organizations.',
    inputSchema: {
      type: 'object',
      properties: {
        organization: { type: 'string', description: 'Org slug (preferred) or numeric id.' },
        canvas_id: { type: 'string' },
        title: { type: 'string' },
      },
      required: ['organization', 'canvas_id', 'title'],
      additionalProperties: false,
    },
    annotations: annotations.write,
  },
];

// Called by your MCP layer for tools/call. `auth` is whatever your token
// check produced: the SI user id (Supreme JWT `sub`) and the OAuth client id.
export async function callTool(
  req: Request,
  params: { name: string; arguments: Record<string, unknown>; _meta?: Record<string, unknown> },
  auth: { siUserId: number; clientId: string },
) {
  if (params.name === 'list_organizations') {
    return si.mcp.listOrganizationsTool().handler({ userId: auth.siUserId });
  }

  if (params.name === 'canvas_update') {
    try {
      const scope = await si.mcp.scopeToolCall({
        userId: auth.siUserId,
        clientId: auth.clientId,
        conversationKey: si.mcp.conversationKey({ headers: req.headers, meta: params._meta }),
        organization: String(params.arguments.organization),
        tool: 'canvas_update',
        kind: 'write',
      });

      // The canvas id must belong to the checked org (ids carry their org).
      const { data: canvas } = await admin
        .from('canvases')
        .select('id, organization_id')
        .eq('id', params.arguments.canvas_id)
        .eq('organization_id', scope.organization.id) // data-layer scoping
        .maybeSingle();
      if (!canvas) {
        return { isError: true, content: [{ type: 'text', text: 'Canvas not found in this organization.' }] };
      }

      // App permission logic on SI roles.
      if (scope.roles.some((r) => r.toLowerCase() === 'client')) {
        return { isError: true, content: [{ type: 'text', text: 'Clients cannot edit canvases.' }] };
      }

      await admin.from('canvases').update({ title: params.arguments.title }).eq('id', canvas.id);

      return si.mcp.labelResult(
        { content: [{ type: 'text', text: `Renamed canvas ${canvas.id}.` }] },
        scope,
      );
    } catch (err) {
      return si.mcp.errorResult(err);
    } finally {
      // Only matters with audit forwarding on; keeps the batch alive past the response.
      // @ts-ignore EdgeRuntime is a Supabase global
      globalThis.EdgeRuntime?.waitUntil?.(si.audit.flush());
    }
  }
}
```

Result of a write right after reading another org in soft mode:

```json
{
  "content": [
    { "type": "text", "text": "[Org: Supreme Group (supreme-group)]" },
    {
      "type": "text",
      "text": "Warning: this connection read Kadiko (kadiko) 4 min ago. Confirm nothing from Kadiko is in this write to Supreme Group (supreme-group)."
    },
    { "type": "text", "text": "Renamed canvas 81." }
  ]
}
```

Error result (`si.mcp.errorResult(err)`) for a locked conversation:

```json
{
  "isError": true,
  "content": [
    {
      "type": "text",
      "text": "Error (org_locked): This conversation is already working in Kadiko (kadiko). Start a new conversation to work in Supreme Group (supreme-group)."
    }
  ]
}
```

### No `structuredContent` for Claude

When a tool result carries `structuredContent`, Claude passes **only** that object to the model and drops the `content` text blocks. A result labelled with `structuredContent.organization` would reach the model as `{ organization }`: no data, no banner, no warning. SI's own MCP dropped `structuredContent` for the same reason.

- Tools served to Claude **should not** set `structuredContent`. Put the data in text blocks (JSON text is fine).
- `labelResult` never creates or edits `structuredContent`. If the caller sets `structuredContent`, it is passed through unchanged, without the org, so the model would not see the banner.
- `errorResult` and `listOrganizationsTool` return text only. The stable error `code` is in the text: `Error (<code>): <message>`.

---

## Token introspection (`si.auth`)

Since 1.3.0 (SI-378 v2, for SI-375 / SI-411). For an app whose MCP server is an SI OAuth **resource**: SI is the authorization server, the app mints and stores no tokens. On every MCP request the app sends the client's bearer to SI (`POST /api/oauth/introspect`, RFC 7662) with its `membership_api` key and gets back who the user is, the grant, the scopes and the orgs the user may use the app in right now. The same key authenticates it; there is no separate introspection key.

```ts
const si = createSiServerClient({
  baseUrl: 'https://app.supremegroup.ai',
  membershipKey: Deno.env.get('SI_MEMBERSHIP_KEY')!,
  locks: supabaseLockStore(admin),
  auth: {
    resource: 'https://studio-canvas.supremegroup.ai/mcp',   // mcp_resources.resource_uri, exactly
    resourceSlug: 'canva',
    scopes: CANVA_SCOPES,                                    // declared once, see Declaring scopes (1.5.0)
    resourceName: 'Studio Canvas',
  },
});

const principal = await si.auth.introspect(si.auth.bearerToken(req.headers));
si.auth.requireScope(principal, 'mcp:canva:base');
```

### What `introspect` checks

`introspect(bearer, { resource? })` returns an `IntrospectionPrincipal` or throws. It returns a principal only when **all** of these hold:

1. SI answered `200` with `active: true` and a body matching the contract (`sub` an integer string, `aud`, `iss`, `client_id`, `scope`, `grant_id`, `requested_resource` strings, `exp` / `iat` integers, `is_superadmin` boolean, `organizations` of `{id, slug, name, roles, app_grant}`). `email` and `name` are optional.
2. `aud` equals this app's canonical resource (`auth.resource`, or `{ resource }` per call), compared canonically (lowercase scheme and host, no default port, one trailing `/` stripped, query kept). SI already refuses tokens for other resources; this is defence in depth. A mismatch also logs a warning.
3. `exp` is in the future by the local clock.

| Outcome | Error | `reason` |
|---|---|---|
| No token, empty, or a bare `Bearer` | `InvalidTokenError` | `missing` (SI isn't called) |
| SI `{"active": false}` (unknown, revoked, expired, refresh token, other resource, revoked grant, ...) | `InvalidTokenError` | `inactive` |
| `aud` ≠ the configured resource | `InvalidTokenError` | `audience_mismatch` |
| `exp` passed | `InvalidTokenError` | `expired` |
| Network error, timeout (3 s), 5xx, malformed body, unexpected status | `SiUnavailableError` | `network`, `timeout`, `server_error`, `malformed_response`, `unexpected_status` |
| `429` | `SiUnavailableError` | `rate_limited`, with `retryAfterSeconds` from `Retry-After` |
| `401` (key rejected) / `500 misconfigured_key` (key has no app, or the app has no MCP resource) | `MisconfiguredKeyError` | `status` 401 / 500 |
| `403 app_inactive` | `AppInactiveError` | |
| `422 validation_failed` | `SiValidationError` | `errors` |

There is no code path that returns a principal without SI's `active: true` for this resource. Network errors and 5xx get one retry (as for membership); `500 misconfigured_key`, `422` and `429` are never retried.

**`429` and `Retry-After`.** SI allows 1200 requests per minute per key across introspection and grant status. After a `429` with `Retry-After`, the client stops calling SI for that long (capped at 60 s) and throws `rate_limited` immediately; answers already in the cache are still served. Return `503` with the same `Retry-After` to the MCP client (`si.auth.challenge` does).

### Cache

- `active: true` is cached for **at most 60 s** (`auth.introspectionTtlSeconds`, default and cap 60; callers can lower it, `0` disables), and **never past the token's `exp`**: the TTL is `min(60, exp - now)` in whole seconds, and a token with under a second left isn't cached. A revoked token, grant or org membership therefore takes effect within 60 s.
- **Never cached:** `active: false`, errors, aud mismatches. A token that was inactive a moment ago is asked about again.
- The key is `si:i:` + **SHA-256 hex of the token**. The raw token is never a key or a stored value.
- Cached answers are re-validated on read (contract shape, age ≤ TTL even if the adapter keeps entries longer, `aud`, `exp`). An adapter error is a miss, never an allow.
- Concurrent introspections of one token share one SI request.

**Store: in-process memory by default, on purpose.** The introspection cache is a separate `memoryCache()`, not `config.cache`. A shared store (a Supabase table, KV) would cost a network round trip per call, about what the SI call it saves costs, and would copy principals (which carry the user's email) into another store. Per-isolate memory only costs extra SI calls, never correctness. If you do want sharing, pass `auth.cache` (any `CacheAdapter`); keys stay hashed and the TTL rules still apply.

### The principal

```ts
interface IntrospectionPrincipal {      // frozen; only introspect creates one
  sub: string;                          // SI user id
  aud: string;                          // this app's resource
  scope: string[];                      // granted scopes
  clientId: string;                     // CIMD URL or DCR id
  clientName: string | null;
  grantId: string;                      // the connection id; stable across refreshes
  requestedResource: string;            // aud, or the query variant the client used (…/mcp?instance=broth)
  isSuperadmin: boolean;
  organizations: Array<{ id; slug; name; roles; appGrant }>;   // same shape as membership; may be empty
  exp: number; iat: number;             // Unix seconds
  iss: string;
  email?: string; name?: string;        // only when SI sends them
  fromCache: boolean;
}
```

Principals are frozen and registered: `scopeToolCall`, `organizations.resolve` and `listOrganizationsTool().handler` accept only the object `introspect` returned, so a principal assembled from request data can't be passed off as verified (`InvalidArgumentError`).

### Scopes: `requireScope` and the 403

```ts
si.auth.requireScope(principal, ['mcp:canva:base', 'mcp:canva:runs']);   // every one required
```

Throws `InsufficientScopeError` with `requiredScopes` (all of them) and `missingScopes`. `si.auth.challenge(err)` turns it into:

```
HTTP/1.1 403
WWW-Authenticate: Bearer error="insufficient_scope", scope="mcp:canva:base mcp:canva:runs", resource_metadata="https://studio-canvas.supremegroup.ai/.well-known/oauth-protected-resource/mcp"
```

The `scope` lists every scope the operation needs, not just the missing one, so the client's step-up request asks for a complete set.

With `auth.scopes` declared (1.5.0), `si.auth.requireScope` throws `InvalidArgumentError` for a name outside the declaration: a typo is a programming error, never a 403 that sends the client to step up for a scope SI doesn't know. The standalone `requireScope` export is unchanged.

### `challenge(err, { requestUrl? })`: 401 / 403 / 503

Returns `{ status, headers, body }` (runtime-neutral; build your `Response` from it):

| Error | Status | `WWW-Authenticate` |
|---|---|---|
| `InvalidTokenError` `missing` | `401` | `Bearer resource_metadata="…"` (no error code, RFC 6750 §3.1) |
| `InvalidTokenError` other | `401` | `Bearer error="invalid_token", resource_metadata="…"` |
| `InsufficientScopeError` | `403` | `Bearer error="insufficient_scope", scope="…", resource_metadata="…"` |
| any other `SiServerError` (SI down, `429`, bad key, inactive app) | `503` (+ `Retry-After` when known) | none: it isn't the token's fault, and a 401 would send the client through OAuth again |
| anything else | `500` | none |

`resource_metadata` is the path-suffixed PRM URL. Pass `requestUrl` (the MCP URL the client called) to carry its query: `…/mcp?instance=broth` → `…/.well-known/oauth-protected-resource/mcp?instance=broth`. `bearerChallenge(params)` builds the header alone.

### Protected-resource metadata (PRM)

`si.auth.protectedResourceMetadata(requestUrl?)` returns the RFC 9728 document:

```json
{
  "resource": "https://studio-canvas.supremegroup.ai/mcp?instance=broth",
  "authorization_servers": ["https://app.supremegroup.ai"],
  "bearer_methods_supported": ["header"],
  "scopes_supported": ["mcp:canva:base", "mcp:canva:storyboards", "mcp:canva:runs"],
  "resource_name": "Studio Canvas"
}
```

- `authorization_servers` is SI's issuer: `auth.issuer`, default `baseUrl`. Set it when the issuer differs from the API origin.
- `resource` **echoes the URL the client used**: the configured resource's origin and path, plus the query of `requestUrl` (`?instance=…`). Clients compare `resource` with the server URL they connected to. Origin and path always come from the configured resource, never the request, so a proxy that rewrites the host or path (Supabase functions behind a custom domain) can't change it.
- `scopes_supported` lists the names declared in `auth.scopes` (1.5.0, see [Declaring scopes](#declaring-scopes)), or `auth.scopesSupported`. `resource_name`, `resource_documentation`, `logo_uri` come from `auth.*`. All are omitted when unset.

Serve the same document at both variants (clients try the path-suffixed one first):

| URL | Variant |
|---|---|
| `GET /.well-known/oauth-protected-resource/mcp` (plus any `?instance=…`) | Path-suffixed (RFC 9728 §3.1): `/.well-known/oauth-protected-resource` + the resource path. |
| `GET /.well-known/oauth-protected-resource` | Root. |

Answer with `Content-Type: application/json` and, for browser-based clients, `Access-Control-Allow-Origin: *`.

### Declaring scopes

Since 1.5.0 (SI-419). An app declares its MCP scopes **once**, in `auth.scopes`, and the SDK serves the one list twice: as the PRM's `scopes_supported`, and as the **SI scope manifest** at `GET /.well-known/si-mcp-scopes.json`, which SI pulls into its resource registry (when the `mcp_resources` row is saved in Filament, by an artisan command, and daily). The manifest carries what the PRM has no fields for: a consent label, a description and the kind.

Studio Canvas's eight scopes (SI `docs/api/knowledge-lake-mcp-oauth.md` § Registered app resources):

```ts
import { createSiServerClient, type ScopeDeclaration } from '@supreme-ai/si-sdk/server';

const ADOBE = 'Inspect, create, edit and export content on the paired computer.';

export const CANVA_SCOPES: ScopeDeclaration[] = [
  { name: 'mcp:canva:base', label: 'Use Studio Canvas', description: 'List and read flows, create flows, add and connect nodes, read the model catalogue.', kind: 'required' },
  { name: 'mcp:canva:storyboards', label: 'Storyboards', description: 'List, read and save storyboards.', kind: 'default' },
  { name: 'mcp:canva:photoshop', label: 'Photoshop', description: ADOBE, kind: 'default' },
  { name: 'mcp:canva:indesign', label: 'InDesign', description: ADOBE, kind: 'default' },
  { name: 'mcp:canva:after_effects', label: 'After Effects', description: ADOBE, kind: 'default' },
  { name: 'mcp:canva:premiere', label: 'Premiere', description: ADOBE, kind: 'default' },
  { name: 'mcp:canva:illustrator', label: 'Illustrator', description: ADOBE, kind: 'default' },
  { name: 'mcp:canva:runs', label: 'Run generations', description: "Run nodes, which spends the organization's credits.", kind: 'default' },
];

const si = createSiServerClient({
  baseUrl: 'https://app.supremegroup.ai',
  membershipKey: Deno.env.get('SI_MEMBERSHIP_KEY')!,
  auth: {
    resource: 'https://studio-canvas.supremegroup.ai/mcp',   // mcp_resources.resource_uri
    resourceSlug: 'canva',                                   // the SI resource slug: every name is mcp:canva:<verb>
    scopes: CANVA_SCOPES,
    resourceName: 'Studio Canvas',
  },
});
```

| Field | Rule (SI-419 manifest contract v1) |
|---|---|
| `name` | `mcp:<resourceSlug>:<verb>`, `<verb>` matching `[a-z0-9_]+`. Unique. |
| `label` | Required. Single-line plain text, 1–80 characters (trimmed). SI's consent screen shows it. |
| `description` | Optional. Single-line plain text, at most 500 characters (trimmed; empty is omitted). |
| `kind` | `required` (always granted), `default` (granted when the client asks for no scope; pre-ticked on consent), `optional` (only when asked for). At least one `required`. |
| the list | 1–50 scopes; the serialized manifest at most 64 KB. No `status`: SI owns status (`active`, `pending`, `deprecated`). Other unknown fields are dropped. |

`createSiServerClient` validates the declaration at construction and throws `InvalidArgumentError` naming the broken rule (for example `auth.scopes[3].name "mcp:other:runs" must match mcp:canva:<verb> (...)`), so an invalid manifest is never served. `auth.resource` and `auth.resourceSlug` are required with `scopes`. The standalone `scopeManifest({ resource, resourceSlug, scopes })` runs the same checks and returns the manifest, for a build step or a test.

What the declaration drives:

- `si.auth.protectedResourceMetadata()` lists the declared names as `scopes_supported`, in declaration order. `auth.scopesSupported` alone still works as in 1.3.0; set together with `scopes` it must be a subset of them and narrows what the PRM advertises (see the approval note below).
- `si.auth.scopeManifest()` returns the contract JSON (below, three of the eight scopes shown). `si.auth.scopeManifestResponse()` returns `{ status: 200, headers, body }` for the well-known route: `body` is the JSON text, `headers` are `Content-Type: application/json` and `Cache-Control: public, max-age=300`. `SCOPE_MANIFEST_PATH` is `/.well-known/si-mcp-scopes.json`.
- `si.auth.requireScope(principal, scope)` throws `InvalidArgumentError` for a name outside the declaration.

```json
{
  "version": 1,
  "resource": "https://studio-canvas.supremegroup.ai/mcp",
  "scopes": [
    { "name": "mcp:canva:base", "label": "Use Studio Canvas", "description": "List and read flows, create flows, add and connect nodes, read the model catalogue.", "kind": "required" },
    { "name": "mcp:canva:storyboards", "label": "Storyboards", "description": "List, read and save storyboards.", "kind": "default" },
    { "name": "mcp:canva:runs", "label": "Run generations", "description": "Run nodes, which spends the organization's credits.", "kind": "default" }
  ]
}
```

Serve it publicly (no auth, no token) on the resource origin. In a Supabase edge function:

```ts
import { SCOPE_MANIFEST_PATH } from '@si/server';

Deno.serve(async (req) => {
  const url = new URL(req.url);
  if (req.method === 'GET' && url.pathname === SCOPE_MANIFEST_PATH) {
    const r = si.auth.scopeManifestResponse();
    return new Response(r.body, { status: r.status, headers: r.headers });
  }
  // ...PRM and MCP (see Canva-style handler)
});
```

Route `/.well-known/si-mcp-scopes.json` on the resource origin to that function the same way as the PRM paths (for Vercel, a rewrite next to the `oauth-protected-resource` ones). The manifest URL must be on the **same origin** as `resource` (https; http only for loopback in local dev and tests), and SI compares the manifest's `resource` with the row's `resource_uri` exactly, after canonicalisation. The SDK writes the canonical form of `auth.resource`.

**SI approves manifest changes before users see them.** SI never lets a manifest change what users are asked to grant on its own: a new scope, or any change to an existing scope's `label`, `description` or `kind`, lands in the registry as **pending** until a superadmin approves it in Filament; a scope removed from the manifest becomes `deprecated` on approval, never deleted, and existing grants keep working. Until approval, a pending scope is neither shown on the consent screen nor granted. So a deploy that adds a scope changes nothing for users by itself. One thing to stage: a PRM that advertises the new scope before approval can make clients that request every `scopes_supported` (Claude does) ask SI for a scope it won't grant yet. Declare the scope in `scopes` (so SI pulls it) and keep `scopesSupported` at the approved names until the superadmin approves; then drop `scopesSupported`.

### Grant status (background jobs)

```ts
const statuses = await si.auth.grantStatus(['0199a6c2-…', '0199a6c2-…']);
// { '0199a6c2-…': 'active', '0199a6c2-…': 'revoked' }
```

Wraps `POST /api/oauth/grants/status` for code that has a `grant_id` but no bearer (job workers, the SQL grant check). Statuses: `active`, `revoked`, `expired` (past the resource's `max_grant_lifetime_days`), `unknown` (no such grant **for this resource**; treat like `revoked`).

- Ids are deduped and sent in chunks of 100 (SI's limit). An empty list returns `{}` without a call. Each id must be a non-empty string of ≤ 64 chars (`InvalidArgumentError` otherwise). Ids are matched exactly (SI's grant ids are lowercase uuids).
- **No partial answers:** if any chunk fails, or SI's answer lacks a requested id or has an unknown status, the whole call throws (same error mapping as introspection).
- Optional cache for `active` only: `auth.grantStatusTtlSeconds` (default **0, off**; max 60). Other statuses are never cached.

### Canva-style handler

A Supabase edge function serving MCP as an SI resource (SI-417). The MCP framework is up to the app; only the SDK calls matter.

```ts
import { annotations, createSiServerClient, SCOPE_MANIFEST_PATH, supabaseLockStore } from '@si/server';
import { createClient } from 'npm:@supabase/supabase-js@2';
import { CANVA_SCOPES } from '../_shared/siScopes.ts';     // the eight scopes from "Declaring scopes"

const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

const si = createSiServerClient({
  baseUrl: Deno.env.get('SI_BASE_URL')!,                // https://app.supremegroup.ai
  membershipKey: Deno.env.get('SI_MEMBERSHIP_KEY')!,
  locks: supabaseLockStore(admin),
  auth: {
    resource: Deno.env.get('SI_MCP_RESOURCE')!,         // https://studio-canvas.supremegroup.ai/mcp
    resourceSlug: 'canva',
    scopes: CANVA_SCOPES,                                 // PRM scopes_supported + the SI scope manifest
    resourceName: 'Studio Canvas',
  },
});

const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...headers } });

Deno.serve(async (req) => {
  const url = new URL(req.url);

  // 0. SI scope manifest: public, cached 5 min. SI pulls it into the resource registry.
  if (req.method === 'GET' && url.pathname === SCOPE_MANIFEST_PATH) {
    const r = si.auth.scopeManifestResponse();
    return new Response(r.body, { status: r.status, headers: r.headers });
  }

  // 1. PRM, root and path-suffixed.
  if (url.pathname === '/.well-known/oauth-protected-resource' || url.pathname === '/.well-known/oauth-protected-resource/mcp') {
    return json(200, si.auth.protectedResourceMetadata(req.url), { 'Access-Control-Allow-Origin': '*' });
  }

  // 2. Every MCP request: introspect (cached ≤ 60 s), check the base scope.
  let principal;
  try {
    principal = await si.auth.introspect(si.auth.bearerToken(req.headers));
    si.auth.requireScope(principal, 'mcp:canva:base');
  } catch (err) {
    const c = si.auth.challenge(err, { requestUrl: req.url });
    return json(c.status, c.body, c.headers);
  }

  // Grant mirror for SQL and background jobs (upsert on every successful introspection).
  await admin.from('si_grants').upsert({
    grant_id: principal.grantId,
    supreme_user_id: Number(principal.sub),
    client_id: principal.clientId,
    scopes: principal.scope,
    status: 'active',
    last_introspected_at: new Date().toISOString(),
  });

  const rpc = await req.json();
  if (rpc.method !== 'tools/call') return handleOtherMcp(rpc, principal);   // your MCP layer
  const { name, arguments: args, _meta } = rpc.params;

  if (name === 'list_organizations') {
    return json(200, { jsonrpc: '2.0', id: rpc.id, result: await si.mcp.listOrganizationsTool().handler({ principal }) });
  }

  if (name === 'run_generation') {
    try {
      // Spend needs the optional scope: a missing one becomes a 403 step-up.
      si.auth.requireScope(principal, ['mcp:canva:base', 'mcp:canva:runs']);
    } catch (err) {
      const c = si.auth.challenge(err, { requestUrl: req.url });
      return json(c.status, c.body, c.headers);
    }
    try {
      // 3. Org from the introspection answer: explicit argument, no second SI call.
      const scope = await si.mcp.scopeToolCall({
        principal,                                       // userId = sub, clientId = principal.clientId
        conversationKey: si.mcp.conversationKey({ headers: req.headers, meta: _meta }),
        organization: String(args.organization),         // slug preferred
        tool: name,
        kind: 'write',
      });
      const job = await admin.from('creative_app_jobs').insert({
        organization_id: scope.organization.id,          // the checked org, never the raw argument
        grant_id: principal.grantId,                     // revoking the grant in SI stops the job
        prompt: args.prompt,
      }).select('id').single();
      const result = si.mcp.labelResult({ content: [{ type: 'text', text: `Queued job ${job.data!.id}.` }] }, scope);
      return json(200, { jsonrpc: '2.0', id: rpc.id, result });
    } catch (err) {
      return json(200, { jsonrpc: '2.0', id: rpc.id, result: si.mcp.errorResult(err) });
    }
  }
  // ...
});

// 4. Background worker: no bearer in hand, check the grants of queued jobs.
export async function claimJobs(jobs: Array<{ id: string; grant_id: string }>) {
  const status = await si.auth.grantStatus(jobs.map((j) => j.grant_id));    // throws → claim nothing
  return jobs.filter((j) => status[j.grant_id] === 'active');                // revoked / expired / unknown → drop
}
```

Notes for this flow:

- The org rules (rev 3) are unchanged: explicit `organization` argument (slug preferred), `[Org: …]` banner via `labelResult`, no `structuredContent`, conversation-key lock only where the client sends a key. Only the source of the org list changes: the principal's `organizations` instead of a membership call. Its freshness is the introspection cache's (≤ 60 s), better than membership's 5 min.
- Token errors are HTTP answers (`401` / `403`), not MCP tool errors, so the client can re-authorize or step up. Org errors stay tool errors (`errorResult`).
- `instance` from `?instance=` carries no authority: orgs come only from `principal.organizations` and the tool argument.

---

## API

All methods throw an [error class](#errors) on deny. They never return a "denied" value.

### `si.membership`

| Method | Returns | Notes |
|---|---|---|
| `get(userId)` | `Membership` | Wraps `GET /api/membership/users/{userId}/organizations`. Cached under `si:m:{userId}`: allow ≤ 300 s, empty org list and `user_not_found` ≤ 30 s. Other errors are never cached. Concurrent calls for one user share a request. |
| `requireOrg(userId, organizationId)` | `ResolvedOrganization` | Numeric id only. Throws `OrgAccessDeniedError` when absent. |
| `findOrganization(userId, match)` | `{ organization \| null, membership }` | Low-level lookup used by `requireOrg` and `organizations.resolve`. |
| `invalidate(userId)` | `void` | Drops the cached answer. |

```ts
interface Membership {
  user: { id: number };
  app: { id: number; name: string };
  isSuperadmin: boolean;
  organizations: Array<{ id: number; slug: string; name: string; roles: string[]; appGrant: 'organization' | 'role' | 'orgadmin' | 'superadmin' }>;
  generatedAt: string;   // SI meta.generated_at
  fromCache: boolean;
}
type ResolvedOrganization = Membership['organizations'][number];
```

**Refetch on a stale miss.** When the cached answer is fresh (≤ 300 s) but lacks the requested org and is older than the deny TTL (30 s), the SDK refetches once, so a user just added to an org isn't locked out for 5 minutes. If that refetch hits `429`, the cached answer is used (the contract's "serve from cache while fresh").

`userId` must be a positive integer (number or digit string), else `InvalidArgumentError`.

### `si.organizations`

| Method | Returns | Notes |
|---|---|---|
| `resolve(userIdOrPrincipal, organization)` | `ResolvedOrganization` | `organization` is a slug (case-insensitive) or numeric id (string or number). All-digit input is always an id. Unknown or not allowed → `OrgAccessDeniedError`. With a principal from `si.auth.introspect`, resolves from its `organizations` without calling SI; any other object → `InvalidArgumentError`. |

### `si.mcp`

| Method | Returns | Notes |
|---|---|---|
| `conversationKey({ headers, meta })` | `string \| null` | `meta` is the tool call's `params._meta`; `headers` is a Fetch `Headers` or a plain object. Values over 512 chars are ignored. |
| `scopeToolCall(input)` | `ToolScope` | Org resolution + membership (or the principal's orgs) + lock (or soft mode) + detection + audit, in that order. |
| `labelResult(result, scope)` | `McpToolResult` | `content` = `[banner, warning?, ...result.content]`. New object; input not mutated. Never adds `structuredContent`; a caller-set one passes through unchanged (don't set one for Claude). |
| `errorResult(err)` | `McpToolResult` | `isError: true`, one text block `Error (<code>): <message>`, no `structuredContent`. Public message only. Unknown errors → `internal_error` with a generic message. |
| `listOrganizationsTool()` | `{ definition, handler }` | Read-only tool. `handler({ userId })` or `handler({ principal })` returns `{ data: [{ organization_id, slug, name, roles, app_grant }], meta: { count } }` as JSON text only (no `structuredContent`). Errors come back as `errorResult`. |
| `annotations` | presets | Same object as the top-level `annotations` export. |

```ts
interface ScopeToolCallInput {
  principal?: IntrospectionPrincipal; // from si.auth.introspect: org list from SI's answer, no membership call
  userId?: number | string;         // or: SI user id of the VERIFIED caller (token sub), never request input
  principalId?: string;             // default String(userId) (= principal.sub)
  clientId?: string;                // OAuth client id / MCP client: keeps ChatGPT and Claude apart. Required with userId; default principal.clientId
  conversationKey: string | null;   // from conversationKey(); null → soft mode
  organization: string | number;    // the tool argument
  tool: string;                     // for audit
  kind: 'read' | 'write';
}

interface ToolScope {
  organization: { id: number; slug: string; name: string };
  roles: string[];
  appGrant: AppGrant;
  mode: 'locked' | 'soft';
  keyHash: string | null;           // sha256 hex of the key
  warning: string | null;           // detection warning on writes
  userId: string; principalId: string; clientId: string; tool: string; kind: 'read' | 'write';
}
```

Pass `principal` or `userId`. With both, `userId` must equal `principal.sub`. An expired principal throws `InvalidTokenError` (`expired`).

| Preset | `readOnlyHint` | `destructiveHint` | `idempotentHint` | `openWorldHint` |
|---|---|---|---|---|
| `annotations.read` | `true` | `false` | `true` | `false` |
| `annotations.write` | `false` | `false` | `false` | `false` |
| `annotations.destructive` | `false` | `true` | `false` | `false` |

### `si.auth`

See [Token introspection](#token-introspection-siauth).

| Method | Returns | Notes |
|---|---|---|
| `introspect(bearer, { resource? })` | `IntrospectionPrincipal` | `POST /api/oauth/introspect`. Checks `active`, `aud`, `exp`. Caches `active: true` ≤ 60 s and ≤ `exp`, keyed by SHA-256 of the token; never caches anything else. |
| `grantStatus(grantIds)` | `{ [grantId]: 'active' \| 'revoked' \| 'expired' \| 'unknown' }` | `POST /api/oauth/grants/status`, chunked by 100, deduped, no partial answers. Optional `active`-only cache. |
| `requireScope(principal, scope \| scopes)` | `void` | Throws `InsufficientScopeError` (`requiredScopes`, `missingScopes`). With `auth.scopes` declared, an undeclared name throws `InvalidArgumentError`. |
| `challenge(err, { requestUrl?, resourceMetadataUrl? })` | `{ status, headers, body }` | 401 / 403 with `WWW-Authenticate`, 503 (+ `Retry-After`) when SI couldn't answer. |
| `protectedResourceMetadata(requestUrl?)` | `ProtectedResourceMetadata` | RFC 9728 JSON; `resource` = configured resource + the request's query; `scopes_supported` from `auth.scopes` (or `auth.scopesSupported`). |
| `scopeManifest()` | `ScopeManifest` | `{ version: 1, resource, scopes }` from `auth.scopes` (1.5.0, [Declaring scopes](#declaring-scopes)). `InvalidArgumentError` without a declaration. |
| `scopeManifestResponse()` | `{ status: 200, headers, body }` | For `GET /.well-known/si-mcp-scopes.json`: the manifest as JSON text, `Content-Type: application/json`, `Cache-Control: public, max-age=300`. |
| `resourceMetadataUrl(requestUrl?)` | `string` | Path-suffixed PRM URL for `resource_metadata`. |
| `bearerToken(headers)` | `string \| null` | Token of `Authorization: Bearer …`. |

### `si.locks`

| Method | Notes |
|---|---|
| `bindOrg({ principalId, clientId, keyHash, organizationId })` | `keyHash: null` → `{ mode: 'soft' }`, store untouched. Otherwise first call binds, same org passes and slides the TTL, another org throws `OrgLockedError`. Store errors throw `LockStoreUnavailableError` (fail closed). Key: `si:lock:{principal}:{client}:{keyHash}`. |
| `release({ principalId, clientId, keyHash })` | Removes a binding. |

### `si.detection`

| Method | Notes |
|---|---|
| `recordRead(principalId, clientId, org)` | Keeps recent reads in the cache under `si:d:{principal}:{client}` for the window. |
| `checkWrite(principalId, clientId, org)` | Warning string or `null`. Never throws. |

`scopeToolCall` calls both; use them directly only for non-MCP flows.

### `si.audit`

| Member | Notes |
|---|---|
| `emit(event)` | Runs `onAudit`, then queues for SI if forwarding is on. Never throws. `scopeToolCall` emits one event per call (`outcome: 'allowed'` or the error code). |
| `flush()` | Sends queued events now. Never rejects. Pass to `waitUntil` on edge runtimes. |
| `forwarding` | `true` when forwarding is enabled. |

### Standalone exports

`conversationKey(source, options?)`, `hashConversationKey(key)`, `labelResult`, `errorResult`, `orgBanner(org)`, `annotations`, `requireScope`, `bearerChallenge(params)`, `bearerToken(headers)`, `canonicalResourceUri(uri)`, `isVerifiedPrincipal(value)`, `scopeManifest({ resource, resourceSlug, scopes })`, `memoryCache`, `memoryLockStore`, `supabaseLockStore`, `SUPABASE_LOCK_STORE_SQL`, `SERVER_SDK_VERSION`, constants (`MAX_ALLOW_TTL_SECONDS`, `MAX_DENY_TTL_SECONDS`, `DEFAULT_LOCK_TTL_SECONDS`, `DEFAULT_DETECTION_WINDOW_SECONDS`, `AUDIT_EVENTS_PATH`, `DEFAULT_CODEX_HEADERS`, `DEFAULT_SI_HEADER`, `INTROSPECT_PATH`, `GRANT_STATUS_PATH`, `PROTECTED_RESOURCE_METADATA_PATH`, `MAX_INTROSPECTION_TTL_SECONDS`, `MAX_GRANT_STATUS_TTL_SECONDS`, `GRANT_STATUS_CHUNK_SIZE`, `SCOPE_MANIFEST_PATH`, `SCOPE_MANIFEST_VERSION`, `MAX_DECLARED_SCOPES`, `MAX_SCOPE_MANIFEST_BYTES`) and all types.

---

## Errors

Every class extends `SiServerError` with a stable `code`, a `message` for logs and a `publicMessage` safe for MCP clients. The org codes match SI's MCP error codes.

| Class | `code` | When | App action |
|---|---|---|---|
| `OrgAccessDeniedError` | `org_access_denied` | Org not in the user's membership for this app, or doesn't exist. | Show the error; the model can call `list_organizations`. |
| `OrgLockedError` | `org_locked` | Conversation key already bound to another org. `lockedOrganization`, `requestedOrganization`. | Tell the user to start a new conversation. |
| `UserGoneError` | `user_not_found` | SI `404 user_not_found`. Cached ≤ 30 s. | Revoke the user's connection / tokens. |
| `SiUnavailableError` | `si_unavailable` | Network error, timeout, 5xx, `429` without fresh cache, malformed body, unexpected status. `reason`: `network`, `timeout`, `server_error`, `rate_limited`, `malformed_response`, `unexpected_status`. `retryAfterSeconds` on a `429` with `Retry-After`. | Retry later (MCP request: `503`). |
| `InvalidTokenError` | `invalid_token` | `si.auth.introspect`: no token, `active: false`, `aud` mismatch, or expired. `reason`: `missing`, `inactive`, `audience_mismatch`, `expired`. Never cached. | `401` with `resource_metadata` (`si.auth.challenge`). |
| `InsufficientScopeError` | `insufficient_scope` | `requireScope`: the token lacks a scope. `requiredScopes`, `missingScopes`. | `403 insufficient_scope` listing `requiredScopes`. |
| `SiValidationError` | `validation_failed` | SI `422` on introspection / grant status. `errors`. | Fix the caller (an SDK/contract mismatch). |
| `MisconfiguredKeyError` | `misconfigured_key` | Empty key at construction, SI `401`, or SI `500 misconfigured_key` (for introspection also: the key's app has no MCP resource). `status` tells them apart. | Alert ops; ask SI to (re)issue the key. |
| `AppInactiveError` | `app_inactive` | SI `403 app_inactive`. | The app is switched off in SI. |
| `LockStoreUnavailableError` | `lock_store_unavailable` | The lock store failed while a conversation key was present. | Retry later; check the store. |
| `InvalidArgumentError` | `invalid_argument` | Bad `userId`, empty `organization`, missing `clientId` / `tool`, bad config, no `auth.resource`, an `auth.scopes` declaration that breaks the manifest contract, a `requireScope` name outside it, a principal not created by `introspect`, bad grant ids. | Fix the caller. |

### HTTP behaviour

- Per-attempt timeout 3 s (`timeoutMs`).
- One retry with 100–300 ms jitter on network error, timeout or 5xx. A `Retry-After` up to 1 s is honoured; longer → no retry. `500 misconfigured_key` and all 4xx (including `429`) are never retried.
- `Authorization: Bearer <membershipKey>`, `Accept: application/json`.

---

## Adapters

```ts
interface CacheAdapter {
  get(key: string): Promise<unknown | undefined>;
  set(key: string, value: unknown, ttlSeconds: number): Promise<void>;   // ttlSeconds > 0
  delete(key: string): Promise<void>;
}

interface LockStoreAdapter {
  get(key: string): Promise<string | null>;
  // MUST be atomic: of racing callers on an absent/expired key, exactly one
  // gets created: true, and all get the winner's value.
  setIfAbsent(key: string, value: string, ttlSeconds: number): Promise<{ created: boolean; value: string }>;
  touch(key: string, ttlSeconds: number): Promise<boolean>;  // false when gone
  delete(key: string): Promise<void>;
}
```

- Cache read errors are treated as a miss and write errors are ignored: the cache is never needed for correctness. Values are JSON-serializable, so a KV or Redis adapter is a thin wrapper.
- `memoryCache()` is fine in production (per isolate it only costs extra SI calls).
- `memoryLockStore()` is **tests and local dev only**: locks aren't shared between processes or edge isolates. The client logs a warning when no `locks` is passed.
- Expired entries count as absent everywhere.

### Supabase lock store

`supabaseLockStore(client, { functionPrefix? })` calls four Postgres functions through `client.rpc`. Pass a client created with the **service role** key. Apply this migration first (also exported as `SUPABASE_LOCK_STORE_SQL`):

```sql
create table if not exists public.si_conversation_locks (
  key        text primary key,
  value      text not null,
  expires_at timestamptz not null
);

-- No policies: only the service role (which bypasses RLS) may touch it.
alter table public.si_conversation_locks enable row level security;

create index if not exists si_conversation_locks_expires_at_idx
  on public.si_conversation_locks (expires_at);

create or replace function public.si_lock_get(p_key text)
returns text
language sql
as $$
  select value from public.si_conversation_locks
  where key = p_key and expires_at > now();
$$;

create or replace function public.si_lock_set_if_absent(p_key text, p_value text, p_ttl_seconds integer)
returns table (created boolean, value text)
language plpgsql
as $$
#variable_conflict use_column
declare
  v_value text;
begin
  insert into public.si_conversation_locks as l (key, value, expires_at)
  values (p_key, p_value, now() + make_interval(secs => p_ttl_seconds))
  on conflict (key) do update
    set value = excluded.value, expires_at = excluded.expires_at
    where l.expires_at <= now()
  returning l.value into v_value;

  if found then
    -- Retention: each new bind purges up to 100 rows expired over a day ago.
    delete from public.si_conversation_locks
     where key in (select g.key from public.si_conversation_locks g
                    where g.expires_at < now() - interval '1 day'
                    order by g.expires_at
                    limit 100
                    for update skip locked);
    return query select true, v_value;
    return;
  end if;

  select l.value into v_value from public.si_conversation_locks l where l.key = p_key;
  return query select false, v_value;
end;
$$;

create or replace function public.si_lock_touch(p_key text, p_ttl_seconds integer)
returns boolean
language plpgsql
as $$
begin
  update public.si_conversation_locks
     set expires_at = now() + make_interval(secs => p_ttl_seconds)
   where key = p_key and expires_at > now();
  return found;
end;
$$;

create or replace function public.si_lock_delete(p_key text)
returns void
language sql
as $$
  delete from public.si_conversation_locks where key = p_key;
$$;

revoke all on table public.si_conversation_locks from public, anon, authenticated;
grant select, insert, update, delete on table public.si_conversation_locks to service_role;
revoke execute on function public.si_lock_get(text) from public, anon, authenticated;
revoke execute on function public.si_lock_set_if_absent(text, text, integer) from public, anon, authenticated;
revoke execute on function public.si_lock_touch(text, integer) from public, anon, authenticated;
revoke execute on function public.si_lock_delete(text) from public, anon, authenticated;
grant execute on function public.si_lock_get(text) to service_role;
grant execute on function public.si_lock_set_if_absent(text, text, integer) to service_role;
grant execute on function public.si_lock_touch(text, integer) to service_role;
grant execute on function public.si_lock_delete(text) to service_role;
```

**Stored data and retention.** One row per bound conversation: `key` = `si:lock:{principalId}:{clientId}:{sha256(conversation key)}`, `value` = the org id, `expires_at`. No request content, names or messages. Rows expire 24 h after last use (sliding) and are ignored once expired; each new bind deletes up to 100 rows that expired more than a day ago, so retention is bounded without pg_cron.

Atomicity: the primary key plus `INSERT ... ON CONFLICT DO UPDATE ... WHERE expired`. Of two racing first binds, the second waits on the key, sees the committed live row and gets the winner's value. The test suite runs this SQL against Postgres 16 when `SI_TEST_PG_URL` is set, including the race. With a custom `functionPrefix`, rename the functions in the migration to match.

---

## Audit forwarding

**Available once SI enables the endpoint** (it ships with SI-379). Until then leave it off (the default); `onAudit` works either way.

```ts
createSiServerClient({ ..., auditForwarding: { enabled: true } });
```

- `POST {baseUrl}/api/membership/audit-events`, `Authorization: Bearer <membershipKey>`, expects `202`.
- Batched (default 50 events or 5 s, whichever comes first), fire-and-forget, one attempt, never throws into the caller. Failures and non-2xx answers are logged via `logger.warn` and the batch is dropped.
- The raw conversation key never leaves the SDK; only `key_hash` (SHA-256 hex) is sent.
- On edge runtimes call `si.audit.flush()` inside `waitUntil` so the last batch isn't lost when the isolate freezes.

Request body:

```json
{
  "events": [
    {
      "principal_id": "456",
      "client_id": "chatgpt",
      "mode": "locked",
      "key_hash": "9f2c…64 hex",
      "organization_id": 2,
      "tool": "canvas_update",
      "kind": "write",
      "outcome": "allowed",
      "occurred_at": "2026-10-05T12:00:00.000Z"
    }
  ]
}
```

`mode` is `locked` or `soft`; `key_hash` is `null` in soft mode; `organization_id` is `null` when the call was denied before the org resolved; `outcome` is `allowed` or an [error code](#errors).

---

## SI endpoints used

| Method | Path | Contract |
|---|---|---|
| `GET` | `/api/membership/users/{user}/organizations` | SI-374, live. Response `{ data: { user: { id }, app: { id, name }, is_superadmin, organizations: [{ id, slug, name, roles, app_grant }] }, meta: { count, generated_at } }`. Errors `401`, `403 app_inactive`, `404 user_not_found`, `429`, `500 misconfigured_key`. 600 req/min per key. |
| `POST` | `/api/membership/audit-events` | SI-379, not live yet. Opt-in. |
| `POST` | `/api/oauth/introspect` | SI-411, live on main. JSON `{ token }`. `200` `{"active": false}` or the active body ([principal](#the-principal)). Errors `401`, `403 app_inactive`, `422`, `429`, `500 misconfigured_key`. `Cache-Control: no-store`. |
| `POST` | `/api/verify-session-jwt` | SI Actions (`createSiActions`). JSON `{ token }`; `200 { valid: true, claims }` confirms the hub service token's signature. `400`/`401` are final, anything else is `upstream_unavailable`. Tokens are never cached. Times out after `verifyTimeoutMs` (5s); redirects are not followed. |
| `POST` | `/api/workflows/callbacks/{run}/{node}` (the `callback_url` the hub sends) | SI Actions async results (`siActions.completeJob`). `Authorization: Bearer <callback_token>` (single use). Sent only to https on `supremegroup.ai` or a subdomain (loopback hosts only when `hubUrl` is loopback); redirects are refused. Body `{ status: "completed", job_id?, output }` or `{ status: "failed", job_id?, error: { code, message, retryable } }`. `200 { ok, accepted }` (`accepted: false` = invalid output, final); `401` bad or used token, `404`, `409 idempotency_conflict`, `410` run finished, `422` malformed. Retries network errors, 429 (`Retry-After`) and 5xx only. |
| `POST` | `/api/oauth/grants/status` | SI-411, live on main. JSON `{ grant_ids: [...] }` (1–100). `200` `{ "<id>": "active" \| "revoked" \| "expired" \| "unknown" }`. Same errors. |

Introspection and grant status share SI's `mcp-introspect` limit: 1200 requests per minute per key (separate from membership's 600). Contract: SI `docs/api/knowledge-lake-mcp-oauth.md` § Token introspection and grant status.

Served **by the app** (SI calls them, the SDK only builds the answers): `GET /.well-known/oauth-protected-resource[/<path>]` (`protectedResourceMetadata`) and `GET /.well-known/si-mcp-scopes.json` (`scopeManifestResponse`, SI-419; SI pulls it on row save, by command and daily, and a superadmin approves changes).

The SDK validates the whole `200` body (integer ids, string slug/name/app_grant, string-array roles, `data.user.id` equal to the requested user). Any mismatch is `si_unavailable` / `malformed_response`.

---

## Workflow actions (SI Actions)

`createSiActions` serves an app's actions to the SI Workflow Builder: the manifest at `/.well-known/si-actions.json`, `POST /si/actions/{id}`, and for async actions `GET /si/actions/{id}/jobs/{jobId}` plus `siActions.completeJob` for the callback. Usage, routes, token checks and the async flow are in the README under "Workflow actions (SI Actions)"; the SI endpoints it calls are in the table above.

---

## Not in the SDK

- The app's own tools and asset permission rules (built on `scope.roles`).
- Data-layer enforcement (RLS / query scoping). The SDK returns the checked org; **the app must scope its queries with `scope.organization.id`**.
- Token issuance and consent (SI is the authorization server). The SDK only introspects.
- Token passthrough: never forward the client's bearer to upstream APIs.

---

## Version policy

- Each release says in the changelog whether it contains a security fix.
- SI may send `X-SI-Min-Server-SDK` on its responses (membership, introspection, grant status). When this SDK is older, it logs one warning through `logger.warn`. As of SI main on 2026-10-15, SI doesn't send it yet.
- Apps using `si-sdk/server` are listed in the README so each release can be rolled out to them.

## Testing

```bash
npm run build && npm test                      # dist checks need a fresh build
SI_TEST_PG_URL=postgres://postgres:postgres@localhost:5432/postgres npx jest supabase-sql   # optional, real Postgres
SI_TEST_INTROSPECT_KEY=si-… SI_TEST_BEARER=… npx jest introspect-live   # optional, staging SI
```

The live introspection test defaults to `https://v2.supremegroup.ai` (staging) and the resource `https://studio-canvas.supremegroup.ai/mcp`; override with `SI_TEST_BASE_URL` / `SI_TEST_RESOURCE`. It needs the resource registered on that SI and a bearer issued for it.

Deno: the bundle is verified to import as plain ESM in Node (`node -e "import('./dist/server.mjs')"`). A Deno / Supabase edge smoke test is a follow-up for the first adopting app (si-canva, SI-380).
