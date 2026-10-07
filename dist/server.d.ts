/**
 * Structural types for the web-standard APIs the server entry uses. Public
 * signatures use these (not DOM or Node types), so the real `fetch`,
 * `Headers` and `Response` of any runtime fit without extra type packages.
 */
interface HeadersLike {
    get(name: string): string | null;
}
interface FetchInit {
    method?: string;
    headers?: Record<string, string>;
    body?: string;
    signal?: any;
}
interface FetchResponse {
    readonly status: number;
    readonly headers: HeadersLike;
    text(): Promise<string>;
}
type FetchLike = (input: string, init?: FetchInit) => Promise<FetchResponse>;

/**
 * Cache used for membership answers and detection state. Values are plain
 * JSON-serializable objects. Implementations may drop entries at any time;
 * the SDK treats read errors as a miss and ignores write errors.
 */
interface CacheAdapter {
    get(key: string): Promise<unknown | undefined>;
    /** `ttlSeconds` is always > 0. */
    set(key: string, value: unknown, ttlSeconds: number): Promise<void>;
    delete(key: string): Promise<void>;
}
interface SetIfAbsentResult {
    /** True when this call stored `value`. */
    created: boolean;
    /** The value stored under the key after the call: ours, or the winner's. */
    value: string;
}
/**
 * Store for conversation-key locks. `setIfAbsent` **must be atomic**: when
 * two callers race on an absent (or expired) key with different values,
 * exactly one gets `created: true` and both get the winner's value back.
 * Expired entries count as absent everywhere.
 */
interface LockStoreAdapter {
    get(key: string): Promise<string | null>;
    setIfAbsent(key: string, value: string, ttlSeconds: number): Promise<SetIfAbsentResult>;
    /** Extends a live entry's TTL. Returns false when the entry is gone. */
    touch(key: string, ttlSeconds: number): Promise<boolean>;
    delete(key: string): Promise<void>;
}

interface Logger {
    warn(message: string, context?: Record<string, unknown>): void;
    error?(message: string, context?: Record<string, unknown>): void;
}
/** How SI says the app is available to the user in an org. */
type AppGrant = 'organization' | 'role' | 'orgadmin' | 'superadmin' | (string & {});
interface MembershipOrganization {
    id: number;
    slug: string;
    name: string;
    roles: string[];
    appGrant: AppGrant;
}
/** Normalized `GET /api/membership/users/{user}/organizations` answer. */
interface Membership {
    user: {
        id: number;
    };
    app: {
        id: number;
        name: string;
    };
    isSuperadmin: boolean;
    organizations: MembershipOrganization[];
    /** SI's `meta.generated_at`. */
    generatedAt: string;
    /** True when served from the cache. */
    fromCache: boolean;
}
/** An organization the user may use in this app right now. */
type ResolvedOrganization = MembershipOrganization;
type ToolKind = 'read' | 'write';
type ScopeMode = 'locked' | 'soft';
interface AuditEvent {
    principalId: string;
    clientId: string;
    mode: ScopeMode;
    /** SHA-256 hex of the conversation key, or null in soft mode. */
    keyHash: string | null;
    /** Null when the org couldn't be resolved (denied before resolution). */
    organizationId: number | null;
    tool: string;
    kind: ToolKind;
    /** `allowed`, or the error `code` the call failed with. */
    outcome: string;
    /** ISO 8601. */
    occurredAt: string;
}
interface AuditForwardingConfig {
    /** Default **false**. SI's endpoint ships with SI-379; enable once SI says it's live. */
    enabled?: boolean;
    /** Flush when this many events are queued. Default 50, max 500. */
    batchSize?: number;
    /** Flush this long after the first queued event. Default 5000 ms. */
    flushIntervalMs?: number;
}
interface ConversationKeyOptions {
    /**
     * Headers carrying a Codex conversation id, checked in order after
     * `_meta["openai/session"]`. Default `['x-codex-conversation-id', 'x-codex-session-id']`.
     */
    codexHeaders?: string[];
    /** SI's own header for clients that can set one. Default `x-si-conversation`. */
    siHeader?: string;
}
interface SiServerConfig {
    /** SI origin, e.g. `https://app.supremegroup.ai`. Must be https (http allowed for localhost). */
    baseUrl: string;
    /** The app's `membership_api` key (`SI_MEMBERSHIP_KEY`). Server-side secret. */
    membershipKey: string;
    /** Membership + detection cache. Default `memoryCache()`. */
    cache?: CacheAdapter;
    /** Conversation-key lock store. Default `memoryLockStore()` (logs a warning: per-process only). */
    locks?: LockStoreAdapter;
    /** Fetch implementation. Default global `fetch`. */
    fetch?: FetchLike;
    /** Default `console`. */
    logger?: Logger;
    /** Per-attempt timeout for SI calls. Default 3000 ms. */
    timeoutMs?: number;
    membership?: {
        /** Cache TTL for successful answers. Default and max 300 s. */
        allowTtlSeconds?: number;
        /** Cache TTL for denials (`user_not_found`, no orgs, org missing). Default and max 30 s. */
        denyTtlSeconds?: number;
    };
    /** Sliding TTL of a conversation-key lock. Default 86400 s (24 h). */
    lockTtlSeconds?: number;
    detection?: {
        /** Default true. */
        enabled?: boolean;
        /** Read-then-write window. Default 900 s (15 min). */
        windowSeconds?: number;
    };
    conversation?: ConversationKeyOptions;
    /** Called for every `scopeToolCall`. Errors are swallowed. */
    onAudit?: (event: AuditEvent) => void | Promise<void>;
    /** Forward audit events to SI. Opt-in, default off. */
    auditForwarding?: AuditForwardingConfig;
    /** Clock override for tests. Milliseconds since epoch. */
    now?: () => number;
}

declare const SERVER_SDK_VERSION = "1.2.1";

declare const AUDIT_EVENTS_PATH = "/api/membership/audit-events";
interface AuditApi {
    /** Run the `onAudit` hook and queue the event for SI if forwarding is on. Never throws. */
    emit(event: AuditEvent): void;
    /**
     * Send queued events now. Never rejects. On edge runtimes, pass it to
     * `waitUntil` so the batch isn't lost when the isolate freezes.
     */
    flush(): Promise<void>;
    /** Whether forwarding to SI is enabled. */
    readonly forwarding: boolean;
}

declare const DEFAULT_DETECTION_WINDOW_SECONDS: number;
interface DetectionOrg {
    id: number;
    slug: string;
    name: string;
}
interface DetectionApi {
    /** Remember an org-scoped read. Never throws. */
    recordRead(principalId: string, clientId: string, org: DetectionOrg): Promise<void>;
    /**
     * Warning text when the same principal + client read another org within
     * the window, else null. Never throws, never blocks.
     */
    checkWrite(principalId: string, clientId: string, org: DetectionOrg): Promise<string | null>;
}

declare const DEFAULT_LOCK_TTL_SECONDS: number;
interface BindOrgInput {
    principalId: string;
    clientId: string;
    /** SHA-256 hex of the conversation key; `null` → soft mode, no lock. */
    keyHash: string | null;
    organizationId: number;
}
interface BindOrgResult {
    mode: 'locked' | 'soft';
    /** True when this call created the binding. */
    created: boolean;
}
interface LocksApi {
    /**
     * Bind `(principal, client, keyHash)` to an org. First call binds, the same
     * org passes (and slides the TTL), another org throws `OrgLockedError`.
     * A lock store failure throws `LockStoreUnavailableError` (fail closed).
     */
    bindOrg(input: BindOrgInput): Promise<BindOrgResult>;
    /** Remove a binding, e.g. from an admin "reset conversation" action. */
    release(input: Omit<BindOrgInput, 'organizationId'>): Promise<void>;
}

declare const MAX_ALLOW_TTL_SECONDS = 300;
declare const MAX_DENY_TTL_SECONDS = 30;
interface MembershipApi {
    /** The user's orgs for this app. Cached (allow ≤ 300 s; empty list / user_not_found ≤ 30 s). */
    get(userId: number | string): Promise<Membership>;
    /** Returns the org when the user may use it (by numeric id), else throws `OrgAccessDeniedError`. */
    requireOrg(userId: number | string, organizationId: number | string): Promise<ResolvedOrganization>;
    /** Finds an org in the membership, refetching once when the cached answer is older than the deny TTL. */
    findOrganization(userId: number | string, match: (org: MembershipOrganization) => boolean): Promise<{
        organization: MembershipOrganization | null;
        membership: Membership;
    }>;
    /** Drop the cached answer for a user. */
    invalidate(userId: number | string): Promise<void>;
}

/** Header-ish input: a Fetch `Headers`, or a plain object (Node `IncomingHttpHeaders`, etc.). */
type HeadersInput = HeadersLike | Record<string, string | string[] | undefined | null>;
interface ConversationKeySource {
    /** The HTTP request headers of the MCP call. */
    headers?: HeadersInput | null;
    /** The tool call's `params._meta`. */
    meta?: Record<string, unknown> | null;
}
declare const DEFAULT_CODEX_HEADERS: string[];
declare const DEFAULT_SI_HEADER = "x-si-conversation";
/**
 * Best available per-conversation key: `_meta["openai/session"]` (ChatGPT) →
 * Codex header → `X-SI-Conversation` → `null`. Never `Mcp-Session-Id`, which
 * Claude shares across conversations. A guard against model confusion, never
 * an authorization input.
 */
declare function conversationKey(source: ConversationKeySource | null | undefined, options?: ConversationKeyOptions): string | null;
/** SHA-256 hex of a conversation key. Only the hash is stored or forwarded. */
declare function hashConversationKey(key: string): Promise<string>;

interface OrganizationsApi {
    /**
     * Resolve an `organization` tool argument (slug, or numeric id as a string
     * or number) against the user's live SI membership. Unknown and
     * not-allowed orgs both throw `OrgAccessDeniedError`, so a caller can't
     * probe which orgs exist.
     */
    resolve(userId: number | string, organization: string | number): Promise<ResolvedOrganization>;
}

/** Minimal MCP `CallToolResult` shape. Extra fields pass through untouched. */
interface McpContentBlock {
    type: string;
    text?: string;
    [key: string]: unknown;
}
interface McpToolResult {
    content: McpContentBlock[];
    structuredContent?: Record<string, unknown>;
    isError?: boolean;
    [key: string]: unknown;
}
interface McpToolAnnotations {
    readonly readOnlyHint: boolean;
    readonly destructiveHint: boolean;
    readonly idempotentHint: boolean;
    readonly openWorldHint: boolean;
}
/**
 * Annotation presets. Correct hints make clients auto-run reads and put a
 * human in front of writes.
 */
declare const annotations: Readonly<{
    read: McpToolAnnotations;
    write: McpToolAnnotations;
    destructive: McpToolAnnotations;
}>;
interface ScopeToolCallInput {
    /**
     * SI user id of the **authenticated** caller: the `sub` of the token your
     * server verified. Never take it from tool arguments or other request
     * input; the SDK trusts it as the identity to check.
     */
    userId: number | string;
    /** The app's principal id for lock/detection/audit keys. Default `String(userId)`. */
    principalId?: string;
    /** OAuth client id or MCP client name: separates ChatGPT from Claude for the same user. */
    clientId: string;
    /** From `si.mcp.conversationKey(...)`. `null` → soft mode. */
    conversationKey: string | null;
    /** The tool's `organization` argument: slug (preferred) or numeric id. */
    organization: string | number;
    /** Tool name, for audit. */
    tool: string;
    kind: ToolKind;
}
interface ToolScope {
    organization: {
        id: number;
        slug: string;
        name: string;
    };
    roles: string[];
    appGrant: AppGrant;
    mode: ScopeMode;
    /** SHA-256 hex of the conversation key, or null in soft mode. */
    keyHash: string | null;
    /** Cross-org detection warning for writes, else null. */
    warning: string | null;
    userId: string;
    principalId: string;
    clientId: string;
    tool: string;
    kind: ToolKind;
}
interface ListOrganizationsTool {
    definition: {
        name: 'list_organizations';
        title: string;
        description: string;
        inputSchema: {
            type: 'object';
            properties: Record<string, never>;
            additionalProperties: false;
        };
        annotations: McpToolAnnotations;
    };
    /** Lists the user's orgs for this app, same shape as SI's `list_organizations`. `userId` must be the verified caller. */
    handler(input: {
        userId: number | string;
    }): Promise<McpToolResult>;
}
interface McpApi {
    conversationKey(source: ConversationKeySource | null | undefined): string | null;
    scopeToolCall(input: ScopeToolCallInput): Promise<ToolScope>;
    labelResult(result: McpToolResult, scope: Pick<ToolScope, 'organization' | 'warning'>): McpToolResult;
    errorResult(err: unknown): McpToolResult;
    listOrganizationsTool(): ListOrganizationsTool;
    readonly annotations: typeof annotations;
}
/** First line of every org-scoped result, e.g. `[Org: Kadiko (kadiko)]`. */
declare function orgBanner(org: {
    slug: string;
    name: string;
}): string;
/**
 * Label a tool result with its org: returns `content` as
 * `[banner, warning?, ...result.content]`, where the banner is a text block
 * `[Org: Name (slug)]` and the cross-org detection warning (if any) is its own
 * text block. Returns a new object; the input is not mutated.
 *
 * **Do not set `structuredContent` on results served to Claude.** When a
 * result has `structuredContent`, Claude passes only that object to the model
 * and drops the text blocks, so the model loses the banner, the warning and
 * any text data. This helper never creates or modifies `structuredContent`;
 * one the caller set is passed through unchanged (the org is not added to it).
 */
declare function labelResult(result: McpToolResult, scope: Pick<ToolScope, 'organization' | 'warning'>): McpToolResult;
/**
 * Standard MCP error result: `isError: true` and one text block
 * `Error (<code>): <message>`, no `structuredContent` (Claude would show the
 * model only that). SDK errors keep their stable `code` and public message;
 * anything else becomes `internal_error` without leaking detail.
 */
declare function errorResult(err: unknown): McpToolResult;

interface SiServerClient {
    membership: MembershipApi;
    organizations: OrganizationsApi;
    locks: LocksApi;
    detection: DetectionApi;
    audit: AuditApi;
    mcp: McpApi;
}
/**
 * Server-side SI client for app MCPs and APIs. Holds the app's secret
 * `membership_api` key: never construct it in browser code.
 */
declare function createSiServerClient(config: SiServerConfig): SiServerClient;

/**
 * Error classes for the server entry. Every class carries a stable `code`
 * string; the org-related codes match SI's MCP error codes (SI-379).
 *
 * `message` may contain operator detail (status codes, reasons) and is meant
 * for logs. `publicMessage` is safe to show to an MCP client or end user.
 */
type SiServerErrorCode = 'org_access_denied' | 'org_locked' | 'user_not_found' | 'si_unavailable' | 'misconfigured_key' | 'app_inactive' | 'lock_store_unavailable' | 'invalid_argument';
declare class SiServerError extends Error {
    readonly code: SiServerErrorCode;
    readonly publicMessage: string;
    constructor(code: SiServerErrorCode, message: string, publicMessage: string);
}
/** The user can't use the requested organization in this app (or it doesn't exist). */
declare class OrgAccessDeniedError extends SiServerError {
    readonly organization: string;
    constructor(organization: string | number);
}
interface LockedOrganization {
    id: number;
    slug?: string;
    name?: string;
}
/** The conversation is bound to another organization. */
declare class OrgLockedError extends SiServerError {
    readonly lockedOrganization: LockedOrganization;
    readonly requestedOrganization: LockedOrganization;
    constructor(locked: LockedOrganization, requested: LockedOrganization);
}
/** SI answered `404 user_not_found`. The app should revoke the user's connection. */
declare class UserGoneError extends SiServerError {
    readonly userId: string;
    constructor(userId: string | number);
}
type SiUnavailableReason = 'network' | 'timeout' | 'server_error' | 'rate_limited' | 'malformed_response' | 'unexpected_status';
/** SI couldn't give a usable answer. Always a deny. */
declare class SiUnavailableError extends SiServerError {
    readonly reason: SiUnavailableReason;
    readonly status?: number;
    constructor(reason: SiUnavailableReason, detail?: string, status?: number);
}
/** The membership key is missing, rejected (`401`) or not linked to an app (`500 misconfigured_key`). */
declare class MisconfiguredKeyError extends SiServerError {
    readonly status?: number;
    constructor(detail: string, status?: number);
}
/** SI answered `403 app_inactive`: the app is switched off on the SI side. */
declare class AppInactiveError extends SiServerError {
    constructor();
}
/** The lock store failed while a conversation key was present. Fails closed. */
declare class LockStoreUnavailableError extends SiServerError {
    constructor(detail: string);
}
/** A caller passed an unusable argument (bad user id, empty organization, ...). */
declare class InvalidArgumentError extends SiServerError {
    constructor(detail: string);
}
declare function isSiServerError(err: unknown): err is SiServerError;

interface MemoryAdapterOptions {
    /** Clock override for tests. Milliseconds since epoch. */
    now?: () => number;
}
/**
 * In-process cache. Fine for a single long-lived server and for tests. On
 * edge runtimes every isolate gets its own copy, which only costs extra SI
 * calls (the cache is never needed for correctness).
 */
declare function memoryCache(options?: MemoryAdapterOptions): CacheAdapter;
/**
 * In-process lock store. **Tests and local dev only**: locks are not shared
 * between processes or edge isolates, so production needs a shared store
 * such as `supabaseLockStore`.
 */
declare function memoryLockStore(options?: MemoryAdapterOptions): LockStoreAdapter;

/**
 * The subset of a supabase-js client this adapter uses. Pass a client
 * created with the **service role** key; the functions are not granted to
 * `anon` / `authenticated`.
 */
interface SupabaseRpcClient {
    rpc(fn: string, args: Record<string, unknown>): PromiseLike<{
        data: unknown;
        error: unknown;
    }>;
}
interface SupabaseLockStoreOptions {
    /** Prefix of the SQL functions. Default `si_lock` (see `SUPABASE_LOCK_STORE_SQL`). */
    functionPrefix?: string;
}
/**
 * Migration for `supabaseLockStore`. Atomicity comes from the primary key
 * plus `INSERT ... ON CONFLICT DO UPDATE ... WHERE expired`: of two racing
 * first binds, the second waits on the key, sees the committed live row, and
 * gets the winner's value back.
 */
declare const SUPABASE_LOCK_STORE_SQL = "-- @supreme-ai/si-sdk/server: conversation-key lock store\ncreate table if not exists public.si_conversation_locks (\n  key        text primary key,\n  value      text not null,\n  expires_at timestamptz not null\n);\n\n-- No policies: only the service role (which bypasses RLS) may touch it.\nalter table public.si_conversation_locks enable row level security;\n\ncreate index if not exists si_conversation_locks_expires_at_idx\n  on public.si_conversation_locks (expires_at);\n\ncreate or replace function public.si_lock_get(p_key text)\nreturns text\nlanguage sql\nas $$\n  select value from public.si_conversation_locks\n  where key = p_key and expires_at > now();\n$$;\n\ncreate or replace function public.si_lock_set_if_absent(p_key text, p_value text, p_ttl_seconds integer)\nreturns table (created boolean, value text)\nlanguage plpgsql\nas $$\n#variable_conflict use_column\ndeclare\n  v_value text;\nbegin\n  insert into public.si_conversation_locks as l (key, value, expires_at)\n  values (p_key, p_value, now() + make_interval(secs => p_ttl_seconds))\n  on conflict (key) do update\n    set value = excluded.value, expires_at = excluded.expires_at\n    where l.expires_at <= now()\n  returning l.value into v_value;\n\n  if found then\n    -- Retention: each new bind purges up to 100 rows expired over a day ago.\n    delete from public.si_conversation_locks\n     where key in (select g.key from public.si_conversation_locks g\n                    where g.expires_at < now() - interval '1 day'\n                    order by g.expires_at\n                    limit 100\n                    for update skip locked);\n    return query select true, v_value;\n    return;\n  end if;\n\n  select l.value into v_value from public.si_conversation_locks l where l.key = p_key;\n  return query select false, v_value;\nend;\n$$;\n\ncreate or replace function public.si_lock_touch(p_key text, p_ttl_seconds integer)\nreturns boolean\nlanguage plpgsql\nas $$\nbegin\n  update public.si_conversation_locks\n     set expires_at = now() + make_interval(secs => p_ttl_seconds)\n   where key = p_key and expires_at > now();\n  return found;\nend;\n$$;\n\ncreate or replace function public.si_lock_delete(p_key text)\nreturns void\nlanguage sql\nas $$\n  delete from public.si_conversation_locks where key = p_key;\n$$;\n\nrevoke all on table public.si_conversation_locks from public, anon, authenticated;\ngrant select, insert, update, delete on table public.si_conversation_locks to service_role;\nrevoke execute on function public.si_lock_get(text) from public, anon, authenticated;\nrevoke execute on function public.si_lock_set_if_absent(text, text, integer) from public, anon, authenticated;\nrevoke execute on function public.si_lock_touch(text, integer) from public, anon, authenticated;\nrevoke execute on function public.si_lock_delete(text) from public, anon, authenticated;\ngrant execute on function public.si_lock_get(text) to service_role;\ngrant execute on function public.si_lock_set_if_absent(text, text, integer) to service_role;\ngrant execute on function public.si_lock_touch(text, integer) to service_role;\ngrant execute on function public.si_lock_delete(text) to service_role;\n";
/**
 * Reference lock store on Supabase Postgres. Requires `SUPABASE_LOCK_STORE_SQL`
 * to be applied. Any RPC error or unexpected payload throws, which the SDK
 * turns into a closed (denied) call.
 */
declare function supabaseLockStore(client: SupabaseRpcClient, options?: SupabaseLockStoreOptions): LockStoreAdapter;

export { AUDIT_EVENTS_PATH, type AppGrant, AppInactiveError, type AuditApi, type AuditEvent, type AuditForwardingConfig, type BindOrgInput, type BindOrgResult, type CacheAdapter, type ConversationKeyOptions, type ConversationKeySource, DEFAULT_CODEX_HEADERS, DEFAULT_DETECTION_WINDOW_SECONDS, DEFAULT_LOCK_TTL_SECONDS, DEFAULT_SI_HEADER, type DetectionApi, type DetectionOrg, type FetchInit, type FetchLike, type FetchResponse, type HeadersInput, type HeadersLike, InvalidArgumentError, type ListOrganizationsTool, type LockStoreAdapter, LockStoreUnavailableError, type LockedOrganization, type LocksApi, type Logger, MAX_ALLOW_TTL_SECONDS, MAX_DENY_TTL_SECONDS, type McpApi, type McpContentBlock, type McpToolAnnotations, type McpToolResult, type Membership, type MembershipApi, type MembershipOrganization, type MemoryAdapterOptions, MisconfiguredKeyError, OrgAccessDeniedError, OrgLockedError, type OrganizationsApi, type ResolvedOrganization, SERVER_SDK_VERSION, SUPABASE_LOCK_STORE_SQL, type ScopeMode, type ScopeToolCallInput, type SetIfAbsentResult, type SiServerClient, type SiServerConfig, SiServerError, type SiServerErrorCode, SiUnavailableError, type SiUnavailableReason, type SupabaseLockStoreOptions, type SupabaseRpcClient, type ToolKind, type ToolScope, UserGoneError, annotations, conversationKey, createSiServerClient, errorResult, hashConversationKey, isSiServerError, labelResult, memoryCache, memoryLockStore, orgBanner, supabaseLockStore };
