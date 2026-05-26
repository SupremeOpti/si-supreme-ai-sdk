/**
 * Supreme AI SDK - Credit System and Personas Management
 *
 * @packageDocumentation
 */

// Core imports and exports
import { CreditSystemClient } from './core/CreditSystemClient';
import { PersonasClient } from './core/PersonasClient';
import { ReportsClient } from './core/ReportsClient';
import { SkillsClient } from './core/SkillsClient';
export { CreditSystemClient };
export { PersonasClient };
export { ReportsClient };
export { SkillsClient };
export type { PersonasClientConfig } from './core/PersonasClient';
export type { ReportsClientConfig } from './core/ReportsClient';
export type { SkillsClientConfig } from './core/SkillsClient';

// React exports
export { useCreditSystem } from './react/useCreditSystem';
export { CreditSystemProvider, useCreditContext } from './react/CreditSystemProvider';
export { useSwitchOrganization } from './react/useSwitchOrganization';

// Parent integration exports
export { ParentIntegrator } from './parent/ParentIntegrator';
export type { ParentConfig } from './parent/ParentIntegrator';

// Type exports
export type {
  // User and Auth
  User,
  Organization,
  AuthTokens,
  AuthResult,

  // Credit System
  CreditBalance,
  Transaction,
  TransactionHistory,

  // Configuration
  CreditSDKConfig,
  SDKState,

  // Messages
  IframeMessage,
  TokenRequestMessage,
  TokenResponseMessage,
  RouteChangedMessage,
  UserStateRequestMessage,
  UserStateResponseMessage,

  // Events
  CreditSDKEvents,

  // API
  ApiResponse,
  BalanceResponse,
  SpendResponse,
  AddCreditsResponse,

  // Operations
  OperationResult,
  BalanceResult,
  SpendResult,
  AddResult,
  HistoryResult,
  SwitchOrgResult,

  // Personas
  Persona,
  PersonasResult,
  PersonaResult,

  // User State
  UserStateResult,

  // AI Agents
  Agent,
  AgentsResult,
  RoleGroupedAgents,

  // Reports
  Report,
  ReportSummary,
  ReportVisibility,
  ListReportsParams,
  CreateReportParams,
  UpdateReportParams,
  ReportsResult,
  ReportResult,

  // Skills
  Skill,
  SkillSummary,
  SkillVisibility,
  ListSkillsParams,
  SkillsResult,
  SkillResult,
  UserSkillsResult,
  UserSkillsRequestMessage,
  UserSkillsResponseMessage,

  // React
  UseCreditSystemReturn
} from './types';

// Default export
export default CreditSystemClient;