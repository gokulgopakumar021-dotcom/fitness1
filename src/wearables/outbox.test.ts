import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { HrRecorder } from './hrRecorder';
import type { IngestPayload } from './ingestClient';
import { clearWearableOutbox, createScopedOutbox, OUTBOX_BASE_KEY, OUTBOX_MAX_AGE_MS, OUTBOX_MAX_TOTAL, parseOutbox } from './outboxStore';
import type { IngestClientResult, IngestSummary } from './syncStatus';
import { scopedKey, setStorageScope, SIGNED_OUT_SCOPE } from '../storage/storageScope';

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
const NOW = Date.parse('2026-11-16T10:00:00.000Z');
const sum = (o: Partial<IngestSummary> = {}): IngestSummary => ({ received: 0, accepted: 0, duplicate: 0, rejected: 0, unsupported: 0, invalid: 0, ...o });
const ok = (n: number): IngestClientResult => ({ kind: 'ok', summary: sum({ received: n, accepted: n }), syncedAt: '2026-11-16T10:00:00.000Z' });
const dev = { key: 'dev-1', name: 'Test strap' };
const iso = (ms: number) => new Date(ms).toISOString();
const keyFor = (scope: string) => `${OUTBOX_BASE_KEY}::u:${scope}`;

function mk(opts: { results?: IngestClientResult[]; clock?: { t: number } } = {}) {
  const sent: IngestPayload[] = [];
  const queue = [...(opts.results ?? [])];
  const clock = opts.clock ?? { t: NOW };
  const rec = new HrRecorder({
    now: () => clock.t,
    store: createScopedOutbox(),
    send: async (p) => { sent.push(structuredClone(p)); return queue.shift() ?? ok(p.samples.length); }
  });
  return { rec, sent, clock };
}

beforeEach(() => { localStorage.clear(); setStorageScope(A); });
afterEach(() => { setStorageScope(null); localStorage.clear(); });

describe('parseOutbox (untrusted stored data)', () => {
  const good = (over: Record<string, unknown> = {}) => JSON.stringify({ v: 1, scope: A, savedAt: iso(NOW), device: dev, buffers: { s1: [{ value: 120, measuredAt: iso(NOW - 1000) }] }, ...over });

  it('accepts a well-formed outbox', () => {
    const r = parseOutbox(good(), A, NOW)!;
    expect(r.device).toEqual(dev);
    expect(r.buffers.get('s1')).toEqual([{ value: 120, measuredAt: iso(NOW - 1000) }]);
  });
  it('rejects corrupt JSON, wrong version and a different scope', () => {
    expect(parseOutbox('{nope', A, NOW)).toBeNull();
    expect(parseOutbox(null, A, NOW)).toBeNull();
    expect(parseOutbox(good({ v: 2 }), A, NOW)).toBeNull();
    expect(parseOutbox(good({ scope: B }), A, NOW)).toBeNull();
  });
  it('drops implausible, non-integer, non-canonical, expired, future and duplicate readings', () => {
    const items = [
      { value: 19, measuredAt: iso(NOW - 1000) },
      { value: 256, measuredAt: iso(NOW - 2000) },
      { value: 120.5, measuredAt: iso(NOW - 3000) },
      { value: 120, measuredAt: '2026-11-16T09:59:00Z' },
      { value: 120, measuredAt: iso(NOW - OUTBOX_MAX_AGE_MS - 1) },
      { value: 120, measuredAt: iso(NOW + 10 * 60_000) },
      { value: 130, measuredAt: iso(NOW - 4000) },
      { value: 131, measuredAt: iso(NOW - 4000) },
      { value: '120', measuredAt: iso(NOW - 5000) },
      null
    ];
    const r = parseOutbox(good({ buffers: { s1: items } }), A, NOW)!;
    expect(r.buffers.get('s1')).toEqual([{ value: 130, measuredAt: iso(NOW - 4000) }]);
  });
  it('returns null when nothing valid is left, and caps the total', () => {
    expect(parseOutbox(good({ buffers: { s1: [{ value: 5, measuredAt: iso(NOW - 1) }] } }), A, NOW)).toBeNull();
    expect(parseOutbox(good({ device: { key: '', name: 'x' } }), A, NOW)).toBeNull();
    const many = (n: number, off: number) => Array.from({ length: n }, (_, i) => ({ value: 100, measuredAt: iso(NOW - off - i * 1000) }));
    const r = parseOutbox(good({ buffers: { a: many(1000, 10_000), b: many(1000, 5_000_000), c: many(1000, 9_000_000) } }), A, NOW)!;
    let total = 0; for (const b of r.buffers.values()) total += b.length;
    expect(total).toBeLessThanOrEqual(OUTBOX_MAX_TOTAL);
  });
  it('strips control characters from the device name', () => {
    const r = parseOutbox(good({ device: { key: 'k', name: 'Strap\u0000\n<x>' } }), A, NOW)!;
    expect(r.device.name).not.toMatch(/[\u0000-\u001f]/);
  });
});

describe('scope safety', () => {
  it('never persists without a real account scope', () => {
    setStorageScope(null);
    expect(createScopedOutbox()).toBeNull();
    setStorageScope(SIGNED_OUT_SCOPE);
    expect(createScopedOutbox()).toBeNull();
    const { rec } = mk();
    rec.offer('s1', 120, dev);
    expect(localStorage.length).toBe(0);
  });
  it('writes only under the account-scoped key', () => {
    const { rec } = mk();
    expect(rec.offer('s1', 120, dev)).toBe(true);
    expect(localStorage.getItem(keyFor(A))).not.toBeNull();
    expect(localStorage.getItem(OUTBOX_BASE_KEY)).toBeNull();
    expect(localStorage.length).toBe(1);
  });
  it('a recorder from account A cannot write into or read from account B after a switch', async () => {
    const a = mk();
    a.rec.offer('s1', 120, dev);
    setStorageScope(B);
    a.clock.t += 6000;
    a.rec.offer('s1', 121, dev);
    expect(localStorage.getItem(keyFor(B))).toBeNull();
    const b = mk();
    expect(b.rec.restore()).toBe(0);
    expect(b.rec.pending()).toBe(0);
    setStorageScope(A);
    expect(localStorage.getItem(keyFor(A))).not.toBeNull();
  });
  it('a restored outbox is ignored when its stored scope does not match the key (copied data)', () => {
    const a = mk();
    a.rec.offer('s1', 120, dev);
    const raw = localStorage.getItem(keyFor(A))!;
    localStorage.setItem(keyFor(B), raw);
    setStorageScope(B);
    expect(mk().rec.restore()).toBe(0);
  });
  it('clearWearableOutbox removes only the active account and is a no-op when signed out', () => {
    mk().rec.offer('s1', 120, dev);
    localStorage.setItem(keyFor(B), 'x');
    setStorageScope(SIGNED_OUT_SCOPE);
    clearWearableOutbox();
    expect(localStorage.getItem(keyFor(A))).not.toBeNull();
    setStorageScope(A);
    clearWearableOutbox();
    expect(localStorage.getItem(keyFor(A))).toBeNull();
    expect(localStorage.getItem(keyFor(B))).toBe('x');
    expect(scopedKey(OUTBOX_BASE_KEY)).toBe(keyFor(A));
  });
});

describe('HrRecorder with outbox', () => {
  it('survives a reload: restores, resends the SAME timestamps, then empties the outbox', async () => {
    const first = mk();
    first.rec.offer('s1', 120, dev);
    first.clock.t += 6000;
    first.rec.offer('s1', 125, dev);
    const original = JSON.parse(localStorage.getItem(keyFor(A))!).buffers.s1.map((x: { measuredAt: string }) => x.measuredAt);

    const second = mk(); // simulated reload: new recorder, same storage
    expect(second.rec.pending()).toBe(0);
    expect(second.rec.restore()).toBe(2);
    await second.rec.flush();
    expect(second.sent).toHaveLength(1);
    expect(second.sent[0].workoutSessionId).toBe('s1');
    expect(second.sent[0].samples.map((s) => s.measuredAt)).toEqual(original);
    expect(second.sent[0].samples.every((s) => s.origin === 'live')).toBe(true);
    expect(second.rec.pending()).toBe(0);
    expect(localStorage.getItem(keyFor(A))).toBeNull();
  });
  it('keeps the outbox when the network fails and retries with identical timestamps', async () => {
    const m = mk({ results: [{ kind: 'unavailable' }] });
    m.rec.offer('s1', 120, dev);
    await m.rec.flush();
    expect(m.rec.pending()).toBe(1);
    expect(localStorage.getItem(keyFor(A))).not.toBeNull();
    await m.rec.flush();
    expect(m.sent[1].samples[0].measuredAt).toBe(m.sent[0].samples[0].measuredAt);
    expect(localStorage.getItem(keyFor(A))).toBeNull();
  });
  it('restore does not duplicate readings already in memory', () => {
    const m = mk();
    m.rec.offer('s1', 120, dev);
    expect(m.rec.restore()).toBe(0);
    expect(m.rec.pending()).toBe(1);
  });
  it('discardAll (consent off) wipes memory and storage and blocks restore', () => {
    const m = mk();
    m.rec.offer('s1', 120, dev);
    m.rec.discardAll();
    expect(localStorage.getItem(keyFor(A))).toBeNull();
    expect(m.rec.restore()).toBe(0);
    expect(m.rec.offer('s1', 121, dev)).toBe(false);
  });
  it('server consent_required wipes the outbox and stops recording', async () => {
    const m = mk({ results: [{ kind: 'consent_required' }] });
    m.rec.offer('s1', 120, dev);
    await m.rec.flush();
    expect(localStorage.getItem(keyFor(A))).toBeNull();
    expect(m.rec.pending()).toBe(0);
    m.clock.t += 6000;
    expect(m.rec.offer('s1', 121, dev)).toBe(false);
  });
  it('restore stays blocked after consent_required until reset()', async () => {
    const m = mk({ results: [{ kind: 'consent_required' }] });
    m.rec.offer('s1', 120, dev);
    await m.rec.flush();
    localStorage.setItem(keyFor(A), JSON.stringify({ v: 1, scope: A, savedAt: iso(NOW), device: dev, buffers: { s1: [{ value: 120, measuredAt: iso(NOW - 1000) }] } }));
    expect(m.rec.restore()).toBe(0);
    m.rec.reset();
    expect(m.rec.restore()).toBe(1);
  });
  it('without consent confirmation nothing is sent: restore is never called, flush is a no-op', async () => {
    mk().rec.offer('s1', 120, dev);
    const fresh = mk();
    await fresh.rec.flush();
    expect(fresh.sent).toHaveLength(0);
  });
  it('reset({discard:true}) (account change) clears the outbox', () => {
    const m = mk();
    m.rec.offer('s1', 120, dev);
    m.rec.reset({ discard: true });
    expect(localStorage.getItem(keyFor(A))).toBeNull();
  });
  it('expired readings are not restored', () => {
    const old = mk({ clock: { t: NOW - OUTBOX_MAX_AGE_MS - 60_000 } });
    old.rec.offer('s1', 120, dev);
    expect(mk().rec.restore()).toBe(0);
  });
  it('storage failure does not break recording', () => {
    const m = mk();
    const orig = Storage.prototype.setItem;
    Storage.prototype.setItem = () => { throw new Error('quota'); };
    try { expect(m.rec.offer('s1', 120, dev)).toBe(true); expect(m.rec.pending()).toBe(1); } finally { Storage.prototype.setItem = orig; }
  });
  it('implausible values are neither buffered nor persisted', () => {
    const m = mk();
    expect(m.rec.offer('s1', 10, dev)).toBe(false);
    expect(localStorage.length).toBe(0);
  });
});
