import type { LockStoreAdapter } from './adapters/types';
import { LockStoreUnavailableError, OrgLockedError } from './errors';

export const DEFAULT_LOCK_TTL_SECONDS = 24 * 60 * 60;

export interface BindOrgInput {
  principalId: string;
  clientId: string;
  /** SHA-256 hex of the conversation key; `null` → soft mode, no lock. */
  keyHash: string | null;
  organizationId: number;
}

export interface BindOrgResult {
  mode: 'locked' | 'soft';
  /** True when this call created the binding. */
  created: boolean;
}

export interface LocksApi {
  /**
   * Bind `(principal, client, keyHash)` to an org. First call binds, the same
   * org passes (and slides the TTL), another org throws `OrgLockedError`.
   * A lock store failure throws `LockStoreUnavailableError` (fail closed).
   */
  bindOrg(input: BindOrgInput): Promise<BindOrgResult>;
  /** Remove a binding, e.g. from an admin "reset conversation" action. */
  release(input: Omit<BindOrgInput, 'organizationId'>): Promise<void>;
}

export function lockKey(principalId: string, clientId: string, keyHash: string): string {
  return `si:lock:${encodeURIComponent(principalId)}:${encodeURIComponent(clientId)}:${keyHash}`;
}

export function createLocks(store: LockStoreAdapter, ttlSeconds: number = DEFAULT_LOCK_TTL_SECONDS): LocksApi {
  const guard = async <T>(fn: () => Promise<T>): Promise<T> => {
    try {
      return await fn();
    } catch (err) {
      throw new LockStoreUnavailableError(err instanceof Error ? err.message : String(err));
    }
  };

  const parse = (value: string): number => {
    const n = Number(value);
    if (!Number.isInteger(n)) throw new LockStoreUnavailableError('lock store returned a non-numeric org id');
    return n;
  };

  return {
    async bindOrg({ principalId, clientId, keyHash, organizationId }) {
      if (keyHash === null) return { mode: 'soft', created: false };
      const key = lockKey(principalId, clientId, keyHash);
      const wanted = String(organizationId);

      const existing = await guard(() => store.get(key));
      if (existing !== null) {
        const lockedId = parse(existing);
        if (lockedId !== organizationId) throw new OrgLockedError({ id: lockedId }, { id: organizationId });
        // Sliding TTL. If the entry expired between get and touch, re-bind.
        const touched = await guard(() => store.touch(key, ttlSeconds));
        if (touched) return { mode: 'locked', created: false };
      }

      const result = await guard(() => store.setIfAbsent(key, wanted, ttlSeconds));
      const winner = parse(result.value);
      if (winner !== organizationId) throw new OrgLockedError({ id: winner }, { id: organizationId });
      return { mode: 'locked', created: result.created };
    },
    async release({ principalId, clientId, keyHash }) {
      if (keyHash === null) return;
      await guard(() => store.delete(lockKey(principalId, clientId, keyHash)));
    },
  };
}
