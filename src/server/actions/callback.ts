import { InvalidArgumentError } from '../errors';
import type { FetchLike } from '../runtime';
import { isObject } from './schema';
import type { SiActionCallback, SiActionJobError, SiCallbackOptions, SiCallbackResult } from './types';

type CallbackResult =
  | { jobId?: string; status: 'completed'; output: Record<string, unknown> }
  | { jobId?: string; status: 'failed'; error: SiActionJobError };

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]', '::1']);

/** https only, except plain http to a loopback host for local development. */
export function checkCallbackUrl(url: string): string {
  let u: InstanceType<typeof URL>;
  try {
    u = new URL(url);
  } catch {
    throw new InvalidArgumentError('callback url must be an absolute URL');
  }
  const local = LOCAL_HOSTS.has(u.hostname) || u.hostname.endsWith('.localhost');
  if (u.protocol !== 'https:' && !(u.protocol === 'http:' && local)) {
    throw new InvalidArgumentError('callback url must use https (http is allowed for localhost only)');
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
  options: SiCallbackOptions = {},
): Promise<SiCallbackResult> {
  if (!callback || typeof callback.token !== 'string' || callback.token === '') throw new InvalidArgumentError('callback token is required');
  if (result?.status !== 'completed' && result?.status !== 'failed') throw new InvalidArgumentError("result status must be 'completed' or 'failed'");
  if (result.status === 'completed' && !isObject(result.output)) throw new InvalidArgumentError('completed output must be an object');
  const url = checkCallbackUrl(callback.url);
  const timeoutMs = Math.max(1, options.timeoutMs ?? 10_000);
  const retries = Math.max(0, Math.min(10, options.retries ?? 3));
  const payload = body(result);

  let last: SiCallbackResult = { delivered: false, accepted: false, status: 0, code: 'upstream_unavailable' };
  for (let attempt = 0; attempt <= retries; attempt++) {
    if (attempt > 0) await sleep(500 * 2 ** (attempt - 1));
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetchImpl(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json', Authorization: `Bearer ${callback.token}` },
        body: payload,
        signal: controller.signal,
      });
      let parsed: unknown = null;
      try {
        parsed = JSON.parse((await res.text()) || 'null');
      } catch {
        parsed = null;
      }
      if (res.status === 200) {
        const ok = isObject(parsed) ? parsed : {};
        const accepted = ok.accepted !== false;
        return {
          delivered: true,
          accepted,
          status: 200,
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
    } catch {
      last = { delivered: false, accepted: false, status: 0, code: 'upstream_unavailable' };
    } finally {
      clearTimeout(timer);
    }
  }
  return last;
}
