/**
 * @supreme-ai/si-sdk/server
 *
 * Server-only helpers for app MCPs and APIs that trust Supreme Intelligence
 * for identity, membership, roles and app grants. Holds a secret key: never
 * import from browser code (the `browser` export condition throws).
 */

export { createSiServerClient } from './client';
export type { SiServerClient } from './client';

export {
  SiServerError,
  OrgAccessDeniedError,
  OrgLockedError,
  UserGoneError,
  SiUnavailableError,
  MisconfiguredKeyError,
  AppInactiveError,
  LockStoreUnavailableError,
  InvalidArgumentError,
  isSiServerError,
} from './errors';
export type { SiServerErrorCode, SiUnavailableReason, LockedOrganization } from './errors';

export { memoryCache, memoryLockStore } from './adapters/memory';
export type { MemoryAdapterOptions } from './adapters/memory';
export { supabaseLockStore, SUPABASE_LOCK_STORE_SQL } from './adapters/supabase';
export type { SupabaseRpcClient, SupabaseLockStoreOptions } from './adapters/supabase';
export type { CacheAdapter, LockStoreAdapter, SetIfAbsentResult } from './adapters/types';

export { conversationKey, hashConversationKey, DEFAULT_CODEX_HEADERS, DEFAULT_SI_HEADER } from './conversation';
export type { ConversationKeySource, HeadersInput } from './conversation';

export { annotations, labelResult, errorResult, orgBanner } from './mcp';
export type {
  McpApi,
  McpToolResult,
  McpContentBlock,
  McpToolAnnotations,
  ScopeToolCallInput,
  ToolScope,
  ListOrganizationsTool,
} from './mcp';

export { MAX_ALLOW_TTL_SECONDS, MAX_DENY_TTL_SECONDS } from './membership';
export type { MembershipApi } from './membership';
export type { OrganizationsApi } from './organizations';
export { DEFAULT_LOCK_TTL_SECONDS } from './locks';
export type { LocksApi, BindOrgInput, BindOrgResult } from './locks';
export { DEFAULT_DETECTION_WINDOW_SECONDS } from './detection';
export type { DetectionApi, DetectionOrg } from './detection';
export { AUDIT_EVENTS_PATH } from './audit';
export type { AuditApi } from './audit';
export { SERVER_SDK_VERSION } from './http';
export type { FetchLike, FetchInit, FetchResponse, HeadersLike } from './runtime';

export type {
  SiServerConfig,
  Logger,
  Membership,
  MembershipOrganization,
  ResolvedOrganization,
  AppGrant,
  ToolKind,
  ScopeMode,
  AuditEvent,
  AuditForwardingConfig,
  ConversationKeyOptions,
} from './types';
