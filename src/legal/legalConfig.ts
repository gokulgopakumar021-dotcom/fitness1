/**
 * Single source of truth for legal-page metadata (Stage 2B).
 *
 * EVERYTHING HERE IS DRAFT until the owner and Indian legal counsel have reviewed it. While `isDraft` is true every
 * legal page shows a visible "draft, not legally reviewed" notice, owner-to-complete fields render as highlighted
 * placeholders and reviewer notes are visible. Setting `isDraft` to false is a deliberate release gate: the test in
 * `legalPages.test.tsx` fails if any placeholder would still be published.
 */
export const LEGAL = {
  /** Public brand approved by the owner. (The app UI currently spells it "IronLog AI"; see docs/legal/STAGE_2B_OWNER_LEGAL_CHECKLIST.md.) */
  brandName: 'Iron Log AI',
  supportEmail: 'support@ironlog.app',
  /** true = drafts: banner + placeholders + reviewer notes are shown. Flip only after owner + counsel sign-off. */
  isDraft: true,
  /**
   * Policy version identifiers recorded at sign-up and in the existing-user acknowledgement. Changing either value
   * re-triggers the one-time notice for everyone whose latest recorded acknowledgement is for an older version.
   * Replace with the final version labels when the effective date is fixed.
   */
  termsVersion: '2026-11-draft-1',
  privacyVersion: '2026-11-draft-1',
  /** Owner supplies the final effective date. null renders as a placeholder. */
  effectiveDate: null as string | null
} as const;

/** Version identifiers must stay short, printable and safe to store (also enforced in the database). */
export const POLICY_VERSION_PATTERN = /^[A-Za-z0-9._-]{1,40}$/;

/** Every owner-to-complete field. Used by the owner/legal checklist and by the release-gate test. */
export const OWNER_PLACEHOLDERS = {
  operatorLegalName: 'LEGAL NAME OF THE INDIVIDUAL OPERATOR',
  operatorAddress: 'BUSINESS ADDRESS AND JURISDICTION',
  effectiveDate: 'EFFECTIVE DATE OF THESE POLICIES',
  governingLaw: 'GOVERNING LAW AND COURTS / DISPUTE VENUE',
  grievanceContact: 'GRIEVANCE OFFICER OR DESIGNATED CONTACT, IF REQUIRED',
  billingRetention: 'RETENTION PERIOD FOR PAYMENT RECORDS',
  trialHashRetention: 'RETENTION PERIOD FOR THE TRIAL-PREVENTION HASH',
  geminiTier: 'GEMINI API TIER AND APPLICABLE DATA TERMS'
} as const;

export type PlaceholderKey = keyof typeof OWNER_PLACEHOLDERS;
