# Changelog

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
