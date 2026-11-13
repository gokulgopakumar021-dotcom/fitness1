// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { LegalRoot } from '../components/legal/LegalRoot';
import { LEGAL, OWNER_PLACEHOLDERS } from './legalConfig';
import type { LegalRouteKey } from './routes';
import { DRAFT_LANGUAGE, INVENTED_FACT_SHAPES, findMatches, releaseBlockers } from './releaseGate';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/**
 * Stage 2D / Stage 6: legal and owner-information protection.
 *
 * To list everything still blocking a release, run:   LEGAL_RELEASE_CHECK=1 npx vitest run src/legal/legalReleaseGate.test.tsx
 */
const KEYS: LegalRouteKey[] = ['privacy', 'terms', 'refund-policy', 'cancellation-policy', 'contact'];

/** Renders one page and returns { public text without draft-only parts, the placeholder keys that were visible }. */
function renderPage(route: LegalRouteKey) {
  const el = document.createElement('div');
  document.body.appendChild(el);
  const root = createRoot(el);
  act(() => root.render(<LegalRoot route={route} />));
  const banner = el.querySelector('[data-legal-draft-banner]') !== null;
  const placeholders = Array.from(el.querySelectorAll('[data-legal-placeholder]')).map((n) => n.getAttribute('data-legal-placeholder') as string);
  el.querySelectorAll('[data-legal-review-note],[data-legal-draft-banner],[data-legal-placeholder]').forEach((n) => n.remove());
  const text = (el.textContent ?? '').replace(/\s+/g, ' ');
  act(() => root.unmount());
  el.remove();
  return { text, banner, placeholders };
}
const rendered = Object.fromEntries(KEYS.map((k) => [k, renderPage(k)])) as Record<LegalRouteKey, ReturnType<typeof renderPage>>;
const pages = Object.fromEntries(KEYS.map((k) => [k, rendered[k].text]));

describe('draft state is protected while the owner and counsel have not finished', () => {
  it('the pages are still drafts, with no effective date invented', () => {
    expect(LEGAL.isDraft).toBe(true);
    expect(LEGAL.effectiveDate).toBeNull();
  });

  it('every one of the five pages shows the "not legally reviewed" banner', () => {
    for (const k of KEYS) expect(rendered[k].banner, k).toBe(true);
  });

  it('every owner-supplied fact still has a visible placeholder somewhere (none silently dropped or hard-coded)', () => {
    const shown = new Set(KEYS.flatMap((k) => rendered[k].placeholders));
    const missing = Object.keys(OWNER_PLACEHOLDERS).filter((f) => !shown.has(f));
    expect(missing).toEqual([]);
  });

  it('no owner fact has been invented in the public text', () => {
    const offenders = KEYS.flatMap((k) => findMatches(pages[k], INVENTED_FACT_SHAPES).map((h) => `${k}: ${h}`));
    expect(offenders).toEqual([]);
  });

  it('owner-approved facts that ARE settled stay in place: 18+, prices, support address', () => {
    expect(pages.terms).toMatch(/at least 18 years of age/);
    expect(pages.terms).toContain('₹299 per month');
    expect(pages.terms).toContain('₹1,499 per year');
    expect(pages.contact).toContain(LEGAL.supportEmail);
    expect(`${pages.terms} ${pages.privacy}`).not.toMatch(/\b1[3-7]\+|aged 1[3-7]\b|at least 1[3-7] years/);
  });
});

describe('the release gate itself', () => {
  const clean = { termsVersion: '2027-01-1', privacyVersion: '2027-01-1', effectiveDate: '2027-01-15', pages: { terms: 'We charge ₹299 per month.' } };

  it('passes a finished, clean state', () => {
    expect(releaseBlockers(clean)).toEqual([]);
  });

  it('blocks a missing or malformed effective date and draft version labels', () => {
    expect(releaseBlockers({ ...clean, effectiveDate: null })).toHaveLength(1);
    expect(releaseBlockers({ ...clean, effectiveDate: '15 Jan 2027' })).toHaveLength(1);
    expect(releaseBlockers({ ...clean, effectiveDate: '2027-13-45' })).toHaveLength(1);
    expect(releaseBlockers({ ...clean, termsVersion: '2026-11-draft-1' }).join()).toMatch(/draft label/);
  });

  it('blocks each kind of draft-era wording left in public text', () => {
    const samples = [
      'At the time of this draft, checkout charges those amounts.',
      'Photos stay on your device in the audited version of the app.',
      'Backups age out on a schedule which we have not verified.',
      'Corrected in Stage 2D, Stage 4.',
      'Owner decision: 18+. Counsel to confirm.',
      '[OWNER TO PROVIDE: EFFECTIVE DATE]'
    ];
    for (const s of samples) expect(releaseBlockers({ ...clean, pages: { terms: s } }), s).not.toEqual([]);
    expect(DRAFT_LANGUAGE.length).toBeGreaterThanOrEqual(samples.length);
  });

  it('blocks invented owner facts', () => {
    const samples = [
      'Our office is at 12 MG Road, Bengaluru 560001.',
      'These Terms are governed by the laws of India.',
      'Disputes are subject to the exclusive jurisdiction of the courts at Kochi.',
      'These policies are effective from 1 December 2026.',
      'We use the paid tier of the Gemini API.',
      'Grievance Officer: Mr Kumar'
    ];
    for (const s of samples) expect(releaseBlockers({ ...clean, pages: { terms: s } }), s).not.toEqual([]);
  });

  it('does not flag the owner-approved wording that is allowed to stay', () => {
    const ok = 'You must be at least 18 years of age. Monthly plan: ₹299 per month. Annual plan: ₹1,499 per year. Contact support@ironlog.app. Nothing here removes rights under applicable Indian consumer law.';
    expect(releaseBlockers({ ...clean, pages: { terms: ok } })).toEqual([]);
  });

  // Honest about what it does: skipped (and counted as skipped) while the pages are drafts, not a silent early "pass".
  const enforce = !LEGAL.isDraft || process.env.LEGAL_RELEASE_CHECK === '1';
  it.skipIf(!enforce)('RELEASE GATE: nothing in the live pages blocks publishing (skipped while LEGAL.isDraft; set LEGAL_RELEASE_CHECK=1 to list blockers)', () => {
    expect(releaseBlockers({ termsVersion: LEGAL.termsVersion, privacyVersion: LEGAL.privacyVersion, effectiveDate: LEGAL.effectiveDate, pages })).toEqual([]);
    for (const k of KEYS) expect(rendered[k].placeholders, `${k} still shows owner placeholders`).toEqual([]);
    expect(LEGAL.isDraft).toBe(false);
  });
});

describe('policy versions and the server allowlist cannot drift apart', () => {
  const dir = resolve(import.meta.dirname, '../../supabase/migrations');
  const sql = readdirSync(dir).filter((f) => f.endsWith('.sql')).map((f) => readFileSync(resolve(dir, f), 'utf8')).join('\n');
  const seeded = new Set<string>();
  for (const m of sql.matchAll(/\(\s*'(terms|privacy)'\s*,\s*'([A-Za-z0-9._-]{1,40})'\s*,\s*true\s*\)/g)) seeded.add(`${m[1]}:${m[2]}`);

  it('the current Terms and Privacy versions are seeded as current in a migration (else EVERY sign-up is rejected)', () => {
    expect(
      [...[`terms:${LEGAL.termsVersion}`, `privacy:${LEGAL.privacyVersion}`]].filter((k) => !seeded.has(k)),
      'Changing a version in src/legal/legalConfig.ts needs a new, reviewed migration that inserts it into public.legal_policy_versions (and makes it the single current row) in the SAME release. See docs/legal/STAGE_6_OWNER_INFORMATION_AND_RELEASE.md.'
    ).toEqual([]);
  });
});
