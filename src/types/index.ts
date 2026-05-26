/**
 * Supreme AI Credit SDK - Type Definitions
 */

// Organization Type
export interface Organization {
  id?: string;
  name?: string;
  slug?: string;
  domain?: string;
  drive_folder_id?: string | null;
  logo_url?: string | null;
  org_icon?: string | null;
  selectedStatus?: boolean;
  isSelected?: boolean;
  credits?: number;
  user_role_ids?: number[];
  roles?: Record<string, string>;        // e.g. { "15": "orgadmin", "8": "HR" }
  agents?: {                              // agents nested within the org
    all?: Agent[];
    [roleId: string]: Agent[] | any;
  };
}

// User and Authentication Types
export interface User {
  id: number;
  email: string;
  name?: string;
  profile_image?: string | null;
  is_superadmin?: boolean;
  organizations?: Organization[];
  personas?: Array<{
    id: string;
    name: string;
    description?: string;
    category_id?: string | null;
    category_name?: string;
  }>;
  userRoleIds?: number[];
  userId?: string; // User ID from parent state
  userRole?: string; // User role from parent state
}

export interface AuthTokens {
  access_token: string;
  refresh_token: string;
  expires_in?: number;
}

export interface AuthResult {
  success: boolean;
  user?: User;
  tokens?: AuthTokens;
  message?: string;
  error?: string;
}

// Credit System Types
export interface CreditBalance {
  balance: number;
  currency?: string;
  updated_at?: string;
}

export interface Transaction {
  id: string;
  type: 'credit' | 'debit';
  amount: number;
  description?: string;
  reference_id?: string;
  created_at: string;
  balance_after: number;
}

export interface TransactionHistory {
  transactions: Transaction[];
  total: number;
  current_page: number;
  total_pages: number;
}

// SDK Configuration
export interface SDKFeatures {
  credits?: boolean;
  personas?: boolean;
  reports?: boolean;
  skills?: boolean;
}

export interface CreditSDKConfig {
  apiBaseUrl?: string;
  agentsApiBaseUrl?: string;
  /**
   * Base URL for the Reports JWT API. Defaults to `${apiBaseUrl without /secure-credits/jwt}/reports/jwt`,
   * i.e. `/api/reports/jwt` when `apiBaseUrl` is `/api/secure-credits/jwt`.
   */
  reportsApiBaseUrl?: string;
  /**
   * Base URL for the Skills JWT API. Defaults to `${apiBaseUrl without /secure-credits/jwt}/skills/jwt`,
   * i.e. `/api/skills/jwt` when `apiBaseUrl` is `/api/secure-credits/jwt`.
   */
  skillsApiBaseUrl?: string;
  authUrl?: string;
  parentTimeout?: number;
  tokenRefreshInterval?: number;
  balanceRefreshInterval?: number;
  allowedOrigins?: string[];
  autoInit?: boolean;
  debug?: boolean;
  storagePrefix?: string;
  mode?: 'auto' | 'embedded' | 'standalone';
  features?: SDKFeatures;
  /** Enable deep linking: auto-detect SPA route changes and notify the parent frame. Only active in embedded mode. */
  deepLinking?: boolean;
  onAuthRequired?: () => void;
  onTokenExpired?: () => void;
}

// SDK State
export interface SDKState {
  mode: 'embedded' | 'standalone' | null;
  isInIframe: boolean;
  isInitialized: boolean;
  isAuthenticated: boolean;
  isSuperAdmin: boolean;
  user: User | null;
  balance: number;
  personas: Persona[];
  accessToken: string | null;
  refreshToken: string | null;
  organizations: Organization[];
  selectedOrganization: Organization | null;
}

// Message Types for iframe Communication
export interface IframeMessage {
  type: string;
  timestamp: number;
  [key: string]: any;
}

export interface TokenRequestMessage extends IframeMessage {
  type: 'REQUEST_JWT_TOKEN';
  origin: string;
}

export interface TokenResponseMessage extends IframeMessage {
  type: 'JWT_TOKEN_RESPONSE';
  token?: string;
  refreshToken?: string;
  user?: User;
  isSuperAdmin?: boolean;
  organization?: {
    organizationId: string;
    organizationName: string;
    userRoleIds: number[];
  };
  organizations?: Organization[];
  personas?: Array<{
    id: string;
    name: string;
    description?: string;
    category_id?: string | null;
    category_name?: string;
  }>;
  error?: string;
}

export interface UserStateRequestMessage extends IframeMessage {
  type: 'REQUEST_CURRENT_USER_STATE';
  origin: string;
}

export interface UserStateResponseMessage extends IframeMessage {
  type: 'RESPONSE_CURRENT_USER_STATE';
  userState?: {
    orgId: string;
    orgName: string;
    orgSlug?: string;
    orgDomain?: string;
    driveFolderId?: string | null;
    orgLogoUrl?: string | null;
    orgIcon?: string | null;
    userRole: string;
    userId: string;
    userRoleIds?: number[]; // Array of role IDs (for consistency with JWT token response)
    isSuperAdmin?: boolean;
    profileImage?: string | null;
    personas?: any[];
  };
  error?: string;
}

export interface UserOrgsRequestMessage extends IframeMessage {
  type: 'REQUEST_USER_ORGS';
  origin: string;
}

export interface UserOrgsResponseMessage extends IframeMessage {
  type: 'RESPONSE_USER_ORGS';
  organizations?: Organization[];
  count?: number;
  error?: string;
}

export interface UserPersonasRequestMessage extends IframeMessage {
  type: 'REQUEST_USER_PERSONAS';
  origin: string;
}

export interface UserPersonasResponseMessage extends IframeMessage {
  type: 'RESPONSE_USER_PERSONAS';
  personas?: Array<{
    id: string;
    name: string;
    description?: string;
    category_id?: string | null;
    category_name?: string;
  }>;
  count?: number;
  error?: string;
}

export interface UserSkillsRequestMessage extends IframeMessage {
  type: 'REQUEST_USER_SKILLS';
  origin: string;
}

export interface UserSkillsResponseMessage extends IframeMessage {
  type: 'RESPONSE_USER_SKILLS';
  skills?: SkillSummary[];
  count?: number;
  error?: string;
}

export interface RouteChangedMessage extends IframeMessage {
  type: 'ROUTE_CHANGED';
  /** The full path including pathname, search params, and hash (e.g. "/posts/123?tab=comments#top") */
  path: string;
}

// Event Types
export type CreditSDKEvents = {
  'ready': { user: User | null; mode: string };
  'modeDetected': { mode: string };
  'authRequired': void;
  'loginSuccess': { user: User };
  'loginError': { error: string };
  'logoutSuccess': void;
  'balanceUpdate': { balance: number };
  'creditsSpent': {
    amount: number;
    description?: string;
    previousBalance: number;
    newBalance: number;
    transaction?: Transaction;
  };
  'creditsAdded': {
    amount: number;
    type: string;
    description?: string;
    previousBalance: number;
    newBalance: number;
    transaction?: Transaction;
  };
  'personasLoaded': { personas: Persona[] };
  'personasFailed': { error: string };
  'tokenRefreshed': void;
  'tokenExpired': void;
  'error': { type: string; error: string };
  'waitingForParent': void;
  'parentTimeout': void;
  'parentAuthRequired': { error: string };
  'organizationsUpdated': { organizations: Organization[] };
  'organizationSwitched': { previousOrgId?: string; newOrgId: string; organization: Organization };
  'tokensUpdated': { accessToken: string; refreshToken?: string };
  'routeChanged': { path: string };
};

// API Response Types
export interface ApiResponse<T = any> {
  success: boolean;
  data?: T;
  message?: string;
  error?: string;
}

export interface BalanceResponse {
  balance: number;
  currency?: string;
}

export interface SpendResponse {
  new_balance: number;
  transaction: Transaction;
}

export interface AddCreditsResponse {
  new_balance: number;
  transaction: Transaction;
}

// Operation Results
export interface OperationResult {
  success: boolean;
  error?: string;
}

export interface BalanceResult extends OperationResult {
  balance?: number;
}

export interface SpendResult extends OperationResult {
  newBalance?: number;
  transaction?: Transaction;
}

export interface AddResult extends OperationResult {
  newBalance?: number;
  transaction?: Transaction;
}

export interface HistoryResult extends OperationResult {
  transactions?: Transaction[];
  total?: number;
  page?: number;
  pages?: number;
}

export interface UserOrgsResult extends OperationResult {
  organizations?: Organization[];
  count?: number;
}

export interface UserPersonasResult extends OperationResult {
  personas?: Array<{
    id: string;
    name: string;
    description?: string;
    category_id?: string | null;
    category_name?: string;
  }>;
  count?: number;
}

export interface UserSkillsResult extends OperationResult {
  skills?: SkillSummary[];
  count?: number;
}

// Switch Organization Result
export interface SwitchOrgResult {
  success: boolean;
  error?: string;
  previousOrgId?: string;
  newOrgId?: string;
  // Only populated in standalone mode
  organizations?: Organization[];
  balance?: number;
  history?: {
    transactions: Transaction[];
    total: number;
    page: number;
    pages: number;
  };
  agents?: {
    all: Agent[];
    filtered: Agent[];
    roleGrouped: Record<string, { role_name: string; agents: Agent[] }>;
  };
  refreshErrors?: {
    balance?: string;
    history?: string;
    agents?: string;
  };
}

// React Hook Types
export interface UseCreditSystemReturn {
  isInitialized: boolean;
  isAuthenticated: boolean;
  isSuperAdmin: boolean;
  mode: 'embedded' | 'standalone' | null;
  user: User | null;
  balance: number | null;
  personas: Persona[];
  loading: boolean;
  error: string | null;
  accessToken: string | null;
  refreshToken: string | null;
  organizations: Organization[];
  selectedOrganization: Organization | null;
  login: (email: string, password: string) => Promise<AuthResult>;
  logout: () => Promise<void>;
  checkBalance: () => Promise<BalanceResult>;
  spendCredits: (amount: number, description?: string, referenceId?: string) => Promise<SpendResult>;
  addCredits: (amount: number, type?: string, description?: string) => Promise<AddResult>;
  getHistory: (page?: number, limit?: number) => Promise<HistoryResult>;
  getAgents: (all?: boolean) => Promise<AgentsResult>;
  getPersonas: () => Promise<PersonasResult>;
  getPersonaById: (id: number) => Promise<PersonaResult>;
  requestCurrentUserState: () => Promise<UserStateResult>;
  requestUserOrganizations: () => Promise<UserOrgsResult>;
  requestUserPersonas: () => Promise<UserPersonasResult>;
  switchOrganization: (orgId: string) => Promise<SwitchOrgResult>;
  // Reports — always scoped to the authenticated user (server enforces strict creator-only).
  listReports: (params?: ListReportsParams) => Promise<ReportsResult>;
  getReport: (id: number | string, organizationId?: string | number) => Promise<ReportResult>;
  createReport: (params: CreateReportParams) => Promise<ReportResult>;
  updateReport: (id: number | string, params: UpdateReportParams) => Promise<ReportResult>;
  // Skills — read-only; server filters out `private` visibility before returning.
  getSkills: (params?: ListSkillsParams) => Promise<SkillsResult>;
  getSkillById: (id: number | string) => Promise<SkillResult>;
  requestUserSkills: () => Promise<UserSkillsResult>;
}

// Persona Types
export interface Persona {
  id: number;
  name: string;
  description?: string;
  category?: string;
  created_at?: string;
  updated_at?: string;
  [key: string]: any;
}

export interface PersonasResult extends OperationResult {
  personas?: Persona[];
}

export interface PersonaResult extends OperationResult {
  persona?: Persona;
}

// User State Result
export interface UserStateResult extends OperationResult {
  userState?: {
    orgId: string;
    orgName: string;
    orgSlug?: string;
    orgDomain?: string;
    driveFolderId?: string | null;
    orgLogoUrl?: string | null;
    orgIcon?: string | null;
    userRole: string;
    userId: string;
    userRoleIds?: number[];
    isSuperAdmin?: boolean;
    profileImage?: string | null;
    personas?: any[];
  };
}

// AI Agent Types
export interface Agent {
  id: number;
  name: string;
  description?: string;
  short_desc?: string;
  assistant_id?: string;
  is_default?: boolean;
  grant_type?: string;
  status?: string;
  created_at?: string;
  updated_at?: string;
  [key: string]: any;
}

// Role-grouped agents structure
export interface RoleGroupedAgents {
  [roleId: string]: {
    role_name: string;
    agents: Agent[];
  };
}

export interface AgentsResult extends OperationResult {
  agents?: Agent[];
  roleGrouped?: RoleGroupedAgents;
  total?: number;
}

// Reports Types
//
// All reports operations are scoped to the authenticated user via JWT.
// The server enforces strict creator-only access: a user can only ever read,
// list, create, or update reports they created themselves. The SDK never
// accepts a creator/user ID — the JWT identifies the user.
export type ReportVisibility = 'inherit' | 'personal' | 'internal' | 'client' | 'public';

export interface ReportSummary {
  id: number;
  organization_id: number;
  folder_id: number | null;
  title: string;
  visibility: ReportVisibility;
  pinned: boolean;
  url: string;
  created_at: string;
  updated_at: string;
  edited_at: string | null;
}

export interface Report extends ReportSummary {
  /** HTML body fragment. Always returned by GET /{id}. Omitted from list responses and from create/update unless `includeBody: true` is passed. */
  body?: string;
}

export interface ListReportsParams {
  /** Defaults to the SDK's currently selected organization. */
  organizationId?: string | number;
  folderId?: string | number | null;
  cursor?: string;
  /** Default 25, max 100 (server enforced). */
  perPage?: number;
}

export interface CreateReportParams {
  title: string;
  body: string;
  visibility: ReportVisibility;
  folderId?: number | null;
  pinned?: boolean;
  /** When true, the server echoes the persisted HTML body back. Defaults to false to avoid large payloads. */
  includeBody?: boolean;
  /** Defaults to the SDK's currently selected organization. */
  organizationId?: string | number;
}

export interface UpdateReportParams {
  title?: string;
  body?: string;
  visibility?: ReportVisibility;
  folderId?: number | null;
  pinned?: boolean;
  /** When true, the server echoes the persisted HTML body back. Defaults to false to avoid large payloads. */
  includeBody?: boolean;
  /** Defaults to the SDK's currently selected organization. */
  organizationId?: string | number;
}

export interface ReportsResult extends OperationResult {
  reports?: Report[];
  /** Opaque cursor for the next page, or null when there are no more pages. */
  nextCursor?: string | null;
}

export interface ReportResult extends OperationResult {
  report?: Report;
  /** Populated on 422 responses: `{ field: [messages, ...] }`. */
  validationErrors?: Record<string, string[]>;
}

// Skills Types
//
// Skills are SKILL.md documents (Claude Code skills) the platform exposes to
// child apps so their devs / AI agents can install or reference them.
// Visibility is enforced server-side: `private` skills are never returned by
// the SDK endpoint. `internal` is restricted to the owning organization.
// `public` is visible to any authenticated caller.
export type SkillVisibility = 'private' | 'internal' | 'public';

export interface SkillSummary {
  id: number;
  organization_id: number | null;
  name: string;
  description: string;
  category?: string | null;
  version?: string | null;
  visibility: SkillVisibility;
  created_at: string;
  updated_at: string;
}

export interface Skill extends SkillSummary {
  /**
   * Full SKILL.md content — frontmatter + markdown body. Returned by
   * `GET /skills/jwt/{id}`. Omitted from list responses unless the server
   * is explicitly asked to include it.
   */
  body?: string;
}

export interface ListSkillsParams {
  /** Defaults to the SDK's currently selected organization. Used to scope `internal` skills. */
  organizationId?: string | number;
  /** Restrict to a category slug (e.g. `auth`, `integration`). */
  category?: string;
  /** Restrict to a visibility band. Server still strips `private` regardless of this value. */
  visibility?: Exclude<SkillVisibility, 'private'>;
  /** Opaque pagination cursor returned by a previous call. */
  cursor?: string;
  /** Page size. Default 25, max 100 (server enforced). */
  perPage?: number;
}

export interface SkillsResult extends OperationResult {
  skills?: SkillSummary[];
  /** Opaque cursor for the next page, or null when there are no more pages. */
  nextCursor?: string | null;
}

export interface SkillResult extends OperationResult {
  skill?: Skill;
}