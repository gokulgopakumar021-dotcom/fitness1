// @vitest-environment node
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  AGE_CONFIRMATION_REQUIRED_MESSAGE,
  buildSignupAgeMetadata,
  declareAdult,
  fetchAgeEligibility,
  MINIMUM_AGE,
  validateAgeConfirmation
} from './ageEligibility';

const client = (rpc: (fn: string) => unknown) => ({ rpc: vi.fn(async (fn: string) => rpc(fn)) }) as unknown as SupabaseClient;

describe('sign-up metadata and validation', () => {
  it('the minimum age is 18 for the whole platform (never 14)', () => {
    expect(MINIMUM_AGE).toBe(18);
  });
  it('sends only a literal positive declaration: no date of birth, no age number, no timestamp, no version', () => {
    expect(buildSignupAgeMetadata()).toEqual({ age_declaration: { adult_18_plus: true } });
  });
  it('requires the confirmation to be exactly true', () => {
    expect(validateAgeConfirmation(true)).toBeNull();
    expect(validateAgeConfirmation(false)).toBe(AGE_CONFIRMATION_REQUIRED_MESSAGE);
  });
});

describe('fetchAgeEligibility reads the DATABASE answer and fails to "unavailable", never to "declared"', () => {
  it('maps the two documented answers', async () => {
    expect(await fetchAgeEligibility(client(() => ({ data: 'declared', error: null })))).toBe('declared');
    expect(await fetchAgeEligibility(client(() => ({ data: 'unknown', error: null })))).toBe('unknown');
  });
  it.each([
    ['an RPC error (e.g. migration not applied)', { data: null, error: { message: 'function not found' } }],
    ['a true boolean', { data: true, error: null }],
    ['the string "adult"', { data: 'adult', error: null }],
    ['null', { data: null, error: null }],
    ['an object', { data: { eligible: true }, error: null }]
  ])('%s is "unavailable"', async (_l, res) => {
    expect(await fetchAgeEligibility(client(() => res))).toBe('unavailable');
  });
  it('a thrown error (offline) is "unavailable"', async () => {
    const c = { rpc: vi.fn(() => { throw new Error('network'); }) } as unknown as SupabaseClient;
    expect(await fetchAgeEligibility(c)).toBe('unavailable');
  });
  it('a lookup that never answers times out to "unavailable"', async () => {
    vi.useFakeTimers();
    try {
      const c = { rpc: vi.fn(() => new Promise(() => {})) } as unknown as SupabaseClient;
      const p = fetchAgeEligibility(c);
      await vi.advanceTimersByTimeAsync(8_100);
      expect(await p).toBe('unavailable');
    } finally {
      vi.useRealTimers();
    }
  });
  it('calls only the caller-scoped RPC, with no arguments', async () => {
    const c = client(() => ({ data: 'declared', error: null }));
    await fetchAgeEligibility(c);
    expect((c.rpc as unknown as ReturnType<typeof vi.fn>).mock.calls).toEqual([['get_my_age_eligibility']]);
  });
});

describe('declareAdult', () => {
  it('is true only when the database accepted it, and passes no user id', async () => {
    const c = client(() => ({ error: null }));
    expect(await declareAdult(c)).toBe(true);
    expect((c.rpc as unknown as ReturnType<typeof vi.fn>).mock.calls).toEqual([['declare_adult_18_plus']]);
    expect(await declareAdult(client(() => ({ error: { message: 'x' } })))).toBe(false);
    expect(await declareAdult({ rpc: vi.fn(() => { throw new Error('offline'); }) } as unknown as SupabaseClient)).toBe(false);
  });
});

describe('eligibility never relies on anything the browser controls', () => {
  const read = (p: string) => readFileSync(resolve(import.meta.dirname, '../..', p), 'utf8');
  it.each(['src/legal/ageEligibility.ts', 'src/context/AgeEligibilityContext.tsx', 'src/components/legal/AgeEligibilityGate.tsx'])(
    '%s touches no localStorage, sessionStorage, cookie or profile age',
    (file) => {
      const src = read(file).replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
      expect(src).not.toMatch(/localStorage|sessionStorage|document\.cookie|profile\.age|getProfile/);
    }
  );
});
