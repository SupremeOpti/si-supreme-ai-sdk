import type { FetchLike } from '../runtime';
import { SiActionError } from './errors';
import { isObject } from './schema';

export interface VerifiedService {
  claims: Record<string, unknown>;
  organizationId: number;
  userId: number;
}

interface AuthOptions {
  issuer: string;
  audience: string;
  app: string;
  hubUrl: string;
  fetch: FetchLike;
  nowSeconds: number;
}

/** `aud` may be a string or a list; the hub sends `["si-actions", "si-actions:<app>"]`. */
export function audienceList(aud: unknown): string[] {
  if (typeof aud === 'string') return [aud];
  return Array.isArray(aud) ? aud.filter((a): a is string => typeof a === 'string') : [];
}

function decodePayload(token: string): Record<string, unknown> | null {
  const part = token.split('.')[1];
  if (!part) return null;
  try {
    const b64 = part.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (part.length % 4)) % 4);
    const payload = JSON.parse(atob(b64));
    return isObject(payload) ? payload : null;
  } catch {
    return null;
  }
}

function checkClaims(claims: Record<string, unknown>, opts: AuthOptions): string | null {
  if (claims.type !== 'service') return 'not a service token';
  if (claims.iss !== opts.issuer) return 'wrong issuer';
  const aud = audienceList(claims.aud);
  if (!aud.includes(opts.audience)) return 'wrong audience';
  // A token scoped to another app (aud "si-actions:<other>") is refused even though it carries the shared audience.
  const scoped = aud.filter((a) => a.startsWith(`${opts.audience}:`));
  if (scoped.length > 0 && !scoped.includes(`${opts.audience}:${opts.app}`)) return 'token was issued for another app';
  if (typeof claims.exp !== 'number' || claims.exp <= opts.nowSeconds) return 'expired';
  if (!Number.isInteger(Number(claims.org_id)) || !Number.isInteger(Number(claims.user_id ?? claims.sub))) return 'missing org or user';
  return null;
}

/**
 * Local claim checks, then the hub confirms the signature
 * (`POST {hub}/api/verify-session-jwt`). Tokens are never cached.
 */
export async function verifyServiceToken(authorization: string | null, opts: AuthOptions): Promise<VerifiedService> {
  const match = /^Bearer\s+(.+)$/i.exec(authorization ?? '');
  if (!match) throw new SiActionError('unauthenticated', 'Missing bearer token.');
  const token = match[1].trim();

  const local = decodePayload(token);
  const localProblem = local ? checkClaims(local, opts) : 'malformed token';
  if (local === null || localProblem) throw new SiActionError('unauthenticated', `Invalid service token: ${localProblem}.`);

  let status: number;
  let body: unknown;
  try {
    const res = await opts.fetch(`${opts.hubUrl}/api/verify-session-jwt`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ token }),
    });
    status = res.status;
    body = JSON.parse((await res.text()) || 'null');
  } catch {
    throw new SiActionError('upstream_unavailable', 'Could not reach the SI hub to verify the token.');
  }

  if (status === 400 || status === 401) throw new SiActionError('unauthenticated', 'The SI hub rejected the token.');
  if (status !== 200 || !isObject(body) || body.valid !== true || !isObject(body.claims)) {
    throw new SiActionError('upstream_unavailable', `The SI hub verifier answered HTTP ${status}.`);
  }
  const claims = body.claims;
  const same = (k: string) => String(claims[k]) === String(local[k]);
  if (!same('type') || !same('iss') || !same('org_id') || String(claims.user_id ?? claims.sub) !== String(local.user_id ?? local.sub)) {
    throw new SiActionError('unauthenticated', 'Verified claims do not match the presented token.');
  }

  return { claims: local, organizationId: Number(local.org_id), userId: Number(local.user_id ?? local.sub) };
}
