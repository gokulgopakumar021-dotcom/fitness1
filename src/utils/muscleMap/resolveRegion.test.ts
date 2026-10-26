import { describe, expect, it } from 'vitest';
import { STARTER_PPL_PLAN, STARTER_UPPER_LOWER_PLAN } from '../../data/starterPlans';
import { inferMuscleGroup } from '../recoveryAnalytics';
import { MUSCLE_REGION_IDS, type MuscleRegionId } from './regions';
import { normalizeText, resolveRegion } from './resolveRegion';

const region = (name: string, label?: string) => resolveRegion(name, label).regionId;

describe('normalizeText', () => {
  it('lower-cases, strips punctuation/accents and collapses whitespace', () => {
    expect(normalizeText('  Weighted Pull-Up / Bodyweight   Pull-Up ')).toBe('weighted pull up bodyweight pull up');
    expect(normalizeText('Romanian Deadlift (RDL)')).toBe('romanian deadlift rdl');
    expect(normalizeText('Back & Lats')).toBe('back lats');
    expect(normalizeText('Café Row')).toBe('cafe row');
    expect(normalizeText(undefined)).toBe('');
    expect(normalizeText(42)).toBe('');
  });
});

describe('1. explicit labels', () => {
  const cases: [string, MuscleRegionId][] = [
    // starter-plan labels
    ['Chest', 'chest'], ['Back', 'back'], ['Shoulders', 'shoulders'], ['Arms', 'arms'],
    ['Quads', 'quadriceps'], ['Hamstrings', 'hamstrings_glutes'], ['Calves', 'calves'],
    // add-exercise dropdown labels
    ['Glutes', 'hamstrings_glutes'], ['Biceps', 'arms'], ['Triceps', 'arms'], ['Abs', 'core'],
    // labels the existing global resolver emits
    ['Back / Lats', 'back'], ['Quads', 'quadriceps'], ['Hamstrings & Glutes', 'hamstrings_glutes'],
    ['Arms (Biceps & Triceps)', 'arms'], ['Core & Lower Back', 'core'],
    // canonical display labels and plausible free text
    ['Core / Lower Back', 'core'], ['Quadriceps', 'quadriceps'], ['Hamstrings / Glutes', 'hamstrings_glutes'],
    ['Lower Back', 'core'], ['Lats', 'back'], ['Traps', 'back'], ['Delts', 'shoulders'], ['Forearms', 'arms'],
    ['Pecs', 'chest'], ['Calf', 'calves'],
  ];
  it.each(cases)('label %s -> %s (explicit-label, high)', (label, expected) => {
    expect(resolveRegion('Some Unknown Movement', label)).toEqual({ regionId: expected, source: 'explicit-label', confidence: 'high' });
  });

  it('ignores case and extra whitespace', () => {
    expect(region('x', '  qUaDs  ')).toBe('quadriceps');
    expect(region('x', 'HAMSTRINGS   &   GLUTES')).toBe('hamstrings_glutes');
  });

  it('every canonical region is reachable through at least one explicit label', () => {
    const reached = new Set(cases.map(([l]) => region('x', l)));
    for (const id of MUSCLE_REGION_IDS) expect(reached.has(id)).toBe(true);
  });

  it('an explicit label wins over a conflicting exercise name', () => {
    const r = resolveRegion('Barbell Bench Press', 'Quads');
    expect(r.regionId).toBe('quadriceps');
    expect(r.source).toBe('explicit-label');
  });

  it("treats 'General', blank and unrecognised labels as no label and falls through to the name", () => {
    for (const label of ['General', '', '   ', 'Cardio', 'Full Body', 'Legs', undefined, null, 7]) {
      expect(resolveRegion('Lat Pulldown', label as never).source).toBe('exact-name');
      expect(resolveRegion('Mystery Move', label as never)).toMatchObject({ regionId: null, source: 'unmapped' });
    }
  });

  it("maps 'Lower Back' to Core / Lower Back (the global resolver sends it to Back / Lats)", () => {
    expect(region('x', 'Lower Back')).toBe('core');
    expect(inferMuscleGroup('x', 'Lower Back')).toBe('Back / Lats'); // documents the difference
  });
});

describe('2. exact names and 3. bounded name rules (no label)', () => {
  const table: [string, MuscleRegionId | null][] = [
    // starter exercises
    ['Barbell Bench Press', 'chest'], ['Incline Dumbbell Press', 'chest'], ['Dumbbell Flat Bench Press', 'chest'], ['Incline Cable Flye', 'chest'],
    ['Barbell Bent Over Row', 'back'], ['Chest Supported Dumbbell Row', 'back'], ['Seated Cable Row', 'back'], ['Lat Pulldown', 'back'],
    ['Weighted Pull-Up / Bodyweight Pull-Up', 'back'],
    ['Standing Overhead Barbell Press', 'shoulders'], ['Dumbbell Seated Shoulder Press', 'shoulders'], ['Cable Lateral Raise', 'shoulders'], ['Face Pull', 'shoulders'],
    ['Barbell Bicep Curl', 'arms'], ['Hammer Curl', 'arms'], ['Incline Dumbbell Curl', 'arms'], ['Triceps Rope Pushdown', 'arms'],
    ['Barbell Back Squat', 'quadriceps'], ['Bulgarian Split Squat', 'quadriceps'], ['Leg Press', 'quadriceps'], ['Leg Extension', 'quadriceps'],
    ['Lying Leg Curl', 'hamstrings_glutes'], ['Romanian Deadlift (RDL)', 'hamstrings_glutes'],
    ['Seated Calf Raise', 'calves'], ['Standing Calf Raise', 'calves'],
    // variants handled by whole-word rules
    ['Machine Chest Press', 'chest'], ['Push-Up', 'chest'], ['Pushups', 'chest'], ['Pec Deck', 'chest'], ['Cable Fly', 'chest'], ['Cable Crossover', 'chest'], ['Decline Dumbbell Press', 'chest'],
    ['T-Bar Row', 'back'], ['Pull Ups', 'back'], ['Chin-Up', 'back'], ['Straight Arm Pulldown', 'back'], ['Straight-Arm Pushdown', 'back'], ['Dumbbell Shrug', 'back'],
    ['Lateral Raise', 'shoulders'], ['Dumbbell Side Raise', 'shoulders'], ['Front Raise', 'shoulders'], ['Military Press', 'shoulders'], ['Arnold Press', 'shoulders'], ['Reverse Fly', 'shoulders'], ['Rear Delt Fly', 'shoulders'], ['Reverse Pec Deck', 'shoulders'], ['Push Press', 'shoulders'],
    ['EZ Bar Curl', 'arms'], ['Overhead Triceps Extension', 'arms'], ['Skull Crusher', 'arms'], ['Cable Pushdown', 'arms'], ['Preacher Curls', 'arms'],
    ['Plank', 'core'], ['Cable Crunch', 'core'], ['Hanging Leg Raise', 'core'], ['Ab Wheel', 'core'], ['Back Extension', 'core'], ['Hyperextensions', 'core'], ['Russian Twist', 'core'], ['Sit-Up', 'core'],
    ['Front Squat', 'quadriceps'], ['Hack Squat', 'quadriceps'], ['Goblet Squat', 'quadriceps'],
    ['Seated Leg Curl', 'hamstrings_glutes'], ['Hip Thrust', 'hamstrings_glutes'], ['Glute Bridge', 'hamstrings_glutes'], ['Stiff-Leg Deadlift', 'hamstrings_glutes'], ['Good Morning', 'hamstrings_glutes'], ['Nordic Curl', 'hamstrings_glutes'], ['Cable Pull-Through', 'hamstrings_glutes'],
    ['Donkey Calf Raise', 'calves'], ['Leg Press Calf Raise', 'calves'],
    // deliberately unmapped (ambiguous or unknown) -- never defaulted to Chest
    ['Conventional Barbell Deadlift', null], ['Deadlift', null], ['Sumo Deadlift', null], ['Dips (Chest / Triceps)', null], ['Dips', null],
    ['Walking Lunge', null], ['Dumbbell Pullover', null], ['Upright Row', null], ['Close-Grip Bench Press', null],
    ['Burpees', null], ['Treadmill', null], ['Rowing Machine', null], ['Mystery Move', null], ['', null],
  ];
  it.each(table)('%s -> %s', (name, expected) => {
    expect(region(name)).toBe(expected);
  });

  it('reports the resolution source, confidence and reason', () => {
    expect(resolveRegion('Barbell Bench Press')).toEqual({ regionId: 'chest', source: 'exact-name', confidence: 'high' });
    expect(resolveRegion('Machine Chest Press')).toEqual({ regionId: 'chest', source: 'name-rule', confidence: 'medium' });
    expect(resolveRegion('Burpees')).toEqual({ regionId: null, source: 'unmapped', confidence: 'none', reason: 'no-match' });
    expect(resolveRegion('')).toEqual({ regionId: null, source: 'unmapped', confidence: 'none', reason: 'empty' });
    // two rules fire for different regions -> ambiguous -> unmapped
    expect(resolveRegion('Squat to Row')).toMatchObject({ regionId: null, source: 'unmapped', reason: 'ambiguous' });
    // a triceps mention next to "chest" is deliberately not trusted, so this stays unmapped
    expect(resolveRegion('Dips (Chest / Triceps)')).toMatchObject({ regionId: null, source: 'unmapped', reason: 'no-match' });
  });
});

describe('substring collisions the global resolver gets wrong', () => {
  it("'lateral' is not 'lat', so lateral raises are Shoulders, not Back", () => {
    expect(region('Cable Lateral Raise')).toBe('shoulders');
    expect(region('Lateral Raise')).toBe('shoulders');
    expect(inferMuscleGroup('Cable Lateral Raise')).toBe('Back / Lats'); // documents the old bug
  });
  it('Romanian deadlifts are Hamstrings / Glutes, not Back', () => {
    expect(region('Romanian Deadlift')).toBe('hamstrings_glutes');
    expect(inferMuscleGroup('Romanian Deadlift')).toBe('Back / Lats');
  });
  it('calf raises are Calves, not Chest', () => {
    expect(region('Calf Raise')).toBe('calves');
    expect(inferMuscleGroup('Calf Raise')).toBe('Chest');
  });
  it("'cable' is not 'ab': cable crossover is Chest, not Core; unknown cable moves are unmapped", () => {
    expect(region('Cable Crossover')).toBe('chest');
    expect(inferMuscleGroup('Cable Crossover')).toBe('Core & Lower Back');
    expect(region('Cable Wizard Thing')).toBeNull();
    expect(region('Crab Walk')).toBeNull();
    expect(region('Table Top Hold')).toBeNull();
  });
  it('face pulls and triceps extensions land where they belong', () => {
    expect(region('Face Pull')).toBe('shoulders');
    expect(region('Triceps Extension')).toBe('arms');
  });
  it("'curl' needs context: leg curls are not Arms, and curl-ups are not Arms", () => {
    expect(region('Leg Curl')).toBe('hamstrings_glutes');
    expect(region('Hamstring Curl')).toBe('hamstrings_glutes');
    expect(region('Curl Up')).toBeNull();
  });
  it('is not fooled by words that merely contain a keyword', () => {
    expect(region('Rowing Machine')).toBeNull();
    expect(region('Pressing Nonsense')).toBeNull();
    expect(region('Squatting Stance Drill')).toBeNull();
    expect(region('Backstroke Swim')).toBeNull();
  });
});

describe('never defaults to a region', () => {
  it('returns unmapped for a spread of unknown names and junk input', () => {
    for (const n of ['Yoga Flow', 'Sled Push', 'Farmers Walk', 'Kettlebell Swing', 'Jump Rope', 'xyz', '   ', '123']) {
      expect(resolveRegion(n)).toMatchObject({ regionId: null, source: 'unmapped' });
    }
    for (const junk of [undefined, null, 5, {}, [], true]) {
      expect(resolveRegion(junk as never, junk as never)).toMatchObject({ regionId: null, source: 'unmapped' });
    }
  });
});

describe('agreement with the real starter plans', () => {
  const plans = [STARTER_PPL_PLAN, STARTER_UPPER_LOWER_PLAN];
  const exercises = plans.flatMap((p) => p.days.flatMap((d) => d.exercises));

  it('finds the starter exercises', () => {
    expect(exercises.length).toBeGreaterThan(20);
  });

  it('every starter label resolves through the explicit-label path', () => {
    for (const e of exercises) {
      expect(resolveRegion(e.name, e.muscleGroup).source, `${e.name} / ${e.muscleGroup}`).toBe('explicit-label');
    }
  });

  it('where the name alone resolves, it agrees with the label the plan itself uses', () => {
    const labelled = exercises.map((e) => ({ name: e.name, byLabel: resolveRegion(e.name, e.muscleGroup).regionId, byName: resolveRegion(e.name).regionId }));
    const disagreements = labelled.filter((x) => x.byName !== null && x.byName !== x.byLabel).map((x) => `${x.name}: name=${x.byName} label=${x.byLabel}`);
    expect(disagreements).toEqual([]);
  });

  it('only the documented ambiguous starter exercises are unmapped by name', () => {
    const unmappedByName = [...new Set(exercises.filter((e) => resolveRegion(e.name).regionId === null).map((e) => e.name))].sort();
    expect(unmappedByName).toEqual(['Conventional Barbell Deadlift', 'Dips (Chest / Triceps)'].sort());
  });
});
