# `@supreme-ai/si-sdk/server`

Server-side helpers for app MCP servers and APIs that trust Supreme Intelligence (SI) for identity, membership, roles and app grants. Since 1.2.0 (SI-378).

- **Server-only.** It holds the app's secret `membership_api` key. The browser entry (`@supreme-ai/si-sdk`) never re-exports it, and bundlers that resolve the `browser` export condition get a stub that throws `@supreme-ai/si-sdk/server is server-only`.
- **Runtime-neutral.** Only `fetch`, Web Crypto, `URL`, `TextEncoder`, `AbortController`, `setTimeout`. Runs on Node 18+, Next.js route handlers / server actions (Node and Edge runtimes), Supabase edge functions (Deno) and Workers. No runtime dependencies.
- **Fails closed.** Network error, timeout, 5xx, `429` without a fresh cached answer, malformed body, rejected or misconfigured key, inactive app: every one is a deny (a thrown error). No code path returns "allowed" without a successful SI answer.

Contents: [Install](#install) · [Configuration](#configuration) · [Org-isolation model](#org-isolation-model-in-app-terms) · [Worked MCP tool handler](#worked-mcp-tool-handler) · [API](#api) · [Errors](#errors) · [Adapters](#adapters) · [Supabase lock store SQL](#supabase-lock-store) · [Audit forwarding](#audit-forwarding) · [SI endpoints used](#si-endpoints-used) · [Not in the SDK](#not-in-the-sdk) · [Version policy](#version-policy)

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

## Org-isolation model in app terms

SI's model (`mcp-org-session-isolation-plan.md`, rev 3) applies to every app MCP. The SDK implements the shared parts; the app wires them into every org-scoped tool.

1. **Explicit org on every org-scoped tool.** Add an `organization` argument that takes the org **slug** (preferred: a human approving the call can read it) or the numeric id as a string. No server-side "current org", no `select_instance`.
2. **Membership on every call.** `scopeToolCall` resolves the argument against SI's live membership answer (cached ≤ 5 min, denials ≤ 30 s). Unknown and not-allowed orgs get the same `org_access_denied` error.
3. **Conversation-key lock where the client sends a key.** `conversationKey()` tries `_meta["openai/session"]` (ChatGPT) → Codex conversation header → `X-SI-Conversation` (Claude Code via `headersHelper`, SI's own agents) → `null`. With a key, the first org-scoped call binds `(principal, client, sha256(key))` to that org and another org is refused (`org_locked`: "Start a new conversation to work in X"). Without a key (Claude.ai / Desktop / mobile send none) the call runs in **soft mode**: no lock. The key guards against model confusion; it is never an authorization input. **Nothing uses `Mcp-Session-Id`**: Claude shares one MCP session across every conversation, and MCP `2026-07-28` removes sessions.
4. **Org on every result.** `labelResult` adds `structuredContent.organization = { id, slug, name }` and a banner `[Org: Kadiko (kadiko)]` as the first text line.
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
        { content: [{ type: 'text', text: `Renamed canvas ${canvas.id}.` }], structuredContent: { canvas_id: canvas.id } },
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
    {
      "type": "text",
      "text": "[Org: Supreme Group (supreme-group)]\nWarning: this connection read Kadiko (kadiko) 4 min ago. Confirm nothing from Kadiko is in this write to Supreme Group (supreme-group).\nRenamed canvas 81."
    }
  ],
  "structuredContent": {
    "canvas_id": 81,
    "organization": { "id": 29, "slug": "supreme-group", "name": "Supreme Group" }
  }
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
  ],
  "structuredContent": {
    "error": {
      "code": "org_locked",
      "message": "This conversation is already working in Kadiko (kadiko). Start a new conversation to work in Supreme Group (supreme-group).",
      "locked_organization": { "id": 2, "slug": "kadiko", "name": "Kadiko" },
      "requested_organization": { "id": 29, "slug": "supreme-group", "name": "Supreme Group" }
    }
  }
}
```

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
| `resolve(userId, organization)` | `ResolvedOrganization` | `organization` is a slug (case-insensitive) or numeric id (string or number). All-digit input is always an id. Unknown or not allowed → `OrgAccessDeniedError`. |

### `si.mcp`

| Method | Returns | Notes |
|---|---|---|
| `conversationKey({ headers, meta })` | `string \| null` | `meta` is the tool call's `params._meta`; `headers` is a Fetch `Headers` or a plain object. Values over 512 chars are ignored. |
| `scopeToolCall(input)` | `ToolScope` | Org resolution + membership + lock (or soft mode) + detection + audit, in that order. |
| `labelResult(result, scope)` | `McpToolResult` | New object; input not mutated. |
| `errorResult(err)` | `McpToolResult` | `isError: true`, stable `code`, public message only. Unknown errors → `internal_error` with a generic message. |
| `listOrganizationsTool()` | `{ definition, handler }` | Read-only tool. `handler({ userId })` returns `{ data: [{ organization_id, slug, name, roles, app_grant }], meta: { count } }` as JSON text and `structuredContent`. Errors come back as `errorResult`. |
| `annotations` | presets | Same object as the top-level `annotations` export. |

```ts
interface ScopeToolCallInput {
  userId: number | string;          // SI user id (Supreme JWT sub)
  principalId?: string;             // default String(userId)
  clientId: string;                 // OAuth client id / MCP client: keeps ChatGPT and Claude apart
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

| Preset | `readOnlyHint` | `destructiveHint` | `idempotentHint` | `openWorldHint` |
|---|---|---|---|---|
| `annotations.read` | `true` | `false` | `true` | `false` |
| `annotations.write` | `false` | `false` | `false` | `false` |
| `annotations.destructive` | `false` | `true` | `false` | `false` |

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

`conversationKey(source, options?)`, `hashConversationKey(key)`, `labelResult`, `errorResult`, `orgBanner(org)`, `annotations`, `memoryCache`, `memoryLockStore`, `supabaseLockStore`, `SUPABASE_LOCK_STORE_SQL`, `SERVER_SDK_VERSION`, constants (`MAX_ALLOW_TTL_SECONDS`, `MAX_DENY_TTL_SECONDS`, `DEFAULT_LOCK_TTL_SECONDS`, `DEFAULT_DETECTION_WINDOW_SECONDS`, `AUDIT_EVENTS_PATH`, `DEFAULT_CODEX_HEADERS`, `DEFAULT_SI_HEADER`) and all types.

---

## Errors

Every class extends `SiServerError` with a stable `code`, a `message` for logs and a `publicMessage` safe for MCP clients. The org codes match SI's MCP error codes.

| Class | `code` | When | App action |
|---|---|---|---|
| `OrgAccessDeniedError` | `org_access_denied` | Org not in the user's membership for this app, or doesn't exist. | Show the error; the model can call `list_organizations`. |
| `OrgLockedError` | `org_locked` | Conversation key already bound to another org. `lockedOrganization`, `requestedOrganization`. | Tell the user to start a new conversation. |
| `UserGoneError` | `user_not_found` | SI `404 user_not_found`. Cached ≤ 30 s. | Revoke the user's connection / tokens. |
| `SiUnavailableError` | `si_unavailable` | Network error, timeout, 5xx, `429` without fresh cache, malformed body, unexpected status. `reason`: `network`, `timeout`, `server_error`, `rate_limited`, `malformed_response`, `unexpected_status`. | Retry later. |
| `MisconfiguredKeyError` | `misconfigured_key` | Empty key at construction, SI `401`, or SI `500 misconfigured_key`. `status` tells them apart. | Alert ops; ask SI to (re)issue the key. |
| `AppInactiveError` | `app_inactive` | SI `403 app_inactive`. | The app is switched off in SI. |
| `LockStoreUnavailableError` | `lock_store_unavailable` | The lock store failed while a conversation key was present. | Retry later; check the store. |
| `InvalidArgumentError` | `invalid_argument` | Bad `userId`, empty `organization`, missing `clientId` / `tool`, bad config. | Fix the caller. |

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

The SDK validates the whole `200` body (integer ids, string slug/name/app_grant, string-array roles, `data.user.id` equal to the requested user). Any mismatch is `si_unavailable` / `malformed_response`.

---

## Not in the SDK

- The app's own tools and asset permission rules (built on `scope.roles`).
- Data-layer enforcement (RLS / query scoping). The SDK returns the checked org; **the app must scope its queries with `scope.organization.id`**.
- Token issuance, consent and introspection (SI-375; a later version adds `si.auth.introspect`).

---

## Version policy

- Each release says in the changelog whether it contains a security fix.
- SI may send `X-SI-Min-Server-SDK` on its responses. When this SDK is older, it logs one warning through `logger.warn`.
- Apps using `si-sdk/server` are listed in the README so each release can be rolled out to them.

## Testing

```bash
npm run build && npm test                      # dist checks need a fresh build
SI_TEST_PG_URL=postgres://postgres:postgres@localhost:5432/postgres npx jest supabase-sql   # optional, real Postgres
```

Deno: the bundle is verified to import as plain ESM in Node (`node -e "import('./dist/server.mjs')"`). A Deno / Supabase edge smoke test is a follow-up for the first adopting app (si-canva, SI-380).
