import { EXERCISE_BIOMECHANICS } from './exerciseBiomechanics';
import { STARTER_PPL_PLAN, STARTER_UPPER_LOWER_PLAN } from './starterPlans';
import type { ExerciseIndexEntry } from '../types/video';
import { normalizeExerciseText, slugifyExerciseName } from '../utils/videoLibrary/normalize';

/**
 * The exercise identity index that videos are matched against. It is DERIVED from data that already exists
 * (the biomechanics catalog and the starter plans); it is not a second exercise database and holds no content
 * of its own. Biomechanics ids are reused verbatim as keys. A starter-plan exercise that is already covered by
 * a biomechanics entry (same name or alias) is not added again.
 */

/** "Romanian Deadlift (RDL)" -> ["Romanian Deadlift", "RDL"]; "A / B" -> ["A", "B"]. Purely mechanical. */
function mechanicalAliases(name: string): string[] {
  const out: string[] = [];
  const paren = [...name.matchAll(/\(([^)]+)\)/g)].map((m) => m[1]);
  const withoutParen = name.replace(/\([^)]*\)/g, ' ').replace(/\s+/g, ' ').trim();
  if (paren.length) out.push(withoutParen, ...paren);
  for (const part of withoutParen.split('/')) {
    const p = part.trim();
    if (p && p !== name) out.push(p);
  }
  return [...new Set(out.filter((a) => a && a !== name))];
}

export function buildExerciseIndex(): ExerciseIndexEntry[] {
  const entries: ExerciseIndexEntry[] = Object.values(EXERCISE_BIOMECHANICS).map((e) => ({
    key: e.id,
    name: e.name,
    aliases: [...e.aliases],
    source: 'biomechanics' as const
  }));

  const claimed = new Set<string>();
  for (const e of entries) {
    claimed.add(normalizeExerciseText(e.key));
    claimed.add(normalizeExerciseText(e.name));
    for (const a of e.aliases) claimed.add(normalizeExerciseText(a));
  }

  const planned = [...STARTER_PPL_PLAN.days, ...STARTER_UPPER_LOWER_PLAN.days].flatMap((d) => d.exercises);
  for (const ex of planned) {
    const forms = [ex.name, ...mechanicalAliases(ex.name)].map(normalizeExerciseText);
    if (forms.some((f) => claimed.has(f))) continue; // already covered by an existing entry
    const key = slugifyExerciseName(ex.name);
    if (!key || entries.some((e) => e.key === key)) continue;
    const aliases = mechanicalAliases(ex.name);
    entries.push({ key, name: ex.name, aliases, source: 'starter-plan' });
    for (const f of forms) claimed.add(f);
  }
  return entries;
}

let cached: ExerciseIndexEntry[] | null = null;
/** Built once; the underlying data is static. */
export function getExerciseIndex(): ExerciseIndexEntry[] {
  return (cached ??= buildExerciseIndex());
}
