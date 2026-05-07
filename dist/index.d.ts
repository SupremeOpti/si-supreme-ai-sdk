import * as react_jsx_runtime from 'react/jsx-runtime';
import { ReactNode } from 'react';

/**
 * Supreme AI Credit SDK - Type Definitions
 */
interface Organization {
    id?: string;
    name?: string;
    slug?: string;
    domain?: string;
    drive_folder_id?: string | null;
    logo_url?: string | null;
    icon_url?: string | null;
    selectedStatus?: boolean;
    isSelected?: boolean;
    credits?: number;
    user_role_ids?: number[];
    roles?: Record<string, string>;
    agents?: {
        all?: Agent[];
        [roleId: string]: Agent[] | any;
    };
}
interface User {
    id: number;
    email: string;
    name?: string;
    avatar_url?: string | null;
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
    userId?: string;
    userRole?: string;
}
interface AuthTokens {
    access_token: string;
    refresh_token: string;
    expires_in?: number;
}
interface AuthResult {
    success: boolean;
    user?: User;
    tokens?: AuthTokens;
    message?: string;
    error?: string;
}
interface CreditBalance {
    balance: number;
    currency?: string;
    updated_at?: string;
}
interface Transaction {
    id: string;
    type: 'credit' | 'debit';
    amount: number;
    description?: string;
    reference_id?: string;
    created_at: string;
    balance_after: number;
}
interface TransactionHistory {
    transactions: Transaction[];
    total: number;
    current_page: number;
    total_pages: number;
}
interface SDKFeatures {
    credits?: boolean;
    personas?: boolean;
}
interface CreditSDKConfig {
    apiBaseUrl?: string;
    agentsApiBaseUrl?: string;
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
interface SDKState {
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
interface IframeMessage {
    type: string;
    timestamp: number;
    [key: string]: any;
}
interface TokenRequestMessage extends IframeMessage {
    type: 'REQUEST_JWT_TOKEN';
    origin: string;
}
interface TokenResponseMessage extends IframeMessage {
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
interface UserStateRequestMessage extends IframeMessage {
    type: 'REQUEST_CURRENT_USER_STATE';
    origin: string;
}
interface UserStateResponseMessage extends IframeMessage {
    type: 'RESPONSE_CURRENT_USER_STATE';
    userState?: {
        orgId: string;
        orgName: string;
        orgSlug?: string;
        orgDomain?: string;
        driveFolderId?: string | null;
        orgLogoUrl?: string | null;
        orgIconUrl?: string | null;
        userRole: string;
        userId: string;
        userRoleIds?: number[];
        isSuperAdmin?: boolean;
        avatarUrl?: string | null;
        personas?: any[];
    };
    error?: string;
}
interface RouteChangedMessage extends IframeMessage {
    type: 'ROUTE_CHANGED';
    /** The full path including pathname, search params, and hash (e.g. "/posts/123?tab=comments#top") */
    path: string;
}
type CreditSDKEvents = {
    'ready': {
        user: User | null;
        mode: string;
    };
    'modeDetected': {
        mode: string;
    };
    'authRequired': void;
    'loginSuccess': {
        user: User;
    };
    'loginError': {
        error: string;
    };
    'logoutSuccess': void;
    'balanceUpdate': {
        balance: number;
    };
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
    'personasLoaded': {
        personas: Persona[];
    };
    'personasFailed': {
        error: string;
    };
    'tokenRefreshed': void;
    'tokenExpired': void;
    'error': {
        type: string;
        error: string;
    };
    'waitingForParent': void;
    'parentTimeout': void;
    'parentAuthRequired': {
        error: string;
    };
    'organizationsUpdated': {
        organizations: Organization[];
    };
    'organizationSwitched': {
        previousOrgId?: string;
        newOrgId: string;
        organization: Organization;
    };
    'tokensUpdated': {
        accessToken: string;
        refreshToken?: string;
    };
    'routeChanged': {
        path: string;
    };
};
interface ApiResponse<T = any> {
    success: boolean;
    data?: T;
    message?: string;
    error?: string;
}
interface BalanceResponse {
    balance: number;
    currency?: string;
}
interface SpendResponse {
    new_balance: number;
    transaction: Transaction;
}
interface AddCreditsResponse {
    new_balance: number;
    transaction: Transaction;
}
interface OperationResult {
    success: boolean;
    error?: string;
}
interface BalanceResult extends OperationResult {
    balance?: number;
}
interface SpendResult extends OperationResult {
    newBalance?: number;
    transaction?: Transaction;
}
interface AddResult extends OperationResult {
    newBalance?: number;
    transaction?: Transaction;
}
interface HistoryResult extends OperationResult {
    transactions?: Transaction[];
    total?: number;
    page?: number;
    pages?: number;
}
interface UserOrgsResult extends OperationResult {
    organizations?: Organization[];
    count?: number;
}
interface UserPersonasResult extends OperationResult {
    personas?: Array<{
        id: string;
        name: string;
        description?: string;
        category_id?: string | null;
        category_name?: string;
    }>;
    count?: number;
}
interface SwitchOrgResult {
    success: boolean;
    error?: string;
    previousOrgId?: string;
    newOrgId?: string;
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
        roleGrouped: Record<string, {
            role_name: string;
            agents: Agent[];
        }>;
    };
    refreshErrors?: {
        balance?: string;
        history?: string;
        agents?: string;
    };
}
interface UseCreditSystemReturn {
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
}
interface Persona {
    id: number;
    name: string;
    description?: string;
    category?: string;
    created_at?: string;
    updated_at?: string;
    [key: string]: any;
}
interface PersonasResult extends OperationResult {
    personas?: Persona[];
}
interface PersonaResult extends OperationResult {
    persona?: Persona;
}
interface UserStateResult extends OperationResult {
    userState?: {
        orgId: string;
        orgName: string;
        orgSlug?: string;
        orgDomain?: string;
        driveFolderId?: string | null;
        orgLogoUrl?: string | null;
        orgIconUrl?: string | null;
        userRole: string;
        userId: string;
        userRoleIds?: number[];
        isSuperAdmin?: boolean;
        avatarUrl?: string | null;
        personas?: any[];
    };
}
interface Agent {
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
interface RoleGroupedAgents {
    [roleId: string]: {
        role_name: string;
        agents: Agent[];
    };
}
interface AgentsResult extends OperationResult {
    agents?: Agent[];
    roleGrouped?: RoleGroupedAgents;
    total?: number;
}

/**
 * Type-safe EventEmitter implementation
 */
type EventListener<T = any> = (data?: T) => void;
declare class EventEmitter<Events extends Record<string, any> = Record<string, any>> {
    private events;
    protected debug: boolean;
    /**
     * Subscribe to an event
     */
    on<K extends keyof Events>(event: K, listener: EventListener<Events[K]>): this;
    /**
     * Subscribe to an event once
     */
    once<K extends keyof Events>(event: K, listener: EventListener<Events[K]>): this;
    /**
     * Unsubscribe from an event
     */
    off<K extends keyof Events>(event: K, listener: EventListener<Events[K]>): this;
    /**
     * Emit an event
     */
    emit<K extends keyof Events>(event: K, data?: Events[K]): boolean;
    /**
     * Remove all listeners for an event or all events
     */
    removeAllListeners<K extends keyof Events>(event?: K): this;
    /**
     * Get listener count for an event
     */
    listenerCount<K extends keyof Events>(event: K): number;
}

declare class CreditSystemClient extends EventEmitter<CreditSDKEvents> {
    private config;
    private state;
    private storage;
    private messageBridge;
    private authManager;
    private apiClient;
    private agentsApiClient;
    private personasClient;
    private tokenTimer?;
    private balanceTimer?;
    private parentResponseReceived;
    private lastPath;
    private originalPushState?;
    private originalReplaceState?;
    private popstateHandler?;
    private hashchangeHandler?;
    constructor(config?: CreditSDKConfig);
    /**
     * Initialize the credit system
     */
    initialize(): Promise<void>;
    /**
     * Initialize embedded mode (iframe)
     */
    private initializeEmbeddedMode;
    /**
     * Handle JWT token response from parent
     */
    private handleParentTokenResponse;
    /**
     * Initialize standalone mode
     */
    private initializeStandaloneMode;
    /**
     * Initialize with valid JWT token
     */
    private initializeWithToken;
    /**
     * Get current auth token
     */
    private getAuthToken;
    /**
     * Login with credentials (standalone mode)
     */
    login(email: string, password: string): Promise<AuthResult>;
    /**
     * Logout
     */
    logout(): Promise<void>;
    /**
     * Check current credit balance
     */
    checkBalance(): Promise<BalanceResult>;
    /**
     * Spend credits
     */
    spendCredits(amount: number, description?: string, referenceId?: string): Promise<SpendResult>;
    /**
     * Add credits
     */
    addCredits(amount: number, type?: string, description?: string): Promise<AddResult>;
    /**
     * Get transaction history
     */
    getHistory(page?: number, limit?: number): Promise<HistoryResult>;
    /**
     * Get AI agents
     * @param all - If true, fetches all agents for the organization. If false/undefined, fetches agents filtered by user's role IDs.
     */
    getAgents(all?: boolean): Promise<AgentsResult>;
    /**
     * Get the current full path (pathname + search + hash)
     */
    private getCurrentPath;
    /**
     * Start watching for route changes in the embedded app.
     * Detects pushState, replaceState, and popstate (back/forward) navigation.
     */
    private startRouteWatcher;
    /**
     * Stop the route watcher and restore original history methods.
     */
    private stopRouteWatcher;
    /**
     * Check if the route has changed and notify the parent if so.
     */
    private checkRouteChange;
    /**
     * Notify the parent frame that the route has changed.
     * Called automatically when deep linking is enabled, but can also be called manually.
     * @param path - The path to send. Defaults to the current window path (pathname + search + hash).
     */
    notifyRouteChanged(path?: string): void;
    /**
     * Read personas from cookie
     */
    private getOrganizationIdFromCookie;
    private getPersonasFromCookie;
    /**
     * Load personas for authenticated user
     * First tries to load from cookie, falls back to API if cookie is empty
     */
    private loadPersonas;
    /**
     * Get all personas for authenticated user
     * If no filters (organizationId/roleId) are provided, returns personas from cookie
     * Otherwise fetches from API with filters
     * @param organizationId - Optional organization ID to filter personas
     * @param roleId - Optional role ID to filter personas
     */
    getPersonas(organizationId?: string | number, roleId?: string | number): Promise<PersonasResult>;
    /**
     * Get specific persona by ID
     */
    getPersonaById(id: number): Promise<PersonaResult>;
    /**
     * Request current user state from parent page (embedded mode only)
     */
    requestCurrentUserState(): Promise<UserStateResult>;
    /**
     * Request user organizations from parent page (embedded mode only)
     */
    requestUserOrganizations(): Promise<UserOrgsResult>;
    /**
     * Request user personas from parent page (embedded mode only)
     */
    requestUserPersonas(): Promise<UserPersonasResult>;
    /**
     * Refresh JWT token
     */
    private refreshToken;
    /**
     * Start token refresh timer
     */
    private startTokenRefreshTimer;
    /**
     * Start balance refresh timer
     */
    private startBalanceRefreshTimer;
    /**
     * Clear all timers
     */
    private clearTimers;
    private clearTokenTimer;
    private clearBalanceTimer;
    /**
     * Set up internal event handlers
     */
    private setupEventHandlers;
    /**
     * Switch to a different organization
     */
    switchOrganization(orgId: string): Promise<SwitchOrgResult>;
    /**
     * Get current state
     */
    getState(): SDKState;
    /**
     * Debug logging
     */
    private log;
    /**
     * Destroy the client
     */
    destroy(): void;
}

/**
 * PersonasClient - Handles persona management
 */

interface PersonasClientConfig {
    apiBaseUrl: string;
    getAuthToken: () => string | null;
    debug?: boolean;
}
declare class PersonasClient {
    private apiBaseUrl;
    private getAuthToken;
    private debug;
    constructor(config: PersonasClientConfig);
    /**
     * Log messages if debug mode is enabled
     */
    private log;
    /**
     * Make authenticated API request
     */
    private makeRequest;
    /**
     * Get all personas
     * @param organizationId - Optional organization ID to filter personas
     * @param roleId - Optional role ID to filter personas
     */
    getPersonas(organizationId?: string | number, roleId?: string | number): Promise<PersonasResult>;
    /**
     * Get a specific persona by ID
     */
    getPersonaById(id: number): Promise<PersonaResult>;
}

/**
 * React Hook for Supreme AI Credit System SDK
 */

declare function useCreditSystem(config?: CreditSDKConfig): UseCreditSystemReturn;

interface CreditSystemProviderProps {
    children: ReactNode;
    config?: CreditSDKConfig;
}
declare function CreditSystemProvider({ children, config }: CreditSystemProviderProps): react_jsx_runtime.JSX.Element;
declare function useCreditContext(): UseCreditSystemReturn;

/**
 * React Hook for switching selected organization
 * Delegates to the core CreditSystemClient.switchOrganization() method
 */

declare function useSwitchOrganization(): {
    switchOrganization: (orgId: string) => Promise<SwitchOrgResult>;
};

/**
 * ParentIntegrator - Helper for parent pages to integrate with iframe credit system
 */

interface ParentConfig {
    getJWTToken: () => Promise<{
        token: string;
        refreshToken: string;
        user: User;
    } | null>;
    getCurrentUserState?: () => Promise<{
        orgId: string;
        orgName: string;
        orgSlug?: string;
        orgDomain?: string;
        driveFolderId?: string | null;
        orgLogoUrl?: string | null;
        orgIconUrl?: string | null;
        userRole: string;
        userId: string;
        userRoleIds?: number[];
        isSuperAdmin?: boolean;
        avatarUrl?: string | null;
        personas?: any[];
    } | null>;
    allowedOrigins?: string[];
    debug?: boolean;
    onIframeReady?: () => void;
    onBalanceUpdate?: (balance: number) => void;
    onCreditsSpent?: (amount: number, newBalance: number) => void;
    onCreditsAdded?: (amount: number, newBalance: number) => void;
    onLogout?: () => void;
    onError?: (error: string) => void;
}
declare class ParentIntegrator {
    private config;
    private iframe;
    private messageHandler?;
    private cachedToken?;
    constructor(config: ParentConfig);
    /**
     * Attach to an iframe element
     */
    attachToIframe(iframe: HTMLIFrameElement): void;
    /**
     * Set up message listener for iframe communication
     */
    private setupMessageListener;
    /**
     * Handle JWT token request from iframe
     */
    private handleTokenRequest;
    /**
     * Handle user state request from iframe
     */
    private handleUserStateRequest;
    /**
     * Handle iframe ready event
     */
    private handleIframeReady;
    /**
     * Handle balance update
     */
    private handleBalanceUpdate;
    /**
     * Handle credits spent
     */
    private handleCreditsSpent;
    /**
     * Handle credits added
     */
    private handleCreditsAdded;
    /**
     * Handle token refreshed
     */
    private handleTokenRefreshed;
    /**
     * Handle logout
     */
    private handleLogout;
    /**
     * Handle error
     */
    private handleError;
    /**
     * Handle status response
     */
    private handleStatusResponse;
    /**
     * Send message to iframe
     */
    sendToIframe(type: string, data?: Record<string, any>): boolean;
    /**
     * Validate message origin
     */
    private isValidOrigin;
    /**
     * Request balance refresh from iframe
     */
    refreshBalance(): void;
    /**
     * Request status from iframe
     */
    getStatus(): void;
    /**
     * Clear iframe storage
     */
    clearStorage(): void;
    /**
     * Send custom message to iframe
     */
    sendCustomMessage(message: string, data?: any): void;
    /**
     * Destroy the integrator
     */
    destroy(): void;
}

/**
 * Supreme AI SDK - Credit System and Personas Management
 *
 * @packageDocumentation
 */

export { type AddCreditsResponse, type AddResult, type Agent, type AgentsResult, type ApiResponse, type AuthResult, type AuthTokens, type BalanceResponse, type BalanceResult, type CreditBalance, type CreditSDKConfig, type CreditSDKEvents, CreditSystemClient, CreditSystemProvider, type HistoryResult, type IframeMessage, type OperationResult, type Organization, type ParentConfig, ParentIntegrator, type Persona, type PersonaResult, PersonasClient, type PersonasClientConfig, type PersonasResult, type RoleGroupedAgents, type RouteChangedMessage, type SDKState, type SpendResponse, type SpendResult, type SwitchOrgResult, type TokenRequestMessage, type TokenResponseMessage, type Transaction, type TransactionHistory, type UseCreditSystemReturn, type User, type UserStateRequestMessage, type UserStateResponseMessage, type UserStateResult, CreditSystemClient as default, useCreditContext, useCreditSystem, useSwitchOrganization };
