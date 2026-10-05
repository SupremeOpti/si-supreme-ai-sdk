# `@supreme-ai/si-sdk/server`: shared server-side auth for app MCPs and APIs

**Linear:** SI-378 (tracker SI-376). **Status:** planned 2026-10-02, not started. Branch `michael-supreme/server-entry`.
**Related (supreme-intelligence-v2 `docs/plans/`):**
- `sub-app-membership-endpoint-plan.md` (SI-374): the membership endpoint this wraps first
- `mcp-org-session-isolation-plan.md` (rev 3): the org-isolation model these helpers implement (explicit org, conversation-key lock where available, human-visible writes, detection)
- `sub-app-mcp-oauth-federation-plan.md` (SI-375): introspection, which v2 of this entry wraps

## Why

Every sub-app will run its own MCP server and trust SI for identity, membership,
roles and app grants. The security-critical code (checking a caller, checking
org access, keeping a conversation to one org where the client allows, failing closed) must be written once.
Inside SI alone, the "can this user use org N" rule drifted into three versions.
Across N apps it would drift N ways.

## Constraints

- **Server-only.** It holds a secret `membership_api` key. It's a separate entry
  point (`@supreme-ai/si-sdk/server`), never re-exported from the browser entry.
  Importing it from a client bundle should fail loudly (see Packaging).
- **Runtime-neutral.** Only `fetch`, Web Crypto, `URL`, `Headers`. No React,
  `window`, `localStorage`, Node built-ins or runtime dependencies. It must run in:
  - Supabase edge functions (Deno). Today apps use `npm` only for the browser
    side, so Deno imports it by URL (see Distribution).
  - Next.js route handlers / server actions (Node 18+, Edge runtime).
- **Fail closed everywhere.** Network error, timeout, 5xx, 429 with no fresh cache,
  malformed response → deny. There is no code path that returns "allowed" without
  a successful SI answer.
- **Zero runtime dependencies.** Keeps URL import into Deno trivial and limits
  supply-chain exposure.

## Scope: v1 (ships with SI-374)

```ts
import {
  createSiServerClient,       // config: baseUrl, membershipKey, cache, fetch?, logger?
  OrgAccessDeniedError, OrgLockedError, SiUnavailableError,
} from '@supreme-ai/si-sdk/server';

const si = createSiServerClient({
  baseUrl: 'https://app.supremegroup.ai',
  membershipKey: Deno.env.get('SI_MEMBERSHIP_KEY')!,
  cache: memoryCache(),            // or a custom adapter (KV / Supabase table)
  locks: supabaseLockStore(supabase),  // conversation-key lock store, see below
});

// membership (wraps GET /api/membership/users/{id}/organizations)
const m = await si.membership.get(userId);         // cached: allow ≤ 5 min, deny ≤ 30 s
await si.membership.requireOrg(userId, orgId);     // throws OrgAccessDeniedError, returns { org, roles, app_grant }

// conversation key (never Mcp-Session-Id: removed in MCP 2026-07-28, shared across chats on Claude)
const key = si.mcp.conversationKey(request);   // openai/session → Codex header → X-SI-Conversation → null

// one call for a tool handler: org resolution (slug or id) + membership + lock-or-soft + label
const scope = await si.mcp.scopeToolCall({ userId, principalId, clientId, conversationKey: key, organization, kind: 'write' });
// scope.organization = { id, slug, name } → label the result
// scope.mode = 'locked' | 'soft'; scope.warning = cross-org detection warning or null
// scope.roles, scope.appGrant → feed the app's own permission logic

return si.mcp.labelResult(result, scope);   // structuredContent.organization + banner line + warning line

// ready-made MCP pieces
si.mcp.listOrganizationsTool()   // tool definition + handler, same shape as SI's list_organizations
si.mcp.errorResult(err)          // standard MCP error content for the error classes above
```

### Modules

| Module | Contents |
|---|---|
| `server/http.ts` | fetch wrapper: timeout (default 3 s), one retry on network error / 5xx with jitter, honours `Retry-After`, never retries 4xx. Bearer from config. Maps responses to typed results. |
| `server/membership.ts` | `get`, `requireOrg`. Cache keys `si:m:{userId}`. Positive TTL 300 s, negative 30 s, both capped (callers can lower, not raise). `404 user_not_found` → `UserGoneError` (app should revoke the connection). |
| `server/conversation.ts` | `conversationKey(request)`: `_meta["openai/session"]` → Codex conversation header → `X-SI-Conversation` → `null`. Treated as a guard against model confusion, never for authorization. |
| `server/locks.ts` | `bindOrg(principal, client, keyHash, orgId)` with an atomic "set if empty" contract on the adapter; mismatch → `OrgLockedError`. Sliding 24 h TTL. Skipped entirely when the key is `null` (soft mode). |
| `server/organizations.ts` | `resolveOrganization(userId, organization)`: accepts slug or id string, resolves via the membership response, returns `{id, slug, name, roles, appGrant}` or throws `OrgAccessDeniedError`. |
| `server/detection.ts` | Recent org-scoped reads per (principal, client) through the cache adapter; on a write to a different org within 15 min returns a warning string. Never throws, never blocks. |
| `server/mcp.ts` | `scopeToolCall`, `labelResult` (structured `organization` + banner + warning), `annotations.read / .write / .destructive` presets, `listOrganizationsTool`, `errorResult`. |
| `server/adapters/` | `memoryCache()` and `memoryLockStore()` (tests/dev only). Interfaces `CacheAdapter`, `LockStoreAdapter` (`get`, `setIfAbsent`, `touch`, `delete`). A `supabaseLockStore(client, table)` reference adapter with the SQL migration in docs. |
| `server/errors.ts` | `OrgAccessDeniedError`, `OrgLockedError`, `UserGoneError`, `SiUnavailableError`, `MisconfiguredKeyError`, `AppInactiveError`. Stable `code` strings, which match SI's MCP error codes. |
| `server/audit.ts` | `onAudit(event)` hook plus **forwarding to SI** (`POST /api/membership/audit-events`, same app key, batched, fire-and-forget) so SI can detect cross-org patterns **across apps**: `{ principalId, clientId, mode, keyHash, orgId, tool, kind: read|write, outcome }`. Conversation key hashed (SHA-256) before it leaves the module. |

### Explicitly not in the SDK

- The apps' own tools and their asset permission logic (canvas-level rules stay in the app).
- Data-layer enforcement (RLS / query scoping). The SDK returns the checked org;
  the app must scope its queries with it. Documented as a required step.
- Token issuance or consent. SI does that (SI-375).

## Scope: v2 (ships with SI-375 phase B)

- `si.auth.introspect(bearer)`: wraps `POST /oauth/introspect`. Returns principal,
  audience, scopes, organizations. Cache `active:true` ≤ 60 s, never cache `active:false`.
  **Checks `aud` equals this app's resource URI**, and rejects otherwise.
- `si.mcp.protectedResourceMetadata()` → JSON for `/.well-known/oauth-protected-resource`.
- `si.mcp.unauthorized()` → `401` with `WWW-Authenticate: Bearer resource_metadata="…"`.
- `scopeToolCall` accepts the introspection result directly, so membership and
  token check share one SI round-trip.
- v1 `membership.*` stays for non-MCP server jobs.

## Packaging

- `src/server/index.ts` as a second tsup entry →
  `dist/server.mjs`, `dist/server.js`, `dist/server.d.ts`.
  `package.json` `exports["./server"]` with `import`/`require`/`types`.
- Build the server entry **without** `DOM` lib (separate `tsconfig.server.json`,
  `lib: ["ES2022"]` + minimal fetch types) so a browser API slipping in fails the build.
- Client-bundle guard: `exports["./server"]` gets a `"browser": "./dist/server-browser-stub.mjs"`
  condition that throws `"@supreme-ai/si-sdk/server is server-only"` at import.
  Bundlers that resolve the `browser` condition (Vite, Next client) hit it at build/run.
- `dist/` is committed (apps install from GitHub). Rebuild and commit `dist` in the same PR.
- Bump to **1.2.0**. Browser entry unchanged.

## Distribution to Deno edge functions

Apps install the SDK from GitHub (`github:SupremeOpti/si-supreme-ai-sdk#<tag>`),
which Deno's `npm:` specifier can't use. Because the server entry has no
dependencies, edge functions import the built ESM by URL, **pinned to a commit
SHA** (tags are mutable; this is auth code):

```ts
// supabase/functions/import_map.json (or deno.json "imports")
"@si/server": "https://cdn.jsdelivr.net/gh/SupremeOpti/si-supreme-ai-sdk@<sha>/dist/server.mjs"
```

Next.js server code imports `@supreme-ai/si-sdk/server` normally. Open question
for later: publish to a registry so both runtimes use one specifier.

## Version policy

Security fixes only help apps that upgrade:
- Each release notes whether it's a security fix.
- SI's membership/introspection endpoints send an `X-SI-Min-Server-SDK` response
  header. The SDK logs a warning (via `logger`) when it's older.
- An "apps using si-sdk/server" list lives in this repo's README, and the
  release checklist bumps each one.

## Tests (first tests in this repo: jest + ts-jest are already in devDependencies)

- Fail closed: network error, timeout, 500, 429 without cache, malformed JSON,
  `misconfigured_key` → all deny.
- Cache: allow cached ≤ 5 min, deny ≤ 30 s, caller can't raise TTLs.
- `requireOrg`: org present → returns roles/app_grant; absent → `OrgAccessDeniedError`.
- `conversationKey`: each source picked up in priority order; absent → `null`.
- `bindOrg`: first binds; same org ok; other org → `OrgLockedError`; concurrent
  first binds with two orgs → exactly one wins (adapter contract test, run
  against the memory and Supabase adapters); `null` key → no lock (soft mode).
- `resolveOrganization`: slug and id both resolve; org not in membership → denied.
- detection: read A then write B within the window → warning; outside the window or same org → none; never throws.
- `scopeToolCall` happy path returns the label; every failure maps through `errorResult` with a stable `code`.
- Server bundle: assert no `window`/`document`/`localStorage` references and
  zero runtime imports in `dist/server.mjs`.
- Browser stub throws on import.

## Docs (per this repo's CLAUDE.md rules)

- README: new **Server entry** section (config, methods, adapters, errors, Deno
  import), rows in the SDK method index and Exports tables, environment
  variables (`SI_MEMBERSHIP_KEY`).
- `docs/SERVER.md`: full contract, adapter interface, the D + E model in app
  terms, a worked MCP tool handler example.
- Changelog entry (README) + `CHANGELOG.md` 1.2.0.
- `SKILL.md`: add the server entry so agents in app repos find it.

## Order

1. SI-374 endpoint contract frozen (response shape) → build v1 against it, test with a mocked fetch.
2. Integration test against staging once SI-374 is on `staging-v2`.
3. Tag 1.2.0. si-canva adopts. Base template docs point at it.
4. v2 with SI-375 phase B.
