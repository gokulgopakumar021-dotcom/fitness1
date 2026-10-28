// @vitest-environment node
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { pg_trgm } from '@electric-sql/pglite/contrib/pg_trgm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

/**
 * Runs the REAL migration files (including the `published` visibility migration, applied on top of rows that
 * already exist, like the live project) in an in-process Postgres and exercises RLS as anon / authenticated / the
 * table owner (which stands in for the service role, which bypasses RLS). Simulated: the auth schema, the
 * Supabase roles, and a minimal storage schema (buckets + objects with RLS). NOT covered: Supabase's Storage API
 * itself or signed-URL generation. Those need verifying on the live project.
 */
const read = (f: string) => readFileSync(resolve(import.meta.dirname, `../../supabase/migrations/${f}`), 'utf8');
const CATALOG = read('20261027010000_exercise_videos_catalog.sql');
const STORAGE = read('20261027010100_exercise_videos_storage.sql');
const manual = (f: string) => readFileSync(resolve(import.meta.dirname, `../../supabase/manual/${f}`), 'utf8');
const PUBLISH_SQL = manual('publish_videos.sql');
const UNPUBLISH_SQL = manual('unpublish_videos.sql');
const PUBLISHED = read('20261028000000_exercise_videos_published.sql');

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
  // Rows as they exist BEFORE the published migration (old rule: matched + uploaded was visible).
  await pg.exec([
    insert(1),                                                                       // matched + uploaded: must stay visible after the migration
    insert(2, { status: "'pending'" }),                                              // not uploaded yet
    insert(3, { review_status: "'needs_review'", exercise_key: 'null' }),            // uploaded, unreviewed: hidden until published
    insert(4, { status: "'failed'" }),
    insert(5, { review_status: "'rejected'" })                                       // uploaded, rejected mapping
  ].join(';') + ';');
  await pg.exec(PUBLISHED);
  // Deliberate publishing (what supabase/manual/publish_videos.sql does): an unmatched video becomes visible.
  await pg.exec(`update public.exercise_videos set published = true where content_sha256 = '${sha(3)}'`);
  // Added after the migration: uploaded and matched but never published.
  await pg.exec(insert(6) + ';');
  await pg.exec(`insert into storage.objects (bucket_id, name) values
    ('exercise-videos','videos/x/1.mp4'), ('exercise-videos','videos/x/2.mp4'), ('exercise-videos','videos/x/3.mp4'),
    ('exercise-videos','videos/x/4.mp4'), ('exercise-videos','videos/x/6.mp4'), ('exercise-videos','videos/x/orphan.mp4')`);
}, 60000);
afterAll(async () => { await pg.close(); });

const titles = (role: 'anon' | 'authenticated' | 'postgres') =>
  as(role, async () => (await rows('select title from public.exercise_videos order by title')).map((r) => r.title));

describe('migrations', () => {
  it('are idempotent', async () => {
    await expect(pg.exec(CATALOG)).resolves.toBeDefined();
    await expect(pg.exec(STORAGE)).resolves.toBeDefined();
    await expect(pg.exec(PUBLISHED)).resolves.toBeDefined();
    expect((await rows('select count(*)::int n from public.exercise_videos'))[0].n).toBe(6);
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
  it('denies anon completely, even for published rows', async () => {
    await expect(as('anon', () => rows('select * from public.exercise_videos'))).rejects.toThrow(/permission denied/);
    await expect(as('anon', () => rows("select title from public.exercise_videos where published"))).rejects.toThrow(/permission denied/);
  });
  it('shows authenticated users only uploaded AND published rows (published + uploaded visible)', async () => {
    expect(await titles('authenticated')).toEqual(['Video 1', 'Video 3']);
  });
  it('hides an unpublished row even when it is uploaded and matched', async () => {
    expect(await titles('authenticated')).not.toContain('Video 6');
  });
  it('shows a published video whose exercise mapping is still unreviewed (review_status is not part of visibility)', async () => {
    const r = await as('authenticated', () => rows("select review_status from public.exercise_videos where title = 'Video 3'"));
    expect(r).toEqual([{ review_status: 'needs_review' }]);
  });
  it('hides pending, failed and rejected-but-unpublished rows', async () => {
    const t = await titles('authenticated');
    for (const hidden of ['Video 2', 'Video 4', 'Video 5']) expect(t).not.toContain(hidden);
  });
  it('lets the service role (owner) see everything', async () => {
    expect((await as('postgres', () => rows('select count(*)::int n from public.exercise_videos')))[0].n).toBe(6);
  });
  it('blocks every write for authenticated and anon', async () => {
    await expect(as('authenticated', () => pg.exec(insert(99)))).rejects.toThrow(/permission denied/);
    await expect(as('authenticated', () => pg.exec("update public.exercise_videos set title = 'hacked'"))).rejects.toThrow(/permission denied/);
    await expect(as('authenticated', () => pg.exec('delete from public.exercise_videos'))).rejects.toThrow(/permission denied/);
    await expect(as('anon', () => pg.exec(insert(98)))).rejects.toThrow(/permission denied/);
    expect((await rows("select title from public.exercise_videos where content_sha256 = '" + sha(1) + "'"))[0].title).toBe('Video 1');
  });
});

describe('published migration', () => {
  it('defaults published to false for new rows (ingestion never publishes)', async () => {
    const r = await rows(`select published from public.exercise_videos where content_sha256 = '${sha(6)}'`);
    expect(r).toEqual([{ published: false }]);
  });
  it('backfilled only the rows that were visible under the old rule', async () => {
    const r = await rows('select title, published from public.exercise_videos order by title');
    expect(r).toEqual([
      { title: 'Video 1', published: true },   // matched + uploaded before the migration
      { title: 'Video 2', published: false },
      { title: 'Video 3', published: true },   // published deliberately afterwards
      { title: 'Video 4', published: false },
      { title: 'Video 5', published: false },  // uploaded but mapping rejected: was hidden, stays hidden
      { title: 'Video 6', published: false }
    ]);
  });
  it('never republishes on a re-run (the backfill happens once, when the column is added)', async () => {
    await pg.exec(`update public.exercise_videos set published = false where content_sha256 = '${sha(1)}'`);
    await pg.exec(PUBLISHED);
    expect((await rows(`select published from public.exercise_videos where content_sha256 = '${sha(1)}'`))[0].published).toBe(false);
    await pg.exec(`update public.exercise_videos set published = true where content_sha256 = '${sha(1)}'`);
  });
  it('refuses to publish a row that is not uploaded', async () => {
    await expect(pg.exec(`update public.exercise_videos set published = true where content_sha256 = '${sha(2)}'`)).rejects.toThrow(/published_requires_uploaded/);
    await expect(pg.exec(`update public.exercise_videos set published = true where content_sha256 = '${sha(4)}'`)).rejects.toThrow(/published_requires_uploaded/);
  });
  it('replaces the old policy with a single authenticated SELECT policy on the published rule', async () => {
    expect(await rows("select cmd, roles::text roles, qual from pg_policies where tablename = 'exercise_videos'")).toEqual([
      { cmd: 'SELECT', roles: '{authenticated}', qual: expect.stringContaining('published') }
    ]);
  });
  it('does not let a signed-in user publish or unpublish anything', async () => {
    await expect(as('authenticated', () => pg.exec("update public.exercise_videos set published = true"))).rejects.toThrow(/permission denied/);
    await expect(as('authenticated', () => pg.exec("update public.exercise_videos set published = false"))).rejects.toThrow(/permission denied/);
    expect(await titles('authenticated')).toEqual(['Video 1', 'Video 3']);
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
    expect((await rows("select title from public.exercise_videos where exercise_key = 'barbell-squat' and status = 'uploaded' and review_status = 'matched'")).length).toBe(2);
  });
  it('supports the prefix, case-insensitive library search the app uses, only over published rows', async () => {
    const lib = (tsquery: string) =>
      as('authenticated', async () =>
        (await rows(`select title from public.exercise_videos where status = 'uploaded' and published and search_vector @@ to_tsquery('simple', '${tsquery}') order by title, id`)).map((r) => r.title));
    expect(await lib('vid:*')).toEqual(['Video 1', 'Video 3']);          // prefix; unpublished Video 6 excluded
    expect(await lib('VID:* & 3:*')).toEqual(['Video 3']);                 // case-insensitive, every word must match
    expect(await lib('ideo:*')).toEqual([]);                               // prefix, not substring
  });
});

describe('storage object access', () => {
  const visible = (role: 'authenticated' | 'anon') =>
    as(role, async () => (await rows("select name from storage.objects where bucket_id = 'exercise-videos' order by name")).map((r) => r.name));
  it('exposes only objects backed by an uploaded, published catalog row', async () => {
    expect(await visible('authenticated')).toEqual(['videos/x/1.mp4', 'videos/x/3.mp4']);
  });
  it('hides unpublished, pending, failed and orphan objects, and everything from anon', async () => {
    const names = await visible('authenticated');
    for (const hidden of ['videos/x/2.mp4', 'videos/x/4.mp4', 'videos/x/6.mp4', 'videos/x/orphan.mp4']) expect(names).not.toContain(hidden);
    expect(await visible('anon')).toEqual([]);
  });
  it('lets an object appear when its video is published, and disappear when unpublished', async () => {
    await pg.exec(`update public.exercise_videos set published = true where content_sha256 = '${sha(6)}'`);
    expect(await visible('authenticated')).toEqual(['videos/x/1.mp4', 'videos/x/3.mp4', 'videos/x/6.mp4']);
    await pg.exec(`update public.exercise_videos set published = false where content_sha256 = '${sha(6)}'`);
    expect(await visible('authenticated')).toEqual(['videos/x/1.mp4', 'videos/x/3.mp4']);
  });
  it('hides the object again if the row stops being uploaded', async () => {
    await pg.exec(`update public.exercise_videos set published = false where content_sha256 = '${sha(3)}'`);
    await pg.exec(`update public.exercise_videos set status = 'failed' where content_sha256 = '${sha(3)}'`);
    expect(await visible('authenticated')).toEqual(['videos/x/1.mp4']);
    await pg.exec(`update public.exercise_videos set status = 'uploaded' where content_sha256 = '${sha(3)}'`);
    await pg.exec(`update public.exercise_videos set published = true where content_sha256 = '${sha(3)}'`);
  });
  it('grants no write policy on storage.objects for this bucket', async () => {
    const pol = await rows("select cmd from pg_policies where schemaname = 'storage' and tablename = 'objects'");
    expect(pol).toEqual([{ cmd: 'SELECT' }]);
  });
});

describe('manual publish / unpublish scripts (supabase/manual)', () => {
  const withHashes = (sql: string, hashes: string[]) =>
    sql.replace(/array\s*\[[^\]]*\]/, `array[${hashes.map((h) => `'${h}'`).join(', ')}]`);
  const flag = async (n: number) => (await rows(`select published from public.exercise_videos where content_sha256 = '${sha(n)}'`))[0].published;

  it('publishes exactly the listed uploaded hashes and nothing else', async () => {
    await pg.exec(withHashes(PUBLISH_SQL, [sha(6)]));
    expect(await flag(6)).toBe(true);
    expect(await titles('authenticated')).toEqual(['Video 1', 'Video 3', 'Video 6']);
    expect(await flag(5)).toBe(false);
  });
  it('is a no-op for rows that are already published', async () => {
    await expect(pg.exec(withHashes(PUBLISH_SQL, [sha(6), sha(1)]))).resolves.toBeDefined();
  });
  it('refuses the whole batch when any hash is unknown, pending, failed or malformed', async () => {
    for (const bad of [sha(999), sha(2), sha(4), 'NOT-A-HASH', 'A'.repeat(64)]) {
      await expect(pg.exec(withHashes(PUBLISH_SQL, [sha(5), bad]))).rejects.toThrow(/Nothing published/);
    }
    expect(await flag(5)).toBe(false); // the valid hash in each rejected batch was not published either
  });
  it('never changes review_status or exercise_key', async () => {
    const r = await rows(`select review_status, exercise_key from public.exercise_videos where content_sha256 = '${sha(3)}'`);
    expect(r).toEqual([{ review_status: 'needs_review', exercise_key: null }]);
  });
  it('unpublishes the listed hashes, hiding the row and its object', async () => {
    await pg.exec(withHashes(UNPUBLISH_SQL, [sha(6)]));
    expect(await flag(6)).toBe(false);
    expect(await titles('authenticated')).toEqual(['Video 1', 'Video 3']);
  });
});
