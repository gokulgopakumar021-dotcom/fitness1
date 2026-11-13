/**
 * Release-gate helpers for the legal pages (Stage 2D / Stage 6). Used by tests only; nothing in the app imports this.
 *
 * The pages are DRAFTS. While `LEGAL.isDraft` is true they show a banner, owner placeholders and reviewer notes. Flipping
 * `isDraft` to false must not publish draft-era wording that lives in the ordinary body text (for example "in the audited
 * version" or "which we have not verified"), because that text is true of a draft and misleading in a final policy.
 */

/** Wording that belongs to a draft or an internal review, never to a published policy. */
export const DRAFT_LANGUAGE: ReadonlyArray<{ id: string; re: RegExp }> = [
  { id: 'the word "draft"', re: /\bdraft\b/i },
  { id: '"audited" (internal review wording)', re: /\baudited\b/i },
  { id: 'an unverified-fact admission', re: /not (yet )?(been )?verified|have not verified|NOT VERIFIED/i },
  { id: 'a stage reference', re: /\bStage \d/i },
  { id: 'internal decision or counsel wording', re: /owner decision|\bcounsel\b|legally reviewed/i },
  { id: 'an unfilled owner field', re: /OWNER TO PROVIDE/ }
];

/**
 * Facts the owner has NOT supplied. If any of these shapes appears in public policy text, someone invented a fact.
 * (Retention periods, GSTIN, phone, CIN/LLP are guarded in legalPages.test.tsx.)
 */
export const INVENTED_FACT_SHAPES: ReadonlyArray<{ id: string; re: RegExp }> = [
  { id: 'a postal PIN code (operator address not supplied)', re: /\b[1-9]\d{5}\b/ },
  { id: 'a governing-law or venue statement (not supplied)', re: /(governed by|construed in accordance with)[^.]{0,40}\blaws? of\b|exclusive jurisdiction|courts? (at|of|in) [A-Z]/ },
  { id: 'a stated effective date (not supplied)', re: /effective (from|on|as of) (\d|(January|February|March|April|May|June|July|August|September|October|November|December))/i },
  { id: 'a stated Gemini API tier (not supplied)', re: /Gemini[^.]{0,80}\b(paid|free|enterprise|Vertex)\b[^.]{0,30}\b(tier|plan)\b|\b(paid|free|enterprise)\b[^.]{0,20}\b(tier|plan)\b[^.]{0,30}Gemini/i },
  { id: 'a named grievance officer (not supplied)', re: /grievance (officer|contact)\s*[:\-]\s*(Mr|Ms|Mrs|Dr|Shri|Smt)\b/i }
];

export function findMatches(text: string, rules: ReadonlyArray<{ id: string; re: RegExp }>): string[] {
  const flat = text.replace(/\s+/g, ' ');
  const out: string[] = [];
  for (const { id, re } of rules) {
    // Report EVERY occurrence, so the owner sees the whole list and not just the first hit per category.
    const all = new RegExp(re.source, re.flags.includes('g') ? re.flags : `${re.flags}g`);
    for (const m of flat.matchAll(all)) {
      const at = m.index ?? 0;
      out.push(`${id}: "…${flat.slice(Math.max(0, at - 45), at + m[0].length + 45).trim()}…"`);
    }
  }
  return out;
}

export interface ReleaseState {
  termsVersion: string;
  privacyVersion: string;
  effectiveDate: string | null;
  /** Public text of each page: draft banner, reviewer notes and placeholders already removed. */
  pages: Record<string, string>;
}

/** Everything that must be true before `LEGAL.isDraft` may become false. An empty list means "no code-detectable blocker". */
export function releaseBlockers(s: ReleaseState): string[] {
  const out: string[] = [];
  if (!s.effectiveDate || !/^\d{4}-\d{2}-\d{2}$/.test(s.effectiveDate) || Number.isNaN(Date.parse(s.effectiveDate))) {
    out.push('effectiveDate must be a real YYYY-MM-DD date supplied by the owner');
  }
  for (const [name, v] of [['termsVersion', s.termsVersion], ['privacyVersion', s.privacyVersion]] as const) {
    if (/draft/i.test(v)) out.push(`${name} "${v}" is still a draft label (add the final version to the database allowlist in the same release)`);
  }
  for (const [page, text] of Object.entries(s.pages)) {
    for (const hit of findMatches(text, DRAFT_LANGUAGE)) out.push(`${page}: ${hit}`);
    for (const hit of findMatches(text, INVENTED_FACT_SHAPES)) out.push(`${page}: ${hit}`);
  }
  return out;
}
