import { InvalidArgumentError } from './errors';

/**
 * Canonical form of a resource URI, as SI compares them: lowercase scheme
 * and host, no default port, one trailing `/` stripped, query kept, no
 * fragment. Must be https (http only for localhost).
 */
export function canonicalResourceUri(uri: string): string {
  if (typeof uri !== 'string' || !uri.trim()) throw new InvalidArgumentError('resource must be an absolute URI');
  if (uri.includes('#')) throw new InvalidArgumentError('resource must not have a fragment');
  let url: InstanceType<typeof URL>;
  try {
    url = new URL(uri.trim());
  } catch {
    throw new InvalidArgumentError('resource must be an absolute URI');
  }
  const local = url.hostname === 'localhost' || url.hostname === '127.0.0.1' || url.hostname === '[::1]';
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && local)) {
    throw new InvalidArgumentError('resource must use https (http is allowed for localhost only)');
  }
  const path = url.pathname.endsWith('/') ? url.pathname.slice(0, -1) : url.pathname;
  return `${url.protocol}//${url.host}${path}${url.search}`;
}
