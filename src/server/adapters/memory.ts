import type { CacheAdapter, LockStoreAdapter, SetIfAbsentResult } from './types';

interface Entry<T> {
  value: T;
  expiresAt: number;
}

export interface MemoryAdapterOptions {
  /** Clock override for tests. Milliseconds since epoch. */
  now?: () => number;
}

/**
 * In-process cache. Fine for a single long-lived server and for tests. On
 * edge runtimes every isolate gets its own copy, which only costs extra SI
 * calls (the cache is never needed for correctness).
 */
export function memoryCache(options: MemoryAdapterOptions = {}): CacheAdapter {
  const now = options.now ?? Date.now;
  const store = new Map<string, Entry<unknown>>();

  return {
    async get(key) {
      const entry = store.get(key);
      if (!entry) return undefined;
      if (entry.expiresAt <= now()) {
        store.delete(key);
        return undefined;
      }
      return entry.value;
    },
    async set(key, value, ttlSeconds) {
      if (ttlSeconds <= 0) {
        store.delete(key);
        return;
      }
      store.set(key, { value, expiresAt: now() + ttlSeconds * 1000 });
    },
    async delete(key) {
      store.delete(key);
    },
  };
}

/**
 * In-process lock store. **Tests and local dev only**: locks are not shared
 * between processes or edge isolates, so production needs a shared store
 * such as `supabaseLockStore`.
 */
export function memoryLockStore(options: MemoryAdapterOptions = {}): LockStoreAdapter {
  const now = options.now ?? Date.now;
  const store = new Map<string, Entry<string>>();

  const live = (key: string): Entry<string> | undefined => {
    const entry = store.get(key);
    if (entry && entry.expiresAt <= now()) {
      store.delete(key);
      return undefined;
    }
    return entry;
  };

  return {
    async get(key) {
      return live(key)?.value ?? null;
    },
    async setIfAbsent(key, value, ttlSeconds): Promise<SetIfAbsentResult> {
      // Synchronous check-and-set: atomic within one JS event loop.
      const existing = live(key);
      if (existing) return { created: false, value: existing.value };
      store.set(key, { value, expiresAt: now() + ttlSeconds * 1000 });
      return { created: true, value };
    },
    async touch(key, ttlSeconds) {
      const existing = live(key);
      if (!existing) return false;
      existing.expiresAt = now() + ttlSeconds * 1000;
      return true;
    },
    async delete(key) {
      store.delete(key);
    },
  };
}
