/**
 * Runs SUPABASE_LOCK_STORE_SQL against a real Postgres. Opt-in: set
 * SI_TEST_PG_URL (e.g. postgres://postgres:postgres@localhost:55432/postgres)
 * and have `psql` on PATH. Skipped otherwise.
 */
import { describe, expect, it, beforeAll } from '@jest/globals';
import { execFileSync, spawn } from 'child_process';
import { SUPABASE_LOCK_STORE_SQL } from '../../src/server';

const url = process.env.SI_TEST_PG_URL;
const d = url ? describe : describe.skip;

function psql(sql: string): string {
  return execFileSync('psql', [url!, '-v', 'ON_ERROR_STOP=1', '-qtA', '-c', sql], { encoding: 'utf8' }).trim();
}

function psqlAsync(sql: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const p = spawn('psql', [url!, '-v', 'ON_ERROR_STOP=1', '-qtA'], { stdio: ['pipe', 'pipe', 'pipe'] });
    let out = '';
    let err = '';
    p.stdout.on('data', (b) => (out += b));
    p.stderr.on('data', (b) => (err += b));
    p.on('close', (code) => (code === 0 ? resolve(out.trim()) : reject(new Error(err))));
    p.stdin.end(sql);
  });
}

d('SUPABASE_LOCK_STORE_SQL on Postgres', () => {
  beforeAll(() => {
    psql(`do $$ begin
      if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon; end if;
      if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated; end if;
      if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role; end if;
      alter role service_role bypassrls;
    end $$;`);
    psql('drop table if exists public.si_conversation_locks cascade');
    execFileSync('psql', [url!, '-v', 'ON_ERROR_STOP=1', '-q'], { input: SUPABASE_LOCK_STORE_SQL });
    // Applying twice must be safe.
    execFileSync('psql', [url!, '-v', 'ON_ERROR_STOP=1', '-q'], { input: SUPABASE_LOCK_STORE_SQL });
  });

  it('set_if_absent creates, then returns the stored value', () => {
    expect(psql(`select created, value from si_lock_set_if_absent('a', '2', 60)`)).toBe('t|2');
    expect(psql(`select created, value from si_lock_set_if_absent('a', '29', 60)`)).toBe('f|2');
    expect(psql(`select si_lock_get('a')`)).toBe('2');
  });

  it('expired rows count as absent and are replaced', () => {
    psql(`insert into si_conversation_locks values ('old', '2', now() - interval '1 second')`);
    expect(psql(`select coalesce(si_lock_get('old'), 'null')`)).toBe('null');
    expect(psql(`select si_lock_touch('old', 60)`)).toBe('f');
    expect(psql(`select created, value from si_lock_set_if_absent('old', '29', 60)`)).toBe('t|29');
  });

  it('touch extends a live row; delete removes it', () => {
    psql(`select si_lock_set_if_absent('t', '2', 5)`);
    expect(psql(`select si_lock_touch('t', 3600)`)).toBe('t');
    expect(psql(`select expires_at > now() + interval '50 minutes' from si_conversation_locks where key = 't'`)).toBe('t');
    psql(`select si_lock_delete('t')`);
    expect(psql(`select coalesce(si_lock_get('t'), 'null')`)).toBe('null');
  });

  it('concurrent first binds: the second waits and gets the winner', async () => {
    const a = psqlAsync(`begin; select created, value from si_lock_set_if_absent('race', '2', 60); select pg_sleep(1); commit;`);
    await new Promise((r) => setTimeout(r, 300));
    const b = psqlAsync(`select created, value from si_lock_set_if_absent('race', '29', 60);`);
    const [ra, rb] = await Promise.all([a, b]);
    expect(ra.split('\n')[0]).toBe('t|2');
    expect(rb).toBe('f|2');
  });

  it('many parallel first binds: exactly one creates', async () => {
    const results = await Promise.all(
      Array.from({ length: 8 }, (_, i) => psqlAsync(`select created, value from si_lock_set_if_absent('herd', '${i + 1}', 60);`))
    );
    const created = results.filter((r) => r.startsWith('t|'));
    expect(created).toHaveLength(1);
    const winner = created[0].split('|')[1];
    expect(results.every((r) => r.endsWith(`|${winner}`))).toBe(true);
  });

  it('a new bind purges rows expired over a day ago, bounded to 100', () => {
    psql(`insert into si_conversation_locks select 'gc-' || i, '2', now() - interval '2 days' from generate_series(1, 150) i`);
    psql(`insert into si_conversation_locks values ('gc-recent', '2', now() - interval '1 hour')`);
    psql(`select si_lock_set_if_absent('gc-trigger', '2', 60)`);
    expect(psql(`select count(*) from si_conversation_locks where key like 'gc-%' and expires_at < now() - interval '1 day'`)).toBe('50');
    expect(psql(`select count(*) from si_conversation_locks where key = 'gc-recent'`)).toBe('1');
    // A bind that finds a live row does not purge.
    psql(`select si_lock_set_if_absent('gc-trigger', '29', 60)`);
    expect(psql(`select count(*) from si_conversation_locks where key like 'gc-%' and expires_at < now() - interval '1 day'`)).toBe('50');
  });

  it('anon and authenticated cannot execute the functions', () => {
    expect(() => psql(`set role anon; select si_lock_get('a')`)).toThrow(/permission denied/);
    expect(() => psql(`set role authenticated; select si_lock_set_if_absent('x', '1', 60)`)).toThrow(/permission denied/);
    expect(psql(`set role service_role; select si_lock_get('a')`)).toBe('2');
  });
});
