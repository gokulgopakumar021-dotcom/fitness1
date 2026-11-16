// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The real SupabaseWearableStore.readConsentHistory against a mocked PostgREST client: the exact table, columns, filters, order and
 * limit sent, row mapping and error mapping. It does NOT prove anything about the live database (RLS: rls.wearableConsentIngest.test.ts).
 */
type Row = Record<string, unknown>;
const h = vi.hoisted(() => ({
  result: { data: [] as unknown, error: null as null | { code?: string; message?: string; name?: string } },
  calls: [] as { table: string; select: string; eq: [string, unknown][]; order: [string, unknown][]; limit: number | null; writes: string[] }[],
  headers: [] as Record<string, string>[]
}));

vi.mock('@supabase/supabase-js', () => ({
  createClient: (_url: string, _key: string, opts: { global?: { headers?: Record<string, string> } }) => {
    h.headers.push(opts.global?.headers ?? {});
    return {
      from: (table: string) => {
        const call = { table, select: '', eq: [] as [string, unknown][], order: [] as [string, unknown][], limit: null as number | null, writes: [] as string[] };
        const q = {
          select: (c: string) => { call.select = c; return q; },
          eq: (c: string, v: unknown) => { call.eq.push([c, v]); return q; },
          order: (c: string, o: unknown) => { call.order.push([c, o]); return q; },
          limit: (n: number) => { call.limit = n; return q; },
          insert: () => { call.writes.push('insert'); return q; },
          update: () => { call.writes.push('update'); return q; },
          delete: () => { call.writes.push('delete'); return q; },
          abortSignal: () => { h.calls.push(call); return Promise.resolve(h.result); }
        };
        return q;
      }
    };
  }
}));

import { SupabaseWearableStore, WearableStoreUnavailableError } from './store';
import { CONSENT_HISTORY_LIMIT } from '../../wearables/consentHistory';

const store = () => new SupabaseWearableStore({ supabaseUrl: 'https://example.supabase.co', supabaseKey: 'anon-key' });
const row = (i: number, over: Row = {}): Row => ({ category: 'live_heart_rate', action: i % 2 ? 'revoked' : 'granted', consent_version: 1, created_at: new Date(Date.parse('2026-11-16T10:00:00Z') + i * 1000).toISOString(), ...over });

beforeEach(() => { h.result = { data: [], error: null }; h.calls = []; h.headers = []; });

describe('SupabaseWearableStore.readConsentHistory', () => {
  it('reads only wearable_consent_events, only the needed columns, for the caller, newest first, with the caller\'s own token, and never writes', async () => {
    h.result.data = [row(1), row(0)];
    const r = await store().readConsentHistory('user-a', 'TOKEN-A');
    expect(r.events.map((e) => e.action)).toEqual(['revoked', 'granted']);
    expect(r.truncated).toBe(false);
    expect(h.calls).toHaveLength(1);
    const c = h.calls[0];
    expect(c.table).toBe('wearable_consent_events');
    expect(c.select).toBe('category,action,consent_version,created_at');
    expect(c.eq).toEqual([['user_id', 'user-a']]);
    expect(c.order).toEqual([['created_at', { ascending: false }], ['id', { ascending: false }]]);
    expect(c.limit).toBe(CONSENT_HISTORY_LIMIT + 1);
    expect(c.writes).toEqual([]);
    expect(h.headers[0].Authorization).toBe('Bearer TOKEN-A');
  });
  it('reports truncated when one more than the limit comes back, and returns exactly the limit', async () => {
    h.result.data = Array.from({ length: CONSENT_HISTORY_LIMIT + 1 }, (_, i) => row(i));
    const r = await store().readConsentHistory('user-a', 'T');
    expect(r.events).toHaveLength(CONSENT_HISTORY_LIMIT);
    expect(r.truncated).toBe(true);
  });
  it('skips malformed rows rather than repairing them', async () => {
    h.result.data = [row(0, { category: 'dna' }), row(1, { consent_version: 'x' }), row(2, { created_at: 'nope' }), row(3)];
    const r = await store().readConsentHistory('user-a', 'T');
    expect(r.events).toHaveLength(1);
  });
  it('maps database errors to a coded "unavailable" without leaking the message (e.g. table missing before the migration is applied)', async () => {
    h.result = { data: null, error: { code: '42P01', message: 'relation "public.wearable_consent_events" does not exist' } };
    const err = await store().readConsentHistory('user-a', 'T').catch((e) => e);
    expect(err).toBeInstanceOf(WearableStoreUnavailableError);
    expect(err.reason).toBe('rpc_42P01');
    expect(String(err.message)).not.toMatch(/relation|does not exist|wearable_consent_events/);
  });
  it('treats a non-array body as unavailable (bad_shape) and a timeout as unavailable (timeout)', async () => {
    h.result = { data: null, error: null };
    expect(await store().readConsentHistory('u', 'T').catch((e) => e.reason)).toBe('bad_shape');
    h.result = { data: null, error: { name: 'AbortError', message: 'aborted' } };
    expect(await store().readConsentHistory('u', 'T').catch((e) => e.reason)).toBe('timeout');
  });
  it('refuses without a token (no unauthenticated database call)', async () => {
    const err = await store().readConsentHistory('u', undefined).catch((e) => e);
    expect(err).toBeInstanceOf(WearableStoreUnavailableError);
    expect(err.reason).toBe('no_token');
    expect(h.calls).toHaveLength(0);
  });
});
