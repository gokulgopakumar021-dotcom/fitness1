import type { SupabaseClient } from '@supabase/supabase-js';
import { describe, expect, it, vi } from 'vitest';
import { BUCKET, MAX_PAGE_SIZE, SIGNED_URL_TTL_SECONDS, VideoCatalogService, buildPrefixTsQuery, quoteFilterValue, rowToVideo } from './videoCatalogService';

type Call = [string, unknown[]];

/** Chainable, awaitable stand-in for the PostgREST query builder that records every call. */
function fakeClient(result: { data: unknown; error: { message: string } | null }, storage?: unknown) {
  const calls: Call[] = [];
  const builder: Record<string, unknown> = {};
  const chain = new Proxy(builder, {
    get(_t, prop: string) {
      if (prop === 'then') return (res: (v: unknown) => void) => res(result);
      return (...args: unknown[]) => { calls.push([prop, args]); return chain; };
    }
  });
  const client = { from: vi.fn(() => chain), storage } as unknown as SupabaseClient;
  return { client, calls };
}

const row = (over: Record<string, unknown> = {}) => ({
  id: 'id-1', content_sha256: 'a'.repeat(64), original_filename: 'curl.mp4', title: 'Curl', exercise_key: 'k', storage_key: 'videos/aa/x.mp4',
  size_bytes: '1048576', duration_seconds: '12.50', width: 640, height: 360, equipment: null, muscle_groups: ['arms'], tags: null,
  match_method: 'exact_key', match_confidence: '1.00', review_status: 'matched', status: 'uploaded', sort_order: 2, ...over
});

describe('rowToVideo', () => {
  it('converts numeric strings and null arrays', () => {
    expect(rowToVideo(row() as never)).toMatchObject({ sizeBytes: 1048576, durationSeconds: 12.5, matchConfidence: 1, equipment: [], tags: [], muscleGroups: ['arms'], storageKey: 'videos/aa/x.mp4' });
    expect(rowToVideo(row({ duration_seconds: null }) as never).durationSeconds).toBeNull();
  });
});

describe('getVideosForExercise', () => {
  it('asks only for published rows of one exercise, ordered, and bounded', async () => {
    const { client, calls } = fakeClient({ data: [row()], error: null });
    const r = await new VideoCatalogService(client).getVideosForExercise('barbell-bench-press', 10_000);
    expect(r.ok && r.data).toHaveLength(1);
    const names = calls.map(([n]) => n);
    expect(calls).toContainEqual(['eq', ['exercise_key', 'barbell-bench-press']]);
    expect(calls).toContainEqual(['eq', ['status', 'uploaded']]);
    expect(calls).toContainEqual(['eq', ['review_status', 'matched']]);
    expect(calls).toContainEqual(['eq', ['published', true]]);
    expect(names.filter((n) => n === 'order')).toHaveLength(2);
    expect(calls).toContainEqual(['limit', [50]]);
  });
  it('returns an empty list without a network call when there is no exercise key', async () => {
    const { client } = fakeClient({ data: [], error: null });
    expect(await new VideoCatalogService(client).getVideosForExercise('')).toEqual({ ok: true, data: [] });
    expect(client.from).not.toHaveBeenCalled();
  });
  it('reports an error instead of throwing, so a workout is never blocked', async () => {
    const { client } = fakeClient({ data: null, error: { message: 'network down' } });
    expect(await new VideoCatalogService(client).getVideosForExercise('k')).toEqual({ ok: false, error: 'network down' });
  });
});

const U1 = '11111111-1111-4111-8111-111111111111';
const U2 = '22222222-2222-4222-8222-222222222222';
const names = (calls: Call[]) => calls.map(([n]) => n);

describe('buildPrefixTsQuery', () => {
  it.each([
    ['bench press', 'bench:* & press:*'],
    ['  BENCH   Press ', 'BENCH:* & Press:*'],           // case is folded by the simple config in Postgres
    ["curl' | !& drop", 'curl:* & drop:*'],               // tsquery operators and quotes are stripped
    ['a,b (c) "d" *%_\\ e', 'a:* & b:* & c:* & d:* & e:*'], // commas, parentheses, quotes, wildcards, backslash
    ['press:*', 'press:*'],
    ['squat; drop table x', 'squat:* & drop:* & table:* & x:*'],
    ['Ünïcode 3/4', 'Ünïcode:* & 3:* & 4:*']
  ])('%j -> %j', (input, expected) => {
    expect(buildPrefixTsQuery(input)).toBe(expected);
  });
  it('returns null when nothing searchable remains', () => {
    for (const t of ['', '   ', undefined, null, '!!! ,,, ""', '*%_']) expect(buildPrefixTsQuery(t)).toBeNull();
  });
  it('caps the query length and the number of words', () => {
    expect(buildPrefixTsQuery('a '.repeat(50))!.split(' & ')).toHaveLength(8);
    expect(buildPrefixTsQuery('x'.repeat(500))!.length).toBeLessThanOrEqual(100 + 2);
  });
});

describe('quoteFilterValue', () => {
  it('escapes backslashes before quotes so a value can never close its own quoting', () => {
    expect(quoteFilterValue('plain')).toBe('"plain"');
    expect(quoteFilterValue('He said "hi"')).toBe('"He said \\"hi\\""');
    expect(quoteFilterValue('ends with \\')).toBe('"ends with \\\\"');
    expect(quoteFilterValue('\\"')).toBe('"\\\\\\""');
  });
  it('leaves commas, parentheses and wildcards inside the quotes untouched', () => {
    expect(quoteFilterValue('a,b)(c*%')).toBe('"a,b)(c*%"');
  });
});

describe('search', () => {
  it('asks only for uploaded + published rows (review_status is not required) in (title, id) order', async () => {
    const { client, calls } = fakeClient({ data: [row()], error: null });
    await new VideoCatalogService(client).search({});
    expect(calls).toContainEqual(['eq', ['status', 'uploaded']]);
    expect(calls).toContainEqual(['eq', ['published', true]]);
    expect(calls.some(([n, a]) => n === 'eq' && a[0] === 'review_status')).toBe(false);
    expect(calls.filter(([n]) => n === 'order').map(([, a]) => a[0])).toEqual(['title', 'id']);
  });

  it('browses the whole library page by page when the query is empty or has no searchable characters', async () => {
    for (const text of [undefined, '', '   ', '!!! ,,,']) {
      const { client, calls } = fakeClient({ data: [row()], error: null });
      const r = await new VideoCatalogService(client).search({ text });
      expect(r.ok).toBe(true);
      expect(names(calls)).not.toContain('textSearch');
      expect(calls).toContainEqual(['limit', [25]]); // default page of 24 + 1 to detect a next page
    }
  });

  it('uses a prefix, word-AND text search on the simple config', async () => {
    const { client, calls } = fakeClient({ data: [row()], error: null });
    await new VideoCatalogService(client).search({ text: 'Bench pre' });
    expect(calls.find(([n]) => n === 'textSearch')![1]).toEqual(['search_vector', 'Bench:* & pre:*', { config: 'simple' }]);
  });

  it('never lets user text alter the query: operators, quotes, commas and wildcards are dropped', async () => {
    const { client, calls } = fakeClient({ data: [], error: null });
    await new VideoCatalogService(client).search({ text: "curl' | !& drop),title.eq.x,(%*\\\"" });
    const ts = calls.find(([n]) => n === 'textSearch')![1][1] as string;
    expect(ts).toBe('curl:* & drop:* & title:* & eq:* & x:*');
    expect(ts).not.toMatch(/[|!'",()%\\]/);
    expect(names(calls)).not.toContain('or'); // free text never reaches a PostgREST or()/ilike filter
    expect(names(calls)).not.toContain('ilike');
  });

  it('uses keyset pagination and reports the next cursor from the extra row', async () => {
    const rows = [row({ id: U1, title: 'A' }), row({ id: U2, title: 'B' }), row({ id: 'c', title: 'C' })];
    const { client, calls } = fakeClient({ data: rows, error: null });
    const r = await new VideoCatalogService(client).search({ text: 'bench press', limit: 2, cursor: { title: 'He said "hi"', id: U1 } });
    expect(r.ok && r.data.items.map((v) => v.id)).toEqual([U1, U2]);
    expect(r.ok && r.data.nextCursor).toEqual({ title: 'B', id: U2 });
    expect(calls).toContainEqual(['limit', [3]]);
    const or = calls.find(([n]) => n === 'or')![1][0] as string;
    expect(or).toBe(`title.gt."He said \\"hi\\"",and(title.eq."He said \\"hi\\"",id.gt.${U1})`);
  });

  it('escapes backslashes and commas in a cursor title', async () => {
    const { client, calls } = fakeClient({ data: [], error: null });
    await new VideoCatalogService(client).search({ cursor: { title: 'a\\", id.gt.0)),(title.neq."', id: U1 } });
    const or = calls.find(([n]) => n === 'or')![1][0] as string;
    expect(or).toBe(`title.gt."a\\\\\\", id.gt.0)),(title.neq.\\"",and(title.eq."a\\\\\\", id.gt.0)),(title.neq.\\"",id.gt.${U1})`);
  });

  it('rejects a cursor whose id is not a UUID without querying', async () => {
    const { client } = fakeClient({ data: [], error: null });
    const r = await new VideoCatalogService(client).search({ cursor: { title: 'A', id: '1),title.neq.(' } });
    expect(r).toEqual({ ok: false, error: 'Invalid page cursor.' });
    expect(client.from).not.toHaveBeenCalled();
  });

  it('has no next cursor on the last page', async () => {
    const { client } = fakeClient({ data: [row()], error: null });
    const r = await new VideoCatalogService(client).search({ text: 'curl', limit: 5 });
    expect(r.ok && r.data.nextCursor).toBeNull();
  });

  it('clamps the page size to 1..MAX_PAGE_SIZE and survives nonsense limits', async () => {
    for (const [limit, expected] of [[10_000, MAX_PAGE_SIZE + 1], [0, 2], [-5, 2], [Number.NaN, 25], [2.9, 3]] as const) {
      const { client, calls } = fakeClient({ data: [], error: null });
      await new VideoCatalogService(client).search({ limit });
      expect(calls).toContainEqual(['limit', [expected]]);
    }
  });

  it('applies optional equipment, muscle and tag filters with array containment', async () => {
    const { client, calls } = fakeClient({ data: [], error: null });
    await new VideoCatalogService(client).search({ equipment: 'barbell', muscleGroup: 'chest', tag: 'compound' });
    expect(calls).toContainEqual(['contains', ['equipment', ['barbell']]]);
    expect(calls).toContainEqual(['contains', ['muscle_groups', ['chest']]]);
    expect(calls).toContainEqual(['contains', ['tags', ['compound']]]);
  });

  it('returns an error result instead of throwing when the query fails', async () => {
    const { client } = fakeClient({ data: null, error: { message: 'network down' } });
    expect(await new VideoCatalogService(client).search({ text: 'x' })).toEqual({ ok: false, error: 'network down' });
  });

  it('treats a null data payload as an empty page', async () => {
    const { client } = fakeClient({ data: null, error: null });
    expect(await new VideoCatalogService(client).search({})).toEqual({ ok: true, data: { items: [], nextCursor: null } });
  });
});

describe('getPlaybackUrl', () => {
  it('signs a single object in the private bucket with a one-hour expiry', async () => {
    const createSignedUrl = vi.fn().mockResolvedValue({ data: { signedUrl: 'https://x/y?token=t' }, error: null });
    const from = vi.fn(() => ({ createSignedUrl }));
    const { client } = fakeClient({ data: [], error: null }, { from });
    expect(await new VideoCatalogService(client).getPlaybackUrl('videos/aa/x.mp4')).toEqual({ ok: true, data: 'https://x/y?token=t' });
    expect(from).toHaveBeenCalledWith(BUCKET);
    expect(createSignedUrl).toHaveBeenCalledWith('videos/aa/x.mp4', SIGNED_URL_TTL_SECONDS);
  });
  it('surfaces a refusal (for example storage RLS) as an error result', async () => {
    const createSignedUrl = vi.fn().mockResolvedValue({ data: null, error: { message: 'Object not found' } });
    const { client } = fakeClient({ data: [], error: null }, { from: () => ({ createSignedUrl }) });
    expect(await new VideoCatalogService(client).getPlaybackUrl('videos/zz/none.mp4')).toEqual({ ok: false, error: 'Object not found' });
  });
});
