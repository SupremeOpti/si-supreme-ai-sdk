import { memoryCache, memoryLockStore } from './adapters/memory';
import { createAudit, type AuditApi } from './audit';
import { createDetection, DEFAULT_DETECTION_WINDOW_SECONDS, type DetectionApi } from './detection';
import { MisconfiguredKeyError, InvalidArgumentError } from './errors';
import { createHttp } from './http';
import { createLocks, DEFAULT_LOCK_TTL_SECONDS, type LocksApi } from './locks';
import { clampTtl, createMembership, MAX_ALLOW_TTL_SECONDS, MAX_DENY_TTL_SECONDS, type MembershipApi } from './membership';
import { createMcp, type McpApi } from './mcp';
import { createOrganizations, type OrganizationsApi } from './organizations';
import type { Logger, SiServerConfig } from './types';

export interface SiServerClient {
  membership: MembershipApi;
  organizations: OrganizationsApi;
  locks: LocksApi;
  detection: DetectionApi;
  audit: AuditApi;
  mcp: McpApi;
}

const consoleLogger: Logger = {
  warn: (message, context) => (context ? console.warn(message, context) : console.warn(message)),
  error: (message, context) => (context ? console.error(message, context) : console.error(message)),
};

function validateBaseUrl(baseUrl: string): string {
  let url: InstanceType<typeof URL>;
  try {
    url = new URL(baseUrl);
  } catch {
    throw new InvalidArgumentError('baseUrl must be an absolute URL');
  }
  const local = url.hostname === 'localhost' || url.hostname === '127.0.0.1' || url.hostname === '[::1]';
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && local)) {
    throw new InvalidArgumentError('baseUrl must use https (http is allowed for localhost only)');
  }
  return url.origin + url.pathname.replace(/\/+$/, '');
}

/**
 * Server-side SI client for app MCPs and APIs. Holds the app's secret
 * `membership_api` key: never construct it in browser code.
 */
export function createSiServerClient(config: SiServerConfig): SiServerClient {
  if (!config || typeof config !== 'object') throw new InvalidArgumentError('config is required');
  if (typeof config.membershipKey !== 'string' || !config.membershipKey.trim()) {
    throw new MisconfiguredKeyError('membershipKey is empty (set SI_MEMBERSHIP_KEY)');
  }
  const baseUrl = validateBaseUrl(config.baseUrl);
  const logger = config.logger ?? consoleLogger;
  const now = config.now ?? Date.now;
  const fetchImpl = config.fetch ?? ((input, init) => fetch(input, init));
  const cache = config.cache ?? memoryCache({ now });

  let lockStore = config.locks;
  if (!lockStore) {
    lockStore = memoryLockStore({ now });
    logger.warn(
      '[si-sdk/server] no lock store configured: using memoryLockStore(), which is per-process. Pass `locks` (e.g. supabaseLockStore) in production.'
    );
  }

  const http = createHttp({
    baseUrl,
    bearer: config.membershipKey.trim(),
    fetch: fetchImpl,
    timeoutMs: config.timeoutMs && config.timeoutMs > 0 ? config.timeoutMs : 3000,
    logger,
  });

  const membership = createMembership({
    http,
    cache,
    logger,
    now,
    allowTtlSeconds: clampTtl(config.membership?.allowTtlSeconds, MAX_ALLOW_TTL_SECONDS),
    denyTtlSeconds: clampTtl(config.membership?.denyTtlSeconds, MAX_DENY_TTL_SECONDS),
  });
  const organizations = createOrganizations(membership);
  const locks = createLocks(lockStore, config.lockTtlSeconds && config.lockTtlSeconds > 0 ? config.lockTtlSeconds : DEFAULT_LOCK_TTL_SECONDS);
  const detection = createDetection({
    cache,
    now,
    enabled: config.detection?.enabled !== false,
    windowSeconds: config.detection?.windowSeconds ?? DEFAULT_DETECTION_WINDOW_SECONDS,
  });
  const audit = createAudit({ http, logger, onAudit: config.onAudit, forwarding: config.auditForwarding });
  const mcp = createMcp({ membership, organizations, locks, detection, audit, logger, now, conversation: config.conversation });

  return { membership, organizations, locks, detection, audit, mcp };
}
