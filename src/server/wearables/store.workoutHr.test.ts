// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The real SupabaseWearableStore.readWorkoutHeartRate against a mocked PostgREST client. Covers what the in-memory fake in
 * wearables.api.test.ts cannot: the exact filters sent, paging past the 1000-row API cap, truncation and error mapping.
 * It does NOT prove anything about the live database (RLS is checked in rls.wearableConsentIngest.test.ts, in PGlite).
 */
type Row = { value?: unknown; measured_at?: unknown; workout_session_verified?: unknown };
const h = vi.hoisted(() => ({
  pages: [] as { data: Row[] | null; error: { code?: string; message?: string; name?: string } | null }[],
  calls: [] as { table: string; select: string; eq: [string, unknown][]; order: [string, unknown][]; range: [number, number] | null }[],
  headers: [] as Record<string, string>[]
}));

vi.mock('@supabase/supabase-js', () => ({
  createClient: (_url: string, _key: string, opts: { global?: { headers?: Record<string, string> } }) => {
    h.headers.push(opts.global?.headers ?? {});
    return {
      from: (table: string) => {
        const call = { table, select: '', eq: [] as [string, unknown][], order: [] as [string, unknown][], range: null as [number, number] | null };
        const q = {
          select: (c: string) => { call.select = c; return q; },
          eq: (c: string, v: unknown) => { call.eq.push([c, v]); return q; },
          order: (c: string, o: unknown) => { call.order.push([c, o]); return q; },
          range: (a: number, b: number) => { call.range = [a, b]; return q; },
          abortSignal: () => { h.calls.push(call); return Promise.resolve(h.pages.shift() ?? { data: [], error: null }); }
        };
        return q;
      }
    };
  }
}));

import { HR_READ_PAGE, HR_READ_PAGES, SupabaseWearableStore, WearableStoreUnavailableError } from './store';

const store = () => new SupabaseWearableStore({ supabaseUrl: 'https://example.supabase.co', supabaseKey: 'anon-key' });
const row = (i: number, verified: unknown = true): Row => ({ value: 100 + (i % 50), measured_at: new Date(Date.parse('2026-11-15T10:00:00Z') + i * 5000).toISOString(), workout_session_verified: verified });
const full = (n: number, start = 0) => Array.from({ length: n }, (_, i) => row(start + i));

beforeEach(() => { h.pages = []; h.calls = []; h.headers = []; });

describe('SupabaseWearableStore.readWorkoutHeartRate', () => {
  it('filters by the caller, the session and heart_rate; orders by time; and uses the caller\'s own token', async () => {
    h.pages.push({ data: [row(0), row(1, false), row(2, null)], error: null });
    const r = await store().readWorkoutHeartRate('user-a', 'TOKEN-A', 'sess-1');
    expect(r.truncated).toBe(false);
    expect(r.samples.map((s) => s.verified)).toEqual([true, false, null]);
    expect(h.calls).toHaveLength(1);
    const c = h.calls[0];
    expect(c.table).toBe('wearable_samples');
    expect(c.select).toBe('value,measured_at,workout_session_verified');
    expect(c.eq).toEqual([['user_id', 'user-a'], ['workout_session_id', 'sess-1'], ['metric', 'heart_rate']]);
    expect(c.order.map((o) => o[0])).toEqual(['measured_at', 'id']);
    expect(h.headers[0].Authorization).toBe('Bearer TOKEN-A');
  });

  it('pages past the 1000-row API cap and is not truncated when the last page is short', async () => {
    h.pages.push({ data: full(HR_READ_PAGE), error: null }, { data: full(HR_READ_PAGE, HR_READ_PAGE), error: null }, { data: full(400, 2 * HR_READ_PAGE), error: null });
    const r = await store().readWorkoutHeartRate('user-a', 'T', 's');
    expect(r.samples).toHaveLength(2400);
    expect(r.truncated).toBe(false);
    expect(h.calls.map((c) => c.range)).toEqual([[0, 999], [1000, 1999], [2000, 2999]]);
  });

  it('stops at the page cap and reports truncated instead of presenting a partial read as complete', async () => {
    for (let i = 0; i < HR_READ_PAGES + 2; i++) h.pages.push({ data: full(HR_READ_PAGE, i * HR_READ_PAGE), error: null });
    const r = await store().readWorkoutHeartRate('user-a', 'T', 's');
    expect(h.calls).toHaveLength(HR_READ_PAGES);
    expect(r.samples).toHaveLength(HR_READ_PAGES * HR_READ_PAGE);
    expect(r.truncated).toBe(true);
  });

  it('skips malformed rows rather than repairing them, and treats a non-boolean verification flag as unconfirmed', async () => {
    h.pages.push({ data: [{ value: '120', measured_at: '2026-11-15T10:00:00Z' }, { value: 121 }, row(3, 'yes'), row(4, true)], error: null });
    const r = await store().readWorkoutHeartRate('user-a', 'T', 's');
    expect(r.samples.map((s) => s.verified)).toEqual([null, true]);
  });

  it('maps database errors to a coded "unavailable" without leaking the message (e.g. column missing before the migration is applied)', async () => {
    h.pages.push({ data: null, error: { code: '42703', message: 'column wearable_samples.workout_session_id does not exist' } });
    const err = await store().readWorkoutHeartRate('user-a', 'T', 's').catch((e) => e);
    expect(err).toBeInstanceOf(WearableStoreUnavailableError);
    expect(err.reason).toBe('rpc_42703');
    expect(String(err.message)).not.toMatch(/column|does not exist/);
  });

  it('treats a non-array body as unavailable (bad_shape) and a timeout as unavailable (timeout)', async () => {
    h.pages.push({ data: null, error: null });
    expect(await store().readWorkoutHeartRate('u', 'T', 's').catch((e) => e.reason)).toBe('bad_shape');
    h.pages.push({ data: null, error: { name: 'AbortError', message: 'aborted' } });
    expect(await store().readWorkoutHeartRate('u', 'T', 's').catch((e) => e.reason)).toBe('timeout');
  });

  it('refuses without a token (no unauthenticated database call)', async () => {
    const err = await store().readWorkoutHeartRate('u', undefined, 's').catch((e) => e);
    expect(err).toBeInstanceOf(WearableStoreUnavailableError);
    expect(err.reason).toBe('no_token');
    expect(h.calls).toHaveLength(0);
  });
});
