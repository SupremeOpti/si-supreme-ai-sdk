/**
 * Minimal JWT payload inspection — no signature verification (that is the
 * server's job). Used only to decide whether a locally held token is worth
 * presenting, so an expired token can be discarded without a network call.
 */

export function decodeJwtPayload(token: string): Record<string, any> | null {
  try {
    const part = token.split('.')[1];
    if (!part) return null;
    const base64 = part.replace(/-/g, '+').replace(/_/g, '/');
    return JSON.parse(atob(base64));
  } catch {
    return null;
  }
}

/**
 * True when the token's `exp` claim is more than `bufferSeconds` away.
 * Tokens without a readable `exp` are treated as expired — the caller
 * falls back to refresh/re-auth and the server stays the authority.
 */
export function tokenHasRemainingLife(token: string, bufferSeconds = 30): boolean {
  const payload = decodeJwtPayload(token);
  if (!payload || typeof payload.exp !== 'number') return false;
  return payload.exp * 1000 - Date.now() > bufferSeconds * 1000;
}
