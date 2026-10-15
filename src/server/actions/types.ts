import type { FetchLike } from '../runtime';
import type { Logger } from '../types';

/** JSON Schema subset the hub and the SDK both understand. Always `type: 'object'` at the top. */
export type JsonSchema = Record<string, unknown>;

/** Who the hub says is running the step. Comes from the verified service token only. */
export interface SiActionContext {
  organizationId: number;
  organizationSlug: string | null;
  userId: number;
  workflowId: number | null;
  runId: number | null;
  nodeId: string | null;
  attempt: number;
  /** `X-SI-Idempotency-Key`: stable for one step of one run across retries. */
  idempotencyKey: string | null;
}

export interface SiActionAnnotations {
  readOnlyHint?: boolean;
  idempotentHint?: boolean;
  openWorldHint?: boolean;
}

export interface SiActionDefinition<I = Record<string, unknown>, O = Record<string, unknown>> {
  /** `^[a-z0-9_]{1,48}$`. Append-only: never rename a shipped id. */
  id: string;
  name: string;
  /** Read by the hub's AI to decide when to use the action. Say what it does, what it needs and what it returns. */
  description: string;
  inputSchema: JsonSchema;
  outputSchema: JsonSchema;
  annotations?: SiActionAnnotations;
  /** Defaults: typical 10s, max 120s. Sync actions must answer within the hub's timeout. */
  execution?: { typicalSeconds?: number; maxSeconds?: number };
  examples?: Array<{ input?: Record<string, unknown>; output?: Record<string, unknown> }>;
  handler(input: I, context: SiActionContext): Promise<O>;
}

export interface SiActionsConfig {
  /** App slug as registered in SI, e.g. `data-library`. Tokens must be issued for this app. */
  app: string;
  /** Public origin the hub calls, e.g. `https://library.supremegroup.ai`. Goes into the manifest as `base_url`. */
  baseUrl: string;
  /** SI hub origin that verifies service tokens, e.g. `https://app.supremegroup.ai`. */
  hubUrl: string;
  actions: SiActionDefinition<any, any>[]; // eslint-disable-line @typescript-eslint/no-explicit-any
  /** Default `supreme-intelligence`. */
  issuer?: string;
  /** Default `si-actions`. */
  audience?: string;
  fetch?: FetchLike;
  logger?: Logger;
  now?: () => number;
}

/** Minimal request shape: the runtime's real `Request` fits. */
export interface SiActionRequest {
  readonly method: string;
  readonly url: string;
  readonly headers: { get(name: string): string | null };
  text(): Promise<string>;
}

/** Plain response the adapter turns into the runtime's `Response`. */
export interface SiActionResponse {
  status: number;
  headers: Record<string, string>;
  body: string;
}

export type SiActionErrorCode =
  | 'bad_request'
  | 'unauthenticated'
  | 'org_not_authorized'
  | 'unknown_action'
  | 'unknown_job'
  | 'validation_failed'
  | 'internal_error'
  | 'upstream_unavailable';
