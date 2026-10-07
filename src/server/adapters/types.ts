/**
 * Cache used for membership answers and detection state. Values are plain
 * JSON-serializable objects. Implementations may drop entries at any time;
 * the SDK treats read errors as a miss and ignores write errors.
 */
export interface CacheAdapter {
  get(key: string): Promise<unknown | undefined>;
  /** `ttlSeconds` is always > 0. */
  set(key: string, value: unknown, ttlSeconds: number): Promise<void>;
  delete(key: string): Promise<void>;
}

export interface SetIfAbsentResult {
  /** True when this call stored `value`. */
  created: boolean;
  /** The value stored under the key after the call: ours, or the winner's. */
  value: string;
}

/**
 * Store for conversation-key locks. `setIfAbsent` **must be atomic**: when
 * two callers race on an absent (or expired) key with different values,
 * exactly one gets `created: true` and both get the winner's value back.
 * Expired entries count as absent everywhere.
 */
export interface LockStoreAdapter {
  get(key: string): Promise<string | null>;
  setIfAbsent(key: string, value: string, ttlSeconds: number): Promise<SetIfAbsentResult>;
  /** Extends a live entry's TTL. Returns false when the entry is gone. */
  touch(key: string, ttlSeconds: number): Promise<boolean>;
  delete(key: string): Promise<void>;
}
