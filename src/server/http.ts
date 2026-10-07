import type { FetchLike, FetchResponse, HeadersLike } from './runtime';
import { SiUnavailableError } from './errors';
import type { Logger } from './types';

export const SERVER_SDK_VERSION = '1.2.0';

export interface HttpOptions {
  baseUrl: string;
  bearer: string;
  fetch: FetchLike;
  timeoutMs: number;
  logger: Logger;
  /** Max wait before the single retry, honouring `Retry-After`. */
  maxRetryDelayMs?: number;
  /** Sleep override for tests. */
  sleep?: (ms: number) => Promise<void>;
  random?: () => number;
}

export interface HttpResult {
  status: number;
  /** Parsed JSON body, or `undefined` when the body is empty or not JSON. */
  body: unknown;
  headers: HeadersLike;
}

export interface HttpRequest {
  method?: 'GET' | 'POST';
  path: string;
  body?: unknown;
  /** Retry once on network error / 5xx. Default true. */
  retry?: boolean;
  /** Skip retry for a 5xx whose parsed body matches. */
  noRetryOn?: (result: HttpResult) => boolean;
}

const defaultSleep = (ms: number) =>
  new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });

/** Parse `Retry-After` (seconds or HTTP date) to milliseconds. */
export function parseRetryAfter(value: string | null, now: number = Date.now()): number | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (/^\d+$/.test(trimmed)) return Number(trimmed) * 1000;
  const date = Date.parse(trimmed);
  if (Number.isNaN(date)) return null;
  return Math.max(0, date - now);
}

function compareVersions(a: string, b: string): number {
  const pa = a.split('-')[0].split('.').map((n) => Number(n) || 0);
  const pb = b.split('-')[0].split('.').map((n) => Number(n) || 0);
  for (let i = 0; i < 3; i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d !== 0) return d;
  }
  return 0;
}

/**
 * Fetch wrapper for SI's server-to-server APIs: bearer auth, per-attempt
 * timeout, one retry with jitter on network error / timeout / 5xx (honouring
 * `Retry-After`), never retries 4xx. Network failures throw
 * `SiUnavailableError`; every HTTP status is returned for the caller to map.
 */
export function createHttp(options: HttpOptions) {
  const sleep = options.sleep ?? defaultSleep;
  const random = options.random ?? Math.random;
  const maxRetryDelayMs = options.maxRetryDelayMs ?? 1000;
  const base = options.baseUrl.replace(/\/+$/, '');
  let minVersionWarned = false;

  const checkMinVersion = (headers: HeadersLike) => {
    const min = headers.get('x-si-min-server-sdk');
    if (!min || minVersionWarned) return;
    if (compareVersions(SERVER_SDK_VERSION, min) < 0) {
      minVersionWarned = true;
      options.logger.warn(
        `[si-sdk/server] SI requires @supreme-ai/si-sdk/server >= ${min}; this is ${SERVER_SDK_VERSION}. Upgrade: it may contain security fixes.`
      );
    }
  };

  const attempt = async (req: HttpRequest): Promise<HttpResult> => {
    const controller = new AbortController();
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, options.timeoutMs);

    try {
      const headers: Record<string, string> = {
        Authorization: `Bearer ${options.bearer}`,
        Accept: 'application/json',
      };
      if (req.body !== undefined) headers['Content-Type'] = 'application/json';

      let response: FetchResponse;
      try {
        response = await options.fetch(`${base}${req.path}`, {
          method: req.method ?? 'GET',
          headers,
          body: req.body === undefined ? undefined : JSON.stringify(req.body),
          signal: controller.signal,
        });
      } catch (err) {
        if (timedOut) throw new SiUnavailableError('timeout', `no response within ${options.timeoutMs} ms`);
        throw new SiUnavailableError('network', err instanceof Error ? err.message : String(err));
      }

      let text = '';
      try {
        text = await response.text();
      } catch (err) {
        if (timedOut) throw new SiUnavailableError('timeout', `body not received within ${options.timeoutMs} ms`);
        throw new SiUnavailableError('network', 'failed to read response body');
      }

      let body: unknown;
      if (text) {
        try {
          body = JSON.parse(text);
        } catch {
          body = undefined;
        }
      }

      checkMinVersion(response.headers);
      return { status: response.status, body, headers: response.headers };
    } finally {
      clearTimeout(timer);
    }
  };

  return async function request(req: HttpRequest): Promise<HttpResult> {
    const retry = req.retry !== false;
    let first: HttpResult | undefined;
    try {
      first = await attempt(req);
    } catch (err) {
      if (!retry) throw err;
      await sleep(jitter(random));
      return attempt(req);
    }

    if (first.status < 500 || !retry || req.noRetryOn?.(first)) return first;

    const retryAfter = parseRetryAfter(first.headers.get('retry-after'));
    if (retryAfter !== null && retryAfter > maxRetryDelayMs) return first;
    await sleep(retryAfter ?? jitter(random));
    return attempt(req);
  };
}

function jitter(random: () => number): number {
  return 100 + Math.floor(random() * 200);
}

export type HttpClient = ReturnType<typeof createHttp>;
