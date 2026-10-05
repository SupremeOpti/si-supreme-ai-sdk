import type { LockStoreAdapter, SetIfAbsentResult } from './types';

/**
 * The subset of a supabase-js client this adapter uses. Pass a client
 * created with the **service role** key; the functions are not granted to
 * `anon` / `authenticated`.
 */
export interface SupabaseRpcClient {
  rpc(fn: string, args: Record<string, unknown>): PromiseLike<{ data: unknown; error: unknown }>;
}

export interface SupabaseLockStoreOptions {
  /** Prefix of the SQL functions. Default `si_lock` (see `SUPABASE_LOCK_STORE_SQL`). */
  functionPrefix?: string;
}

/**
 * Migration for `supabaseLockStore`. Atomicity comes from the primary key
 * plus `INSERT ... ON CONFLICT DO UPDATE ... WHERE expired`: of two racing
 * first binds, the second waits on the key, sees the committed live row, and
 * gets the winner's value back.
 */
export const SUPABASE_LOCK_STORE_SQL = `-- @supreme-ai/si-sdk/server: conversation-key lock store
create table if not exists public.si_conversation_locks (
  key        text primary key,
  value      text not null,
  expires_at timestamptz not null
);

-- No policies: only the service role (which bypasses RLS) may touch it.
alter table public.si_conversation_locks enable row level security;

create index if not exists si_conversation_locks_expires_at_idx
  on public.si_conversation_locks (expires_at);

create or replace function public.si_lock_get(p_key text)
returns text
language sql
as $$
  select value from public.si_conversation_locks
  where key = p_key and expires_at > now();
$$;

create or replace function public.si_lock_set_if_absent(p_key text, p_value text, p_ttl_seconds integer)
returns table (created boolean, value text)
language plpgsql
as $$
#variable_conflict use_column
declare
  v_value text;
begin
  insert into public.si_conversation_locks as l (key, value, expires_at)
  values (p_key, p_value, now() + make_interval(secs => p_ttl_seconds))
  on conflict (key) do update
    set value = excluded.value, expires_at = excluded.expires_at
    where l.expires_at <= now()
  returning l.value into v_value;

  if found then
    -- Retention: each new bind purges up to 100 rows expired over a day ago.
    delete from public.si_conversation_locks
     where key in (select g.key from public.si_conversation_locks g
                    where g.expires_at < now() - interval '1 day'
                    order by g.expires_at
                    limit 100
                    for update skip locked);
    return query select true, v_value;
    return;
  end if;

  select l.value into v_value from public.si_conversation_locks l where l.key = p_key;
  return query select false, v_value;
end;
$$;

create or replace function public.si_lock_touch(p_key text, p_ttl_seconds integer)
returns boolean
language plpgsql
as $$
begin
  update public.si_conversation_locks
     set expires_at = now() + make_interval(secs => p_ttl_seconds)
   where key = p_key and expires_at > now();
  return found;
end;
$$;

create or replace function public.si_lock_delete(p_key text)
returns void
language sql
as $$
  delete from public.si_conversation_locks where key = p_key;
$$;

revoke all on table public.si_conversation_locks from public, anon, authenticated;
grant select, insert, update, delete on table public.si_conversation_locks to service_role;
revoke execute on function public.si_lock_get(text) from public, anon, authenticated;
revoke execute on function public.si_lock_set_if_absent(text, text, integer) from public, anon, authenticated;
revoke execute on function public.si_lock_touch(text, integer) from public, anon, authenticated;
revoke execute on function public.si_lock_delete(text) from public, anon, authenticated;
grant execute on function public.si_lock_get(text) to service_role;
grant execute on function public.si_lock_set_if_absent(text, text, integer) to service_role;
grant execute on function public.si_lock_touch(text, integer) to service_role;
grant execute on function public.si_lock_delete(text) to service_role;
`;

/**
 * Reference lock store on Supabase Postgres. Requires `SUPABASE_LOCK_STORE_SQL`
 * to be applied. Any RPC error or unexpected payload throws, which the SDK
 * turns into a closed (denied) call.
 */
export function supabaseLockStore(client: SupabaseRpcClient, options: SupabaseLockStoreOptions = {}): LockStoreAdapter {
  const prefix = options.functionPrefix ?? 'si_lock';

  const call = async (fn: string, args: Record<string, unknown>): Promise<unknown> => {
    const { data, error } = await client.rpc(`${prefix}_${fn}`, args);
    if (error) {
      const message = typeof error === 'object' && error && 'message' in error ? String((error as { message: unknown }).message) : String(error);
      throw new Error(`${prefix}_${fn} failed: ${message}`);
    }
    return data;
  };

  return {
    async get(key) {
      const data = await call('get', { p_key: key });
      if (data === null || data === undefined) return null;
      if (typeof data !== 'string') throw new Error(`${prefix}_get returned ${typeof data}`);
      return data;
    },
    async setIfAbsent(key, value, ttlSeconds): Promise<SetIfAbsentResult> {
      const data = await call('set_if_absent', { p_key: key, p_value: value, p_ttl_seconds: Math.ceil(ttlSeconds) });
      const row = Array.isArray(data) ? data[0] : data;
      if (!row || typeof row !== 'object') throw new Error(`${prefix}_set_if_absent returned no row`);
      const { created, value: stored } = row as { created?: unknown; value?: unknown };
      if (typeof created !== 'boolean' || typeof stored !== 'string') {
        throw new Error(`${prefix}_set_if_absent returned a malformed row`);
      }
      return { created, value: stored };
    },
    async touch(key, ttlSeconds) {
      const data = await call('touch', { p_key: key, p_ttl_seconds: Math.ceil(ttlSeconds) });
      return data === true;
    },
    async delete(key) {
      await call('delete', { p_key: key });
    },
  };
}
