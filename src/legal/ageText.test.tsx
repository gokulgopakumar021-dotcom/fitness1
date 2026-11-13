import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { LEGAL, OWNER_PLACEHOLDERS } from './legalConfig';

const src = (p: string) => readFileSync(resolve(import.meta.dirname, '../..', p), 'utf8');

describe('the 18+ decision is reflected in the policy drafts', () => {
  it('Terms and Privacy state 18, with no minimum-age placeholder left', () => {
    for (const f of ['src/components/legal/content/TermsPage.tsx', 'src/components/legal/content/PrivacyPage.tsx']) {
      const s = src(f);
      expect(s).toMatch(/18 years of age|aged 18/);
      expect(s).not.toContain('minimumAge');
    }
    expect(Object.keys(OWNER_PLACEHOLDERS)).not.toContain('minimumAge');
  });
  it('they never claim the age is verified and still keep the draft state', () => {
    const s = src('src/components/legal/content/TermsPage.tsx') + src('src/components/legal/content/PrivacyPage.tsx');
    expect(s).toMatch(/do not independently verify|we do not verify/);
    expect(LEGAL.isDraft).toBe(true);
  });
});
