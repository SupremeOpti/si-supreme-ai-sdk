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
  /**
   * `X-SI-Idempotency-Key`: stable for one step of one run across retries. The hub
   * sends it only for actions that are not `read_only`, so expect null on those.
   */
  idempotencyKey: string | null;
  /** Where to report an async job's result (from the request body). Null when the hub sent none. */
  callback: SiActionCallback | null;
}

/** The hub's single-use completion endpoint for one step. Persist it with the job; the token is a secret. */
export interface SiActionCallback {
  url: string;
  token: string;
}

/** What a handler passes to `acceptSiAction` to answer 202 and finish later. */
export interface SiActionAcceptOptions {
  /** Optional app id for the job. When given, the hub refuses a callback with a different `job_id` (409). */
  jobId?: string;
  /**
   * Status URL the hub may poll if the callback never arrives. Absolute or path-only; it must be on the
   * host the hub called. Defaults to `/si/actions/{id}/jobs/{jobId}` when the action has `getJob` and a jobId is set.
   */
  pollUrl?: string;
  estimatedSeconds?: number;
}

export interface SiActionAccepted {
  readonly __siAccepted: true;
  readonly jobId?: string;
  readonly pollUrl?: string;
  readonly estimatedSeconds?: number;
}

export interface SiActionJobError {
  code: string;
  message: string;
  retryable?: boolean;
}

/** An async job's state, as `getJob` reports it to a poll and `completeJob` reports it to the callback. */
export type SiActionJobStatus<O = Record<string, unknown>> =
  | { status: 'running'; progress?: number }
  | { status: 'completed'; output: O }
  | { status: 'failed'; error: SiActionJobError };

export interface SiCallbackOptions {
  /** Per attempt. Default 10000. */
  timeoutMs?: number;
  /** Extra attempts on network errors, 429 and 5xx; any other 4xx is final. Default 3. */
  retries?: number;
}

/** Outcome of `completeJob`. It never throws for HTTP outcomes. */
export interface SiCallbackResult {
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
  /** `readOnlyHint: true` also sets the manifest's `read_only`, so the hub sends no idempotency key. */
  annotations?: SiActionAnnotations;
  /**
   * `mode: 'async'` lets the handler return `acceptSiAction(...)` (202) and report later with
   * `completeJob`. Defaults: sync typical 10s / max 120s, async typical 60s / max 900s.
   */
  execution?: { mode?: 'sync' | 'async'; typicalSeconds?: number; maxSeconds?: number };
  examples?: Array<{ input?: Record<string, unknown>; output?: Record<string, unknown> }>;
  handler(input: I, context: SiActionContext): Promise<O | SiActionAccepted>;
  /** Async only: answers the hub's poll at `GET /si/actions/{id}/jobs/{jobId}`. Scope the lookup to `context.organizationId`. */
  getJob?(jobId: string, context: SiActionContext): Promise<SiActionJobStatus<O> | null>;
}

export interface SiActionsConfig {
  /** App slug as registered in SI, e.g. `data-library`. Tokens must be issued for this app. */
  app: string;
  /**
   * Public origin the hub calls in this environment, goes into the manifest as `base_url`. Read it
   * from env (e.g. `process.env.SI_ACTIONS_BASE_URL`) so local, staging and prod each publish their own.
   */
  baseUrl: string;
  /** SI hub origin that verifies service tokens, e.g. `https://app.supremegroup.ai`. */
  hubUrl: string;
  /** Handlers are methods, so a definition typed with its own input/output shapes still fits here. */
  actions: SiActionDefinition[];
  /** Default `supreme-intelligence`. */
  issuer?: string;
  /** Default `si-actions`. */
  audience?: string;
  fetch?: FetchLike;
  logger?: Logger;
  now?: () => number;
  /** Timeout for each hub token verification call. Default 5000 ms; on expiry the action answers `upstream_unavailable`. */
  verifyTimeoutMs?: number;
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
