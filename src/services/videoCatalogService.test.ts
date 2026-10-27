import type { SupabaseClient } from '@supabase/supabase-js';
import { describe, expect, it, vi } from 'vitest';
import { BUCKET, SIGNED_URL_TTL_SECONDS, VideoCatalogService, rowToVideo } from './videoCatalogService';

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

describe('search', () => {
  it('uses keyset pagination and reports the next cursor from the extra row', async () => {
    const rows = [row({ id: 'a', title: 'A' }), row({ id: 'b', title: 'B' }), row({ id: 'c', title: 'C' })];
    const { client, calls } = fakeClient({ data: rows, error: null });
    const r = await new VideoCatalogService(client).search({ text: 'bench press', limit: 2, cursor: { title: 'He said "hi"', id: 'zz' } });
    expect(r.ok && r.data.items.map((v) => v.id)).toEqual(['a', 'b']);
    expect(r.ok && r.data.nextCursor).toEqual({ title: 'B', id: 'b' });
    expect(calls).toContainEqual(['limit', [3]]);
    const or = calls.find(([n]) => n === 'or')![1][0] as string;
    expect(or).toContain('title.gt."He said \\"hi\\""');
    const ts = calls.find(([n]) => n === 'textSearch')!;
    expect(ts[1][1]).toBe('bench & press');
  });
  it('sanitizes search punctuation and has no next cursor on the last page', async () => {
    const { client, calls } = fakeClient({ data: [row()], error: null });
    const r = await new VideoCatalogService(client).search({ text: "curl' | !& drop", limit: 5 });
    expect(r.ok && r.data.nextCursor).toBeNull();
    expect(calls.find(([n]) => n === 'textSearch')![1][1]).toBe('curl & drop');
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
