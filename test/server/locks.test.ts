import { describe, expect, it } from '@jest/globals';
import {
  LockStoreUnavailableError,
  memoryLockStore,
  OrgLockedError,
  supabaseLockStore,
  type LockStoreAdapter,
  type SupabaseRpcClient,
} from '../../src/server';
import { createLocks, lockKey } from '../../src/server/locks';
import { clock } from './helpers';

/**
 * Fake supabase-js client emulating the SQL functions in
 * SUPABASE_LOCK_STORE_SQL. Each RPC yields to the event loop for a random
 * delay first (like a network hop) and then applies its effect atomically,
 * as Postgres does under the primary-key constraint.
 */
function fakeSupabase(now: () => number) {
  const rows = new Map<string, { value: string; expiresAt: number }>();
  const calls: string[] = [];
  let failing = false;
  const live = (k: string) => {
    const r = rows.get(k);
    return r && r.expiresAt > now() ? r : undefined;
  };
  const client: SupabaseRpcClient = {
    async rpc(fn, args) {
      calls.push(fn);
      await new Promise((r) => setTimeout(r, Math.floor(Math.random() * 5)));
      if (failing) return { data: null, error: { message: 'connection refused' } };
      const key = args.p_key as string;
      switch (fn) {
        case 'si_lock_get':
          return { data: live(key)?.value ?? null, error: null };
        case 'si_lock_set_if_absent': {
          const existing = live(key);
          if (existing) return { data: [{ created: false, value: existing.value }], error: null };
          rows.set(key, { value: args.p_value as string, expiresAt: now() + (args.p_ttl_seconds as number) * 1000 });
          return { data: [{ created: true, value: args.p_value }], error: null };
        }
        case 'si_lock_touch': {
          const existing = live(key);
          if (existing) existing.expiresAt = now() + (args.p_ttl_seconds as number) * 1000;
          return { data: !!existing, error: null };
        }
        case 'si_lock_delete':
          rows.delete(key);
          return { data: null, error: null };
        default:
          return { data: null, error: { message: `unknown function ${fn}` } };
      }
    },
  };
  return { client, calls, setFailing: (f: boolean) => (failing = f) };
}

type Factory = (now: () => number) => { store: LockStoreAdapter; fail: () => void };

const adapters: Array<[string, Factory]> = [
  [
    'memoryLockStore',
    (now) => {
      const inner = memoryLockStore({ now });
      let failing = false;
      const wrap =
        <A extends unknown[], R>(f: (...a: A) => Promise<R>) =>
        async (...a: A) => {
          if (failing) throw new Error('down');
          return f(...a);
        };
      return {
        store: { get: wrap(inner.get), setIfAbsent: wrap(inner.setIfAbsent), touch: wrap(inner.touch), delete: wrap(inner.delete) },
        fail: () => (failing = true),
      };
    },
  ],
  [
    'supabaseLockStore (fake client)',
    (now) => {
      const fake = fakeSupabase(now);
      return { store: supabaseLockStore(fake.client), fail: () => fake.setFailing(true) };
    },
  ],
];

describe.each(adapters)('lock store contract: %s', (_name, factory) => {
  const KEY = 'k'.repeat(64);
  const base = { principalId: 'user-456', clientId: 'chatgpt', keyHash: KEY };

  it('setIfAbsent: first call creates, later calls return the stored value', async () => {
    const c = clock();
    const { store } = factory(c.now);
    await expect(store.setIfAbsent('a', '2', 60)).resolves.toEqual({ created: true, value: '2' });
    await expect(store.setIfAbsent('a', '29', 60)).resolves.toEqual({ created: false, value: '2' });
    await expect(store.get('a')).resolves.toBe('2');
  });

  it('expired entries count as absent', async () => {
    const c = clock();
    const { store } = factory(c.now);
    await store.setIfAbsent('a', '2', 60);
    c.advance(61);
    await expect(store.get('a')).resolves.toBeNull();
    await expect(store.touch('a', 60)).resolves.toBe(false);
    await expect(store.setIfAbsent('a', '29', 60)).resolves.toEqual({ created: true, value: '29' });
  });

  it('concurrent setIfAbsent with different values: exactly one wins', async () => {
    const c = clock();
    const { store } = factory(c.now);
    for (let round = 0; round < 20; round++) {
      const key = `race-${round}`;
      const results = await Promise.all(['2', '29', '7', '11'].map((v) => store.setIfAbsent(key, v, 60)));
      expect(results.filter((r) => r.created)).toHaveLength(1);
      const winner = results.find((r) => r.created)!.value;
      expect(results.every((r) => r.value === winner)).toBe(true);
    }
  });

  it('bindOrg: first binds, same org passes, other org → OrgLockedError', async () => {
    const c = clock();
    const locks = createLocks(factory(c.now).store, 3600);
    await expect(locks.bindOrg({ ...base, organizationId: 2 })).resolves.toEqual({ mode: 'locked', created: true });
    await expect(locks.bindOrg({ ...base, organizationId: 2 })).resolves.toEqual({ mode: 'locked', created: false });
    const err = await locks.bindOrg({ ...base, organizationId: 29 }).catch((e) => e);
    expect(err).toBeInstanceOf(OrgLockedError);
    expect(err.code).toBe('org_locked');
    expect(err.lockedOrganization).toEqual({ id: 2 });
  });

  it('bindOrg: locks are per principal, client and key', async () => {
    const c = clock();
    const locks = createLocks(factory(c.now).store, 3600);
    await locks.bindOrg({ ...base, organizationId: 2 });
    await expect(locks.bindOrg({ ...base, keyHash: 'b'.repeat(64), organizationId: 29 })).resolves.toMatchObject({ created: true });
    await expect(locks.bindOrg({ ...base, clientId: 'codex', organizationId: 29 })).resolves.toMatchObject({ created: true });
    await expect(locks.bindOrg({ ...base, principalId: 'user-457', organizationId: 29 })).resolves.toMatchObject({ created: true });
  });

  it('bindOrg: concurrent first binds with two orgs → exactly one wins', async () => {
    const c = clock();
    const locks = createLocks(factory(c.now).store, 3600);
    for (let round = 0; round < 20; round++) {
      const keyHash = String(round).padStart(64, '0');
      const results = await Promise.allSettled([
        locks.bindOrg({ ...base, keyHash, organizationId: 2 }),
        locks.bindOrg({ ...base, keyHash, organizationId: 29 }),
      ]);
      const won = results.filter((r) => r.status === 'fulfilled');
      const lost = results.filter((r) => r.status === 'rejected') as PromiseRejectedResult[];
      expect(won).toHaveLength(1);
      expect(lost).toHaveLength(1);
      expect(lost[0].reason).toBeInstanceOf(OrgLockedError);
    }
  });

  it('bindOrg: null key → soft mode, store untouched', async () => {
    const c = clock();
    const { store, fail } = factory(c.now);
    fail(); // any store call would throw
    const locks = createLocks(store, 3600);
    await expect(locks.bindOrg({ ...base, keyHash: null, organizationId: 2 })).resolves.toEqual({ mode: 'soft', created: false });
    await expect(locks.bindOrg({ ...base, keyHash: null, organizationId: 29 })).resolves.toEqual({ mode: 'soft', created: false });
  });

  it('bindOrg: TTL slides on use and the lock lapses after it', async () => {
    const c = clock();
    const locks = createLocks(factory(c.now).store, 100);
    await locks.bindOrg({ ...base, organizationId: 2 });
    c.advance(90);
    await locks.bindOrg({ ...base, organizationId: 2 }); // slides to t+190
    c.advance(90);
    await expect(locks.bindOrg({ ...base, organizationId: 29 })).rejects.toBeInstanceOf(OrgLockedError);
    c.advance(101);
    await expect(locks.bindOrg({ ...base, organizationId: 29 })).resolves.toMatchObject({ created: true });
  });

  it('bindOrg: store failure fails closed', async () => {
    const c = clock();
    const { store, fail } = factory(c.now);
    fail();
    const locks = createLocks(store, 3600);
    await expect(locks.bindOrg({ ...base, organizationId: 2 })).rejects.toBeInstanceOf(LockStoreUnavailableError);
  });

  it('release removes the binding', async () => {
    const c = clock();
    const locks = createLocks(factory(c.now).store, 3600);
    await locks.bindOrg({ ...base, organizationId: 2 });
    await locks.release(base);
    await expect(locks.bindOrg({ ...base, organizationId: 29 })).resolves.toMatchObject({ created: true });
  });
});

describe('locks details', () => {
  it('lock keys escape separators', () => {
    expect(lockKey('a:b', 'c/d', 'h')).toBe('si:lock:a%3Ab:c%2Fd:h');
  });

  it('a non-numeric stored value fails closed', async () => {
    const store = memoryLockStore();
    await store.setIfAbsent(lockKey('p', 'c', 'h'), 'garbage', 60);
    const locks = createLocks(store);
    await expect(locks.bindOrg({ principalId: 'p', clientId: 'c', keyHash: 'h', organizationId: 2 })).rejects.toBeInstanceOf(
      LockStoreUnavailableError
    );
  });

  it('supabaseLockStore rejects malformed RPC payloads and honours functionPrefix', async () => {
    const calls: string[] = [];
    const client: SupabaseRpcClient = {
      rpc: async (fn) => {
        calls.push(fn);
        return { data: [{ created: 'yes', value: 2 }], error: null };
      },
    };
    const store = supabaseLockStore(client, { functionPrefix: 'app_lock' });
    await expect(store.setIfAbsent('k', '2', 60)).rejects.toThrow(/malformed/);
    expect(calls).toEqual(['app_lock_set_if_absent']);
  });
});
