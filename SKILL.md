---
name: supreme-ai-sdk
description: Install, configure, and integrate `@supreme-ai/si-sdk` (Supreme Intelligence SDK) in a consumer app — JWT auth, credits, AI agents, personas, reports, iframe embedding. TRIGGER when the user is installing this SDK fresh, wiring it into an existing app, or hitting issues with conflicting auth systems (Supabase, NextAuth, Auth0, Firebase, Clerk, Gmail OAuth) or Lovable-scaffolded projects. Also use when the user mentions "Supreme Intelligence", `app.supremegroup.ai`, JWT login conflicts, iframe/parent postMessage problems, or credits/agents/reports/personas integration.
---

# Supreme AI SDK integration skill

You are helping a developer install or work in an app that uses `@supreme-ai/si-sdk`. The SDK is the **sole owner** of authentication, tokens, and user identity. Most install bugs come from a second auth system fighting it.

Authoritative reference: the SDK's own [README.md](https://github.com/SupremeOpti/si-supreme-ai-sdk#readme). Prefer it for endpoint shapes, method signatures, and response examples. This skill covers install posture, conflict avoidance, and dev-loop ergonomics that the README doesn't.

---

## 1. Mental model (read first)

- The SDK runs in one of two **modes**:
  - **Standalone** — the app is not in an iframe. Users log in via `login(email, password)`. Tokens live in `localStorage` under prefix `creditSystem_`.
  - **Embedded** — the app is hosted in an iframe inside Supreme Group (e.g. `app.supremegroup.ai`). The parent posts a JWT to the child via `postMessage`. `login()` is **blocked**.
  - Mode is auto-detected (`mode: 'auto'`) by checking `window !== window.parent`. Override with `mode: 'standalone'` or `mode: 'embedded'` for dev.
- The SDK uses a JWT issued by Supreme Group's auth service. Every REST call sends `Authorization: Bearer <access_token>`. There is **no Supabase, no NextAuth, no OAuth provider** in the loop — the SDK fully owns the session.
- It exposes credits, AI agents, personas, and reports as both a React hook (`useCreditSystem`) and an imperative client (`CreditSystemClient`).

If the dev's mental model is "I'll add Supreme on top of my existing auth," correct them: the SDK replaces the auth layer for any feature that touches Supreme APIs. Co-existing with a separate, unrelated auth system (e.g. Supabase only for your own RLS tables, completely walled off from Supreme calls) is possible but rarely worth the complexity — recommend picking one.

---

## 2. Install

```bash
npm install github:SupremeOpti/si-supreme-ai-sdk
```

Peer deps: `react` and `react-dom`. Skip them only if the consumer is pure-Node and uses `CreditSystemClient` / `ReportsClient` directly.

If the consumer is on a strict CI that blocks GitHub-protocol installs, switch to an HTTPS tarball URL or a pinned commit SHA (`github:SupremeOpti/si-supreme-ai-sdk#<sha>`) — never assume the registry has it.

---

## 3. Required environment variables

Vite consumer (`.env.local`):

```env
VITE_SUPREME_AI_API_BASE_URL=https://app.supremegroup.ai/api/secure-credits/jwt
VITE_SUPREME_AI_AUTH_URL=https://app.supremegroup.ai/api/jwt
VITE_SUPREME_AI_AGENTS_API_BASE_URL=https://app.supremegroup.ai/api/ai-agents/jwt
VITE_ALLOWED_PARENTS=https://app.supremegroup.ai,https://v2.supremegroup.ai
VITE_DEBUG=true
```

Next.js consumer: same values, prefix with `NEXT_PUBLIC_` instead of `VITE_`, and pipe them through your config layer.

Reports base URL is **derived** from `apiBaseUrl` — don't set `reportsApiBaseUrl` unless the reports service lives on a different host.

`allowedOrigins` is a **security boundary** in embedded mode. The SDK refuses postMessages from origins not on this list. If embedding is in scope, this must include every legitimate parent origin and nothing else. `*` is never acceptable.

---

## 4. Auth conflict avoidance (the most common install failure)

Before adding the SDK to a project, audit the existing app for auth systems and disable any that touch the same surfaces. The symptoms of a conflict are: silent 401s, infinite refresh loops, two competing redirects to `/login`, the SDK initializing as `isAuthenticated: false` even after a successful login, or tokens vanishing from storage between renders.

### 4.1 Supabase Auth — the biggest offender

Lovable-scaffolded projects, Bolt, Cursor templates, and most Next.js + Supabase starters ship with Supabase Auth pre-wired. Disable it for any route or component that uses Supreme features.

Concretely:

- **Remove `@supabase/auth-helpers-*` and `@supabase/auth-ui-react`** from routes that render Supreme features. Their session hooks (`useSession`, `useUser`) will fight with `useCreditSystem`.
- **Drop `SessionContextProvider`** from the React tree above any component that uses the SDK, or scope it to the routes that genuinely need Supabase Auth.
- **Disable Supabase middleware** (`middleware.ts` in Next.js) on Supreme routes — it will redirect away unauthenticated visitors before the SDK's own auth has a chance to run.
- **Storage key collision:** Supabase stores its session under `sb-*` keys in `localStorage`. The SDK uses `creditSystem_*`. They don't collide by default, but if a previous integration changed `storagePrefix` to something `sb-`-ish, fix it.
- **Two cookies, two sources of truth:** if both systems set auth cookies on the same domain, the wrong one will win on refresh. Pick one.

If the dev insists on keeping Supabase for non-auth purposes (Postgres, storage, realtime), that's fine — only disable `supabase.auth.*` flows.

### 4.2 NextAuth / Auth.js, Clerk, Auth0, Firebase Auth, Lucia

Same rule: remove them from the surface that uses Supreme features, or remove them entirely. The SDK is not a sub-provider — it owns the session.

If the dev needs a fallback "log in with Google" for non-Supreme parts of the app, sandbox it to a separate subdomain or a separate route group with its own provider tree. Do not interleave.

### 4.3 Gmail / Google OAuth flows

If the app has Gmail OAuth (e.g. to read mail, send via Gmail API), that's an **authorization** flow, not authentication. Keep it — but make sure:

- It does not redirect the user away from a route while the SDK is mid-init.
- It does not store its access token under a key that overlaps `creditSystem_*`.
- The "logged in" UX is driven by `useCreditSystem().isAuthenticated`, not by the presence of a Google token.

### 4.4 Lovable-scaffolded projects specifically

When the dev says "I'm working in a Lovable project" or you see `supabase/` directories alongside a Lovable-generated `App.tsx`:

1. Identify the Supabase auth surface: typically `src/integrations/supabase/`, a `SessionContextProvider`, and `useSession`/`useUser` hooks scattered through pages.
2. Replace the auth gate (`if (!session) return <Auth />`) with the SDK's gate (`if (!isAuthenticated) return <Login />` or rely on embedded mode).
3. Remove the Supabase `<Auth />` UI component.
4. Keep the Supabase data client (`createClient`) only if the app actually queries Postgres/storage tables it owns.
5. Re-run the app and confirm `useCreditSystem` reports `isInitialized: true` and `mode` matches expectations.

---

## 5. Local dev setup

The SDK has no built-in "auth bypass" flag. There are three practical paths for local development. Recommend in order:

### 5.1 Standalone mode with a real dev account (recommended default)

Force standalone so the SDK doesn't try to negotiate with a (nonexistent) parent frame:

```ts
useCreditSystem({
  apiBaseUrl: import.meta.env.VITE_SUPREME_AI_API_BASE_URL,
  authUrl: import.meta.env.VITE_SUPREME_AI_AUTH_URL,
  mode: import.meta.env.DEV ? 'standalone' : 'auto',
  debug: import.meta.env.DEV,
});
```

Then `await login(devEmail, devPassword)` once on app mount in dev. Cache the credentials in a non-committed `.env.local`:

```env
VITE_DEV_LOGIN_EMAIL=dev@example.com
VITE_DEV_LOGIN_PASSWORD=...
VITE_DEV_AUTO_LOGIN=true
```

```ts
useEffect(() => {
  if (import.meta.env.VITE_DEV_AUTO_LOGIN === 'true' && !isAuthenticated && isInitialized) {
    login(import.meta.env.VITE_DEV_LOGIN_EMAIL, import.meta.env.VITE_DEV_LOGIN_PASSWORD);
  }
}, [isInitialized, isAuthenticated]);
```

`.gitignore` must include `.env.local`. Never check dev credentials into the repo. Never wire this flag for production builds — guard it with `import.meta.env.DEV` (Vite) or `process.env.NODE_ENV !== 'production'` (Next.js).

### 5.2 Inject an existing JWT for SDK-only testing

If the dev already has a valid JWT (e.g. from `sessionStorage.supreme_access_token` in a Supreme tab), they can hand it to the SDK by seeding storage before init, or use the imperative client directly. This is what the repo's own `scripts/test-reports.mjs` does via `SUPREME_JWT` and `ORGANIZATION_ID` env vars — point devs at that pattern for headless / CLI testing.

### 5.3 Simulate embedded mode locally

If the embedded-mode behavior is what needs testing, run the app inside an iframe served from a separate origin and write a tiny parent page that posts `JWT_TOKEN_RESPONSE`. The `ParentIntegrator` export is the supported way to do this. Add the local parent origin to `VITE_ALLOWED_PARENTS`.

Do **not** mock the SDK or stub `isAuthenticated` to `true` in dev — that mask hides real init bugs (mode detection, token refresh, organization selection) until production.

---

## 6. Configuration cheatsheet

| Field | Use when |
|-------|----------|
| `mode: 'standalone'` | Local dev outside an iframe, or any non-Supreme host |
| `mode: 'embedded'` | Forced iframe behavior (rare; usually let auto-detect handle it) |
| `allowedOrigins` | Embedded mode — every legitimate parent origin |
| `features.credits/personas/reports` | Set `false` to skip init of features the app does not use |
| `storagePrefix` | Change only if multiple SDK instances coexist on the same origin |
| `balanceRefreshInterval: 0` | Disable polling if balance UI is not visible |
| `tokenRefreshInterval` | Lower in dev only to reproduce refresh bugs |
| `debug: true` | Always on in dev; off in prod |
| `deepLinking: true` | Embedded SPAs that want the parent to track route changes |

The full type is in the SDK's [Configuration reference](https://github.com/SupremeOpti/si-supreme-ai-sdk#configuration-reference) section of the README.

---

## 7. Wire-up checklist

When installing fresh, complete in this order and verify each step before moving on:

1. `npm install` succeeds and `node_modules/@supreme-ai/si-sdk` exists.
2. `.env` (or `.env.local`) has all four `VITE_SUPREME_*` (or `NEXT_PUBLIC_SUPREME_*`) values.
3. Conflicting auth providers are removed or scoped away from Supreme routes (see §4).
4. The app renders `useCreditSystem` or `CreditSystemProvider` at or above every Supreme-consuming component.
5. With `debug: true`, the console shows mode detection, token storage, and either a successful login (standalone) or a successful `JWT_TOKEN_RESPONSE` (embedded).
6. `isInitialized` flips to `true` and `isAuthenticated` reflects the real session state.
7. A single SDK call (`checkBalance()` is the cheapest) returns `{ success: true, balance: <number> }`.
8. If reports/personas are in scope, exercise one method each and confirm a normalized `{ success: true, ... }` response.

If any step fails, stop and diagnose before continuing — most failures cascade.

---

## 8. Diagnosing common failures

| Symptom | Likely cause |
|---------|--------------|
| `isAuthenticated: false` immediately after a successful `login()` | A second auth system clearing/overwriting tokens. Check `localStorage` for `creditSystem_*` keys and for stray `sb-*` / `next-auth.*` keys updating on the same tick. |
| Infinite refresh loop, app keeps re-rendering | Two providers both reacting to storage events. Likely `SessionContextProvider` (Supabase) alongside `CreditSystemProvider`. |
| 401 on every credits call despite a fresh login | `apiBaseUrl` is wrong, or a CORS-blocked `Authorization` header (check the network tab for the preflight). |
| `mode` stuck on `embedded` in local dev | The app is running inside an iframe (Storybook, devtools preview, Lovable embed). Force `mode: 'standalone'`. |
| `mode` stuck on `standalone` in production iframe | Parent origin not in `allowedOrigins`. Add it. |
| `getAgents()` returns empty array | The selected organization has no agents for the user's role IDs. Try `getAgents(true)` to confirm. |
| `createReport()` returns 403 from server | JWT user is not the creator on update, or the org switch didn't propagate. Re-verify `selectedOrganization.id`. |
| postMessage warnings about origin mismatch in console | `allowedOrigins` does not include the parent's exact origin (protocol + host + port). |

When the dev reports a bug, ask them to re-run with `debug: true` and share the first ~50 lines of console output before guessing.

---

## 9. What this SDK does NOT do

Tell the dev plainly if they expect any of these:

- It does not sign users up. The Supreme platform handles registration.
- It does not provide social / OAuth login flows.
- It does not gate routes by itself — the app's router is responsible for redirecting unauthenticated users.
- It does not cache responses beyond tokens and selected org. Wrap with React Query / SWR / etc. if response caching is needed.
- It does not encrypt token storage. Tokens live in `localStorage`. Treat any XSS as a token-exfiltration incident.

---

## 10. When in doubt

Read the SDK's [README.md](https://github.com/SupremeOpti/si-supreme-ai-sdk#readme) and the [Changelog](https://github.com/SupremeOpti/si-supreme-ai-sdk#changelog) at the bottom for recent API changes. If a method, endpoint, or config field is not documented there, do not invent it — surface the gap to the dev and stop.
