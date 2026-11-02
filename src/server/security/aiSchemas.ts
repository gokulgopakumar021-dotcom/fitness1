import { ApiError } from './errors';
import { logger } from './logger';
import { list, num, object, oneOf, text, type Schema, type Validator } from './validation';

/**
 * Output schemas for model-generated JSON (the reverse direction of validation.ts, built from the same primitives).
 *
 * Policy, applied to every route below:
 *  - Only fields declared here survive. Unknown fields, `__proto__`, `constructor` etc. are never copied: the output
 *    object is built from the declared shape, not from the model's object.
 *  - Strings are control-character stripped and TRUNCATED to a cap (a long answer is trimmed, not rejected).
 *  - Numbers must be finite and inside a generous range; numeric strings are coerced; anything else rejects.
 *  - Enums must match exactly. Arrays are length-capped; over-long arrays reject (never silently half-trusted).
 *  - Fields the UI cannot render without are required. Optional fields that are absent stay absent (no `[]`/`''`
 *    defaults), which preserves the client's existing `x || fallback` behaviour.
 *  - A failure never returns partial output: the caller gets a 502 `ai_invalid_response`. Log lines name fields only.
 */

const t = (max: number, required = false): Validator<string> => text({ max, required, truncate: true, allowNumber: true });
const n = (min: number, max: number, required = false): Validator<number> => num({ min, max, required });
const strings = (itemMax: number, maxItems: number): Validator<string[]> => list(t(itemMax, true), { max: maxItems });

const absent = (v: unknown) => v === undefined || v === null;

/** Nested object that stays absent (instead of becoming `{}`) when the model omitted it. */
const optObject = (shape: Record<string, Validator<any>>): Validator<Record<string, unknown>> => {
  const inner = object(shape);
  return (v, path) => (absent(v) ? { ok: true, value: undefined } : inner(v, path));
};

const requiredObject = (shape: Record<string, Validator<any>>): Validator<Record<string, unknown>> => {
  const inner = object(shape);
  return (v, path) => (absent(v) ? { ok: false, issues: [`${path}: is required`] } : inner(v, path));
};

/** Required array the UI indexes into (e.g. `phases[0]`): must exist and be non-empty. */
const nonEmptyList = <T>(item: Validator<T>, max: number): Validator<T[]> => {
  const inner = list(item, { max, required: true });
  return (v, path) => {
    const r = inner(v, path);
    if (r.ok && (!r.value || r.value.length === 0)) return { ok: false, issues: [`${path}: must not be empty`] };
    return r;
  };
};

/** Array of objects: invalid shape rejects; an absent array stays absent. */
const objectList = (shape: Record<string, Validator<any>>, max: number, required = false): Validator<Record<string, unknown>[]> =>
  list(requiredObject(shape), { max, required });

const bool: Validator<boolean> = (v, path) => {
  if (absent(v)) return { ok: true, value: undefined };
  return typeof v === 'boolean' ? { ok: true, value: v } : { ok: false, issues: [`${path}: must be a boolean`] };
};

/* ---------------- shared shapes ---------------- */

const planExercise = {
  name: t(120, true),
  muscleGroup: t(60),
  equipment: t(60),
  workingSets: n(1, 20),
  repRange: t(20),
  targetRir: n(0, 10),
  restSeconds: n(0, 900),
  tempo: t(20),
  notes: t(500)
};
const substitute = { name: t(120, true), equipment: t(60), reason: t(300) };
const planDay = { dayName: t(80, true), exercises: objectList(planExercise, 40, true) };

/* ---------------- per-route schemas ---------------- */

export const aiOutputSchemas = {
  generatePlan: object({
    planName: t(120),
    trainingSplit: t(80),
    description: t(1000),
    days: nonEmptyList(requiredObject(planDay), 14)
  }),

  exerciseCoach: object({
    cues: list(t(300, true), { max: 8, required: true }),
    warmupProtocol: strings(200, 10),
    substitutions: objectList(substitute, 6),
    coachTip: t(500)
  }),

  generateAiRoutine: object({
    routineName: t(120, true),
    targetSplit: t(80),
    durationMinutes: n(5, 300),
    summaryRationale: t(1000),
    targetedMuscles: strings(60, 20),
    restedMuscles: strings(60, 20),
    exercises: nonEmptyList(
      requiredObject({
        ...planExercise,
        muscleRegionId: t(40),
        fatigueRationale: t(500),
        substitutes: objectList(substitute, 4)
      }),
      20
    )
  }),

  foodParser: object({
    items: objectList(
      {
        name: t(120, true),
        quantity: n(0, 100_000),
        servingUnit: t(40),
        calories: n(0, 10_000),
        protein: n(0, 2_000),
        carbs: n(0, 2_000),
        fat: n(0, 2_000),
        fiber: n(0, 1_000)
      },
      30,
      true
    )
  }),

  workoutInsights: object({
    headline: t(300, true),
    volumeTakeaway: t(800),
    fatigueAssessment: t(800),
    nextSessionAction: t(800),
    recoveryAdvice: t(800)
  }),

  planOverloadTuning: object({
    planStrategySummary: t(1000),
    recommendedPhase: oneOf(['hypertrophy', 'strength', 'adaptation', 're_entry'] as const),
    exerciseCalibrations: objectList(
      {
        exerciseName: t(120, true),
        recommendedRepRange: t(20),
        recommendedWorkingSets: n(1, 10),
        recommendedRir: n(0, 10),
        recommendedStrategy: oneOf(['double_progression', 'top_set_only', 'linear_load'] as const),
        recommendedIncrement: n(0, 50),
        rationale: t(500)
      },
      60,
      true
    )
  }),

  nutritionCoach: object({
    dailyCalories: n(500, 10_000, true),
    proteinGrams: n(0, 1_000, true),
    carbGrams: n(0, 2_000, true),
    fatGrams: n(0, 1_000, true),
    proteinPerKg: n(0, 10),
    tdeeEstimate: n(500, 10_000),
    strategyRationale: t(1000)
  }),

  recoveryInsights: object({
    systemicFatigueScore: n(0, 100, true),
    systemicFatigueLevel: oneOf(['Low', 'Optimal', 'Elevated', 'High'] as const, { required: true }),
    overallReadiness: n(0, 100),
    headline: t(300),
    muscleRecovery: objectList(
      {
        muscleGroup: t(60, true),
        recoveryPercentage: n(0, 100, true),
        status: oneOf(['fresh', 'recovering', 'fatigued'] as const, { required: true }),
        hoursSinceLastTrained: n(0, 100_000),
        totalSetsLast7Days: n(0, 1_000),
        recoveryTrend: oneOf(['improving', 'stable', 'needs_rest'] as const),
        recoveryHoursRemaining: n(0, 1_000),
        exercisesTrained: strings(100, 30)
      },
      20
    ),
    optimalRestDays: optObject({
      recommendedRestDays: strings(20, 7),
      isRestRecommendedToday: bool,
      todayAdvice: t(500),
      rationale: t(500)
    }),
    suggestedNextWorkout: optObject({ splitDay: t(80), reasoning: t(500) }),
    recoveryTips: strings(300, 10)
  }),

  warmupGenerator: object({
    routineName: t(120),
    totalDurationSeconds: n(0, 3_600),
    targetMuscles: strings(60, 20),
    coachTip: t(500),
    phases: nonEmptyList(
      requiredObject({
        phase: oneOf(['Raise', 'Activate', 'Mobilize', 'Potentiate'] as const, { required: true }),
        name: t(100, true),
        durationSeconds: n(5, 600, true),
        purpose: t(300),
        cues: strings(200, 6),
        musclesTargeted: strings(60, 10)
      }),
      8
    )
  }),

  physiqueBlueprint: object({
    gapAnalysis: requiredObject({
      currentStatsSummary: t(400),
      targetStatsSummary: t(400),
      bodyCompositionVerdict: t(120),
      estTimelineWeeks: t(80),
      keyFocusAreas: strings(200, 8)
    }),
    nutritionPlan: requiredObject({
      calorieTarget: n(500, 10_000, true),
      strategy: t(800),
      macros: optObject({
        proteinGrams: n(0, 1_000),
        proteinPerKg: t(20),
        carbsGrams: n(0, 2_000),
        fatsGrams: n(0, 1_000),
        hydrationLiters: n(0, 20)
      }),
      nutrientTiming: strings(300, 8),
      sampleMealPlan: objectList({ meal: t(80), foods: t(400), calories: n(0, 5_000), protein: n(0, 500) }, 10),
      recommendedSupplements: strings(120, 10)
    }),
    workoutPlan: requiredObject({
      planName: t(120),
      trainingSplit: t(80),
      description: t(1000),
      days: nonEmptyList(requiredObject(planDay), 14)
    }),
    coachMessage: t(2000)
  })
} satisfies Record<string, Schema>;

export type AiOutputRoute = keyof typeof aiOutputSchemas;

/* ---------------- entry points ---------------- */

const INVALID_AI_MESSAGE = 'The AI service returned an unusable response. Please try again.';

/**
 * Validates parsed model JSON. Returns the sanitised value, or throws ApiError(502, 'ai_invalid_response') which the
 * existing handleRouteError path turns into a safe response. Only field paths are logged: never model text or values.
 */
export function checkAiOutput<R extends AiOutputRoute>(
  route: R,
  raw: unknown,
  req: { requestId?: string; user?: { id?: string } } = {}
): Record<string, any> {
  const r = aiOutputSchemas[route](raw, 'output');
  if (!r.ok) {
    logger.warn('ai_output_invalid', { requestId: req.requestId, userId: req.user?.id, route, issues: r.issues.slice(0, 10) });
    throw new ApiError(502, 'ai_invalid_response', INVALID_AI_MESSAGE);
  }
  return (r.value ?? {}) as Record<string, any>;
}

/** Free-text model replies: strip control characters, trim, cap. Never empty-string a real answer into `undefined`. */
export function capFreeText(value: unknown, max: number, fallback = ''): string {
  if (typeof value !== 'string') return fallback;
  const s = value.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '').trim();
  return s ? s.slice(0, max) : fallback;
}
