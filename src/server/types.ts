import type { FetchLike } from './runtime';
import type { CacheAdapter, LockStoreAdapter } from './adapters/types';
import type { ScopeDeclaration } from './scopes';

export interface Logger {
  warn(message: string, context?: Record<string, unknown>): void;
  error?(message: string, context?: Record<string, unknown>): void;
}

/** How SI says the app is available to the user in an org. */
export type AppGrant = 'organization' | 'role' | 'orgadmin' | 'superadmin' | (string & {});

export interface MembershipOrganization {
  id: number;
  slug: string;
  name: string;
  /**
   * Public URL of the org's picker image (its icon, else its logo) on SI's
   * host, or `null` when it has none. Loadable without a session; allow SI's
   * host in your `img-src` CSP. Square-ish PNG/JPG of any size: scale it down.
   */
  logoUrl: string | null;
  roles: string[];
  appGrant: AppGrant;
}

/** Normalized `GET /api/membership/users/{user}/organizations` answer. */
export interface Membership {
  user: { id: number };
  app: { id: number; name: string };
  isSuperadmin: boolean;
  organizations: MembershipOrganization[];
  /** SI's `meta.generated_at`. */
  generatedAt: string;
  /** True when served from the cache. */
  fromCache: boolean;
}

/** An organization the user may use in this app right now. */
export type ResolvedOrganization = MembershipOrganization;

/**
 * A verified SI access token: the normalized `active: true` answer of
 * `POST /api/oauth/introspect`. Only `si.auth.introspect` creates one (the
 * object is frozen, and `scopeToolCall` rejects look-alikes).
 */
export interface IntrospectionPrincipal {
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

export type GrantStatus = 'active' | 'revoked' | 'expired' | 'unknown';

export interface AuthConfig {
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
  /**
   * The SI resource slug (`mcp_resources` slug, e.g. `canva`). Required with
   * `scopes`: every declared name must be `mcp:<resourceSlug>:<verb>`.
   */
  resourceSlug?: string;
  /**
   * The app's MCP scopes, declared once (SI-419). Validated against the SI
   * manifest contract at construction (`InvalidArgumentError`). Serves the
   * PRM's `scopes_supported` and the manifest at `/.well-known/si-mcp-scopes.json`
   * (`si.auth.scopeManifest()`, `scopeManifestResponse()`), and makes
   * `si.auth.requireScope` reject undeclared names. Needs `resource`.
   */
  scopes?: ScopeDeclaration[];
  /**
   * `scopes_supported` in the PRM. Default: the names in `scopes`. With
   * `scopes` declared it must be a subset of them (narrows what the PRM
   * advertises, e.g. while a new scope is pending SI approval).
   */
  scopesSupported?: string[];
  /** `resource_name` in the PRM. */
  resourceName?: string;
  /** `resource_documentation` in the PRM. */
  resourceDocumentation?: string;
  /** `logo_uri` in the PRM. */
  logoUri?: string;
}

export type ToolKind = 'read' | 'write';
export type ScopeMode = 'locked' | 'soft';

export interface AuditEvent {
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

export interface AuditForwardingConfig {
  /** Default **false**. SI's endpoint ships with SI-379; enable once SI says it's live. */
  enabled?: boolean;
  /** Flush when this many events are queued. Default 50, max 500. */
  batchSize?: number;
  /** Flush this long after the first queued event. Default 5000 ms. */
  flushIntervalMs?: number;
}

export interface ConversationKeyOptions {
  /**
   * Headers carrying a Codex conversation id, checked in order after
   * `_meta["openai/session"]`. Default `['x-codex-conversation-id', 'x-codex-session-id']`.
   */
  codexHeaders?: string[];
  /** SI's own header for clients that can set one. Default `x-si-conversation`. */
  siHeader?: string;
}

export interface SiServerConfig {
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
