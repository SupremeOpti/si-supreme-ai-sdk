/**
 * React Hook for Supreme AI Credit System SDK
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { CreditSystemClient } from '../core/CreditSystemClient';
import type {
  CreditSDKConfig,
  User,
  Organization,
  AuthResult,
  BalanceResult,
  SpendResult,
  AddResult,
  HistoryResult,
  AgentsResult,
  UseCreditSystemReturn,
  Persona,
  PersonasResult,
  PersonaResult,
  UserStateResult,
  UserOrgsResult,
  UserPersonasResult,
  SwitchOrgResult,
  ListReportsParams,
  CreateReportParams,
  UpdateReportParams,
  ReportsResult,
  ReportResult
} from '../types';

export function useCreditSystem(config?: CreditSDKConfig): UseCreditSystemReturn {
  const clientRef = useRef<CreditSystemClient | null>(null);

  const [isInitialized, setIsInitialized] = useState(false);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [isSuperAdmin, setIsSuperAdmin] = useState(false);
  const [mode, setMode] = useState<'embedded' | 'standalone' | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [balance, setBalance] = useState<number | null>(null);
  const [personas, setPersonas] = useState<Persona[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [accessToken, setAccessToken] = useState<string | null>(null);
  const [refreshToken, setRefreshToken] = useState<string | null>(null);
  const [organizations, setOrganizations] = useState<Organization[]>([]);
  const [selectedOrganization, setSelectedOrganization] = useState<Organization | null>(null);

  // Initialize client
  useEffect(() => {
    const client = new CreditSystemClient({
      ...config,
      autoInit: true
    });

    clientRef.current = client;

    // Set up event listeners
    client.on('ready', (data) => {
      if (data) {
        setIsInitialized(true);
        setIsAuthenticated(true);
        setIsSuperAdmin(data.user?.is_superadmin ?? false);
        setUser(data.user);
        setMode(data.mode as 'embedded' | 'standalone');
        setLoading(false);
        // Sync new state fields from client
        const state = client.getState();
        setAccessToken(state.accessToken);
        setRefreshToken(state.refreshToken);
        setOrganizations(state.organizations);
        setSelectedOrganization(state.selectedOrganization);
      }
    });

    client.on('modeDetected', (data) => {
      if (data) {
        setMode(data.mode as 'embedded' | 'standalone');
      }
    });

    client.on('authRequired', () => {
      setIsAuthenticated(false);
      setLoading(false);
    });

    client.on('loginSuccess', (data) => {
      if (data) {
        setIsAuthenticated(true);
        setIsSuperAdmin(data.user?.is_superadmin ?? false);
        setUser(data.user);
        setError(null);
        // Sync new state fields from client
        const state = client.getState();
        setAccessToken(state.accessToken);
        setRefreshToken(state.refreshToken);
        setOrganizations(state.organizations);
        setSelectedOrganization(state.selectedOrganization);
      }
    });

    client.on('loginError', (data) => {
      if (data) {
        setError(data.error);
      }
    });

    client.on('logoutSuccess', () => {
      setIsAuthenticated(false);
      setIsSuperAdmin(false);
      setUser(null);
      setBalance(null);
      setAccessToken(null);
      setRefreshToken(null);
      setOrganizations([]);
      setSelectedOrganization(null);
    });

    client.on('balanceUpdate', (data) => {
      if (data) {
        setBalance(data.balance);
      }
    });

    client.on('personasLoaded', (data) => {
      if (data) {
        setPersonas(data.personas);
      }
    });

    client.on('personasFailed', (data) => {
      if (data) {
        console.error('Failed to load personas:', data.error);
      }
    });

    client.on('error', (data) => {
      if (data) {
        setError(`${data.type}: ${data.error}`);
      }
    });

    client.on('tokenRefreshed', () => {
      // Token was refreshed successfully - user stays authenticated
      // Don't change isAuthenticated state, just log it
      if (config?.debug) {
        console.log('[useCreditSystem] Token refreshed - user remains authenticated');
      }
    });

    client.on('tokenExpired', () => {
      // Only set to false when token actually expires (refresh failed)
      setIsAuthenticated(false);
      setError('Session expired. Please login again.');
    });

    client.on('tokensUpdated', (data) => {
      if (data) {
        setAccessToken(data.accessToken);
        if (data.refreshToken) {
          setRefreshToken(data.refreshToken);
        }
      }
    });

    client.on('organizationsUpdated', (data) => {
      if (data) {
        setOrganizations(data.organizations);
        const selected = data.organizations.find(o => o.selectedStatus || o.isSelected) || null;
        setSelectedOrganization(selected);
      }
    });

    client.on('organizationSwitched', (data) => {
      if (data) {
        setSelectedOrganization(data.organization);
        // Re-derive full list from client state
        const state = client.getState();
        setOrganizations(state.organizations);
      }
    });

    // Cleanup
    return () => {
      client.destroy();
    };
  }, []);

  // Login function
  const login = useCallback(async (email: string, password: string): Promise<AuthResult> => {
    setLoading(true);
    setError(null);

    if (!clientRef.current) {
      setLoading(false);
      return { success: false, error: 'Client not initialized' };
    }

    const result = await clientRef.current.login(email, password);
    setLoading(false);

    return result;
  }, []);

  // Logout function
  const logout = useCallback(async (): Promise<void> => {
    if (!clientRef.current) return;

    await clientRef.current.logout();
  }, []);

  // Check balance
  const checkBalance = useCallback(async (): Promise<BalanceResult> => {
    if (!clientRef.current) {
      return { success: false, error: 'Client not initialized' };
    }

    return await clientRef.current.checkBalance();
  }, []);

  // Spend credits
  const spendCredits = useCallback(async (
    amount: number,
    description?: string,
    referenceId?: string
  ): Promise<SpendResult> => {
    if (!clientRef.current) {
      return { success: false, error: 'Client not initialized' };
    }

    return await clientRef.current.spendCredits(amount, description, referenceId);
  }, []);

  // Add credits
  const addCredits = useCallback(async (
    amount: number,
    type?: string,
    description?: string
  ): Promise<AddResult> => {
    if (!clientRef.current) {
      return { success: false, error: 'Client not initialized' };
    }

    return await clientRef.current.addCredits(amount, type, description);
  }, []);

  // Get history
  const getHistory = useCallback(async (
    page?: number,
    limit?: number
  ): Promise<HistoryResult> => {
    if (!clientRef.current) {
      return { success: false, error: 'Client not initialized' };
    }

    return await clientRef.current.getHistory(page, limit);
  }, []);

  // Get AI agents
  const getAgents = useCallback(async (all?: boolean): Promise<AgentsResult> => {
    if (!clientRef.current) {
      return { success: false, error: 'Client not initialized' };
    }

    return await clientRef.current.getAgents(all);
  }, []);

  // Get personas
  const getPersonas = useCallback(async (organizationId?: string | number, roleId?: string | number): Promise<PersonasResult> => {
    if (!clientRef.current) {
      return { success: false, error: 'Client not initialized' };
    }

    return await clientRef.current.getPersonas(organizationId, roleId);
  }, []);

  // Get persona by ID
  const getPersonaById = useCallback(async (id: number): Promise<PersonaResult> => {
    if (!clientRef.current) {
      return { success: false, error: 'Client not initialized' };
    }

    return await clientRef.current.getPersonaById(id);
  }, []);

  // Request current user state from parent
  const requestCurrentUserState = useCallback(async (): Promise<UserStateResult> => {
    if (!clientRef.current) {
      return { success: false, error: 'Client not initialized' };
    }

    return await clientRef.current.requestCurrentUserState();
  }, []);

  // Request user organizations from parent
  const requestUserOrganizations = useCallback(async (): Promise<UserOrgsResult> => {
    if (!clientRef.current) {
      return { success: false, error: 'Client not initialized' };
    }

    return await clientRef.current.requestUserOrganizations();
  }, []);

  // Request user personas from parent
  const requestUserPersonas = useCallback(async (): Promise<UserPersonasResult> => {
    if (!clientRef.current) {
      return { success: false, error: 'Client not initialized' };
    }

    return await clientRef.current.requestUserPersonas();
  }, []);

  // Switch organization
  const switchOrganization = useCallback(async (orgId: string): Promise<SwitchOrgResult> => {
    if (!clientRef.current) {
      return { success: false, error: 'Client not initialized' };
    }

    return await clientRef.current.switchOrganization(orgId);
  }, []);

  // --- Reports (always scoped to the authed user via JWT) ---

  const listReports = useCallback(async (params?: ListReportsParams): Promise<ReportsResult> => {
    if (!clientRef.current) {
      return { success: false, error: 'Client not initialized', reports: [] };
    }
    return await clientRef.current.listReports(params);
  }, []);

  const getReport = useCallback(async (
    id: number | string,
    organizationId?: string | number
  ): Promise<ReportResult> => {
    if (!clientRef.current) {
      return { success: false, error: 'Client not initialized' };
    }
    return await clientRef.current.getReport(id, organizationId);
  }, []);

  const createReport = useCallback(async (params: CreateReportParams): Promise<ReportResult> => {
    if (!clientRef.current) {
      return { success: false, error: 'Client not initialized' };
    }
    return await clientRef.current.createReport(params);
  }, []);

  const updateReport = useCallback(async (
    id: number | string,
    params: UpdateReportParams
  ): Promise<ReportResult> => {
    if (!clientRef.current) {
      return { success: false, error: 'Client not initialized' };
    }
    return await clientRef.current.updateReport(id, params);
  }, []);

  return {
    isInitialized,
    isAuthenticated,
    isSuperAdmin,
    mode,
    user,
    balance,
    personas,
    loading,
    error,
    accessToken,
    refreshToken,
    organizations,
    selectedOrganization,
    login,
    logout,
    checkBalance,
    spendCredits,
    addCredits,
    getHistory,
    getAgents,
    getPersonas,
    getPersonaById,
    requestCurrentUserState,
    requestUserOrganizations,
    requestUserPersonas,
    switchOrganization,
    listReports,
    getReport,
    createReport,
    updateReport
  };
}