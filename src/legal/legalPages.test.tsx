// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { LegalRoot } from '../components/legal/LegalRoot';
import { LEGAL, OWNER_PLACEHOLDERS, POLICY_VERSION_PATTERN } from './legalConfig';
import { LEGAL_ROUTE_LIST, resolveLegalRoute, type LegalRouteKey } from './routes';
import { loadBillingConfig } from '../server/billing/config';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const mounted: { root: Root; el: HTMLElement }[] = [];
/** Renders into a fresh container (a tiny stand-in for a testing library; the repo does not ship one). */
function render(node: React.ReactNode) {
  const el = document.createElement('div');
  document.body.appendChild(el);
  const root = createRoot(el);
  act(() => root.render(node));
  const entry = { root, el };
  mounted.push(entry);
  return {
    container: el,
    unmount: () => {
      act(() => root.unmount());
      el.remove();
      const i = mounted.indexOf(entry);
      if (i >= 0) mounted.splice(i, 1);
    }
  };
}
afterEach(() => {
  while (mounted.length) {
    const m = mounted.pop()!;
    act(() => m.root.unmount());
    m.el.remove();
  }
});
const links = (root: ParentNode) => Array.from(root.querySelectorAll('a'));
const navs = (root: ParentNode, name: RegExp) =>
  Array.from(root.querySelectorAll('nav')).filter((n) => name.test(n.getAttribute('aria-label') ?? ''));

const KEYS: LegalRouteKey[] = ['privacy', 'terms', 'refund-policy', 'cancellation-policy', 'contact'];

describe('resolveLegalRoute (pathname gate)', () => {
  it.each([
    ['/privacy', 'privacy'],
    ['/terms', 'terms'],
    ['/refund-policy', 'refund-policy'],
    ['/cancellation-policy', 'cancellation-policy'],
    ['/contact', 'contact'],
    ['/privacy/', 'privacy'],
    ['/Privacy', 'privacy']
  ])('%s opens the %s page', (path, key) => {
    expect(resolveLegalRoute(path)).toBe(key);
  });

  it.each(['/', '', '/index.html', '/api/privacy', '/api/health', '/privacy/x', '/privacy.html', '/terms-of-service', '/settings', '/#signin', '/contactus'])(
    '%j keeps the existing app behaviour (no legal page)',
    (path) => {
      expect(resolveLegalRoute(path)).toBeNull();
    }
  );

  it('handles missing input without throwing', () => {
    expect(resolveLegalRoute(undefined)).toBeNull();
    expect(resolveLegalRoute(null)).toBeNull();
  });

  it('lists exactly the five approved routes', () => {
    expect(LEGAL_ROUTE_LIST.map((r) => r.path).sort()).toEqual(['/cancellation-policy', '/contact', '/privacy', '/refund-policy', '/terms']);
  });
});

describe('vercel.json rewrites', () => {
  const cfg = JSON.parse(readFileSync('vercel.json', 'utf8')) as { rewrites: { source: string; destination: string }[] };

  it('keeps the API rewrite first and unchanged', () => {
    expect(cfg.rewrites[0]).toEqual({ source: '/api/:__ironlog_api_path*', destination: '/api' });
  });

  it('adds only the five exact legal paths, each to /index.html, with no wildcard', () => {
    const extra = cfg.rewrites.slice(1);
    expect(extra.map((r) => r.source).sort()).toEqual(['/cancellation-policy', '/contact', '/privacy', '/refund-policy', '/terms']);
    for (const r of extra) {
      expect(r.destination).toBe('/index.html');
      expect(r.source).not.toMatch(/[*:()]/);
    }
  });
});

describe('legal pages render with no auth, no Supabase and no network', () => {
  it.each(KEYS)('%s renders a heading, navigation, and the five-page footer links', (key) => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const { container, unmount } = render(<LegalRoot route={key} />);
    expect(container.querySelectorAll('h1').length).toBe(1);
    expect(container.querySelector('main')).not.toBeNull();
    const legalNavs = navs(container, /legal documents/i);
    expect(legalNavs.length).toBe(2); // header and footer
    for (const nav of legalNavs) {
      const hrefs = links(nav).map((a) => a.getAttribute('href'));
      expect(hrefs).toEqual(['/privacy', '/terms', '/refund-policy', '/cancellation-policy', '/contact']);
    }
    expect(fetchSpy).not.toHaveBeenCalled();
    unmount();
  });

  it('marks the current page with aria-current', () => {
    const { container } = render(<LegalRoot route="terms" />);
    const current = Array.from(container.querySelectorAll('a[aria-current="page"]'));
    expect(current.length).toBe(2);
    for (const a of current) expect(a.getAttribute('href')).toBe('/terms');
  });

  it('sets the document title and links back home', () => {
    const { container } = render(<LegalRoot route="privacy" />);
    expect(document.title).toContain('Privacy Policy');
    expect(container.querySelector('a[aria-label$="home"]')?.getAttribute('href')).toBe('/');
  });

  it('every in-page contents link points at an existing section id', () => {
    const { container } = render(<LegalRoot route="privacy" />);
    const toc = navs(container, /on this page/i)[0];
    expect(toc).toBeTruthy();
    for (const a of links(toc)) {
      const id = (a.getAttribute('href') ?? '').slice(1);
      expect(document.getElementById(id), id).not.toBeNull();
    }
  });
});

describe('draft status, placeholders and the release gate', () => {
  it('shows the draft banner and a version line on Terms and Privacy while LEGAL.isDraft', () => {
    expect(LEGAL.isDraft).toBe(true);
    for (const key of ['privacy', 'terms'] as const) {
      const { container, unmount } = render(<LegalRoot route={key} />);
      expect(container.querySelector('[data-legal-draft-banner]')).not.toBeNull();
      expect(container.textContent).toContain(LEGAL.privacyVersion);
      unmount();
    }
  });

  it('only uses registered placeholder keys, and Contact shows the real support email', () => {
    for (const key of KEYS) {
      const { container, unmount } = render(<LegalRoot route={key} />);
      container.querySelectorAll('[data-legal-placeholder]').forEach((el) => {
        expect(Object.keys(OWNER_PLACEHOLDERS)).toContain(el.getAttribute('data-legal-placeholder'));
      });
      unmount();
    }
    const { container } = render(<LegalRoot route="contact" />);
    const mail = links(container).find((a) => a.textContent === LEGAL.supportEmail);
    expect(mail?.getAttribute('href')).toBe(`mailto:${LEGAL.supportEmail}`);
  });

  it('Contact never invents a phone number, address, company number or tax number', () => {
    const { container } = render(<LegalRoot route="contact" />);
    const text = container.textContent ?? '';
    expect(text).not.toMatch(/\+?\d[\d\s-]{8,}\d/); // no phone-like number
    expect(text).not.toMatch(/GSTIN\s*[:#]?\s*[0-9A-Z]{15}/);
    expect(text).not.toMatch(/\bCIN\b|\bLLP\b/);
  });

  it('RELEASE GATE: when drafts are switched off no placeholder or review note may remain', () => {
    if (LEGAL.isDraft) return; // gate only bites at release; see docs/legal/STAGE_2B_OWNER_LEGAL_CHECKLIST.md
    for (const key of KEYS) {
      const { container, unmount } = render(<LegalRoot route={key} />);
      expect(container.querySelector('[data-legal-placeholder]')).toBeNull();
      expect(container.querySelector('[data-legal-review-note]')).toBeNull();
      unmount();
    }
    expect(LEGAL.effectiveDate).not.toBeNull();
  });

  it('policy versions are storable identifiers', () => {
    expect(LEGAL.termsVersion).toMatch(POLICY_VERSION_PATTERN);
    expect(LEGAL.privacyVersion).toMatch(POLICY_VERSION_PATTERN);
  });
});

describe('accuracy guards on policy copy', () => {
  const text = (key: LegalRouteKey) => {
    const { container, unmount } = render(<LegalRoot route={key} />);
    // Accuracy guards apply to the PUBLIC policy text; draft-only review notes legitimately quote forbidden phrases.
    container.querySelectorAll('[data-legal-review-note]').forEach((n) => n.remove());
    const t = container.textContent ?? '';
    unmount();
    return t;
  };

  it('prices in Terms equal the server defaults (drift guard) and no GST claim is made', () => {
    const cfg = loadBillingConfig({});
    expect(cfg.plans.monthly.amountPaise).toBe(29_900);
    expect(cfg.plans.annual.amountPaise).toBe(149_900);
    const terms = text('terms');
    expect(terms).toContain('₹299 per month');
    expect(terms).toContain('₹1,499 per year');
    expect(terms).not.toMatch(/GST (registered|number|collected|included)|inclusive of GST/i);
  });

  it('does not promise automatic refund of the ₹5 debit, a refund timeline, or a blanket no-refund rule', () => {
    const refund = text('refund-policy');
    expect(refund).not.toMatch(/₹5[^.]*(is|will be) (automatically )?refunded/i);
    expect(refund).not.toMatch(/within \d+ (business )?days/i);
    expect(refund).not.toMatch(/non-?refundable|all payments are final|no refunds? (will be given|under any)/i);
    expect(refund).toMatch(/duplicate/i);
    expect(refund).toMatch(/incorrect/i);
    expect(refund).toMatch(/billing error/i);
    expect(refund).toMatch(/change-of-mind/i);
    expect(refund).toMatch(/cannot (legally )?be excluded/i);
  });

  it('privacy policy does not claim universal cloud sync, instant deletion, or no training use', () => {
    const p = text('privacy');
    expect(p).not.toMatch(/all (of )?your data (is|are) (synced|synchronised|stored in the cloud)/i);
    expect(p).not.toMatch(/(instantly|immediately) and permanently/i);
    expect(p).not.toMatch(/never (used|use[sd]?) (to|for) train|not used (to|for) train(ing)?/i);
    expect(p).not.toMatch(/backups? (are|is) (deleted|erased)/i);
    expect(p).toMatch(/device only/i);
    expect(p).toMatch(/other devices/i);
    expect(p).toMatch(/hash/i);
    for (const provider of ['Supabase', 'Vercel', 'Gemini', 'Razorpay', 'Upstash', 'Open Food Facts', 'Google Fonts', 'GitHub Actions']) {
      expect(p).toContain(provider);
    }
  });

  it('privacy policy does not claim legal compliance or invent a retention period', () => {
    const p = text('privacy').replace(/\s+/g, ' ');
    expect(p).not.toMatch(/(is|are) (fully )?(DPDP|GDPR)[- ]compliant|complies with the (DPDP|Digital Personal)/i);
    expect(p).not.toMatch(/(retain|kept|stored)[^.]{0,40}(\d+|one|two|three|seven|ten) (days|months|years)/i);
  });

  it('terms never call the service a medical device or clinically validated', () => {
    const t = text('terms');
    expect(t).toMatch(/not a medical device/i);
    expect(t).toMatch(/not clinically validated/i);
    expect(t).not.toMatch(/is (a )?(clinically (validated|proven)|medically (validated|approved))/i);
  });

  it('cancellation page documents the Settings, Billing path and promises no tested outcome', () => {
    const c = text('cancellation-policy');
    expect(c).toMatch(/Settings, then Billing/);
    expect(c).toMatch(/Manage billing/);
    expect(c).toMatch(/designed to work/i);
    expect(c).toContain(LEGAL.supportEmail);
  });
});
