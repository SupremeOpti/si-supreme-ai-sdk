import type { FetchLike } from './runtime';
import type { CacheAdapter, LockStoreAdapter } from './adapters/types';

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
  /** Called for every `scopeToolCall`. Errors are swallowed. */
  onAudit?: (event: AuditEvent) => void | Promise<void>;
  /** Forward audit events to SI. Opt-in, default off. */
  auditForwarding?: AuditForwardingConfig;
  /** Clock override for tests. Milliseconds since epoch. */
  now?: () => number;
}
