// @vitest-environment node
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { pg_trgm } from '@electric-sql/pglite/contrib/pg_trgm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

/**
 * Runs the REAL migration files in an in-process Postgres and exercises RLS as anon / authenticated / the
 * table owner (which stands in for the service role, which bypasses RLS). Simulated: the auth schema, the
 * Supabase roles, and a minimal storage schema (buckets + objects with RLS). NOT covered: Supabase's Storage API
 * itself or signed-URL generation. Those need verifying on the live project.
 */
const read = (f: string) => readFileSync(resolve(import.meta.dirname, `../../supabase/migrations/${f}`), 'utf8');
const CATALOG = read('20261027010000_exercise_videos_catalog.sql');
const STORAGE = read('20261027010100_exercise_videos_storage.sql');

const U = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const sha = (n: number) => n.toString(16).padStart(64, '0');
let pg: PGlite;

async function as<T>(role: 'anon' | 'authenticated' | 'postgres', fn: () => Promise<T>): Promise<T> {
  await pg.exec(`reset role; select set_config('request.jwt.claim.sub', '${role === 'anon' ? '' : U}', false);`);
  if (role !== 'postgres') await pg.exec(`set role ${role}`);
  try { return await fn(); } finally { await pg.exec('reset role'); }
}
const rows = async (sql: string) => (await pg.query<Record<string, unknown>>(sql)).rows;

const insert = (n: number, over: Record<string, string> = {}) => {
  const v = { review_status: "'matched'", status: "'uploaded'", exercise_key: "'barbell-squat'", ...over };
  return `insert into public.exercise_videos (content_sha256, original_filename, title, storage_key, size_bytes, review_status, status, exercise_key)
          values ('${sha(n)}', 'v${n}.mp4', 'Video ${n}', 'videos/x/${n}.mp4', 1000, ${v.review_status}, ${v.status}, ${v.exercise_key})`;
};

beforeAll(async () => {
  pg = new PGlite({ extensions: { pg_trgm } });
  await pg.exec(`
    create role anon nologin; create role authenticated nologin;
    create schema auth; create schema extensions; create schema storage;
    create function auth.uid() returns uuid language sql stable as
      $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    create table storage.buckets (id text primary key, name text, public boolean default false, file_size_limit bigint, allowed_mime_types text[]);
    create table storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text references storage.buckets(id), name text);
    alter table storage.objects enable row level security;
    grant usage on schema public, auth, storage to anon, authenticated;
    grant execute on function auth.uid() to anon, authenticated;
    grant select on storage.objects to anon, authenticated;
  `);
  await pg.exec(CATALOG);
  await pg.exec(STORAGE);
  await pg.exec([
    insert(1),                                                                       // published
    insert(2, { status: "'pending'" }),                                              // not uploaded yet
    insert(3, { review_status: "'needs_review'", exercise_key: 'null' }),            // uploaded, unreviewed
    insert(4, { status: "'failed'" }),
    insert(5, { review_status: "'rejected'" })
  ].join(';') + ';');
  await pg.exec(`insert into storage.objects (bucket_id, name) values
    ('exercise-videos','videos/x/1.mp4'), ('exercise-videos','videos/x/2.mp4'), ('exercise-videos','videos/x/3.mp4'),
    ('exercise-videos','videos/x/orphan.mp4')`);
}, 60000);
afterAll(async () => { await pg.close(); });

describe('migrations', () => {
  it('are idempotent', async () => {
    await expect(pg.exec(CATALOG)).resolves.toBeDefined();
    await expect(pg.exec(STORAGE)).resolves.toBeDefined();
    expect((await rows('select count(*)::int n from public.exercise_videos'))[0].n).toBe(5);
    expect((await rows("select count(*)::int n from storage.buckets where id = 'exercise-videos'"))[0].n).toBe(1);
  });
  it('create a private, MP4-only, size-limited bucket', async () => {
    expect(await rows("select public, file_size_limit::text fsl, allowed_mime_types::text m from storage.buckets where id = 'exercise-videos'")).toEqual([
      { public: false, fsl: '104857600', m: '{video/mp4}' }
    ]);
  });
  it('enable RLS and scope the only policy to authenticated SELECT', async () => {
    expect(await rows("select relrowsecurity from pg_class where oid = 'public.exercise_videos'::regclass")).toEqual([{ relrowsecurity: true }]);
    expect(await rows("select cmd, roles::text roles from pg_policies where tablename = 'exercise_videos'")).toEqual([{ cmd: 'SELECT', roles: '{authenticated}' }]);
  });
});

describe('catalog table access', () => {
  it('denies anon completely', async () => {
    await expect(as('anon', () => rows('select * from public.exercise_videos'))).rejects.toThrow(/permission denied/);
  });
  it('shows authenticated users only published, reviewed rows', async () => {
    const r = await as('authenticated', () => rows('select title from public.exercise_videos order by title'));
    expect(r).toEqual([{ title: 'Video 1' }]);
  });
  it('lets the service role (owner) see everything', async () => {
    expect((await as('postgres', () => rows('select count(*)::int n from public.exercise_videos')))[0].n).toBe(5);
  });
  it('blocks every write for authenticated and anon', async () => {
    await expect(as('authenticated', () => pg.exec(insert(99)))).rejects.toThrow(/permission denied/);
    await expect(as('authenticated', () => pg.exec("update public.exercise_videos set title = 'hacked'"))).rejects.toThrow(/permission denied/);
    await expect(as('authenticated', () => pg.exec('delete from public.exercise_videos'))).rejects.toThrow(/permission denied/);
    await expect(as('anon', () => pg.exec(insert(98)))).rejects.toThrow(/permission denied/);
    expect((await rows("select title from public.exercise_videos where content_sha256 = '" + sha(1) + "'"))[0].title).toBe('Video 1');
  });
});

describe('constraints', () => {
  it.each([
    ['a matched video without an exercise key', insert(50, { exercise_key: 'null' })],
    ['a duplicate content hash', insert(1)],
    ['a malformed hash', "insert into public.exercise_videos (content_sha256, original_filename, title, storage_key, size_bytes) values ('xyz','a.mp4','A','k',1)"],
    ['zero size', "insert into public.exercise_videos (content_sha256, original_filename, title, storage_key, size_bytes) values ('" + sha(51) + "','a.mp4','A','k51',0)"],
    ['an unknown status', insert(52, { status: "'live'" })],
    ['a duplicate storage key', "insert into public.exercise_videos (content_sha256, original_filename, title, storage_key, size_bytes) values ('" + sha(53) + "','a.mp4','A','videos/x/1.mp4',1)"]
  ])('rejects %s', async (_n, sql) => {
    await expect(pg.exec(sql)).rejects.toThrow();
  });
  it('touches updated_at on update', async () => {
    const before = (await rows(`select updated_at from public.exercise_videos where content_sha256 = '${sha(1)}'`))[0].updated_at as Date;
    await new Promise((r) => setTimeout(r, 15));
    await pg.exec(`update public.exercise_videos set sort_order = 3 where content_sha256 = '${sha(1)}'`);
    const after = (await rows(`select updated_at from public.exercise_videos where content_sha256 = '${sha(1)}'`))[0].updated_at as Date;
    expect(after.getTime()).toBeGreaterThan(before.getTime());
  });
  it('supports the lookup and trigram/text search queries the app uses', async () => {
    expect((await rows("select title from public.exercise_videos where search_vector @@ to_tsquery('simple','video & 1')")).length).toBe(1);
    expect((await rows("select title from public.exercise_videos where exercise_key = 'barbell-squat' and status = 'uploaded' and review_status = 'matched'")).length).toBe(1);
  });
});

describe('storage object access', () => {
  const visible = (role: 'authenticated' | 'anon') =>
    as(role, async () => (await rows("select name from storage.objects where bucket_id = 'exercise-videos' order by name")).map((r) => r.name));
  it('exposes only objects backed by a published catalog row', async () => {
    expect(await visible('authenticated')).toEqual(['videos/x/1.mp4']);
  });
  it('hides pending, unreviewed and orphan objects, and everything from anon', async () => {
    const names = await visible('authenticated');
    for (const hidden of ['videos/x/2.mp4', 'videos/x/3.mp4', 'videos/x/orphan.mp4']) expect(names).not.toContain(hidden);
    expect(await visible('anon')).toEqual([]);
  });
  it('lets a video appear when it is later published, and disappear if rejected', async () => {
    await pg.exec(`update public.exercise_videos set status = 'uploaded', review_status = 'matched', exercise_key = 'x' where content_sha256 = '${sha(2)}'`);
    expect(await visible('authenticated')).toEqual(['videos/x/1.mp4', 'videos/x/2.mp4']);
    await pg.exec(`update public.exercise_videos set review_status = 'rejected' where content_sha256 = '${sha(2)}'`);
    expect(await visible('authenticated')).toEqual(['videos/x/1.mp4']);
  });
  it('grants no write policy on storage.objects for this bucket', async () => {
    const pol = await rows("select cmd from pg_policies where schemaname = 'storage' and tablename = 'objects'");
    expect(pol).toEqual([{ cmd: 'SELECT' }]);
  });
});
