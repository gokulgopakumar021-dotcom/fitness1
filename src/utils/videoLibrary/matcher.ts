import type { ExerciseIndexEntry, MatchCandidate, MatchResult } from '../../types/video';
import { equipmentFamilies, normalizeExerciseText, normalizeVideoFilename, tokenize } from './normalize';

/**
 * Conservative video -> exercise matcher. Deterministic and offline (no LLM, no network).
 *
 *  1. exact key      -> matched (confidence 1.00)
 *  2. exact name     -> matched (0.98)
 *  3. exact alias    -> matched (0.90)
 *  4. fuzzy          -> NEVER matched automatically: needs_review with a suggestion
 *  5. nothing        -> unmatched
 *
 * Safety rules: a tie at the best exact tier is ambiguous (needs_review); an exact match whose equipment
 * contradicts the video's equipment ("Dumbbell Lateral Raise" vs the cable exercise) is downgraded to review.
 */

export const FUZZY_MIN_SCORE = 0.8;
export const FUZZY_MIN_MARGIN = 0.15;

interface PreparedEntry {
  entry: ExerciseIndexEntry;
  key: string;
  name: string;
  aliases: string[];
  equipment: Set<string>;
  /** Token sets of the name and each alias, for fuzzy comparison. */
  tokenSets: Set<string>[];
}

export interface PreparedIndex {
  entries: PreparedEntry[];
}

export function prepareIndex(entries: ExerciseIndexEntry[]): PreparedIndex {
  return {
    entries: entries.map((entry) => {
      const nameNorm = normalizeExerciseText(entry.name);
      return {
        entry,
        key: normalizeExerciseText(entry.key),
        name: nameNorm,
        aliases: entry.aliases.map(normalizeExerciseText).filter(Boolean),
        equipment: equipmentFamilies(tokenize(entry.name)),
        tokenSets: [entry.name, ...entry.aliases].map((s) => new Set(tokenize(s)))
      };
    })
  };
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let inter = 0;
  for (const t of a) if (b.has(t)) inter++;
  return inter / (a.size + b.size - inter);
}

const round2 = (n: number) => Math.round(n * 100) / 100;

function result(partial: Partial<MatchResult> & Pick<MatchResult, 'method' | 'reviewStatus' | 'reason'>): MatchResult {
  return { exerciseKey: null, suggestedKey: null, confidence: 0, candidates: [], ...partial };
}

/** Matches an already-normalized name (tokens joined by spaces) against the index. */
export function matchNormalizedName(normalized: string, tokens: string[], index: PreparedIndex): MatchResult {
  if (!normalized) return result({ method: 'none', reviewStatus: 'unmatched', reason: 'empty_name' });

  const tiers: Array<{ method: 'exact_key' | 'exact_name' | 'exact_alias'; confidence: number; hit: (p: PreparedEntry) => boolean }> = [
    { method: 'exact_key', confidence: 1, hit: (p) => p.key === normalized },
    { method: 'exact_name', confidence: 0.98, hit: (p) => p.name === normalized },
    { method: 'exact_alias', confidence: 0.9, hit: (p) => p.aliases.includes(normalized) }
  ];

  for (const tier of tiers) {
    const hits = index.entries.filter(tier.hit);
    if (hits.length === 0) continue;
    const candidates: MatchCandidate[] = hits.map((h) => ({ key: h.entry.key, score: tier.confidence }));
    if (hits.length > 1) {
      return result({ method: tier.method, reviewStatus: 'needs_review', reason: 'ambiguous', suggestedKey: null, confidence: 0.5, candidates });
    }
    const hit = hits[0];
    const videoEquipment = equipmentFamilies(tokens);
    if (videoEquipment.size > 0 && hit.equipment.size > 0 && ![...videoEquipment].some((e) => hit.equipment.has(e))) {
      return result({
        method: tier.method,
        reviewStatus: 'needs_review',
        reason: 'equipment_conflict',
        suggestedKey: hit.entry.key,
        confidence: 0.5,
        candidates
      });
    }
    return result({ method: tier.method, reviewStatus: 'matched', reason: 'ok', exerciseKey: hit.entry.key, confidence: tier.confidence, candidates });
  }

  // Secondary, conservative fuzzy step. Suggests only; a human decides.
  const videoTokens = new Set(tokens);
  const videoEquipment = equipmentFamilies(tokens);
  const scored = index.entries
    .map((p) => {
      let best = 0;
      for (const set of p.tokenSets) best = Math.max(best, jaccard(videoTokens, set));
      const conflict = videoEquipment.size > 0 && p.equipment.size > 0 && ![...videoEquipment].some((e) => p.equipment.has(e));
      return { key: p.entry.key, score: conflict ? 0 : best };
    })
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score || a.key.localeCompare(b.key))
    .slice(0, 3)
    .map((s) => ({ key: s.key, score: round2(s.score) }));

  const [top, second] = scored;
  if (top && top.score >= FUZZY_MIN_SCORE && top.score - (second?.score ?? 0) >= FUZZY_MIN_MARGIN) {
    return result({ method: 'fuzzy', reviewStatus: 'needs_review', reason: 'fuzzy_only', suggestedKey: top.key, confidence: top.score, candidates: scored });
  }
  return result({ method: 'none', reviewStatus: 'unmatched', reason: 'no_match', candidates: scored.filter((s) => s.score >= 0.5) });
}

/** Matches a video filename or path. */
export function matchVideoFilename(filename: string, index: PreparedIndex): MatchResult {
  const n = normalizeVideoFilename(filename);
  return matchNormalizedName(n.normalized, n.tokens, index);
}

/**
 * Runtime lookup for the app: resolves an in-workout exercise name to an exercise key. Exact key/name/alias only:
 * a fuzzy or conflicting result yields null, so an unrelated video is never shown for a custom exercise.
 */
export function resolveExerciseKey(exerciseName: string, index: PreparedIndex): string | null {
  const tokens = tokenize(exerciseName);
  const r = matchNormalizedName(tokens.join(' '), tokens, index);
  return r.reviewStatus === 'matched' ? r.exerciseKey : null;
}
