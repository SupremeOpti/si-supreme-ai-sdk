# @supreme-ai/si-sdk

TypeScript SDK for Supreme Intelligence: JWT auth, credits, AI agents, personas, reports, and iframe embedding.

Works in **standalone** apps (email/password login) and **embedded** apps (iframe inside Supreme Group parent).

---

## Installation

```bash
npm install github:SupremeOpti/si-supreme-ai-sdk
```

Peer dependencies: `react` and `react-dom` (optional if you only use `CreditSystemClient` / `ReportsClient` without hooks).

```bash
npm run build   # in this repo, before publishing or linking locally
```

---

## Environment variables

Typical consumer app `.env` (Vite example):

```env
# Production Supreme Intelligence
VITE_SUPREME_AI_API_BASE_URL=https://app.supremegroup.ai/api/secure-credits/jwt
VITE_SUPREME_AI_AUTH_URL=https://app.supremegroup.ai/api/jwt
VITE_SUPREME_AI_AGENTS_API_BASE_URL=https://app.supremegroup.ai/api/ai-agents/jwt

# Embedded iframe: comma-separated parent origins allowed to postMessage
VITE_ALLOWED_PARENTS=https://app.supremegroup.ai,https://v2.supremegroup.ai

# Optional
VITE_DEBUG=true
```

| Variable | Maps to `CreditSDKConfig` | Default if omitted |
|----------|---------------------------|-------------------|
| `VITE_SUPREME_AI_API_BASE_URL` | `apiBaseUrl` | `/api/secure-credits/jwt` |
| `VITE_SUPREME_AI_AUTH_URL` | `authUrl` | `/api/jwt` |
| `VITE_SUPREME_AI_AGENTS_API_BASE_URL` | `agentsApiBaseUrl` | `/api/ai-agents/jwt` |
| (derived) | `reportsApiBaseUrl` | `{api host}/api/reports/jwt` |
| (derived) | `skillsApiBaseUrl` | `{api host}/api/skills/jwt` |
| `VITE_ALLOWED_PARENTS` | `allowedOrigins` | `[window.location.origin]` |

Reports base URL is derived automatically:

```text
apiBaseUrl:  https://app.supremegroup.ai/api/secure-credits/jwt
reports:     https://app.supremegroup.ai/api/reports/jwt
```

Override with `reportsApiBaseUrl` if needed.

Personas use the API root (credits base with `/secure-credits/jwt` removed), e.g. `https://app.supremegroup.ai/api`.

Server entry (`@supreme-ai/si-sdk/server`, server-side only, see [Server entry](#server-entry)):

| Variable | Maps to `SiServerConfig` | Notes |
|----------|--------------------------|-------|
| `SI_MEMBERSHIP_KEY` | `membershipKey` | The app's `membership_api` key. Secret: never in a client bundle or `VITE_*` variable. |
| `SI_BASE_URL` (suggested) | `baseUrl` | e.g. `https://app.supremegroup.ai` |

---

## Quick start (React)

```tsx
import { useCreditSystem } from "@supreme-ai/si-sdk";

function App() {
  const {
    isInitialized,
    isAuthenticated,
    login,
    checkBalance,
    getAgents,
    listReports,
    createReport,
    getReport,
  } = useCreditSystem({
    apiBaseUrl: import.meta.env.VITE_SUPREME_AI_API_BASE_URL,
    authUrl: import.meta.env.VITE_SUPREME_AI_AUTH_URL,
    agentsApiBaseUrl: import.meta.env.VITE_SUPREME_AI_AGENTS_API_BASE_URL,
    allowedOrigins: import.meta.env.VITE_ALLOWED_PARENTS?.split(","),
    debug: import.meta.env.VITE_DEBUG === "true",
    features: { credits: true, personas: true, reports: true },
  });

  // Standalone: await login(email, password) then call other methods
  // Embedded: parent sends JWT via postMessage; no login()
}
```

Provider alternative:

```tsx
import { CreditSystemProvider, useCreditContext } from "@supreme-ai/si-sdk";

<CreditSystemProvider config={{ apiBaseUrl: "...", authUrl: "..." }}>
  <Child />
</CreditSystemProvider>
```

Imperative client (no React):

```ts
import { CreditSystemClient, ReportsClient } from "@supreme-ai/si-sdk";

const client = new CreditSystemClient({ apiBaseUrl: "...", authUrl: "..." });
await client.initialize();
```

---

## Modes

| Mode | Detection | Auth |
|------|-----------|------|
| **Standalone** | Not in iframe (or `mode: 'standalone'`) | `login(email, password)` → tokens in storage |
| **Embedded** | Running in iframe (or `mode: 'embedded'`) | Parent sends `JWT_TOKEN_RESPONSE`; `login()` is blocked |

All REST calls send `Authorization: Bearer <access_token>`.

Token storage key prefix: `creditSystem_` (configurable via `storagePrefix`).

---

## SDK method index

| Section | `useCreditSystem` / `CreditSystemClient` | HTTP (when applicable) |
|---------|------------------------------------------|-------------------------|
| Auth | `login`, `logout` | `POST /api/jwt/login`, `POST /api/jwt/logout` |
| Auth (internal) | — | `GET /api/jwt/validate`, `POST /api/jwt/refresh` |
| Credits | `checkBalance`, `spendCredits`, `addCredits`, `getHistory` | under `apiBaseUrl` |
| AI agents | `getAgents` | `GET agentsApiBaseUrl?...` |
| Personas | `getPersonas`, `getPersonaById` | under API root `/personas/jwt/...`, `/get-persona/...` |
| Organizations | `switchOrganization`, `organizations`, `selectedOrganization` | Client-side + cookie; refreshes data in standalone |
| Reports | `listReports`, `getReport`, `createReport`, `updateReport` | under `reportsApiBaseUrl` |
| Skills | `getSkills`, `getSkillById` | under `skillsApiBaseUrl` |
| Embedded only | `requestCurrentUserState`, `requestUserOrganizations`, `requestUserPersonas`, `requestUserSkills` | postMessage to parent |

Server entry (`@supreme-ai/si-sdk/server`, `createSiServerClient(config)`):

| Section | Method | HTTP (when applicable) |
|---------|--------|-------------------------|
| Membership | `si.membership.get`, `requireOrg`, `findOrganization`, `invalidate` | `GET /api/membership/users/{user}/organizations` |
| Organizations | `si.organizations.resolve` (slug or id) | via membership |
| MCP | `si.mcp.conversationKey`, `scopeToolCall`, `labelResult`, `errorResult`, `listOrganizationsTool`, `annotations` | via membership |
| Locks | `si.locks.bindOrg`, `release` | lock store adapter |
| Detection | `si.detection.recordRead`, `checkWrite` | cache adapter |
| Audit | `si.audit.emit`, `flush`, `forwarding` | `POST /api/membership/audit-events` (opt-in, not live yet) |

---

## API reference

Unless noted, **SDK return values** are normalized objects like `{ success: true, ... }` or `{ success: false, error: "..." }`. They are not raw `fetch` responses.

### Auth

Base: **`authUrl`** (e.g. `https://app.supremegroup.ai/api/jwt`)

#### `login(email, password)` — standalone only

| | |
|---|---|
| **SDK** | `login(email: string, password: string)` → `AuthResult` |
| **HTTP** | `POST {authUrl}/login` |
| **Body** | `{ "email": "user@example.com", "password": "secret" }` |

**Example response (SDK):**

```json
{
  "success": true,
  "user": {
    "id": 123,
    "email": "user@example.com",
    "name": "Jane Doe",
    "avatar_url": "https://app.supremegroup.ai/storage/avatars/123.png",
    "is_superadmin": false,
    "organizations": [
      {
        "id": "29",
        "name": "Supreme Group",
        "selectedStatus": true,
        "user_role_ids": [15, 8],
        "roles": { "15": "orgadmin", "8": "HR" }
      }
    ]
  },
  "tokens": {
    "access_token": "eyJ...",
    "refresh_token": "eyJ...",
    "expires_in": 3600
  }
}
```

**Failure:**

```json
{ "success": false, "error": "Invalid credentials" }
```

Embedded mode: `{ "success": false, "error": "Login not available in embedded mode" }`

---

#### `logout()`

| | |
|---|---|
| **SDK** | `logout()` → `Promise<void>` |
| **HTTP** | `POST {authUrl}/logout` with `Authorization: Bearer <token>` |

Clears SDK state and storage. In embedded mode, sends `LOGOUT` to parent.

---

#### Token validate / refresh (used internally)

| HTTP | Body / headers |
|------|----------------|
| `GET {authUrl}/validate` | `Authorization: Bearer <access_token>` |
| `POST {authUrl}/refresh` | `{ "refresh_token": "eyJ..." }` |

On 401 from credits API, the client refreshes the access token and retries once.

---

### Credits

Base: **`apiBaseUrl`** (e.g. `https://app.supremegroup.ai/api/secure-credits/jwt`)

Organization context: `organization_id` query/body field defaults to **selected organization** or cookie `user-selected-org-id`.

#### `checkBalance()`

| | |
|---|---|
| **SDK** | `checkBalance()` → `BalanceResult` |
| **HTTP** | `GET {apiBaseUrl}/balance?organization_id={orgId}` |

**Example response (SDK):**

```json
{ "success": true, "balance": 1500 }
```

---

#### `spendCredits(amount, description?, referenceId?)`

| | |
|---|---|
| **SDK** | `spendCredits(amount, description?, referenceId?)` → `SpendResult` |
| **HTTP** | `POST {apiBaseUrl}/spend` |

**Request body:**

```json
{
  "user_id": 123,
  "organization_id": "29",
  "amount": 10,
  "description": "AI run",
  "reference_id": "job-abc",
  "user_role_id": 15
}
```

`user_role_id` is included when the selected org has `user_role_ids`.

**Example response (SDK):**

```json
{
  "success": true,
  "newBalance": 1490,
  "transaction": {
    "id": "tx_1",
    "type": "debit",
    "amount": 10,
    "description": "AI run",
    "created_at": "2026-05-22T12:00:00Z",
    "balance_after": 1490
  }
}
```

---

#### `addCredits(amount, type?, description?)`

| | |
|---|---|
| **SDK** | `addCredits(amount, type?, description?)` → `AddResult` |
| **HTTP** | `POST {apiBaseUrl}/add` |

**Request body:**

```json
{
  "user_id": 123,
  "organization_id": "29",
  "amount": 100,
  "type": "purchase",
  "description": "Top-up",
  "user_role_id": 15
}
```

**Example response (SDK):**

```json
{
  "success": true,
  "newBalance": 1590,
  "transaction": { "id": "tx_2", "type": "credit", "amount": 100 }
}
```

---

#### `getHistory(page?, limit?)`

| | |
|---|---|
| **SDK** | `getHistory(page = 1, limit = 10)` → `HistoryResult` |
| **HTTP** | `GET {apiBaseUrl}/history?organization_id={orgId}&limit={limit}&offset={offset}` |

`offset = (page - 1) * limit`

**Example response (SDK):**

```json
{
  "success": true,
  "transactions": [
    {
      "id": "tx_1",
      "type": "debit",
      "amount": 10,
      "description": "AI run",
      "reference_id": "job-abc",
      "created_at": "2026-05-22T12:00:00Z",
      "balance_after": 1490
    }
  ],
  "total": 42,
  "page": 1,
  "pages": 5
}
```

---

### AI agents (assistants)

Base: **`agentsApiBaseUrl`** (e.g. `https://app.supremegroup.ai/api/ai-agents/jwt`)

#### `getAgents(all?)`

| | |
|---|---|
| **SDK** | `getAgents(all?: boolean)` → `AgentsResult` |
| **HTTP** | `GET {agentsApiBaseUrl}?organization_id={orgId}&all=true` |
| | or `...&role_ids=15,8` when `all` is false |

| `all` | Behavior |
|-------|----------|
| `true` | All agents for the organization |
| `false` (default) | Agents for user's role IDs on selected org |
| (server) | Superadmin / admin may receive all agents even when `all=false` |

**Example response — all agents (`getAgents(true)`):**

```json
{
  "success": true,
  "agents": [
    {
      "id": 14,
      "name": "OpenKAI MLR Agent",
      "description": "OpenKAI MLR Agent",
      "short_desc": null,
      "assistant_id": "4dd46d71-8690-49ef-9b3a-5042d33034fa",
      "is_default": false
    }
  ],
  "total": 1
}
```

**Example response — by role (`getAgents(false)`):**

```json
{
  "success": true,
  "agents": [
    { "id": 18, "name": "PHC Main Agent", "assistant_id": "c77f12e6-..." }
  ],
  "roleGrouped": {
    "15": {
      "role_name": "orgadmin",
      "agents": [{ "id": 18, "name": "PHC Main Agent" }]
    }
  },
  "total": 1
}
```

More detail: [docs/GET_AGENTS_API.md](./docs/GET_AGENTS_API.md)

---

### Personas

Base: API root = `apiBaseUrl` with `/secure-credits/jwt` removed  
(e.g. `https://app.supremegroup.ai/api`)

Requires `features.personas !== false` (default **on**).

#### `getPersonas(organizationId?, roleId?)`

| | |
|---|---|
| **SDK** | `getPersonas(organizationId?, roleId?)` → `PersonasResult` |
| **HTTP** | `GET {apiRoot}/personas/jwt/list` |
| **Query (optional)** | `organization_id`, `role_id` — if one is passed, **both** are required |

Without query params, the server filters using JWT claims.

**Example response (SDK):**

```json
{
  "success": true,
  "personas": [
    {
      "id": 1,
      "name": "Marketing Lead",
      "description": "B2B marketing persona",
      "category": "Sales"
    }
  ]
}
```

---

#### `getPersonaById(id)`

| | |
|---|---|
| **SDK** | `getPersonaById(id: number)` → `PersonaResult` |
| **HTTP** | `GET {apiRoot}/get-persona/{id}` |

**Example response (SDK):**

```json
{
  "success": true,
  "persona": {
    "id": 1,
    "name": "Marketing Lead",
    "description": "B2B marketing persona"
  }
}
```

---

### Organizations

Organizations are loaded at login (standalone) or from parent JWT response (embedded). Exposed as `organizations` and `selectedOrganization` on the hook/client.

#### `switchOrganization(orgId)`

| | |
|---|---|
| **SDK** | `switchOrganization(orgId: string)` → `SwitchOrgResult` |
| **HTTP** | No dedicated endpoint — updates client state, sets cookie `user-selected-org-id` |

**Standalone — example response (SDK):**

```json
{
  "success": true,
  "previousOrgId": "29",
  "newOrgId": "42",
  "organizations": [{ "id": "42", "name": "Other Org", "selectedStatus": true }],
  "balance": 800,
  "history": { "transactions": [], "total": 0, "page": 1, "pages": 1 },
  "agents": {
    "all": [],
    "filtered": [],
    "roleGrouped": {}
  }
}
```

**Embedded — example response (SDK):**

```json
{
  "success": true,
  "previousOrgId": "29",
  "newOrgId": "42"
}
```

---

### Reports

Base: **`reportsApiBaseUrl`** (default `{host}/api/reports/jwt`)

All operations are **creator-only**: the JWT user can only list/read/create/update reports they created. The SDK does not accept a user/creator ID parameter.

Requires `features.reports !== false` (default **on**).

`organization_id` defaults to the SDK's selected organization.

Visibility values: `inherit` | `personal` | `internal` | `client` | `public`

---

#### `listReports(params?)`

| | |
|---|---|
| **SDK** | `listReports(params?)` → `ReportsResult` |
| **HTTP** | `GET {reportsApiBaseUrl}?organization_id=&folder_id=&cursor=&per_page=` |

**Params (`ListReportsParams`):**

| Field | Type | Notes |
|-------|------|-------|
| `organizationId` | string \| number | Optional; defaults to selected org |
| `folderId` | string \| number \| null | Optional filter |
| `cursor` | string | Pagination cursor |
| `perPage` | number | Default 25, max 100 (server) |

**Example response (SDK):**

```json
{
  "success": true,
  "reports": [
    {
      "id": 42,
      "organization_id": 29,
      "folder_id": null,
      "title": "Q1 Summary",
      "visibility": "personal",
      "pinned": false,
      "url": "https://app.supremegroup.ai/reports/42",
      "created_at": "2026-05-22T10:00:00Z",
      "updated_at": "2026-05-22T10:00:00Z",
      "edited_at": null
    }
  ],
  "nextCursor": null
}
```

Empty list:

```json
{ "success": true, "reports": [], "nextCursor": null }
```

---

#### `getReport(id, organizationId?)`

| | |
|---|---|
| **SDK** | `getReport(id, organizationId?)` → `ReportResult` |
| **HTTP** | `GET {reportsApiBaseUrl}/{id}?organization_id=` |

Includes HTML `body` in the report object.

**Example response (SDK):**

```json
{
  "success": true,
  "report": {
    "id": 42,
    "organization_id": 29,
    "folder_id": null,
    "title": "Q1 Summary",
    "visibility": "personal",
    "pinned": false,
    "url": "https://app.supremegroup.ai/reports/42",
    "created_at": "2026-05-22T10:00:00Z",
    "updated_at": "2026-05-22T10:00:00Z",
    "edited_at": null,
    "body": "<p>Report content</p>"
  }
}
```

---

#### `createReport(params)`

| | |
|---|---|
| **SDK** | `createReport(params)` → `ReportResult` |
| **HTTP** | `POST {reportsApiBaseUrl}` |

**Request body (server):**

```json
{
  "title": "My report",
  "body": "<p>Hello</p>",
  "visibility": "personal",
  "organization_id": 29,
  "folder_id": null,
  "pinned": false,
  "include_body": true
}
```

**SDK params (`CreateReportParams`):** `title`, `body`, `visibility`, optional `folderId`, `pinned`, `includeBody`, `organizationId`

**Example response (SDK):**

```json
{
  "success": true,
  "report": {
    "id": 43,
    "organization_id": 29,
    "title": "My report",
    "visibility": "personal",
    "body": "<p>Hello</p>"
  }
}
```

**Validation error (422):**

```json
{
  "success": false,
  "error": "Failed to create report (422)",
  "validationErrors": {
    "title": ["The title field is required."]
  }
}
```

---

#### `updateReport(id, params)`

| | |
|---|---|
| **SDK** | `updateReport(id, params)` → `ReportResult` |
| **HTTP** | `PATCH {reportsApiBaseUrl}/{id}` |

**Request body (partial):**

```json
{
  "title": "Updated title",
  "body": "<p>Updated</p>",
  "visibility": "internal",
  "organization_id": 29,
  "pinned": true,
  "include_body": false
}
```

Only the authenticated creator can update; others receive **403** from the server.

**Example response (SDK):**

```json
{
  "success": true,
  "report": {
    "id": 43,
    "title": "Updated title",
    "visibility": "internal",
    "updated_at": "2026-05-22T11:00:00Z"
  }
}
```

---

### Skills

Base: **`skillsApiBaseUrl`** (default `{host}/api/skills/jwt`)

Skills are SKILL.md documents the platform publishes so child apps can install or reference them. Read-only from the SDK. The server filters out private skills before responding — there is no way for a caller to fetch a private skill through this surface.

Requires `features.skills !== false` (default **on**).

`organization_id` defaults to the SDK's selected organization.

**Two-step shape.** `getSkills` returns lightweight summaries (no SKILL.md `content`); `getSkillById` triggers on-demand packaging on the backend and returns the full markdown. Mirrors how reports work — keeps list responses small and avoids packaging skills nobody opens.

---

#### `getSkills(params?)`

| | |
|---|---|
| **SDK** | `getSkills(params?: ListSkillsParams)` → `SkillsResult` |
| **HTTP** | `GET {skillsApiBaseUrl}/list?organization_id=&cursor=&per_page=` |

**Params (`ListSkillsParams`):**

| Field | Type | Notes |
|-------|------|-------|
| `organizationId` | string \| number | Optional; defaults to selected org |
| `cursor` | string | Pagination cursor |
| `perPage` | number | Default 25, max 100 (server) |

**Example response (SDK):**

```json
{
  "success": true,
  "skills": [
    {
      "id": 5,
      "title": "Prestige Presenter",
      "description": "Build polished client presentations from raw notes",
      "template": null,
      "creator": { "id": 525, "name": "Aileen O'Connell", "email": null },
      "is_owner": false,
      "created_at": "2026-05-18T20:55:43.000000Z",
      "updated_at": "2026-05-18T20:55:43.000000Z"
    }
  ],
  "nextCursor": null
}
```

No `content` field on list entries — use `getSkillById` to fetch the SKILL.md body.

Empty list:

```json
{ "success": true, "skills": [], "nextCursor": null }
```

---

#### `getSkillById(id)`

| | |
|---|---|
| **SDK** | `getSkillById(id: number \| string)` → `SkillResult` |
| **HTTP** | `GET {skillsApiBaseUrl}/{id}` |

Returns the skill with its packaged SKILL.md `content` (frontmatter + markdown). The backend packages content on demand for this call only. Returns 404 for skills the caller is not entitled to read.

**Example response (SDK):**

```json
{
  "success": true,
  "skill": {
    "id": 5,
    "title": "Prestige Presenter",
    "description": "Build polished client presentations from raw notes",
    "content": "---\nname: prestige-presenter\ndescription: ...\n---\n\n# Prestige Presenter\n...",
    "template": null,
    "creator": { "id": 525, "name": "Aileen O'Connell", "email": null },
    "is_owner": false,
    "created_at": "2026-05-18T20:55:43.000000Z",
    "updated_at": "2026-05-18T20:55:43.000000Z"
  }
}
```

`content` is `null` when no SKILL.md body has been authored for the skill yet.

More detail: [docs/SKILLS_API.md](./docs/SKILLS_API.md)

---

### Embedded mode (iframe / parent)

These methods use **postMessage** to the parent frame (no REST). Only available when `mode === 'embedded'`.

| SDK method | Child → parent message | Parent → child response |
|------------|------------------------|-------------------------|
| (init) | `REQUEST_JWT_TOKEN` | `JWT_TOKEN_RESPONSE` |
| `requestCurrentUserState()` | `REQUEST_CURRENT_USER_STATE` | `RESPONSE_CURRENT_USER_STATE` |
| `requestUserOrganizations()` | `REQUEST_USER_ORGS` | `RESPONSE_USER_ORGS` |
| `requestUserPersonas()` | `REQUEST_USER_PERSONAS` | `RESPONSE_USER_PERSONAS` |
| `requestUserSkills()` | `REQUEST_USER_SKILLS` | `RESPONSE_USER_SKILLS` |
| (deep linking) | `ROUTE_CHANGED` | — |
| (credits events) | `BALANCE_UPDATE`, `CREDITS_SPENT`, `CREDITS_ADDED` | — |
| `logout()` | `LOGOUT` | — |

**`RESPONSE_CURRENT_USER_STATE` payload (example):**

```json
{
  "type": "RESPONSE_CURRENT_USER_STATE",
  "userState": {
    "orgId": "29",
    "orgName": "Supreme Group",
    "userId": "456",
    "userRole": "orgadmin",
    "userRoleIds": [15, 8],
    "isSuperAdmin": false
  }
}
```

Parent integration helper: `ParentIntegrator` from `@supreme-ai/si-sdk`.

Configure allowed parent origins via `allowedOrigins` in config.

---

### Server entry

`@supreme-ai/si-sdk/server` (since 1.2.0) is a separate, **server-only** entry for app MCP servers and APIs that trust SI for identity, membership, roles and app grants. It holds the app's secret `membership_api` key, is never re-exported from the browser entry, and resolves to a throwing stub under the `browser` export condition. Zero runtime dependencies; runs on Node 18+, Next.js (Node and Edge), Supabase edge functions (Deno) and Workers. Every failure denies (fail closed).

Full contract, adapter interface, org-isolation model and a worked MCP tool handler: [docs/SERVER.md](docs/SERVER.md).

```ts
import { createSiServerClient, supabaseLockStore, annotations } from "@supreme-ai/si-sdk/server";

const si = createSiServerClient({
  baseUrl: "https://app.supremegroup.ai",
  membershipKey: process.env.SI_MEMBERSHIP_KEY!,
  locks: supabaseLockStore(serviceRoleSupabase), // shared conversation-key lock store
});

// In an MCP tools/call handler:
try {
  const scope = await si.mcp.scopeToolCall({
    userId: siUserId,                 // Supreme JWT `sub`
    clientId,                         // OAuth client id
    conversationKey: si.mcp.conversationKey({ headers: req.headers, meta: params._meta }),
    organization: args.organization,  // slug (preferred) or id
    tool: "canvas_update",
    kind: "write",
  });
  // scope.organization.id → scope your queries with it
  // scope.roles, scope.appGrant → app permission logic
  return si.mcp.labelResult({ content: [{ type: "text", text: "Done." }] }, scope);
} catch (err) {
  return si.mcp.errorResult(err);
}
```

`scopeToolCall` returns:

```json
{
  "organization": { "id": 2, "slug": "kadiko", "name": "Kadiko" },
  "roles": ["client"],
  "appGrant": "organization",
  "mode": "locked",
  "keyHash": "3b4c…64 hex",
  "warning": null,
  "userId": "456",
  "principalId": "456",
  "clientId": "chatgpt",
  "tool": "canvas_update",
  "kind": "write"
}
```

| Piece | Behaviour |
|-------|-----------|
| Membership | Wraps `GET /api/membership/users/{user}/organizations` (SI-374). Cache: allow ≤ 300 s, deny (empty list, `user_not_found`) ≤ 30 s; callers may lower, never raise. Network error, timeout, 5xx, `429` without fresh cache, malformed body → `SiUnavailableError`. |
| Org resolution | `organization` argument as slug or numeric id; unknown and not-allowed both → `OrgAccessDeniedError`. |
| Conversation key | `_meta["openai/session"]` → Codex conversation header → `X-SI-Conversation` → `null`. Never `Mcp-Session-Id`. |
| Lock | With a key: first org binds `(principal, client, sha256(key))` for a sliding 24 h, another org → `OrgLockedError`. No key → soft mode. |
| Label | `structuredContent.organization` + `[Org: Name (slug)]` banner line (+ detection warning). |
| Detection | Read org A then write org B within 15 min (same principal + client) → warning on the write. Never blocks. |
| Audit | `onAudit(event)` hook on every call. Forwarding to SI (`auditForwarding: { enabled: true }`) is opt-in, default off: available once SI enables the endpoint (SI-379). |

Adapters: `memoryCache()` (fine in production), `memoryLockStore()` (tests/dev only), `supabaseLockStore(client)` with the SQL in [docs/SERVER.md](docs/SERVER.md#supabase-lock-store) (also exported as `SUPABASE_LOCK_STORE_SQL`).

Errors (all extend `SiServerError`, stable `code`): `OrgAccessDeniedError` (`org_access_denied`), `OrgLockedError` (`org_locked`), `UserGoneError` (`user_not_found`: revoke the connection), `SiUnavailableError` (`si_unavailable`), `MisconfiguredKeyError` (`misconfigured_key`), `AppInactiveError` (`app_inactive`), `LockStoreUnavailableError` (`lock_store_unavailable`), `InvalidArgumentError` (`invalid_argument`).

Deno / Supabase edge functions import the built ESM by URL, pinned to a commit SHA:

```jsonc
// supabase/functions/deno.json
{ "imports": { "@si/server": "https://cdn.jsdelivr.net/gh/SupremeOpti/si-supreme-ai-sdk@<40-char-sha>/dist/server.mjs" } }
```

Apps using `si-sdk/server` (bump each on release): none yet. si-canva adopts in SI-380.

---

## Configuration reference

```ts
interface CreditSDKConfig {
  apiBaseUrl?: string;
  agentsApiBaseUrl?: string;
  reportsApiBaseUrl?: string;
  skillsApiBaseUrl?: string;
  authUrl?: string;
  parentTimeout?: number;           // default 3000 ms
  tokenRefreshInterval?: number;    // default 600000 ms (10 min)
  balanceRefreshInterval?: number;  // default 30000 ms; set 0 to disable
  allowedOrigins?: string[];
  autoInit?: boolean;               // default true
  debug?: boolean;
  storagePrefix?: string;           // default "creditSystem_"
  mode?: "auto" | "embedded" | "standalone";
  features?: {
    credits?: boolean;   // default true
    personas?: boolean;  // default true
    reports?: boolean;   // default true
    skills?: boolean;    // default true
  };
  deepLinking?: boolean;            // embedded: notify parent on route change
  onAuthRequired?: () => void;
  onTokenExpired?: () => void;
}
```

Server entry config (`createSiServerClient`), full detail in [docs/SERVER.md](docs/SERVER.md#configuration):

```ts
interface SiServerConfig {
  baseUrl: string;                 // https (http only for localhost)
  membershipKey: string;           // SI_MEMBERSHIP_KEY
  cache?: CacheAdapter;            // default memoryCache()
  locks?: LockStoreAdapter;        // default memoryLockStore() + warning
  fetch?: FetchLike;               // default global fetch
  logger?: Logger;                 // default console
  timeoutMs?: number;              // default 3000 per attempt
  membership?: { allowTtlSeconds?: number; denyTtlSeconds?: number }; // caps 300 / 30
  lockTtlSeconds?: number;         // default 86400
  detection?: { enabled?: boolean; windowSeconds?: number };          // true / 900
  conversation?: { codexHeaders?: string[]; siHeader?: string };
  onAudit?: (event: AuditEvent) => void | Promise<void>;
  auditForwarding?: { enabled?: boolean; batchSize?: number; flushIntervalMs?: number }; // enabled: false
  now?: () => number;
}
```

---

## CLI: test reports API

From this repo (no React):

```bash
npm run test:reports
```

With a JWT from browser `sessionStorage` key `supreme_access_token`:

```bash
SUPREME_JWT=eyJ... ORGANIZATION_ID=29 node scripts/test-reports.mjs --list
SUPREME_JWT=eyJ... ORGANIZATION_ID=29 node scripts/test-reports.mjs --create
```

---

## Exports

| Export | Description |
|--------|-------------|
| `useCreditSystem` | Main React hook |
| `CreditSystemProvider`, `useCreditContext` | React context |
| `useSwitchOrganization` | Org switch helper hook |
| `CreditSystemClient` | Imperative client |
| `ReportsClient`, `PersonasClient`, `SkillsClient` | Standalone REST clients |
| `ParentIntegrator` | Parent-page iframe helper |
| Types | `User`, `Organization`, `Agent`, `Report`, `CreateReportParams`, `Skill`, `SkillSummary`, `SkillCreator`, `ListSkillsParams`, … |

`@supreme-ai/si-sdk/server` (server-only):

| Export | Description |
|--------|-------------|
| `createSiServerClient` | Server client: `membership`, `organizations`, `mcp`, `locks`, `detection`, `audit` |
| `memoryCache`, `memoryLockStore`, `supabaseLockStore`, `SUPABASE_LOCK_STORE_SQL` | Adapters and the Supabase migration |
| `conversationKey`, `hashConversationKey` | Conversation-key resolver and SHA-256 hash |
| `annotations`, `labelResult`, `errorResult`, `orgBanner` | MCP helpers |
| `SiServerError`, `OrgAccessDeniedError`, `OrgLockedError`, `UserGoneError`, `SiUnavailableError`, `MisconfiguredKeyError`, `AppInactiveError`, `LockStoreUnavailableError`, `InvalidArgumentError`, `isSiServerError` | Errors |
| `SERVER_SDK_VERSION`, `MAX_ALLOW_TTL_SECONDS`, `MAX_DENY_TTL_SECONDS`, `DEFAULT_LOCK_TTL_SECONDS`, `DEFAULT_DETECTION_WINDOW_SECONDS`, `AUDIT_EVENTS_PATH`, `DEFAULT_CODEX_HEADERS`, `DEFAULT_SI_HEADER` | Constants |
| Types | `SiServerConfig`, `Membership`, `ResolvedOrganization`, `ToolScope`, `ScopeToolCallInput`, `McpToolResult`, `AuditEvent`, `CacheAdapter`, `LockStoreAdapter`, … |

---

## License

MIT

---

## Changelog

> Every change to this repo gets an entry here. Newest at the top. See [CLAUDE.md](CLAUDE.md) for the rule.

### 2026-10-05

- Added the server-only entry `@supreme-ai/si-sdk/server` (1.2.0, SI-378): `createSiServerClient` with membership (`GET /api/membership/users/{user}/organizations`, fail closed, capped cache), slug-or-id org resolution, conversation-key lock (`memoryLockStore`, `supabaseLockStore` + SQL), cross-org detection, MCP helpers (`scopeToolCall`, `labelResult`, `annotations`, `listOrganizationsTool`, `errorResult`) and opt-in audit forwarding to `POST /api/membership/audit-events` (off by default; endpoint not live yet). New `./server` export with a throwing `browser` stub, `tsconfig.server.json` (no DOM), first jest suite. Docs: [docs/SERVER.md](docs/SERVER.md), [Server entry](#server-entry), [SKILL.md](SKILL.md), [CHANGELOG.md](CHANGELOG.md). Browser entry unchanged.
- Added the implementation plan [docs/plans/server-entry-plan.md](docs/plans/server-entry-plan.md).

### 2026-05-27

- Realigned Skills to the real backend shape and adopted a summary-in-list / content-on-detail pattern: `getSkills` now returns `SkillSummary[]` (no `content`), `getSkillById` returns `Skill` with packaged `content`. Field names follow the live API (`title`, `content`, `creator`, `is_owner`, `template`); dropped the speculative `visibility`/`organization_id`/`category`/`version` fields and the `SkillVisibility` export. [docs/SKILLS_API.md](docs/SKILLS_API.md) and the Skills section of the README updated to match.

### 2026-05-22

- Added Skills API integration: `getSkills`, `getSkillById`, embedded-mode `requestUserSkills`, new `SkillsClient` export, `features.skills` flag (default on), `skillsApiBaseUrl` config (derived by default). Server filters out `visibility: 'private'` before responding — the SDK never exposes private skills. Endpoint contract documented in [docs/SKILLS_API.md](docs/SKILLS_API.md).
- Added [SKILL.md](SKILL.md) — a Claude Code skill consumer-app devs can install for SDK setup, auth-conflict avoidance (Supabase, Lovable, NextAuth, etc.), and local dev posture.
- Documented `avatar_url` on the user payload returned by `POST {authUrl}/login` in the [Auth](#auth) example.
- Added [CLAUDE.md](CLAUDE.md) with agent instructions for keeping docs in sync with API/SDK changes, and started this changelog at the bottom of the README.
