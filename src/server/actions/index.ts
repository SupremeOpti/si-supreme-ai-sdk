import { InvalidArgumentError } from '../errors';
import type { Logger } from '../types';
import { verifyServiceToken } from './auth';
import { SiActionError } from './errors';
import { isObject, validate } from './schema';
import { completeCallback } from './callback';
import type {
  SiActionAcceptOptions, SiActionAccepted, SiActionCallback, SiActionContext, SiActionDefinition, SiActionJobStatus,
  SiActionRequest, SiActionResponse, SiActionsConfig, SiCallbackOptions, SiCallbackResult,
} from './types';

export { SiActionError } from './errors';
export { audienceList } from './auth';
export { validate as validateJsonSchema } from './schema';
export type * from './types';

export const SI_ACTIONS_VERSION = '1';
export const SI_ACTIONS_MANIFEST_PATH = '/.well-known/si-actions.json';

const ID_PATTERN = /^[a-z0-9_]{1,48}$/;
const JOB_ROUTE = /\/si\/actions\/([^/]+)\/jobs\/([^/]+)$/;

export interface SiActions {
  /** The manifest the hub imports (`workflows:sync-capabilities`). */
  manifest(): Record<string, unknown>;
  /**
   * Routes `GET /.well-known/si-actions.json` and `POST /si/actions/{id}`.
   * Anything else gets a contract 404, so mount it on those paths only.
   */
  handle(request: SiActionRequest): Promise<SiActionResponse>;
  /**
   * Reports an async job's result to the hub: `POST callback.url` with `Bearer callback.token`.
   * Completed output is checked against the action's `outputSchema` first. Retries network errors,
   * 429 and 5xx (any other 4xx is final); never throws for HTTP outcomes.
   */
  completeJob(
    actionId: string,
    callback: SiActionCallback,
    result: { jobId?: string } & (Extract<SiActionJobStatus, { status: 'completed' }> | Extract<SiActionJobStatus, { status: 'failed' }>),
    options?: SiCallbackOptions,
  ): Promise<SiCallbackResult>;
}

/** Return this from an async action's handler to answer `202 { status: "accepted", job_id?, poll_url?, estimated_seconds? }`. */
export function acceptSiAction(options: SiActionAcceptOptions = {}): SiActionAccepted {
  const { jobId } = options;
  if (jobId !== undefined && (typeof jobId !== 'string' || jobId === '' || jobId.length > 255)) {
    throw new InvalidArgumentError('jobId must be a non-empty string of at most 255 characters');
  }
  return Object.freeze({ __siAccepted: true as const, jobId, pollUrl: options.pollUrl, estimatedSeconds: options.estimatedSeconds });
}

function isAccepted(value: unknown): value is SiActionAccepted {
  return isObject(value) && value.__siAccepted === true;
}

const consoleLogger: Logger = {
  warn: (message, context) => (context ? console.warn(message, context) : console.warn(message)),
  error: (message, context) => (context ? console.error(message, context) : console.error(message)),
};

function json(status: number, body: unknown, extra: Record<string, string> = {}): SiActionResponse {
  return { status, headers: { 'Content-Type': 'application/json', ...extra }, body: JSON.stringify(body) };
}

function errorResponse(e: SiActionError): SiActionResponse {
  return json(e.status, { error: { code: e.code, message: e.message, retryable: e.retryable, ...(e.details ? { details: e.details } : {}) } });
}

function origin(url: string, name: string): string {
  try {
    const u = new URL(url);
    return u.origin;
  } catch {
    throw new InvalidArgumentError(`${name} must be an absolute URL`);
  }
}

function isAsync(a: SiActionDefinition): boolean {
  return a.execution?.mode === 'async';
}

function int(value: unknown): number | null {
  const n = Number(value);
  return value !== undefined && value !== null && Number.isInteger(n) ? n : null;
}

/**
 * Serves an app's actions to the SI Workflow Builder (SI Actions contract v1):
 * verifies the hub's service token, scopes every call to the token's org and
 * user, validates input and output against the declared schemas, and answers
 * in the contract's shapes. Async actions answer 202 via `acceptSiAction` and
 * report later with `completeJob`.
 *
 * Pass `baseUrl` from env per environment (local, staging, prod): it is the
 * manifest's `base_url`, and nothing in the SDK defaults it.
 */
export function createSiActions(config: SiActionsConfig): SiActions {
  if (!config || typeof config !== 'object') throw new InvalidArgumentError('config is required');
  if (!/^[a-z0-9][a-z0-9-]{0,62}$/.test(config.app ?? '')) throw new InvalidArgumentError('app must be the lowercase app slug');
  const baseUrl = origin(config.baseUrl, 'baseUrl');
  const hubUrl = origin(config.hubUrl, 'hubUrl');
  const logger = config.logger ?? consoleLogger;
  const now = config.now ?? Date.now;
  const fetchImpl = config.fetch ?? ((input, init) => fetch(input, init));
  const issuer = config.issuer ?? 'supreme-intelligence';
  const audience = config.audience ?? 'si-actions';

  const actions = new Map<string, SiActionDefinition>();
  for (const a of config.actions ?? []) {
    if (!ID_PATTERN.test(a.id)) throw new InvalidArgumentError(`action id '${a.id}' must match ${ID_PATTERN}`);
    if (actions.has(a.id)) throw new InvalidArgumentError(`duplicate action id '${a.id}'`);
    if (a.inputSchema?.type !== 'object' || a.outputSchema?.type !== 'object') {
      throw new InvalidArgumentError(`action '${a.id}' schemas must be of type object`);
    }
    if (a.getJob && a.execution?.mode !== 'async') throw new InvalidArgumentError(`action '${a.id}' has getJob but is not async`);
    actions.set(a.id, a);
  }

  const manifest = () => ({
    si_actions_version: SI_ACTIONS_VERSION,
    app: config.app,
    base_url: baseUrl,
    actions: [...actions.values()].map((a) => ({
      id: a.id,
      name: a.name,
      description: a.description,
      input_schema: a.inputSchema,
      output_schema: a.outputSchema,
      read_only: a.annotations?.readOnlyHint === true,
      annotations: { readOnlyHint: false, idempotentHint: false, openWorldHint: true, ...(a.annotations ?? {}) },
      execution: isAsync(a)
        ? { mode: 'async', typical_seconds: a.execution?.typicalSeconds ?? 60, max_seconds: a.execution?.maxSeconds ?? 900 }
        : { mode: 'sync', typical_seconds: a.execution?.typicalSeconds ?? 10, max_seconds: a.execution?.maxSeconds ?? 120 },
      examples: a.examples ?? [],
    })),
  });

  const verify = (request: SiActionRequest) => verifyServiceToken(request.headers.get('authorization'), {
    issuer, audience, app: config.app, hubUrl, fetch: fetchImpl, nowSeconds: Math.floor(now() / 1000),
  });

  function contextFrom(service: Awaited<ReturnType<typeof verify>>, request: SiActionRequest, callback: SiActionCallback | null): SiActionContext {
    const claims = service.claims;
    return {
      organizationId: service.organizationId,
      organizationSlug: typeof claims.org_slug === 'string' ? claims.org_slug : null,
      userId: service.userId,
      workflowId: int(claims.workflow_id),
      runId: int(claims.run_id),
      nodeId: typeof claims.node_id === 'string' ? claims.node_id : null,
      attempt: int(claims.attempt) ?? 1,
      idempotencyKey: request.headers.get('x-si-idempotency-key') || null,
      callback,
    };
  }

  function checkOutput(action: SiActionDefinition, output: unknown): Record<string, unknown> {
    if (!isObject(output)) throw new SiActionError('internal_error', 'The action returned a non-object output.');
    const problems = validate(output, action.outputSchema, 'output');
    if (problems.length > 0) {
      logger.error?.('[si-sdk/actions] output does not match output_schema', { action: action.id, errors: problems });
      throw new SiActionError('internal_error', 'The action produced output that does not match its schema.');
    }
    return output;
  }

  function acceptedResponse(action: SiActionDefinition, accepted: SiActionAccepted, request: SiActionRequest): SiActionResponse {
    if (!isAsync(action)) {
      logger.error?.('[si-sdk/actions] a sync action returned acceptSiAction()', { action: action.id });
      throw new SiActionError('internal_error', 'The action failed.');
    }
    const called = new URL(request.url);
    let pollUrl: string | undefined;
    const raw = accepted.pollUrl ?? (action.getJob && accepted.jobId ? `/si/actions/${action.id}/jobs/${encodeURIComponent(accepted.jobId)}` : undefined);
    if (raw !== undefined) {
      const u = new URL(raw, called.origin);
      // The hub ignores a poll_url off the host it called, so say so here instead.
      if (u.hostname === called.hostname) pollUrl = u.toString();
      else logger.warn?.('[si-sdk/actions] poll_url dropped: not on the host the hub called', { action: action.id });
    }
    const est = accepted.estimatedSeconds;
    return json(202, {
      status: 'accepted',
      ...(accepted.jobId ? { job_id: accepted.jobId } : {}),
      ...(pollUrl ? { poll_url: pollUrl } : {}),
      ...(typeof est === 'number' && Number.isFinite(est) && est > 0 ? { estimated_seconds: Math.ceil(est) } : {}),
    });
  }

  async function execute(actionId: string, request: SiActionRequest): Promise<SiActionResponse> {
    const action = actions.get(actionId);
    if (!action) throw new SiActionError('unknown_action', `Unknown action '${actionId}'.`);

    const service = await verify(request);

    let body: unknown;
    try {
      body = JSON.parse((await request.text()) || '{}');
    } catch {
      throw new SiActionError('bad_request', 'Body must be JSON.');
    }
    if (!isObject(body)) throw new SiActionError('bad_request', 'Body must be a JSON object.');
    if (body.action_id !== undefined && body.action_id !== actionId) throw new SiActionError('bad_request', 'action_id does not match the path.');

    const input = body.input === undefined ? {} : body.input;
    const problems = validate(input, action.inputSchema);
    if (problems.length > 0) throw new SiActionError('validation_failed', problems[0], { errors: problems });

    const bodyContext = isObject(body.context) ? body.context : {};
    const callback = typeof bodyContext.callback_url === 'string' && typeof bodyContext.callback_token === 'string' && bodyContext.callback_token !== ''
      ? { url: bodyContext.callback_url, token: bodyContext.callback_token }
      : null;
    const context = contextFrom(service, request, callback);

    const result = await action.handler(input as Record<string, unknown>, context);
    if (isAccepted(result)) return acceptedResponse(action, result, request);
    return json(200, { status: 'completed', output: checkOutput(action, result) });
  }

  async function job(actionId: string, jobId: string, request: SiActionRequest): Promise<SiActionResponse> {
    const action = actions.get(actionId);
    if (!action) throw new SiActionError('unknown_action', `Unknown action '${actionId}'.`);
    if (!action.getJob) throw new SiActionError('unknown_job', 'This action has no pollable jobs.');
    const context = contextFrom(await verify(request), request, null);
    const state = await action.getJob(jobId, context);
    if (!state) throw new SiActionError('unknown_job', 'Unknown job.');
    if (state.status === 'completed') return json(200, { status: 'completed', job_id: jobId, output: checkOutput(action, state.output) });
    if (state.status === 'failed') return json(200, { status: 'failed', job_id: jobId, error: state.error });
    return json(200, { status: 'running', job_id: jobId, ...(typeof state.progress === 'number' ? { progress: state.progress } : {}) });
  }

  const completeJob: SiActions['completeJob'] = async (actionId, callback, result, options) => {
    const action = actions.get(actionId);
    if (!action) throw new InvalidArgumentError(`unknown action '${actionId}'`);
    if (result?.status === 'completed') {
      try {
        checkOutput(action, result.output);
      } catch {
        // Tell the hub the job failed rather than leave the step waiting until it expires.
        return completeCallback(callback, { jobId: result.jobId, status: 'failed', error: { code: 'internal_error', message: 'The action produced output that does not match its schema.', retryable: false } }, fetchImpl, options);
      }
    }
    return completeCallback(callback, result, fetchImpl, options);
  };

  async function handle(request: SiActionRequest): Promise<SiActionResponse> {
    let path: string;
    try {
      path = new URL(request.url).pathname.replace(/\/+$/, '');
    } catch {
      return errorResponse(new SiActionError('bad_request', 'Invalid request URL.'));
    }

    try {
      if (request.method === 'GET' && path === SI_ACTIONS_MANIFEST_PATH) {
        return json(200, manifest(), { 'Cache-Control': 'public, max-age=300' });
      }
      const m = /\/si\/actions\/([^/]+)$/.exec(path);
      if (request.method === 'POST' && m) return await execute(decodeURIComponent(m[1]), request);
      const j = JOB_ROUTE.exec(path);
      if (request.method === 'GET' && j) return await job(decodeURIComponent(j[1]), decodeURIComponent(j[2]), request);
      if (j) throw new SiActionError('unknown_job', 'Unknown job.');
      throw new SiActionError('unknown_action', 'Not an SI Actions route.');
    } catch (e) {
      if (e instanceof SiActionError) return errorResponse(e);
      logger.error?.('[si-sdk/actions] action threw', { error: e instanceof Error ? e.message : String(e) });
      return errorResponse(new SiActionError('internal_error', 'The action failed.'));
    }
  }

  return { manifest, handle, completeJob };
}
