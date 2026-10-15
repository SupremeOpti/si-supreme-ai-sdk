import { InvalidArgumentError } from '../errors';
import type { Logger } from '../types';
import { verifyServiceToken } from './auth';
import { SiActionError } from './errors';
import { isObject, validate } from './schema';
import type { SiActionContext, SiActionDefinition, SiActionRequest, SiActionResponse, SiActionsConfig } from './types';

export { SiActionError } from './errors';
export { audienceList } from './auth';
export { validate as validateJsonSchema } from './schema';
export type * from './types';

export const SI_ACTIONS_VERSION = '1';
export const SI_ACTIONS_MANIFEST_PATH = '/.well-known/si-actions.json';

const ID_PATTERN = /^[a-z0-9_]{1,48}$/;

export interface SiActions {
  /** The manifest the hub imports (`workflows:sync-capabilities`). */
  manifest(): Record<string, unknown>;
  /**
   * Routes `GET /.well-known/si-actions.json` and `POST /si/actions/{id}`.
   * Anything else gets a contract 404, so mount it on those paths only.
   */
  handle(request: SiActionRequest): Promise<SiActionResponse>;
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

function int(value: unknown): number | null {
  const n = Number(value);
  return value !== undefined && value !== null && Number.isInteger(n) ? n : null;
}

/**
 * Serves an app's actions to the SI Workflow Builder (SI Actions contract v1):
 * verifies the hub's service token, scopes every call to the token's org and
 * user, validates input and output against the declared schemas, and answers
 * in the contract's shapes. Sync actions only for now.
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
      annotations: { readOnlyHint: false, idempotentHint: false, openWorldHint: true, ...(a.annotations ?? {}) },
      execution: { mode: 'sync', typical_seconds: a.execution?.typicalSeconds ?? 10, max_seconds: a.execution?.maxSeconds ?? 120 },
      examples: a.examples ?? [],
    })),
  });

  async function execute(actionId: string, request: SiActionRequest): Promise<SiActionResponse> {
    const action = actions.get(actionId);
    if (!action) throw new SiActionError('unknown_action', `Unknown action '${actionId}'.`);

    const service = await verifyServiceToken(request.headers.get('authorization'), {
      issuer, audience, app: config.app, hubUrl, fetch: fetchImpl, nowSeconds: Math.floor(now() / 1000),
    });

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

    const claims = service.claims;
    const context: SiActionContext = {
      organizationId: service.organizationId,
      organizationSlug: typeof claims.org_slug === 'string' ? claims.org_slug : null,
      userId: service.userId,
      workflowId: int(claims.workflow_id),
      runId: int(claims.run_id),
      nodeId: typeof claims.node_id === 'string' ? claims.node_id : null,
      attempt: int(claims.attempt) ?? 1,
      idempotencyKey: request.headers.get('x-si-idempotency-key'),
    };

    const output = await action.handler(input as Record<string, unknown>, context);
    if (!isObject(output)) throw new SiActionError('internal_error', 'The action returned a non-object output.');
    const outProblems = validate(output, action.outputSchema, 'output');
    if (outProblems.length > 0) {
      logger.error?.('[si-sdk/actions] output does not match output_schema', { action: actionId, errors: outProblems });
      throw new SiActionError('internal_error', 'The action produced output that does not match its schema.');
    }

    return json(200, { status: 'completed', output });
  }

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
      if (/\/si\/actions\/[^/]+\/jobs\/[^/]+$/.test(path)) throw new SiActionError('unknown_job', 'This app has no async jobs.');
      throw new SiActionError('unknown_action', 'Not an SI Actions route.');
    } catch (e) {
      if (e instanceof SiActionError) return errorResponse(e);
      logger.error?.('[si-sdk/actions] action threw', { error: e instanceof Error ? e.message : String(e) });
      return errorResponse(new SiActionError('internal_error', 'The action failed.'));
    }
  }

  return { manifest, handle };
}
