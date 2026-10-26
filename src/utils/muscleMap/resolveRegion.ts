import type { MuscleRegionId } from './regions';

/**
 * Exercise -> muscle-map region resolver (dedicated to the map; independent of the global
 * `inferMuscleGroup` in recoveryAnalytics.ts, which is deliberately left unchanged).
 *
 * Resolution order:
 *   1. A recognised explicit muscle-group label on the logged exercise        -> 'explicit-label'
 *   2. A curated exact exercise name (the starter-plan names)                 -> 'exact-name'
 *   3. Bounded whole-word rules on the exercise name                          -> 'name-rule'
 *   4. Otherwise `unmapped`. NEVER a default region (the old resolver fell back to Chest).
 *
 * Design rules:
 *   - Matching is on whole normalised WORDS, never substrings: 'lateral' does not match 'lat',
 *     'cable' does not match 'ab', 'crab' does not match 'ab'.
 *   - If name rules point at more than one region, the exercise is `unmapped` (ambiguous).
 *   - Primary muscle only. No secondary-muscle credit is invented.
 *   - Deliberately left unmapped without an explicit label because the primary mover is ambiguous:
 *     conventional/sumo deadlifts, lunges, dips, pullovers, upright rows, close-grip bench press.
 */

export type ResolutionSource = 'explicit-label' | 'exact-name' | 'name-rule' | 'unmapped';
export type ResolutionConfidence = 'high' | 'medium' | 'none';
export type UnmappedReason = 'no-match' | 'ambiguous' | 'empty';

export type RegionResolution =
  | { regionId: MuscleRegionId; source: Exclude<ResolutionSource, 'unmapped'>; confidence: 'high' | 'medium' }
  | { regionId: null; source: 'unmapped'; confidence: 'none'; reason: UnmappedReason };

/** Lower-cases, strips accents, turns every non-alphanumeric run into one space. */
export function normalizeText(input: unknown): string {
  if (typeof input !== 'string') return '';
  return input
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

// ---------------------------------------------------------------------------------------------
// 1. Explicit labels (compared after normalisation, with the word "and" removed)
// ---------------------------------------------------------------------------------------------

const LABELS: Readonly<Record<MuscleRegionId, readonly string[]>> = {
  chest: ['chest', 'pecs', 'pec', 'pectorals', 'upper chest', 'lower chest'],
  back: ['back', 'lats', 'lat', 'back lats', 'upper back', 'mid back', 'traps', 'trapezius', 'rhomboids'],
  shoulders: ['shoulders', 'shoulder', 'delts', 'deltoids', 'front delts', 'side delts', 'rear delts'],
  arms: ['arms', 'arm', 'biceps', 'bicep', 'triceps', 'tricep', 'arms biceps triceps', 'biceps triceps', 'forearms', 'forearm'],
  core: ['core', 'abs', 'abdominals', 'obliques', 'lower back', 'core lower back', 'erectors', 'spinal erectors'],
  quadriceps: ['quads', 'quad', 'quadriceps', 'quadricep'],
  hamstrings_glutes: ['hamstrings', 'hamstring', 'hams', 'glutes', 'glute', 'hamstrings glutes', 'glutes hamstrings'],
  calves: ['calves', 'calf'],
};

const LABEL_TO_REGION: ReadonlyMap<string, MuscleRegionId> = new Map(
  (Object.entries(LABELS) as [MuscleRegionId, readonly string[]][]).flatMap(([region, labels]) =>
    labels.map((l) => [l, region] as const)
  )
);

function normalizeLabel(label: unknown): string {
  return normalizeText(label)
    .split(' ')
    .filter((w) => w !== 'and')
    .join(' ');
}

// ---------------------------------------------------------------------------------------------
// 2. Curated exact names (the starter-plan exercises)
// ---------------------------------------------------------------------------------------------

const EXACT_NAMES: Readonly<Record<string, MuscleRegionId>> = {
  'barbell bench press': 'chest',
  'dumbbell flat bench press': 'chest',
  'incline dumbbell press': 'chest',
  'incline cable flye': 'chest',
  'barbell bent over row': 'back',
  'chest supported dumbbell row': 'back',
  'seated cable row': 'back',
  'lat pulldown': 'back',
  'weighted pull up bodyweight pull up': 'back',
  'standing overhead barbell press': 'shoulders',
  'dumbbell seated shoulder press': 'shoulders',
  'cable lateral raise': 'shoulders',
  'face pull': 'shoulders',
  'barbell bicep curl': 'arms',
  'hammer curl': 'arms',
  'incline dumbbell curl': 'arms',
  'triceps rope pushdown': 'arms',
  'barbell back squat': 'quadriceps',
  'bulgarian split squat': 'quadriceps',
  'leg press': 'quadriceps',
  'leg extension': 'quadriceps',
  'lying leg curl': 'hamstrings_glutes',
  'romanian deadlift rdl': 'hamstrings_glutes',
  'seated calf raise': 'calves',
  'standing calf raise': 'calves',
};

// ---------------------------------------------------------------------------------------------
// 3. Whole-word rules. A rule matches when EVERY `all` entry is present as a word and NO `none`
//    entry is. Entries may list alternatives separated by '|'.
// ---------------------------------------------------------------------------------------------

interface NameRule {
  readonly region: MuscleRegionId;
  readonly all: readonly string[];
  readonly none?: readonly string[];
}

const NAME_RULES: readonly NameRule[] = [
  // Chest
  { region: 'chest', all: ['bench', 'press'], none: ['close'] },
  { region: 'chest', all: ['chest', 'press|fly|flye|flies|flyes'] },
  { region: 'chest', all: ['incline|decline|flat', 'press'], none: ['shoulder', 'overhead', 'military', 'arnold'] },
  { region: 'chest', all: ['push', 'up|ups'] },
  { region: 'chest', all: ['pushup|pushups'] },
  { region: 'chest', all: ['pec', 'deck|fly|flye|press'], none: ['reverse', 'rear'] },
  { region: 'chest', all: ['fly|flye|flies|flyes'], none: ['reverse', 'rear', 'delt', 'face', 'bent'] },
  { region: 'chest', all: ['crossover|crossovers'], none: ['reverse'] },

  // Back / lats (traps are filed under Back)
  { region: 'back', all: ['pulldown|pulldowns'], none: ['tricep|triceps'] },
  { region: 'back', all: ['straight', 'arm|arms', 'pushdown|pushdowns'] },
  { region: 'back', all: ['pull', 'up|ups'] },
  { region: 'back', all: ['pullup|pullups'] },
  { region: 'back', all: ['chin', 'up|ups'] },
  { region: 'back', all: ['chinup|chinups'] },
  { region: 'back', all: ['row|rows'], none: ['upright', 'rear', 'delt'] },
  { region: 'back', all: ['shrug|shrugs'] },

  // Shoulders
  { region: 'shoulders', all: ['lateral|side', 'raise|raises'], none: ['calf|calves'] },
  { region: 'shoulders', all: ['front', 'raise|raises'], none: ['calf|calves'] },
  { region: 'shoulders', all: ['shoulder', 'press'] },
  { region: 'shoulders', all: ['overhead', 'press'], none: ['tricep|triceps'] },
  { region: 'shoulders', all: ['military', 'press'] },
  { region: 'shoulders', all: ['arnold', 'press'] },
  { region: 'shoulders', all: ['push', 'press'] },
  { region: 'shoulders', all: ['ohp'] },
  { region: 'shoulders', all: ['face', 'pull|pulls'] },
  { region: 'shoulders', all: ['reverse|rear', 'fly|flye|flies|flyes'] },
  { region: 'shoulders', all: ['reverse|rear', 'pec|deck'] },
  { region: 'shoulders', all: ['delt|delts|deltoid|deltoids'] },

  // Arms
  { region: 'arms', all: ['curl|curls'], none: ['leg', 'hamstring|hamstrings', 'nordic', 'up'] },
  { region: 'arms', all: ['tricep|triceps'], none: ['chest'] },
  { region: 'arms', all: ['bicep|biceps'] },
  { region: 'arms', all: ['pushdown|pushdowns|pressdown|pressdowns'], none: ['straight'] },
  { region: 'arms', all: ['skull', 'crusher|crushers'] },
  { region: 'arms', all: ['skullcrusher|skullcrushers'] },
  { region: 'arms', all: ['forearm|forearms'] },

  // Core / lower back
  { region: 'core', all: ['plank|planks'] },
  { region: 'core', all: ['crunch|crunches'] },
  { region: 'core', all: ['sit', 'up|ups'] },
  { region: 'core', all: ['situp|situps'] },
  { region: 'core', all: ['ab|abs|abdominal|abdominals'] },
  { region: 'core', all: ['russian', 'twist|twists'] },
  { region: 'core', all: ['leg', 'raise|raises'], none: ['calf|calves'] },
  { region: 'core', all: ['woodchop|woodchops|woodchopper|woodchoppers'] },
  { region: 'core', all: ['rollout|rollouts'] },
  { region: 'core', all: ['pallof'] },
  { region: 'core', all: ['hyperextension|hyperextensions'] },
  { region: 'core', all: ['back', 'extension|extensions'] },
  { region: 'core', all: ['core'] },

  // Quadriceps
  { region: 'quadriceps', all: ['squat|squats'] },
  { region: 'quadriceps', all: ['leg', 'press'], none: ['calf|calves'] },
  { region: 'quadriceps', all: ['leg', 'extension|extensions'] },
  { region: 'quadriceps', all: ['quad|quads|quadricep|quadriceps'] },

  // Hamstrings / glutes
  { region: 'hamstrings_glutes', all: ['romanian|rdl'] },
  { region: 'hamstrings_glutes', all: ['stiff', 'leg', 'deadlift'] },
  { region: 'hamstrings_glutes', all: ['leg', 'curl|curls'] },
  { region: 'hamstrings_glutes', all: ['hamstring|hamstrings'] },
  { region: 'hamstrings_glutes', all: ['nordic'] },
  { region: 'hamstrings_glutes', all: ['hip', 'thrust|thrusts'] },
  { region: 'hamstrings_glutes', all: ['glute|glutes'] },
  { region: 'hamstrings_glutes', all: ['good', 'morning|mornings'] },
  { region: 'hamstrings_glutes', all: ['pull', 'through'] },

  // Calves
  { region: 'calves', all: ['calf|calves'] },
];

function hasAny(words: ReadonlySet<string>, spec: string): boolean {
  return spec.split('|').some((w) => words.has(w));
}

function ruleMatches(rule: NameRule, words: ReadonlySet<string>): boolean {
  if (!rule.all.every((spec) => hasAny(words, spec))) return false;
  if (rule.none && rule.none.some((spec) => hasAny(words, spec))) return false;
  return true;
}

const UNMAPPED = (reason: UnmappedReason): RegionResolution => ({
  regionId: null,
  source: 'unmapped',
  confidence: 'none',
  reason,
});

/**
 * Resolves a logged exercise to a map region, or reports it as unmapped.
 * `muscleGroup` is the exercise's own label (may be missing, free text, or 'General').
 */
export function resolveRegion(exerciseName: unknown, muscleGroup?: unknown): RegionResolution {
  const label = normalizeLabel(muscleGroup);
  const fromLabel = label ? LABEL_TO_REGION.get(label) : undefined;
  if (fromLabel) return { regionId: fromLabel, source: 'explicit-label', confidence: 'high' };

  const name = normalizeText(exerciseName);
  if (!name) return UNMAPPED('empty');

  const exact = Object.prototype.hasOwnProperty.call(EXACT_NAMES, name) ? EXACT_NAMES[name] : undefined;
  if (exact) return { regionId: exact, source: 'exact-name', confidence: 'high' };

  const words = new Set(name.split(' '));
  const matched = new Set<MuscleRegionId>();
  for (const rule of NAME_RULES) {
    if (ruleMatches(rule, words)) matched.add(rule.region);
  }
  if (matched.size === 1) {
    return { regionId: [...matched][0], source: 'name-rule', confidence: 'medium' };
  }
  return UNMAPPED(matched.size === 0 ? 'no-match' : 'ambiguous');
}
