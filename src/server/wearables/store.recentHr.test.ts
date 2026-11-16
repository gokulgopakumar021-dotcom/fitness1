// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The real SupabaseWearableStore.readRecentHeartRate against a mocked PostgREST client: the exact table, columns and filters sent,
 * paging, the row cap, row mapping and error mapping. It does NOT prove anything about the live database (RLS and the filters'
 * meaning are checked in rls.wearableConsentIngest.test.ts, in PGlite).
 */
type Row = { value?: unknown; measured_at?: unknown; workout_session_id?: unknown };
const h = vi.hoisted(() => ({
  pages: [] as { data: Row[] | null; error: { code?: string; message?: string; name?: string } | null }[],
  calls: [] as { table: string; select: string; eq: [string, unknown][]; in: [string, unknown][]; not: unknown[][]; gte: [string, unknown][]; order: [string, unknown][]; range: [number, number] | null; writes: string[] }[],
  headers: [] as Record<string, string>[]
}));

vi.mock('@supabase/supabase-js', () => ({
  createClient: (_u: string, _k: string, opts: { global?: { headers?: Record<string, string> } }) => {
    h.headers.push(opts.global?.headers ?? {});
    return {
      from: (table: string) => {
        const call = { table, select: '', eq: [] as [string, unknown][], in: [] as [string, unknown][], not: [] as unknown[][], gte: [] as [string, unknown][], order: [] as [string, unknown][], range: null as [number, number] | null, writes: [] as string[] };
        const q = {
          select: (c: string) => { call.select = c; return q; },
          eq: (c: string, v: unknown) => { call.eq.push([c, v]); return q; },
          in: (c: string, v: unknown) => { call.in.push([c, v]); return q; },
          not: (...a: unknown[]) => { call.not.push(a); return q; },
          gte: (c: string, v: unknown) => { call.gte.push([c, v]); return q; },
          order: (c: string, o: unknown) => { call.order.push([c, o]); return q; },
          range: (a: number, b: number) => { call.range = [a, b]; return q; },
          insert: () => { call.writes.push('insert'); return q; }, update: () => { call.writes.push('update'); return q; }, delete: () => { call.writes.push('delete'); return q; },
          abortSignal: () => { h.calls.push(call); return Promise.resolve(h.pages.shift() ?? { data: [], error: null }); }
        };
        return q;
      }
    };
  }
}));

import { HR_READ_PAGE, RECENT_HR_PAGES, SupabaseWearableStore, WearableStoreUnavailableError } from './store';

const store = () => new SupabaseWearableStore({ supabaseUrl: 'https://example.supabase.co', supabaseKey: 'anon-key' });
const row = (i: number, over: Row = {}): Row => ({ value: 100 + (i % 50), measured_at: new Date(Date.parse('2026-11-15T10:00:00Z') - i * 1000).toISOString(), workout_session_id: 'sess-1', ...over });
const full = (n: number, start = 0) => Array.from({ length: n }, (_, i) => row(start + i));
const SINCE = '2026-10-17T00:00:00.000Z';

beforeEach(() => { h.pages = []; h.calls = []; h.headers = []; });

describe('SupabaseWearableStore.readRecentHeartRate', () => {
  it('reads only heart-rate rows of the caller from a real device, labelled with a workout, since the window start, newest first, with the caller\'s own token; never writes', async () => {
    h.pages.push({ data: [row(0), row(1)], error: null });
    const r = await store().readRecentHeartRate('user-a', 'TOKEN-A', SINCE);
    expect(r.truncated).toBe(false);
    expect(r.samples).toHaveLength(2);
    expect(r.samples[0]).toEqual({ bpm: 100, measuredAt: '2026-11-15T10:00:00.000Z', sessionId: 'sess-1' });
    const c = h.calls[0];
    expect(c.table).toBe('wearable_samples');
    expect(c.select).toBe('value,measured_at,workout_session_id');
    expect(c.eq).toEqual([['user_id', 'user-a'], ['metric', 'heart_rate']]);
    expect(c.in).toEqual([['origin', ['live', 'synchronized']]]);
    expect(c.not).toEqual([['workout_session_id', 'is', null]]);
    expect(c.gte).toEqual([['measured_at', SINCE]]);
    expect(c.order).toEqual([['measured_at', { ascending: false }], ['id', { ascending: false }]]);
    expect(c.writes).toEqual([]);
    expect(h.headers[0].Authorization).toBe('Bearer TOKEN-A');
  });
  it('does not request device names, device ids, dedupe keys or any other column', async () => {
    h.pages.push({ data: [], error: null });
    await store().readRecentHeartRate('user-a', 'T', SINCE);
    expect(h.calls[0].select.split(',').sort()).toEqual(['measured_at', 'value', 'workout_session_id']);
  });
  it('pages past the 1000-row cap and is not truncated when the last page is short', async () => {
    h.pages.push({ data: full(HR_READ_PAGE), error: null }, { data: full(300, HR_READ_PAGE), error: null });
    const r = await store().readRecentHeartRate('user-a', 'T', SINCE);
    expect(r.samples).toHaveLength(HR_READ_PAGE + 300);
    expect(r.truncated).toBe(false);
    expect(h.calls.map((c) => c.range)).toEqual([[0, 999], [1000, 1999]]);
  });
  it('stops at the page cap and reports truncated instead of presenting a partial read as complete', async () => {
    for (let i = 0; i < RECENT_HR_PAGES + 2; i++) h.pages.push({ data: full(HR_READ_PAGE, i * HR_READ_PAGE), error: null });
    const r = await store().readRecentHeartRate('user-a', 'T', SINCE);
    expect(h.calls).toHaveLength(RECENT_HR_PAGES);
    expect(r.samples).toHaveLength(RECENT_HR_PAGES * HR_READ_PAGE);
    expect(r.truncated).toBe(true);
  });
  it('skips malformed rows rather than repairing them', async () => {
    h.pages.push({ data: [row(0, { value: '120' }), row(1, { measured_at: 5 }), row(2, { workout_session_id: null }), row(3, { workout_session_id: 7 }), row(4)], error: null });
    const r = await store().readRecentHeartRate('user-a', 'T', SINCE);
    expect(r.samples).toHaveLength(1);
  });
  it('maps database errors to a coded "unavailable" without leaking the message', async () => {
    h.pages.push({ data: null, error: { code: '42703', message: 'column wearable_samples.workout_session_id does not exist' } });
    const err = await store().readRecentHeartRate('user-a', 'T', SINCE).catch((e) => e);
    expect(err).toBeInstanceOf(WearableStoreUnavailableError);
    expect(err.reason).toBe('rpc_42703');
    expect(String(err.message)).not.toMatch(/column|does not exist/);
  });
  it('treats a non-array body as unavailable (bad_shape) and a timeout as unavailable (timeout)', async () => {
    h.pages.push({ data: null, error: null });
    expect(await store().readRecentHeartRate('u', 'T', SINCE).catch((e) => e.reason)).toBe('bad_shape');
    h.pages.push({ data: null, error: { name: 'AbortError', message: 'aborted' } });
    expect(await store().readRecentHeartRate('u', 'T', SINCE).catch((e) => e.reason)).toBe('timeout');
  });
  it('refuses without a token (no unauthenticated database call)', async () => {
    const err = await store().readRecentHeartRate('u', undefined, SINCE).catch((e) => e);
    expect(err.reason).toBe('no_token');
    expect(h.calls).toHaveLength(0);
  });
});
