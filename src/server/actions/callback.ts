import { InvalidArgumentError } from '../errors';
import type { FetchLike } from '../runtime';
import { isObject } from './schema';
import type { SiActionCallback, SiActionJobError, SiCallbackOptions, SiCallbackResult } from './types';

type CallbackResult =
  | { jobId?: string; status: 'completed'; output: Record<string, unknown> }
  | { jobId?: string; status: 'failed'; error: SiActionJobError };

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]', '::1']);
const HUB_DOMAIN = 'supremegroup.ai';

function isLoopbackHost(hostname: string): boolean {
  const host = hostname.toLowerCase();
  return LOCAL_HOSTS.has(host) || host.endsWith('.localhost');
}

/**
 * The callback carries the hub's bearer token, so it may only go to an SI host: https on
 * supremegroup.ai or a subdomain, or a loopback host when `hubUrl` is itself loopback (local development).
 */
export function checkCallbackUrl(url: string, hubUrl: string): string {
  let u: InstanceType<typeof URL>;
  try {
    u = new URL(url);
  } catch {
    throw new InvalidArgumentError('callback url must be an absolute URL');
  }
  const host = u.hostname.toLowerCase();
  const localHub = isLoopbackHost(new URL(hubUrl).hostname);
  const local = localHub && isLoopbackHost(host) && (u.protocol === 'https:' || u.protocol === 'http:');
  const hub = (host === HUB_DOMAIN || host.endsWith(`.${HUB_DOMAIN}`)) && u.protocol === 'https:';
  if (!local && !hub) {
    throw new InvalidArgumentError(
      localHub
        ? `callback url must be https on ${HUB_DOMAIN} or a loopback URL`
        : `callback url must be https on ${HUB_DOMAIN}`,
    );
  }
  return u.toString();
}

function body(result: CallbackResult): string {
  const job = typeof result.jobId === 'string' && result.jobId !== '' ? { job_id: result.jobId } : {};
  if (result.status === 'completed') return JSON.stringify({ status: 'completed', ...job, output: result.output });
  const e = result.error ?? { code: 'app_failed', message: 'The job failed.' };
  return JSON.stringify({
    status: 'failed',
    ...job,
    error: {
      code: String(e.code || 'app_failed').slice(0, 64),
      message: String(e.message || 'The job failed.').slice(0, 2000),
      retryable: e.retryable === true,
    },
  });
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
const retryable = (status: number) => status === 0 || status === 429 || status >= 500;

/** `POST {callback.url}` (SI Actions 4.2) with `Authorization: Bearer {callback.token}`. */
export async function completeCallback(
  callback: SiActionCallback,
  result: CallbackResult,
  fetchImpl: FetchLike,
  hubUrl: string,
  options: SiCallbackOptions = {},
): Promise<SiCallbackResult> {
  if (!callback || typeof callback.token !== 'string' || callback.token === '') throw new InvalidArgumentError('callback token is required');
  if (result?.status !== 'completed' && result?.status !== 'failed') throw new InvalidArgumentError("result status must be 'completed' or 'failed'");
  if (result.status === 'completed' && !isObject(result.output)) throw new InvalidArgumentError('completed output must be an object');
  const url = checkCallbackUrl(callback.url, hubUrl);
  const timeoutMs = Math.max(1, options.timeoutMs ?? 10_000);
  const retries = Math.max(0, Math.min(10, options.retries ?? 3));
  const payload = body(result);

  let last: SiCallbackResult = { delivered: false, accepted: false, status: 0, code: 'upstream_unavailable' };
  let retryAfterMs: number | null = null;
  for (let attempt = 0; attempt <= retries; attempt++) {
    if (attempt > 0) await sleep(retryAfterMs ?? 500 * 2 ** (attempt - 1));
    retryAfterMs = null;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetchImpl(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json', Authorization: `Bearer ${callback.token}` },
        body: payload,
        // Never follow a redirect: it could carry the bearer token to another host.
        redirect: 'manual',
        signal: controller.signal,
      });
      if (res.status >= 300 && res.status < 400) {
        return { delivered: false, accepted: false, status: res.status, code: 'redirect_refused' };
      }
      let parsed: unknown = null;
      try {
        parsed = JSON.parse((await res.text()) || 'null');
      } catch {
        parsed = null;
      }
      if (res.status >= 200 && res.status < 300) {
        const ok = isObject(parsed) ? parsed : {};
        const accepted = ok.accepted !== false;
        return {
          delivered: true,
          accepted,
          status: res.status,
          ...(accepted ? {} : { code: typeof ok.reason === 'string' ? ok.reason : 'invalid_output' }),
          ...(Array.isArray(ok.errors) ? { errors: ok.errors.map(String) } : {}),
        };
      }
      const err = isObject(parsed) && isObject(parsed.error) ? parsed.error : null;
      const validation = isObject(parsed) && isObject(parsed.errors) ? Object.values(parsed.errors).flat().map(String) : undefined;
      last = {
        delivered: false,
        accepted: false,
        status: res.status,
        code: typeof err?.code === 'string' ? err.code : res.status === 422 ? 'validation_failed' : `http_${res.status}`,
        ...(validation ? { errors: validation } : {}),
      };
      if (!retryable(res.status)) return last;
      const after = Number(res.headers.get('retry-after'));
      if (res.status === 429 && Number.isFinite(after) && after >= 0) retryAfterMs = Math.min(after, 60) * 1000;
    } catch {
      last = { delivered: false, accepted: false, status: 0, code: 'upstream_unavailable' };
    } finally {
      clearTimeout(timer);
    }
  }
  return last;
}
