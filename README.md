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
| `SI_MCP_RESOURCE` (suggested) | `auth.resource` | The app's canonical MCP resource URI as registered in SI, e.g. `https://studio-canvas.supremegroup.ai/mcp`. Only for apps on SI OAuth (`si.auth`). |

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
| Auth (1.3.0) | `si.auth.introspect` | `POST /api/oauth/introspect` |
| Auth (1.3.0) | `si.auth.grantStatus` | `POST /api/oauth/grants/status` (chunks of 100) |
| Auth (1.3.0) | `si.auth.requireScope`, `challenge`, `protectedResourceMetadata`, `resourceMetadataUrl`, `bearerToken` | local (serve the PRM at `/.well-known/oauth-protected-resource[/<path>]`) |
| Auth (1.5.0) | `si.auth.scopeManifest`, `scopeManifestResponse` (from `auth.scopes`, which also feeds the PRM `scopes_supported`) | local (serve at `/.well-known/si-mcp-scopes.json`; SI pulls it, SI-419) |
| Membership | `si.membership.get`, `requireOrg`, `findOrganization`, `invalidate` | `GET /api/membership/users/{user}/organizations` |
| Organizations | `si.organizations.resolve` (slug or id; user id or introspection principal) | via membership, or the principal's orgs |
| MCP | `si.mcp.conversationKey`, `scopeToolCall`, `labelResult`, `errorResult`, `listOrganizationsTool`, `annotations` | via membership, or the principal's orgs |
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

**Identity.** Apps on SI OAuth pass the `principal` from `si.auth.introspect` (below): the SDK takes the user and the org list from SI's answer for the bearer. Otherwise **`userId` must be the authenticated caller** (the `sub` of the token your server verified), never a value from tool arguments or request input: the SDK trusts it. See [Identity](docs/SERVER.md#identity-who-userid-is).

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
    userId: siUserId,                 // verified token `sub`; never from tool args
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
| Label | `[Org: Name (slug)]` banner block first (+ detection warning block), then the tool's blocks. Text only: don't set `structuredContent` for Claude ([why](docs/SERVER.md#no-structuredcontent-for-claude)). |
| Detection | Read org A then write org B within 15 min (same principal + client) → warning on the write. Never blocks. |
| Audit | `onAudit(event)` hook on every call. Forwarding to SI (`auditForwarding: { enabled: true }`) is opt-in, default off: available once SI enables the endpoint (SI-379). |

#### Token introspection (`si.auth`, 1.3.0)

For an app whose MCP server is an SI OAuth resource (SI-375 / SI-411). Uses the same `membership_api` key. Full rules and a canva-style handler: [docs/SERVER.md](docs/SERVER.md#token-introspection-siauth).

```ts
const si = createSiServerClient({
  baseUrl: "https://app.supremegroup.ai",
  membershipKey: process.env.SI_MEMBERSHIP_KEY!,
  locks: supabaseLockStore(serviceRoleSupabase),
  auth: {
    resource: "https://studio-canvas.supremegroup.ai/mcp",
    resourceSlug: "canva",                       // 1.5.0: declare the scopes once (SI-419); validated at construction
    scopes: [
      { name: "mcp:canva:base", label: "Use Studio Canvas", kind: "required" },
      { name: "mcp:canva:runs", label: "Run generations", description: "Uses your organization's credits.", kind: "default" },
    ],
  },
});

// GET /.well-known/oauth-protected-resource and /.well-known/oauth-protected-resource/mcp
si.auth.protectedResourceMetadata(req.url);
// → { resource: "https://studio-canvas.supremegroup.ai/mcp?instance=broth", authorization_servers: ["https://app.supremegroup.ai"], bearer_methods_supported: ["header"], scopes_supported: ["mcp:canva:base", "mcp:canva:runs"] }

// GET /.well-known/si-mcp-scopes.json (SCOPE_MANIFEST_PATH): the SI scope manifest, from the same declaration
const m = si.auth.scopeManifestResponse();
// → { status: 200, headers: { "Content-Type": "application/json", "Cache-Control": "public, max-age=300" }, body: '{"version":1,"resource":"https://studio-canvas.supremegroup.ai/mcp","scopes":[...]}' }

// Every MCP request:
let principal;
try {
  principal = await si.auth.introspect(si.auth.bearerToken(req.headers));
  si.auth.requireScope(principal, "mcp:canva:base");
} catch (err) {
  const c = si.auth.challenge(err, { requestUrl: req.url }); // 401 / 403 + WWW-Authenticate, or 503
  return new Response(JSON.stringify(c.body), { status: c.status, headers: c.headers });
}
const scope = await si.mcp.scopeToolCall({ principal, conversationKey, organization: args.organization, tool, kind: "write" });

// Background job with a stored grant id, no bearer:
const status = await si.auth.grantStatus([job.grant_id]); // { "<grant id>": "active" | "revoked" | "expired" | "unknown" }
```

`introspect` returns a frozen principal:

```json
{
  "sub": "456",
  "aud": "https://studio-canvas.supremegroup.ai/mcp",
  "scope": ["mcp:canva:base", "mcp:canva:storyboards"],
  "clientId": "https://claude.ai/oauth/claude-code-client-metadata",
  "clientName": "Claude Code",
  "grantId": "0199a6c2-7e1b-7c3a-9f4e-2b8d6c1a0e55",
  "requestedResource": "https://studio-canvas.supremegroup.ai/mcp?instance=broth",
  "isSuperadmin": false,
  "organizations": [{ "id": 29, "slug": "supreme-group", "name": "Supreme Group", "logoUrl": null, "roles": ["orgadmin"], "appGrant": "role" }],
  "exp": 1790000000,
  "iat": 1789996400,
  "iss": "https://app.supremegroup.ai",
  "email": "ada@example.com",
  "name": "Ada Lovelace",
  "fromCache": false
}
```

| Rule | Behaviour |
|------|-----------|
| Fail closed | `active: false`, `aud` ≠ `auth.resource`, past `exp`, or no token → `InvalidTokenError`. Network error, timeout, 5xx, `429`, malformed body → `SiUnavailableError`. `401` / `500 misconfigured_key` → `MisconfiguredKeyError`; `403 app_inactive` → `AppInactiveError`; `422` → `SiValidationError`. |
| Cache | `active: true` only, ≤ 60 s and never past `exp`, keyed by SHA-256 of the token. `active: false` and errors are never cached. In-process by default (`auth.cache` to override). |
| `429` | `retryAfterSeconds` from `Retry-After`; SI isn't called again until it passes (cap 60 s). |
| Scopes | `requireScope` → `InsufficientScopeError`; `challenge` answers `403` with `scope="<every required scope>"`. |
| Grant status | Chunked by 100, deduped, no partial answers. Optional `active`-only cache (`auth.grantStatusTtlSeconds`, default off, max 60). |
| Scopes declared once (1.5.0) | `auth.scopes` (`{ name, label, description?, kind }`, with `auth.resourceSlug`) is checked against the SI manifest contract at construction: names `mcp:<slug>:<verb>` and unique, label 1–80, description ≤ 500, kind `required` / `default` / `optional`, at least one `required`, 1–50 scopes, ≤ 64 KB; `InvalidArgumentError` otherwise. It feeds the PRM `scopes_supported` and the manifest. `si.auth.requireScope` rejects undeclared names. SI approves new or changed scopes before users see them. [docs/SERVER.md](docs/SERVER.md#declaring-scopes). |

Adapters: `memoryCache()` (fine in production), `memoryLockStore()` (tests/dev only), `supabaseLockStore(client)` with the SQL in [docs/SERVER.md](docs/SERVER.md#supabase-lock-store) (also exported as `SUPABASE_LOCK_STORE_SQL`).

Errors (all extend `SiServerError`, stable `code`): `OrgAccessDeniedError` (`org_access_denied`), `OrgLockedError` (`org_locked`), `UserGoneError` (`user_not_found`: revoke the connection), `SiUnavailableError` (`si_unavailable`), `MisconfiguredKeyError` (`misconfigured_key`), `AppInactiveError` (`app_inactive`), `LockStoreUnavailableError` (`lock_store_unavailable`), `InvalidArgumentError` (`invalid_argument`), and for `si.auth`: `InvalidTokenError` (`invalid_token`), `InsufficientScopeError` (`insufficient_scope`), `SiValidationError` (`validation_failed`).

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
  auth?: {                         // si.auth (1.3.0)
    resource?: string;             // canonical MCP resource URI (SI_MCP_RESOURCE)
    issuer?: string;               // PRM authorization_servers, default baseUrl
    cache?: CacheAdapter;          // default: separate in-process memoryCache()
    introspectionTtlSeconds?: number; // default and max 60, never past exp
    grantStatusTtlSeconds?: number;   // default 0 (off), max 60
    scopesSupported?: string[]; resourceName?: string; resourceDocumentation?: string; logoUri?: string; // PRM
  };
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

#### Workflow actions (SI Actions)

`createSiActions` serves an app's actions to the SI Workflow Builder, so the app's work can run as a step in a hub workflow. The app declares each action (schemas plus a handler); the SDK verifies the hub's service token, scopes the call to the token's org and user, validates input and output, answers in the contract's shapes, and publishes the manifest the hub imports with `workflows:sync-capabilities`.

```ts
import { createSiActions, SiActionError } from "@supreme-ai/si-sdk/server";

export const siActions = createSiActions({
  app: "data-library",                         // app slug in SI
  baseUrl: process.env.SI_ACTIONS_BASE_URL!,   // this environment's public origin (local, staging, prod)
  hubUrl: process.env.SI_HUB_URL!,             // e.g. https://app.supremegroup.ai
  actions: [{
    id: "search_library",
    name: "Search the library",
    description: "Find evidence records by keyword. Returns titles, ids and a short summary.",
    inputSchema: { type: "object", properties: { query: { type: "string", maxLength: 200 } }, required: ["query"], additionalProperties: false },
    outputSchema: { type: "object", properties: { count: { type: "integer" }, summary: { type: "string" } }, required: ["count", "summary"] },
    annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
    handler: async ({ query }, ctx) => {
      // ctx.organizationId and ctx.userId come from the verified token only.
      return { count: 0, summary: `No records for ${query}.` };
    },
  }],
});

// Next.js: app/si/actions/[...path]/route.ts and app/.well-known/si-actions.json/route.ts
export async function POST(req: Request) {
  const r = await siActions.handle(req);
  return new Response(r.body, { status: r.status, headers: r.headers });
}
export const GET = POST;
```

| Route | Behaviour |
|-------|-----------|
| `GET /.well-known/si-actions.json` | Manifest (`si_actions_version: "1"`, `app`, `base_url`, `actions[]`; each action has `read_only`, `annotations`, `execution`), `Cache-Control: public, max-age=300` |
| `POST /si/actions/{id}` | Body `{ action_id?, input, context }`. `200 { status: "completed", output }`, or for async actions `202 { status: "accepted", job_id?, poll_url?, estimated_seconds? }` |
| `GET /si/actions/{id}/jobs/{jobId}` | Async actions with `getJob` only. `200 { status: "running" \| "completed" \| "failed", job_id, progress?, output?, error? }` |
| Errors | `{ error: { code, message, retryable, details? } }`: `bad_request` 400, `unauthenticated` 401, `unknown_action`/`unknown_job` 404, `validation_failed` 422, `internal_error` 500, `upstream_unavailable` 503 (retryable) |

Token checks, in order: `Authorization: Bearer`, `type: "service"`, `iss` (`supreme-intelligence`), `aud` contains `si-actions` and, when the token is scoped (`si-actions:<app>`), it names this app; not expired; `org_id` and `user_id` present. Then `POST {hubUrl}/api/verify-session-jwt` confirms the signature and its claims must match. Tokens are never cached. Org, user and run context come from the token, never from the body or headers.

Throw `SiActionError(code, message, details?)` from a handler for a contract error (for example `validation_failed` for a record the caller can't see). Any other exception becomes a generic `500`, and output that breaks `outputSchema` is refused.

`base_url` is exactly `baseUrl` (its origin); the SDK has no default, so set `SI_ACTIONS_BASE_URL` per environment. The hub may override an app's base URL, but the manifest should still be right for the environment serving it.

**Read-only actions.** `annotations.readOnlyHint: true` also publishes `read_only: true`. The hub sends `X-SI-Idempotency-Key` only for actions that are not read-only; `ctx.idempotencyKey` is `null` when the header is absent (never rejected). Dedupe write actions on it when present.

**Async actions.** Set `execution: { mode: "async" }` (defaults typical 60s, max 900s), return `acceptSiAction({ jobId?, pollUrl?, estimatedSeconds? })` from the handler (with a `jobId`, the hub refuses a callback carrying a different one), persist `ctx.callback` (`{ url, token }`, the token is a secret) with the job, and report later with `siActions.completeJob`:

```ts
handler: async (input, ctx) => {
  await queue.add({ input, org: ctx.organizationId, callback: ctx.callback });
  return acceptSiAction({ jobId });
},
getJob: async (jobId, ctx) => jobs.status(jobId, ctx.organizationId), // optional poll fallback

// in the worker
await siActions.completeJob("export_report", job.callback, { jobId, status: "completed", output });
await siActions.completeJob("export_report", job.callback, { jobId, status: "failed", error: { code: "export_failed", message: "..." } });
```

`completeJob` sends `POST {callback.url}` with `Authorization: Bearer {callback.token}` and body `{ status: "completed", job_id?, output }` or `{ status: "failed", job_id?, error: { code, message, retryable } }` (code clipped to 64, message to 2000). Completed output is checked against `outputSchema` first; output that fails is sent as a `failed` result instead. The callback carries the hub's bearer token, so the URL must be https on `supremegroup.ai` or a subdomain; http or https on `localhost`, `127.0.0.1`, `[::1]` or `*.localhost` is accepted only when `hubUrl` is itself a loopback origin (local development), and redirects are never followed (a 3xx returns `code: "redirect_refused"`). Each attempt times out after `timeoutMs` (10s); network errors, 429 and 5xx retry up to `retries` (3) with backoff (a 429's `Retry-After` is honoured, capped at 60s); any 2xx counts as delivered; any other 4xx (401 bad or already-used token, 404, 409, 410 run finished, 422) is final. It returns `{ delivered, accepted, status, code?, errors? }` and never throws for HTTP outcomes; `accepted: false` (hub rejected the output) is final too. `pollUrl` must be on `baseUrl`'s host and port (a path is resolved against `baseUrl`, so an internal request host behind a proxy never leaks into it; an invalid or off-host `pollUrl` is dropped with a warning); with `getJob` and a `jobId` it defaults to `/si/actions/{id}/jobs/{jobId}`.

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
| `createSiServerClient` | Server client: `auth`, `membership`, `organizations`, `mcp`, `locks`, `detection`, `audit` |
| `requireScope`, `bearerChallenge`, `bearerToken`, `canonicalResourceUri`, `isVerifiedPrincipal` | Auth helpers (1.3.0) |
| `scopeManifest`, `SCOPE_MANIFEST_PATH`, `SCOPE_MANIFEST_VERSION`, `MAX_DECLARED_SCOPES`, `MAX_SCOPE_MANIFEST_BYTES` | Scope declaration and the SI scope manifest (1.5.0, SI-419) |
| `memoryCache`, `memoryLockStore`, `supabaseLockStore`, `SUPABASE_LOCK_STORE_SQL` | Adapters and the Supabase migration |
| `createSiActions`, `acceptSiAction`, `SiActionError`, `audienceList`, `validateJsonSchema`, `SI_ACTIONS_VERSION`, `SI_ACTIONS_MANIFEST_PATH` | Workflow actions (SI Actions) server |
| `conversationKey`, `hashConversationKey` | Conversation-key resolver and SHA-256 hash |
| `annotations`, `labelResult`, `errorResult`, `orgBanner` | MCP helpers |
| `SiServerError`, `OrgAccessDeniedError`, `OrgLockedError`, `UserGoneError`, `SiUnavailableError`, `MisconfiguredKeyError`, `AppInactiveError`, `LockStoreUnavailableError`, `InvalidArgumentError`, `InvalidTokenError`, `InsufficientScopeError`, `SiValidationError`, `isSiServerError` | Errors |
| `SERVER_SDK_VERSION`, `MAX_ALLOW_TTL_SECONDS`, `MAX_DENY_TTL_SECONDS`, `DEFAULT_LOCK_TTL_SECONDS`, `DEFAULT_DETECTION_WINDOW_SECONDS`, `AUDIT_EVENTS_PATH`, `DEFAULT_CODEX_HEADERS`, `DEFAULT_SI_HEADER`, `INTROSPECT_PATH`, `GRANT_STATUS_PATH`, `PROTECTED_RESOURCE_METADATA_PATH`, `MAX_INTROSPECTION_TTL_SECONDS`, `MAX_GRANT_STATUS_TTL_SECONDS`, `GRANT_STATUS_CHUNK_SIZE` | Constants |
| Types | `SiServerConfig`, `AuthConfig`, `IntrospectionPrincipal`, `GrantStatus`, `AuthApi`, `AuthChallenge`, `ProtectedResourceMetadata`, `ScopeDeclaration`, `ScopeKind`, `ScopeManifest`, `ScopeManifestResponse`, `Membership`, `ResolvedOrganization`, `ToolScope`, `ScopeToolCallInput`, `McpToolResult`, `AuditEvent`, `CacheAdapter`, `LockStoreAdapter`, … |

---

## License

MIT

---

## Changelog

> Every change to this repo gets an entry here. Newest at the top. See [CLAUDE.md](CLAUDE.md) for the rule.

### 2026-10-27

- Org logos (1.6.0, SI-429): `MembershipOrganization.logoUrl` (`string | null`), so `si.membership.get`, `requireOrg`, `si.organizations.resolve` and the introspection principal's `organizations` carry SI's public org image URL. Only an absolute URL on `baseUrl`'s origin is kept; a missing or other `logo_url` becomes `null` instead of failing the answer, and older cached answers read back as `null`. TypeScript: code that builds `MembershipOrganization` objects itself must add `logoUrl`. [types.ts](src/server/types.ts), [membership.ts](src/server/membership.ts), [docs/SERVER.md](docs/SERVER.md), [CHANGELOG.md](CHANGELOG.md). Browser entry unchanged.

### 2026-10-16

- Declare MCP scopes once in the server entry (1.5.0, SI-419): new `auth.scopes` (`{ name, label, description?, kind }`) with `auth.resourceSlug`, validated against the SI scope manifest contract at construction (`InvalidArgumentError` naming the rule). The one list feeds the PRM `scopes_supported` (an explicit `auth.scopesSupported` still works, and with `scopes` narrows the PRM to a subset) and the SI scope manifest, served by `si.auth.scopeManifest()` / `scopeManifestResponse()` at `/.well-known/si-mcp-scopes.json` (`SCOPE_MANIFEST_PATH`; `Cache-Control: public, max-age=300`). `si.auth.requireScope` rejects undeclared names. New exports `scopeManifest()`, constants and types; `canonicalResourceUri` moved to [resource.ts](src/server/resource.ts). SI approves new or changed scopes before users see them. [scopes.ts](src/server/scopes.ts), [auth.ts](src/server/auth.ts), [docs/SERVER.md](docs/SERVER.md#declaring-scopes), [Server entry](#server-entry), [SKILL.md](SKILL.md), [CHANGELOG.md](CHANGELOG.md). Browser entry unchanged.
- `completeJob` accepts loopback callback URLs only when `hubUrl` is a loopback origin; with any other `hubUrl` only https on `supremegroup.ai` or a subdomain is allowed. [callback.ts](src/server/actions/callback.ts), [actions/](src/server/actions/index.ts), [docs/SERVER.md](docs/SERVER.md).
- SI Actions (1.4.0): manifest actions carry `read_only` (from `annotations.readOnlyHint`); `idempotencyKey` is `null` when the hub sends no key. Async actions: `execution.mode: "async"`, `acceptSiAction()` answers 202 with optional `job_id` and same-host `poll_url`, optional `getJob` serves `GET /si/actions/{id}/jobs/{jobId}`, and `siActions.completeJob()` posts the result to the hub callback with the bearer token (https on `*.supremegroup.ai` only, or loopback when `hubUrl` is loopback; no redirects; timeout; retries on network/429/5xx only, honours `Retry-After`, any 2xx is delivered). Hub token verification times out after `verifyTimeoutMs` (5s) and answers `upstream_unavailable`; `hubUrl` must be https (http only for a loopback host). `poll_url` resolves against `baseUrl`. Server endpoints listed in [docs/SERVER.md](docs/SERVER.md#si-endpoints-used). `baseUrl` documented as per-environment. [actions/](src/server/actions/index.ts), [callback.ts](src/server/actions/callback.ts), README "Workflow actions".

### 2026-10-15

- Added token introspection and grant status to `@supreme-ai/si-sdk/server` (1.3.0, SI-378 v2 for SI-375 / SI-417): `si.auth.introspect` (`POST /api/oauth/introspect`; fails closed, checks `aud` and `exp`, caches `active: true` ≤ 60 s and ≤ `exp` keyed by a token hash, never caches negatives), `si.auth.grantStatus` (`POST /api/oauth/grants/status`, chunked by 100), `requireScope` / `InsufficientScopeError`, `challenge` (401 / 403 `WWW-Authenticate`, 503 + `Retry-After`), `protectedResourceMetadata` (echoes `?instance=`), new `auth` config and errors `InvalidTokenError`, `SiValidationError`; `scopeToolCall`, `organizations.resolve` and `listOrganizationsTool` accept the introspection principal (no membership call). `SiUnavailableError` gains `retryAfterSeconds`. [auth.ts](src/server/auth.ts), [docs/SERVER.md](docs/SERVER.md#token-introspection-siauth), [Server entry](#server-entry), [SKILL.md](SKILL.md), [CHANGELOG.md](CHANGELOG.md). Browser entry unchanged.
- Add `createSiActions` to the server entry: serves an app's actions to the SI Workflow Builder (manifest, hub service-token verification, input/output validation, contract errors). Sync actions only. [actions/](src/server/actions/index.ts), README "Workflow actions".

### 2026-10-07

- Fix (1.2.1, SI-378), matters for Claude clients: `labelResult`, `errorResult` and `listOrganizationsTool` no longer emit `structuredContent` (Claude shows the model only `structuredContent` when present, so labelled results lost their data and banner). `labelResult` now returns `[banner, warning?, ...content]` and passes a caller-set `structuredContent` through unchanged; `errorResult` is text-only `Error (<code>): <message>`. [mcp.ts](src/server/mcp.ts), [docs/SERVER.md](docs/SERVER.md#no-structuredcontent-for-claude), [CHANGELOG.md](CHANGELOG.md).

### 2026-10-05

- Added the server-only entry `@supreme-ai/si-sdk/server` (1.2.0, SI-378): `createSiServerClient` with membership (`GET /api/membership/users/{user}/organizations`, fail closed, capped cache), slug-or-id org resolution, conversation-key lock (`memoryLockStore`, `supabaseLockStore` + SQL), cross-org detection, MCP helpers (`scopeToolCall`, `labelResult`, `annotations`, `listOrganizationsTool`, `errorResult`) and opt-in audit forwarding to `POST /api/membership/audit-events` (off by default; endpoint not live yet). New `./server` export with a throwing `browser` stub, `tsconfig.server.json` (no DOM), first jest suite. Docs: [docs/SERVER.md](docs/SERVER.md), [Server entry](#server-entry), [SKILL.md](SKILL.md), [CHANGELOG.md](CHANGELOG.md). Browser entry unchanged.
- Added the implementation plan [docs/plans/server-entry-plan.md](docs/plans/server-entry-plan.md).
- `SUPABASE_LOCK_STORE_SQL`: each new bind now purges up to 100 lock rows expired over a day ago (executable retention, replaces the optional pg_cron comment); stored data and retention documented in [docs/SERVER.md](docs/SERVER.md#supabase-lock-store). Tightened the `conversationKey` doc comment in [conversation.ts](src/server/conversation.ts).
- Documented that `userId` passed to the server entry must be the verified caller, never request input (v1 does not verify tokens): [docs/SERVER.md](docs/SERVER.md#identity-who-userid-is), README, SKILL.md, JSDoc in [mcp.ts](src/server/mcp.ts).

### 2026-05-27

- Realigned Skills to the real backend shape and adopted a summary-in-list / content-on-detail pattern: `getSkills` now returns `SkillSummary[]` (no `content`), `getSkillById` returns `Skill` with packaged `content`. Field names follow the live API (`title`, `content`, `creator`, `is_owner`, `template`); dropped the speculative `visibility`/`organization_id`/`category`/`version` fields and the `SkillVisibility` export. [docs/SKILLS_API.md](docs/SKILLS_API.md) and the Skills section of the README updated to match.

### 2026-05-22

- Added Skills API integration: `getSkills`, `getSkillById`, embedded-mode `requestUserSkills`, new `SkillsClient` export, `features.skills` flag (default on), `skillsApiBaseUrl` config (derived by default). Server filters out `visibility: 'private'` before responding — the SDK never exposes private skills. Endpoint contract documented in [docs/SKILLS_API.md](docs/SKILLS_API.md).
- Added [SKILL.md](SKILL.md) — a Claude Code skill consumer-app devs can install for SDK setup, auth-conflict avoidance (Supabase, Lovable, NextAuth, etc.), and local dev posture.
- Documented `avatar_url` on the user payload returned by `POST {authUrl}/login` in the [Auth](#auth) example.
- Added [CLAUDE.md](CLAUDE.md) with agent instructions for keeping docs in sync with API/SDK changes, and started this changelog at the bottom of the README.
