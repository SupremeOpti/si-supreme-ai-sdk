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
| `VITE_ALLOWED_PARENTS` | `allowedOrigins` | `[window.location.origin]` |

Reports base URL is derived automatically:

```text
apiBaseUrl:  https://app.supremegroup.ai/api/secure-credits/jwt
reports:     https://app.supremegroup.ai/api/reports/jwt
```

Override with `reportsApiBaseUrl` if needed.

Personas use the API root (credits base with `/secure-credits/jwt` removed), e.g. `https://app.supremegroup.ai/api`.

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
| Embedded only | `requestCurrentUserState`, `requestUserOrganizations`, `requestUserPersonas` | postMessage to parent |

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

### Embedded mode (iframe / parent)

These methods use **postMessage** to the parent frame (no REST). Only available when `mode === 'embedded'`.

| SDK method | Child → parent message | Parent → child response |
|------------|------------------------|-------------------------|
| (init) | `REQUEST_JWT_TOKEN` | `JWT_TOKEN_RESPONSE` |
| `requestCurrentUserState()` | `REQUEST_CURRENT_USER_STATE` | `RESPONSE_CURRENT_USER_STATE` |
| `requestUserOrganizations()` | `REQUEST_USER_ORGS` | `RESPONSE_USER_ORGS` |
| `requestUserPersonas()` | `REQUEST_USER_PERSONAS` | `RESPONSE_USER_PERSONAS` |
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

## Configuration reference

```ts
interface CreditSDKConfig {
  apiBaseUrl?: string;
  agentsApiBaseUrl?: string;
  reportsApiBaseUrl?: string;
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
  };
  deepLinking?: boolean;            // embedded: notify parent on route change
  onAuthRequired?: () => void;
  onTokenExpired?: () => void;
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
| `ReportsClient`, `PersonasClient` | Standalone REST clients |
| `ParentIntegrator` | Parent-page iframe helper |
| Types | `User`, `Organization`, `Agent`, `Report`, `CreateReportParams`, … |

---

## License

MIT

---

## Changelog

> Every change to this repo gets an entry here. Newest at the top. See [CLAUDE.md](CLAUDE.md) for the rule.

### 2026-05-22

- Added [SKILL.md](SKILL.md) — a Claude Code skill consumer-app devs can install for SDK setup, auth-conflict avoidance (Supabase, Lovable, NextAuth, etc.), and local dev posture.
- Documented `avatar_url` on the user payload returned by `POST {authUrl}/login` in the [Auth](#auth) example.
- Added [CLAUDE.md](CLAUDE.md) with agent instructions for keeping docs in sync with API/SDK changes, and started this changelog at the bottom of the README.
