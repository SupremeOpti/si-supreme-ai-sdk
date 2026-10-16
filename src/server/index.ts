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
  InvalidTokenError,
  InsufficientScopeError,
  SiValidationError,
  isSiServerError,
} from './errors';
export type { SiServerErrorCode, SiUnavailableReason, LockedOrganization, InvalidTokenReason } from './errors';

export {
  bearerChallenge,
  bearerToken,
  canonicalResourceUri,
  isVerifiedPrincipal,
  requireScope,
  INTROSPECT_PATH,
  GRANT_STATUS_PATH,
  PROTECTED_RESOURCE_METADATA_PATH,
  MAX_INTROSPECTION_TTL_SECONDS,
  MAX_GRANT_STATUS_TTL_SECONDS,
  GRANT_STATUS_CHUNK_SIZE,
} from './auth';
export type { AuthApi, AuthChallenge, ChallengeOptions, IntrospectOptions, ProtectedResourceMetadata } from './auth';

export { scopeManifest, SCOPE_MANIFEST_PATH, SCOPE_MANIFEST_VERSION, MAX_DECLARED_SCOPES, MAX_SCOPE_MANIFEST_BYTES } from './scopes';
export type { ScopeKind, ScopeDeclaration, ScopeManifest, ScopeManifestResponse, ScopeManifestInput } from './scopes';

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
  IntrospectionPrincipal,
  GrantStatus,
  AuthConfig,
} from './types';

export { createSiActions, acceptSiAction, SiActionError, audienceList, validateJsonSchema, SI_ACTIONS_VERSION, SI_ACTIONS_MANIFEST_PATH } from './actions';
export type {
  SiActions,
  SiActionsConfig,
  SiActionDefinition,
  SiActionContext,
  SiActionAnnotations,
  SiActionRequest,
  SiActionResponse,
  SiActionErrorCode,
  SiActionCallback,
  SiActionAcceptOptions,
  SiActionAccepted,
  SiActionJobStatus,
  SiActionJobError,
  SiCallbackOptions,
  SiCallbackResult,
  JsonSchema,
} from './actions';
