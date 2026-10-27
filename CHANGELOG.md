# Changelog

## 1.6.0 — 2026-10-26

Org logos for org pickers (SI-429). Additive: no existing signature or
behaviour changes. The browser entry is unchanged.

- `MembershipOrganization` gains `logoUrl: string | null`, so
  `si.membership.get`, `si.membership.requireOrg`,
  `si.organizations.resolve` and the introspection principal's
  `organizations` all carry it. It is SI's `logo_url`: the org's icon, else
  its logo, as a public absolute URL on SI's host (no session needed; allow
  that host in your `img-src` CSP), or `null` when the org has none.
- A missing `logo_url` (SI before SI-429) or a malformed one becomes `null`
  rather than failing the membership answer. Membership answers cached by an
  older SDK read back with `logoUrl: null` until they expire.

## 1.5.0 — 2026-10-16

Scope declaration and the SI scope manifest for `@supreme-ai/si-sdk/server`
(SI-419, for SI-417). Additive: no existing signature or behaviour changes.
Not a security fix. The browser entry is unchanged (`dist/index.*`
byte-identical).

### New: `auth.scopes`

- `auth: { resource, resourceSlug, scopes: [{ name, label, description?, kind }] }`
  declares the app's MCP scopes once. Validated against the SI-419 scope
  manifest contract (v1) at construction, `InvalidArgumentError` naming the
  rule: names `mcp:<resourceSlug>:<verb>` and unique; `label` single-line
  plain text of 1–80 characters; `description` optional, at most 500;
  `kind` `required | default | optional`, at least one `required`; 1–50
  scopes; serialized manifest at most 64 KB; no `status` (SI owns it).
  Text is trimmed; unknown fields are dropped. `auth.resource` and
  `auth.resourceSlug` are required with `scopes`.
- One list, served twice. `protectedResourceMetadata()` takes
  `scopes_supported` from the declaration (`auth.scopesSupported` alone
  still works; with `scopes` it must be a subset and narrows the PRM, for
  staging a scope that awaits SI approval). `si.auth.scopeManifest()`
  returns `{ version: 1, resource, scopes }` and
  `si.auth.scopeManifestResponse()` a `200` with the JSON text,
  `Content-Type: application/json` and `Cache-Control: public, max-age=300`
  for `GET /.well-known/si-mcp-scopes.json` (`SCOPE_MANIFEST_PATH`).
  Runtime-neutral, as the PRM helper.
- `si.auth.requireScope` throws `InvalidArgumentError` for a name outside
  the declaration (a typo is never a 403 step-up for a scope SI doesn't
  know). The standalone `requireScope` export is unchanged.
- New exports: `scopeManifest(input)` (the same validation, for build-time
  checks), `SCOPE_MANIFEST_PATH`, `SCOPE_MANIFEST_VERSION`,
  `MAX_DECLARED_SCOPES`, `MAX_SCOPE_MANIFEST_BYTES`; types `ScopeKind`,
  `ScopeDeclaration`, `ScopeManifest`, `ScopeManifestResponse`,
  `ScopeManifestInput`.
- SI approves manifest changes before users see them: a new scope, or a
  change to a scope's `label`, `description` or `kind`, lands in SI's
  registry as `pending` until a superadmin approves it; a removed scope
  becomes `deprecated` on approval, never deleted.

Internal: `canonicalResourceUri` moved to `src/server/resource.ts`
(re-exported unchanged). Docs: `docs/SERVER.md` (Declaring scopes), README,
`SKILL.md`.

## 1.4.0 — 2026-10-16

SI Workflow Builder actions for `@supreme-ai/si-sdk/server`: `createSiActions`
serves an app's actions to the SI hub. Additive; the browser entry is unchanged.

- `createSiActions(config)`: manifest at `/.well-known/si-actions.json`, hub
  service-token verification (scoped `aud`), input/output schema validation and
  contract errors. `baseUrl` has no default; set it per environment
  (`SI_ACTIONS_BASE_URL`).
- Manifest actions carry `read_only` (from `annotations.readOnlyHint`). The hub
  sends `X-SI-Idempotency-Key` only for write actions; `ctx.idempotencyKey` is
  `null` when absent.
- Async actions: `execution: { mode: "async" }`, `acceptSiAction()` answers 202
  with optional `job_id`, same-host `poll_url` and `estimated_seconds`; optional
  `getJob` serves `GET /si/actions/{id}/jobs/{jobId}`; `siActions.completeJob()`
  posts the result to the hub callback with the bearer token (https on
  `supremegroup.ai` or a subdomain only, or a loopback host when `hubUrl` is
  itself loopback; redirects refused; timeout, retries on network errors, 429 (honouring `Retry-After`)
  and 5xx only; any 2xx counts as delivered). `poll_url` resolves against
  `baseUrl` and must match its host and port.
- Hub token verification times out after `verifyTimeoutMs` (default 5000 ms)
  and answers `upstream_unavailable`; `hubUrl` must be https (http only for a
  loopback host).

## 1.3.0 — 2026-10-15

Token introspection and grant status for `@supreme-ai/si-sdk/server`
(SI-378 v2, for SI-375 / SI-417), built against SI's
`POST /api/oauth/introspect` and `POST /api/oauth/grants/status` (SI-411).
Additive: no existing signature or behaviour changes. Not a security fix.
The browser entry is unchanged (`dist/index.*` byte-identical).

### New: `si.auth`

- `introspect(bearer, { resource? })` returns a frozen, typed
  `IntrospectionPrincipal` (`sub`, `aud`, `scope[]`, `clientId`,
  `clientName`, `grantId`, `requestedResource`, `isSuperadmin`,
  `organizations`, `exp`, `iat`, `iss`, optional `email` / `name`).
  **Fails closed:** `active: false` → `InvalidTokenError` (`inactive`);
  `aud` ≠ the configured canonical resource → `audience_mismatch`; past
  `exp` by the local clock → `expired`; no token → `missing`. Network
  error, timeout, 5xx, malformed body → `SiUnavailableError`.
- **Cache:** `active: true` only, ≤ 60 s and never past `exp`, keyed by
  SHA-256 of the token. `active: false`, errors and aud mismatches are
  never cached. A separate in-process `memoryCache()` by default (principals
  carry email; a shared store would cost about what it saves);
  `auth.cache` overrides.
- `grantStatus(grantIds)`: `{ [id]: 'active' | 'revoked' | 'expired' | 'unknown' }`,
  deduped, chunked by 100, no partial answers. Optional `active`-only cache
  (`auth.grantStatusTtlSeconds`, default off, max 60 s).
- `requireScope(principal, scopes)` → `InsufficientScopeError` carrying
  every required scope; `challenge(err, { requestUrl })` builds the
  `401` (`resource_metadata`, `invalid_token`) / `403`
  (`insufficient_scope`, `scope="…"`) answers, and `503` + `Retry-After`
  when SI can't answer.
- `protectedResourceMetadata(requestUrl)` for
  `/.well-known/oauth-protected-resource` (root and path-suffixed):
  `authorization_servers: [issuer]`, `resource` echoes the client's query
  (`?instance=…`) on the configured origin and path.
  `resourceMetadataUrl(requestUrl)` gives the path-suffixed URL.
- Error mapping: `401` / `500 misconfigured_key` → `MisconfiguredKeyError`,
  `403 app_inactive` → `AppInactiveError`, `422` → `SiValidationError`
  (new), `429` → `SiUnavailableError` (`rate_limited`) with the new
  `retryAfterSeconds`; after a `429` the client stops calling SI until
  `Retry-After` passes (cap 60 s), still serving cached answers.

### Changed (additive)

- `scopeToolCall`, `organizations.resolve` and
  `listOrganizationsTool().handler` accept the introspection `principal`:
  the org is resolved from its `organizations`, with no membership call.
  Only principals created by `introspect` are accepted. Rev-3 behaviour is
  unchanged (explicit `organization`, banner, no `structuredContent`,
  conversation-key lock only with a key). `userId` / `clientId` became
  optional in `ScopeToolCallInput` (required when no principal is passed).
- `SiUnavailableError.message` says "SI check unavailable" (was "SI
  membership check unavailable"); membership `429` errors now carry
  `retryAfterSeconds` too.
- New config `auth`, new exports `requireScope`, `bearerChallenge`,
  `bearerToken`, `canonicalResourceUri`, `isVerifiedPrincipal`, the
  `InvalidTokenError` / `InsufficientScopeError` / `SiValidationError`
  classes and constants.
- `X-SI-Min-Server-SDK` is checked on the new endpoints as on membership.
  SI doesn't send the header yet.

Docs: `docs/SERVER.md` (Token introspection), README, `SKILL.md`.

## 1.2.1 — 2026-10-07

Fix for Claude clients (SI-378). When a tool result has
`structuredContent`, Claude passes only that object to the model and drops
the text blocks. In 1.2.0 the MCP helpers set it, so on Claude:

- `labelResult` results reached the model as `{ organization }` only: no
  data, no `[Org: ...]` banner, no detection warning.
- `errorResult` results reached the model as the error object, not the
  human-readable message.
- `listOrganizationsTool` sent its payload twice (text and structured).

Changes:

- `labelResult` returns `content: [banner, warning?, ...result.content]`
  (banner and warning are their own text blocks). It never creates or edits
  `structuredContent`. If the caller sets one, it passes through unchanged,
  without `organization`. Tools served to Claude should not set it.
- `errorResult` returns `isError: true` and one text block
  `Error (<code>): <message>`. No `structuredContent.error`; the stable code
  is in the text.
- `listOrganizationsTool` returns JSON text only.

Breaking only for callers that read `structuredContent.organization` or
`structuredContent.error` from these helpers. Docs: `docs/SERVER.md`
(No `structuredContent` for Claude).

## 1.2.0 — 2026-10-05

Adds the server-only entry `@supreme-ai/si-sdk/server` (SI-378). Not a
security fix. The browser entry (`@supreme-ai/si-sdk`) is unchanged.

### New: `@supreme-ai/si-sdk/server`

- `createSiServerClient({ baseUrl, membershipKey, ... })` for app MCP
  servers and APIs. Zero runtime dependencies; only `fetch`, Web Crypto,
  `URL`. Runs on Node 18+, Next.js (Node and Edge), Supabase edge functions
  (Deno, imported by URL pinned to a commit SHA) and Workers.
- **Membership** wraps SI's `GET /api/membership/users/{user}/organizations`
  (SI-374). Fails closed on network error, timeout, 5xx, `429` without a
  fresh cached answer, malformed body, `401`, `403 app_inactive`,
  `500 misconfigured_key`. `404 user_not_found` → `UserGoneError`. Cache caps:
  allow ≤ 300 s, deny ≤ 30 s (callers may lower, never raise).
- **Org resolution** by slug or id; **conversation-key lock**
  (`_meta["openai/session"]` → Codex header → `X-SI-Conversation`; never
  `Mcp-Session-Id`) with `memoryLockStore` and a `supabaseLockStore`
  reference adapter (SQL in `docs/SERVER.md`, verified on Postgres 16);
  **cross-org detection** (read A then write B within 15 min → warning, never
  blocks).
- **MCP helpers:** `scopeToolCall`, `labelResult` (structured org + banner),
  `annotations` presets, `listOrganizationsTool`, `errorResult` with stable
  error codes.
- **Audit:** `onAudit` hook; forwarding to SI
  (`POST /api/membership/audit-events`) is opt-in and **off by default**:
  available once SI enables the endpoint (SI-379).

### Packaging

- `exports["./server"]` (`import` / `require` / types), with `deno`,
  `workerd`, `worker` and `edge-light` conditions on the real build and a
  `browser` condition on a stub that throws "server-only".
- Server entry built against `tsconfig.server.json` (ES2022 lib, no DOM or
  Node types). New `npm run typecheck:server`.
- First test suite (`npm test`, jest).

See [docs/SERVER.md](docs/SERVER.md).

## 1.1.0 — 2026-07-03

Auth-traffic and session-continuity release. Fully backward compatible — no
config or API surface changes required in integrating apps.

### Session continuity

- **Rate limiting can no longer look like an expired session.** A `429` (or
  `5xx` / network loss) on token refresh is now treated as transient: the SDK
  schedules a single retry (honoring `Retry-After`) instead of emitting
  `tokenExpired` / calling `onTokenExpired`. A `429` on `/validate` falls back
  to a local expiry check instead of reporting a hard validation failure.
- **Silent re-auth through the parent.** In embedded mode, when the refresh
  token itself is rejected (e.g. a tab left open past the 24 h refresh-token
  lifetime), the SDK now asks the parent page to mint fresh tokens from its
  still-alive web session before declaring the session expired. Tabs idle for
  days resume invisibly as long as the user is logged in to the parent app.

### Traffic reduction

- **Timers idle in hidden tabs.** The token-refresh (10 min) and balance
  (30 s) intervals skip ticks while `document.hidden`. A `visibilitychange`
  handler catches up the token first, then the balance, the moment the tab is
  foregrounded — the user never returns to a stale token.
- **No more server-side validate on boot.** Saved tokens are checked locally
  against their `exp` claim instead of a `GET /api/jwt/validate` round-trip on
  every client construction (SPAs construct the client per mount). The server
  remains the authority: a revoked token still 401s on first use and flows
  into the existing refresh-and-retry path.
- **Single-flight refresh.** Concurrent refresh triggers (timer tick, 401
  retry, visibility catch-up) share one request.
- **`ParentIntegrator` reuses tokens.** Token responses are served from cache
  when the last mint is under 60 s old (or, in hidden tabs, while the cached
  token has >2 min of life left), concurrent child requests collapse into one
  `getJWTToken()` call, and failed fetches back off for 5 s. Children are
  never denied a token — a stale cache still triggers a live mint.

### Notes for integrators

- Pairs with server-side per-user throttles on `/api/jwt/validate`,
  `/api/ai-agents/jwt` and the session-mint endpoints (Supreme Intelligence
  app, July 2026). Older SDK versions keep working — the throttle ceilings sit
  far above legitimate cadence — but only 1.1.0 guarantees a throttled call is
  never escalated into a logout, and only 1.1.0 stops hidden-tab traffic.
