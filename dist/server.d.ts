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
/**
 * A verified SI access token: the normalized `active: true` answer of
 * `POST /api/oauth/introspect`. Only `si.auth.introspect` creates one (the
 * object is frozen, and `scopeToolCall` rejects look-alikes).
 */
interface IntrospectionPrincipal {
    /** SI user id, as a string. Key your user rows on it. */
    readonly sub: string;
    /** This app's canonical resource URI (already checked by the SDK). */
    readonly aud: string;
    /** Granted scopes (SI's space-separated `scope`, split). */
    readonly scope: readonly string[];
    /** The MCP client: its CIMD URL, or its DCR id. */
    readonly clientId: string;
    readonly clientName: string | null;
    /** The user's consent to this client at this resource. Stable across refreshes; use it as the connection id. */
    readonly grantId: string;
    /** The `resource` the client asked for: `aud`, or a query variant such as `…/mcp?instance=broth`. */
    readonly requestedResource: string;
    readonly isSuperadmin: boolean;
    /** Orgs the user may use this app in, computed live by SI (same shape as membership). May be empty. */
    readonly organizations: readonly Readonly<MembershipOrganization>[];
    /** Expiry, Unix seconds. */
    readonly exp: number;
    /** Issued at, Unix seconds. */
    readonly iat: number;
    /** SI's issuer. */
    readonly iss: string;
    /** Only when SI returns it. */
    readonly email?: string;
    /** Only when SI returns it. */
    readonly name?: string;
    /** True when served from the introspection cache. */
    readonly fromCache: boolean;
}
type GrantStatus = 'active' | 'revoked' | 'expired' | 'unknown';
interface AuthConfig {
    /**
     * This app's canonical MCP resource URI, exactly as registered in SI
     * (`mcp_resources.resource_uri`), e.g. `https://studio-canvas.supremegroup.ai/mcp`.
     * Introspection rejects tokens whose `aud` differs. Can also be passed per call.
     */
    resource?: string;
    /** SI's OAuth issuer for `authorization_servers` in the PRM. Default `baseUrl`. */
    issuer?: string;
    /**
     * Cache for introspection and grant-status answers. Default: a separate
     * in-process `memoryCache()` (not `config.cache`), so principals (which
     * carry email) stay in process unless you opt into a shared store.
     */
    cache?: CacheAdapter;
    /** Cache TTL for `active: true` answers, further capped by the token's `exp`. Default and max 60 s; 0 disables. */
    introspectionTtlSeconds?: number;
    /** Cache TTL for `active` grant statuses. Default 0 (off), max 60 s. */
    grantStatusTtlSeconds?: number;
    /** `scopes_supported` in the PRM. */
    scopesSupported?: string[];
    /** `resource_name` in the PRM. */
    resourceName?: string;
    /** `resource_documentation` in the PRM. */
    resourceDocumentation?: string;
    /** `logo_uri` in the PRM. */
    logoUri?: string;
}
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
    /** Token introspection, grant status and protected-resource metadata (`si.auth`). */
    auth?: AuthConfig;
    /** Called for every `scopeToolCall`. Errors are swallowed. */
    onAudit?: (event: AuditEvent) => void | Promise<void>;
    /** Forward audit events to SI. Opt-in, default off. */
    auditForwarding?: AuditForwardingConfig;
    /** Clock override for tests. Milliseconds since epoch. */
    now?: () => number;
}

declare const SERVER_SDK_VERSION = "1.3.0";

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

declare const INTROSPECT_PATH = "/api/oauth/introspect";
declare const GRANT_STATUS_PATH = "/api/oauth/grants/status";
declare const PROTECTED_RESOURCE_METADATA_PATH = "/.well-known/oauth-protected-resource";
/** SI's caching rule for `active: true` (and `active` grant statuses). */
declare const MAX_INTROSPECTION_TTL_SECONDS = 60;
declare const MAX_GRANT_STATUS_TTL_SECONDS = 60;
/** SI's batch limit for `grants/status`; larger inputs are chunked. */
declare const GRANT_STATUS_CHUNK_SIZE = 100;
interface IntrospectOptions {
    /** Canonical resource URI to check `aud` against. Default `config.auth.resource`. */
    resource?: string;
}
/** RFC 9728 protected-resource metadata. */
interface ProtectedResourceMetadata {
    resource: string;
    authorization_servers: string[];
    bearer_methods_supported: string[];
    scopes_supported?: string[];
    resource_name?: string;
    resource_documentation?: string;
    logo_uri?: string;
}
/** A ready-to-send HTTP error answer for an MCP request. Runtime-neutral: build your own `Response` from it. */
interface AuthChallenge {
    status: 401 | 403 | 500 | 503;
    headers: Record<string, string>;
    body: {
        error: string;
        error_description: string;
    };
}
interface ChallengeOptions {
    /** The MCP URL the client used (e.g. `req.url`); its query (`?instance=…`) is echoed into `resource_metadata`. */
    requestUrl?: string;
    /** Override the `resource_metadata` URL entirely. */
    resourceMetadataUrl?: string;
}
interface AuthApi {
    /**
     * Introspect an MCP client's bearer token against SI. Returns the verified
     * principal, or throws: `InvalidTokenError` (missing, inactive, wrong `aud`,
     * expired), `SiUnavailableError` (network, timeout, 5xx, 429, malformed),
     * `MisconfiguredKeyError`, `AppInactiveError`, `SiValidationError`. There is
     * no path that returns a principal without SI's `active: true`.
     */
    introspect(bearer: string | null | undefined, options?: IntrospectOptions): Promise<IntrospectionPrincipal>;
    /** Live grant states, chunked by 100. Throws on any failed chunk (no partial answers). */
    grantStatus(grantIds: readonly string[]): Promise<Record<string, GrantStatus>>;
    /** Throws `InsufficientScopeError` unless the principal has every scope. */
    requireScope(principal: Pick<IntrospectionPrincipal, 'scope'>, scope: string | readonly string[]): void;
    /** JSON for `/.well-known/oauth-protected-resource` (root and path-suffixed). */
    protectedResourceMetadata(requestUrl?: string): ProtectedResourceMetadata;
    /** The path-suffixed PRM URL for the 401 `resource_metadata` parameter. */
    resourceMetadataUrl(requestUrl?: string): string;
    /** Map an error from `introspect` / `requireScope` to a 401 / 403 / 503 answer with `WWW-Authenticate`. */
    challenge(err: unknown, options?: ChallengeOptions): AuthChallenge;
    /** The bearer token from an `Authorization` header, or null. */
    bearerToken(headers: HeadersInput | null | undefined): string | null;
}
/** True for a principal returned by `si.auth.introspect` (not a copy or a look-alike). */
declare function isVerifiedPrincipal(value: unknown): value is IntrospectionPrincipal;
/**
 * Canonical form of a resource URI, as SI compares them: lowercase scheme
 * and host, no default port, one trailing `/` stripped, query kept, no
 * fragment. Must be https (http only for localhost).
 */
declare function canonicalResourceUri(uri: string): string;
/**
 * `WWW-Authenticate` value for a Bearer challenge (RFC 6750 §3, RFC 9728 §5.1),
 * e.g. `Bearer error="insufficient_scope", scope="a b", resource_metadata="https://…"`.
 */
declare function bearerChallenge(params: {
    realm?: string;
    error?: 'invalid_token' | 'insufficient_scope' | 'invalid_request';
    errorDescription?: string;
    scope?: string | readonly string[];
    resourceMetadata?: string;
}): string;
/** The token of an `Authorization: Bearer <token>` header, or null. */
declare function bearerToken(headers: HeadersInput | null | undefined): string | null;
/**
 * Throws `InsufficientScopeError` unless `principal.scope` contains every
 * scope in `scope`. The error carries all of them (for the challenge's
 * `scope`), not only the missing ones.
 */
declare function requireScope(principal: Pick<IntrospectionPrincipal, 'scope'>, scope: string | readonly string[]): void;

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

interface OrganizationsApi {
    /**
     * Resolve an `organization` tool argument (slug, or numeric id as a string
     * or number). With a user id it checks the user's live SI membership; with
     * a principal from `si.auth.introspect` it uses the principal's
     * `organizations` (no second SI call). Unknown and not-allowed orgs both
     * throw `OrgAccessDeniedError`, so a caller can't probe which orgs exist.
     */
    resolve(user: number | string | IntrospectionPrincipal, organization: string | number): Promise<ResolvedOrganization>;
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
     * input; the SDK trusts it as the identity to check. Pass this or
     * `principal`.
     */
    userId?: number | string;
    /**
     * The principal from `si.auth.introspect` for this request. The org is
     * resolved from its `organizations` (no membership call); `userId`
     * defaults to its `sub` and `clientId` to its `clientId`.
     */
    principal?: IntrospectionPrincipal;
    /** The app's principal id for lock/detection/audit keys. Default `String(userId)`. */
    principalId?: string;
    /**
     * OAuth client id or MCP client name: separates ChatGPT from Claude for the
     * same user. Required with `userId`; defaults to `principal.clientId`.
     */
    clientId?: string;
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
    /**
     * Lists the user's orgs for this app, same shape as SI's `list_organizations`.
     * Pass the verified caller's `userId`, or the `principal` from
     * `si.auth.introspect` (no membership call).
     */
    handler(input: {
        userId?: number | string;
        principal?: IntrospectionPrincipal;
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
 * any text data. This helper never creates or modifies `structuredContent`.
 * If the caller sets one, it is passed through unchanged (the org is not added to it).
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
    /** Token introspection, grant status, scope checks and protected-resource metadata. */
    auth: AuthApi;
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
type SiServerErrorCode = 'org_access_denied' | 'org_locked' | 'user_not_found' | 'si_unavailable' | 'misconfigured_key' | 'app_inactive' | 'lock_store_unavailable' | 'invalid_argument' | 'invalid_token' | 'insufficient_scope' | 'validation_failed';
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
    /** From SI's `Retry-After` on a `429`, when present. */
    readonly retryAfterSeconds?: number;
    constructor(reason: SiUnavailableReason, detail?: string, status?: number, retryAfterSeconds?: number);
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
type InvalidTokenReason = 
/** No bearer token on the request. */
'missing'
/** SI answered `{"active": false}`. */
 | 'inactive'
/** SI said active, but `aud` isn't this app's resource. */
 | 'audience_mismatch'
/** `exp` is in the past by the local clock. */
 | 'expired';
/**
 * The bearer token can't be used here. Answer the MCP client `401` with
 * `WWW-Authenticate: Bearer error="invalid_token", resource_metadata="…"`
 * (`si.auth.challenge(err)` builds it).
 */
declare class InvalidTokenError extends SiServerError {
    readonly reason: InvalidTokenReason;
    constructor(reason: InvalidTokenReason);
}
/**
 * The token is valid but lacks a scope the operation needs. Answer `403`
 * with `WWW-Authenticate: Bearer error="insufficient_scope", scope="…"`,
 * listing **every** scope the operation needs so the client can step up.
 */
declare class InsufficientScopeError extends SiServerError {
    /** Every scope the operation needs (what goes in the challenge's `scope`). */
    readonly requiredScopes: string[];
    /** The required scopes the token doesn't have. */
    readonly missingScopes: string[];
    constructor(requiredScopes: string[], missingScopes: string[]);
}
/** SI answered `422 validation_failed`: the SDK sent a request SI rejects. Always a deny. */
declare class SiValidationError extends SiServerError {
    readonly errors: Record<string, unknown>;
    constructor(errors?: Record<string, unknown>);
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

/** JSON Schema subset the hub and the SDK both understand. Always `type: 'object'` at the top. */
type JsonSchema = Record<string, unknown>;
/** Who the hub says is running the step. Comes from the verified service token only. */
interface SiActionContext {
    organizationId: number;
    organizationSlug: string | null;
    userId: number;
    workflowId: number | null;
    runId: number | null;
    nodeId: string | null;
    attempt: number;
    /**
     * `X-SI-Idempotency-Key`: stable for one step of one run across retries. The hub
     * sends it only for actions that are not `read_only`, so expect null on those.
     */
    idempotencyKey: string | null;
    /** Where to report an async job's result (from the request body). Null when the hub sent none. */
    callback: SiActionCallback | null;
}
/** The hub's single-use completion endpoint for one step. Persist it with the job; the token is a secret. */
interface SiActionCallback {
    url: string;
    token: string;
}
/** What a handler passes to `acceptSiAction` to answer 202 and finish later. */
interface SiActionAcceptOptions {
    /** Optional app id for the job. When given, the hub refuses a callback with a different `job_id` (409). */
    jobId?: string;
    /**
     * Status URL the hub may poll if the callback never arrives. Absolute or path-only; it must be on the
     * host the hub called. Defaults to `/si/actions/{id}/jobs/{jobId}` when the action has `getJob` and a jobId is set.
     */
    pollUrl?: string;
    estimatedSeconds?: number;
}
interface SiActionAccepted {
    readonly __siAccepted: true;
    readonly jobId?: string;
    readonly pollUrl?: string;
    readonly estimatedSeconds?: number;
}
interface SiActionJobError {
    code: string;
    message: string;
    retryable?: boolean;
}
/** An async job's state, as `getJob` reports it to a poll and `completeJob` reports it to the callback. */
type SiActionJobStatus<O = Record<string, unknown>> = {
    status: 'running';
    progress?: number;
} | {
    status: 'completed';
    output: O;
} | {
    status: 'failed';
    error: SiActionJobError;
};
interface SiCallbackOptions {
    /** Per attempt. Default 10000. */
    timeoutMs?: number;
    /** Extra attempts on network errors, 429 and 5xx; any other 4xx is final. Default 3. */
    retries?: number;
}
/** Outcome of `completeJob`. It never throws for HTTP outcomes. */
interface SiCallbackResult {
    /** The hub took the callback (HTTP 200). */
    delivered: boolean;
    /** Delivered and the output passed the hub's schema check. */
    accepted: boolean;
    /** Last HTTP status, 0 when the hub was unreachable. */
    status: number;
    /** Hub error code (`unauthenticated`, `unknown_job`, `idempotency_conflict`, `gone`, ...) or `invalid_output`. */
    code?: string;
    errors?: string[];
}
interface SiActionAnnotations {
    readOnlyHint?: boolean;
    idempotentHint?: boolean;
    openWorldHint?: boolean;
}
interface SiActionDefinition<I = Record<string, unknown>, O = Record<string, unknown>> {
    /** `^[a-z0-9_]{1,48}$`. Append-only: never rename a shipped id. */
    id: string;
    name: string;
    /** Read by the hub's AI to decide when to use the action. Say what it does, what it needs and what it returns. */
    description: string;
    inputSchema: JsonSchema;
    outputSchema: JsonSchema;
    /** `readOnlyHint: true` also sets the manifest's `read_only`, so the hub sends no idempotency key. */
    annotations?: SiActionAnnotations;
    /**
     * `mode: 'async'` lets the handler return `acceptSiAction(...)` (202) and report later with
     * `completeJob`. Defaults: sync typical 10s / max 120s, async typical 60s / max 900s.
     */
    execution?: {
        mode?: 'sync' | 'async';
        typicalSeconds?: number;
        maxSeconds?: number;
    };
    examples?: Array<{
        input?: Record<string, unknown>;
        output?: Record<string, unknown>;
    }>;
    handler(input: I, context: SiActionContext): Promise<O | SiActionAccepted>;
    /** Async only: answers the hub's poll at `GET /si/actions/{id}/jobs/{jobId}`. Scope the lookup to `context.organizationId`. */
    getJob?(jobId: string, context: SiActionContext): Promise<SiActionJobStatus<O> | null>;
}
interface SiActionsConfig {
    /** App slug as registered in SI, e.g. `data-library`. Tokens must be issued for this app. */
    app: string;
    /**
     * Public origin the hub calls in this environment, goes into the manifest as `base_url`. Read it
     * from env (e.g. `process.env.SI_ACTIONS_BASE_URL`) so local, staging and prod each publish their own.
     */
    baseUrl: string;
    /** SI hub origin that verifies service tokens, e.g. `https://app.supremegroup.ai`. */
    hubUrl: string;
    actions: SiActionDefinition<any, any>[];
    /** Default `supreme-intelligence`. */
    issuer?: string;
    /** Default `si-actions`. */
    audience?: string;
    fetch?: FetchLike;
    logger?: Logger;
    now?: () => number;
}
/** Minimal request shape: the runtime's real `Request` fits. */
interface SiActionRequest {
    readonly method: string;
    readonly url: string;
    readonly headers: {
        get(name: string): string | null;
    };
    text(): Promise<string>;
}
/** Plain response the adapter turns into the runtime's `Response`. */
interface SiActionResponse {
    status: number;
    headers: Record<string, string>;
    body: string;
}
type SiActionErrorCode = 'bad_request' | 'unauthenticated' | 'org_not_authorized' | 'unknown_action' | 'unknown_job' | 'validation_failed' | 'internal_error' | 'upstream_unavailable';

/** Throw from a handler to answer with a contract error instead of a 500. */
declare class SiActionError extends Error {
    readonly code: SiActionErrorCode;
    readonly status: number;
    readonly retryable: boolean;
    readonly details?: Record<string, unknown>;
    constructor(code: SiActionErrorCode, message: string, details?: Record<string, unknown>);
}

/** `aud` may be a string or a list; the hub sends `["si-actions", "si-actions:<app>"]`. */
declare function audienceList(aud: unknown): string[];

/**
 * Validates the JSON Schema subset actions use: object/array/string/number/
 * integer/boolean/null types (or a list of them), required, properties,
 * additionalProperties:false, enum, items, minLength/maxLength, minimum/maximum.
 * Returns problems as `path: message`, empty when valid.
 */
declare function validate(value: unknown, schema: JsonSchema, path?: string): string[];

declare const SI_ACTIONS_VERSION = "1";
declare const SI_ACTIONS_MANIFEST_PATH = "/.well-known/si-actions.json";
interface SiActions {
    /** The manifest the hub imports (`workflows:sync-capabilities`). */
    manifest(): Record<string, unknown>;
    /**
     * Routes `GET /.well-known/si-actions.json` and `POST /si/actions/{id}`.
     * Anything else gets a contract 404, so mount it on those paths only.
     */
    handle(request: SiActionRequest): Promise<SiActionResponse>;
    /**
     * Reports an async job's result to the hub: `POST callback.url` with `Bearer callback.token`.
     * Completed output is checked against the action's `outputSchema` first. Retries network errors,
     * 429 and 5xx (any other 4xx is final); never throws for HTTP outcomes.
     */
    completeJob(actionId: string, callback: SiActionCallback, result: {
        jobId?: string;
    } & (Extract<SiActionJobStatus, {
        status: 'completed';
    }> | Extract<SiActionJobStatus, {
        status: 'failed';
    }>), options?: SiCallbackOptions): Promise<SiCallbackResult>;
}
/** Return this from an async action's handler to answer `202 { status: "accepted", job_id?, poll_url?, estimated_seconds? }`. */
declare function acceptSiAction(options?: SiActionAcceptOptions): SiActionAccepted;
/**
 * Serves an app's actions to the SI Workflow Builder (SI Actions contract v1):
 * verifies the hub's service token, scopes every call to the token's org and
 * user, validates input and output against the declared schemas, and answers
 * in the contract's shapes. Async actions answer 202 via `acceptSiAction` and
 * report later with `completeJob`.
 *
 * Pass `baseUrl` from env per environment (local, staging, prod): it is the
 * manifest's `base_url`, and nothing in the SDK defaults it.
 */
declare function createSiActions(config: SiActionsConfig): SiActions;

export { AUDIT_EVENTS_PATH, type AppGrant, AppInactiveError, type AuditApi, type AuditEvent, type AuditForwardingConfig, type AuthApi, type AuthChallenge, type AuthConfig, type BindOrgInput, type BindOrgResult, type CacheAdapter, type ChallengeOptions, type ConversationKeyOptions, type ConversationKeySource, DEFAULT_CODEX_HEADERS, DEFAULT_DETECTION_WINDOW_SECONDS, DEFAULT_LOCK_TTL_SECONDS, DEFAULT_SI_HEADER, type DetectionApi, type DetectionOrg, type FetchInit, type FetchLike, type FetchResponse, GRANT_STATUS_CHUNK_SIZE, GRANT_STATUS_PATH, type GrantStatus, type HeadersInput, type HeadersLike, INTROSPECT_PATH, InsufficientScopeError, type IntrospectOptions, type IntrospectionPrincipal, InvalidArgumentError, InvalidTokenError, type InvalidTokenReason, type JsonSchema, type ListOrganizationsTool, type LockStoreAdapter, LockStoreUnavailableError, type LockedOrganization, type LocksApi, type Logger, MAX_ALLOW_TTL_SECONDS, MAX_DENY_TTL_SECONDS, MAX_GRANT_STATUS_TTL_SECONDS, MAX_INTROSPECTION_TTL_SECONDS, type McpApi, type McpContentBlock, type McpToolAnnotations, type McpToolResult, type Membership, type MembershipApi, type MembershipOrganization, type MemoryAdapterOptions, MisconfiguredKeyError, OrgAccessDeniedError, OrgLockedError, type OrganizationsApi, PROTECTED_RESOURCE_METADATA_PATH, type ProtectedResourceMetadata, type ResolvedOrganization, SERVER_SDK_VERSION, SI_ACTIONS_MANIFEST_PATH, SI_ACTIONS_VERSION, SUPABASE_LOCK_STORE_SQL, type ScopeMode, type ScopeToolCallInput, type SetIfAbsentResult, type SiActionAcceptOptions, type SiActionAccepted, type SiActionAnnotations, type SiActionCallback, type SiActionContext, type SiActionDefinition, SiActionError, type SiActionErrorCode, type SiActionJobError, type SiActionJobStatus, type SiActionRequest, type SiActionResponse, type SiActions, type SiActionsConfig, type SiCallbackOptions, type SiCallbackResult, type SiServerClient, type SiServerConfig, SiServerError, type SiServerErrorCode, SiUnavailableError, type SiUnavailableReason, SiValidationError, type SupabaseLockStoreOptions, type SupabaseRpcClient, type ToolKind, type ToolScope, UserGoneError, acceptSiAction, annotations, audienceList, bearerChallenge, bearerToken, canonicalResourceUri, conversationKey, createSiActions, createSiServerClient, errorResult, hashConversationKey, isSiServerError, isVerifiedPrincipal, labelResult, memoryCache, memoryLockStore, orgBanner, requireScope, supabaseLockStore, validate as validateJsonSchema };
