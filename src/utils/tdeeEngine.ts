import { BodyMetricEntry, DailyNutritionLog, DynamicExpenditureEstimate, UserProfile } from '../types';

/**
 * Calculates baseline Basal Metabolic Rate (BMR) using the Mifflin-St Jeor equation.
 */
export function calculateMifflinStJeorBMR(profile: UserProfile): number {
  const weight = profile.currentWeightKg || 78;
  const height = profile.heightCm || 178;
  const age = profile.age || 26;
  const isFemale = profile.sex === 'female';

  let bmr = 10 * weight + 6.25 * height - 5 * age;
  bmr = isFemale ? bmr - 161 : bmr + 5;
  return Math.round(bmr);
}

/**
 * Calculates traditional static TDEE based on training frequency
 */
export function calculateStaticTDEE(profile: UserProfile): number {
  const bmr = calculateMifflinStJeorBMR(profile);
  const days = profile.trainingDaysPerWeek || 4;
  let activityMultiplier = 1.375; // 1-3 days
  if (days >= 5) activityMultiplier = 1.6;
  else if (days >= 3) activityMultiplier = 1.48;

  return Math.round(bmr * activityMultiplier);
}

/**
 * Calculates dynamic daily expenditure by analyzing energy intake versus rolling scale weight changes
 * (MacroFactor-style adaptive expenditure algorithm)
 */
export function calculateAdaptiveExpenditure(
  nutritionLogs: DailyNutritionLog[],
  bodyMetrics: BodyMetricEntry[],
  profile: UserProfile
): DynamicExpenditureEstimate {
  const staticBmr = calculateMifflinStJeorBMR(profile);
  const staticTdee = calculateStaticTDEE(profile);

  // Filter logs with logged foods
  const activeNutrLogs = nutritionLogs.filter((n) => {
    const totalCals = (n.entries || []).reduce((sum, e) => sum + (e.calories || 0), 0);
    return totalCals > 800; // filter out empty days
  });

  const sortedMetrics = [...bodyMetrics].sort(
    (a, b) => new Date(a.date).getTime() - new Date(b.date).getTime()
  );

  const daysSampled = Math.min(activeNutrLogs.length, sortedMetrics.length);

  // If insufficient sample data (< 3 days), fallback gracefully to static model with calibrating state
  if (activeNutrLogs.length < 3 || sortedMetrics.length < 2) {
    const defaultGoal = profile.primaryGoal || 'muscle_gain';
    let targetCals = staticTdee;
    if (defaultGoal === 'fat_loss') targetCals = staticTdee - 450;
    else if (defaultGoal === 'muscle_gain') targetCals = staticTdee + 250;

    const protein = Math.round((profile.currentWeightKg || 78) * 2.2);
    const fat = Math.round((targetCals * 0.25) / 9);
    const carbs = Math.round((targetCals - (protein * 4 + fat * 9)) / 4);

    return {
      currentTdee: staticTdee,
      staticBmr,
      staticTdee,
      difference: 0,
      adaptationStatus: 'neutral',
      confidence: 'calibrating',
      daysSampled: Math.max(activeNutrLogs.length, sortedMetrics.length),
      avgDailyIntake: Math.round(activeNutrLogs.reduce((s, n) => s + n.entries.reduce((c, e) => c + e.calories, 0), 0) / Math.max(1, activeNutrLogs.length)) || staticTdee,
      rollingWeightDeltaKg: 0,
      recommendedCalories: targetCals,
      recommendedProtein: protein,
      recommendedCarbs: Math.max(100, carbs),
      recommendedFat: Math.max(40, fat),
      rationale: 'Calibrating baseline expenditure. Log at least 7 days of daily food intake and scale weights for full adaptive precision.'
    };
  }

  // Calculate average daily caloric intake
  const totalCaloriesLogged = activeNutrLogs.reduce((sum, log) => {
    return sum + (log.entries || []).reduce((eSum, e) => eSum + (e.calories || 0), 0);
  }, 0);
  const avgDailyIntake = Math.round(totalCaloriesLogged / activeNutrLogs.length);

  // Calculate weight change across sampled window
  const firstMetric = sortedMetrics[0];
  const lastMetric = sortedMetrics[sortedMetrics.length - 1];
  const weightDeltaKg = lastMetric.weightKg - firstMetric.weightKg;

  const msSpan = new Date(lastMetric.date).getTime() - new Date(firstMetric.date).getTime();
  const daySpan = Math.max(3, Math.round(msSpan / (1000 * 60 * 60 * 24)));

  // Energy balance physics: 1 kg human mass change ≈ 7,700 kcal
  const dailyImbalanceKcal = (weightDeltaKg * 7700) / daySpan;

  // True expenditure = Intake - Imbalance
  let dynamicTdee = Math.round(avgDailyIntake - dailyImbalanceKcal);

  // Physiological guardrails (keep TDEE between 0.8 * BMR and 3.0 * BMR)
  dynamicTdee = Math.min(Math.round(staticBmr * 2.8), Math.max(Math.round(staticBmr * 0.85), dynamicTdee));

  const diff = dynamicTdee - staticTdee;
  const adaptationStatus: 'accelerated' | 'neutral' | 'downregulated' =
    diff > 140 ? 'accelerated' : diff < -140 ? 'downregulated' : 'neutral';

  const confidence: 'high' | 'medium' | 'calibrating' =
    daySpan >= 14 && activeNutrLogs.length >= 10
      ? 'high'
      : daySpan >= 7 && activeNutrLogs.length >= 5
      ? 'medium'
      : 'calibrating';

  // Determine optimal macro targets for user's goal based on dynamic TDEE
  const goal = profile.primaryGoal || 'muscle_gain';
  let recommendedCalories = dynamicTdee;

  if (goal === 'fat_loss') {
    recommendedCalories = Math.round(dynamicTdee - 450);
  } else if (goal === 'muscle_gain') {
    recommendedCalories = Math.round(dynamicTdee + 250);
  } else if (goal === 'recomposition') {
    recommendedCalories = Math.round(dynamicTdee - 150);
  }

  // Protein: 2.0g to 2.4g per kg of bodyweight
  const weightKg = profile.currentWeightKg || 78;
  const recommendedProtein = Math.round(weightKg * 2.2);

  // Fat: 22-25% of total caloric intake (min 50g)
  const recommendedFat = Math.max(45, Math.round((recommendedCalories * 0.24) / 9));

  // Carbs: Remaining calories
  const remainingCals = recommendedCalories - (recommendedProtein * 4 + recommendedFat * 9);
  const recommendedCarbs = Math.max(100, Math.round(remainingCals / 4));

  let rationale = `Your dynamic metabolism is expending ~${dynamicTdee} kcal/day (${diff >= 0 ? '+' : ''}${diff} kcal vs static model). `;
  if (goal === 'fat_loss') {
    rationale += `Prescribing a moderate 450 kcal deficit with high protein to protect lean muscular tissue while sustaining gym output.`;
  } else if (goal === 'muscle_gain') {
    rationale += `Prescribing an optimal 250 kcal lean surplus to maximize muscular hypertrophy while minimizing adiposity.`;
  } else {
    rationale += `Targeting energy balance to maintain lean body mass and optimize performance recovery.`;
  }

  return {
    currentTdee: dynamicTdee,
    staticBmr,
    staticTdee,
    difference: diff,
    adaptationStatus,
    confidence,
    daysSampled: daySpan,
    avgDailyIntake,
    rollingWeightDeltaKg: Number(weightDeltaKg.toFixed(2)),
    recommendedCalories,
    recommendedProtein,
    recommendedCarbs,
    recommendedFat,
    rationale
  };
}

export type ActivityLevel = 'sedentary' | 'light' | 'moderate' | 'very_active' | 'extra_active';
export type NutritionGoal = 'cut' | 'maintain' | 'bulk';
export type DeficitOrSurplusPace = 'conservative' | 'moderate' | 'aggressive';

export interface DetailedTDEEResult {
  bmr: number;
  dailyTdee: number;
  weeklyTdee: number;
  activityMultiplier: number;
  activityLabel: string;
  formulaUsed: 'katch_mcardle' | 'mifflin_st_jeor';
  bodyFatPercentage?: number;
  leanBodyMassKg?: number;
  bmrKatchMcArdle?: number;
  bmrMifflinStJeor?: number;
}

export interface WizardMacroPlan {
  dailyTdee: number;
  weeklyTdee: number;
  targetCalories: number;
  weeklyTargetCalories: number;
  weeklyDeficitOrSurplus: number;
  estimatedWeeklyWeightChangeKg: number;
  goal: NutritionGoal;
  pace: DeficitOrSurplusPace;
  proteinGrams: number;
  carbsGrams: number;
  fatGrams: number;
  proteinPercent: number;
  carbsPercent: number;
  fatPercent: number;
  rationale: string;
  leanBodyMassKg?: number;
  bodyFatPercentage?: number;
  /** Deficit (-) or surplus (+) the chosen goal/pace asked for, before any guardrail. */
  requestedCalorieDelta: number;
  /** Final target minus estimated maintenance. Differs from the request when the calorie floor applies. */
  actualCalorieDelta: number;
  calorieFloorApplied: boolean;
  /** protein*4 + carbs*4 + fat*9 using the final gram values. */
  macroCalories: number;
  /** macroCalories - targetCalories (positive = macros exceed the calorie target). */
  macroCalorieMismatch: number;
  /** True when |macroCalorieMismatch| <= MACRO_RECONCILE_TOLERANCE_KCAL. */
  macrosReconciled: boolean;
  /** True when a guardrail changed the requested result or the macros do not reconcile. Saving needs explicit confirmation. */
  constrained: boolean;
  warnings: string[];
}

/** Software calorie floor. A guardrail in this app, not a medically validated minimum. */
export const CALORIE_FLOOR_KCAL = 1200;
/** Rounding tolerance for 4/4/9 reconciliation (each gram figure is rounded to whole grams). */
export const MACRO_RECONCILE_TOLERANCE_KCAL = 10;
/** Minimum carbohydrate target applied by the engine (existing behavior). */
export const CARB_FLOOR_GRAMS = 50;

/** Supported input ranges. Mirrors the wizard's controls; enforced in code, not only via HTML attributes. */
export const INPUT_BOUNDS = {
  weightKg: { min: 30, max: 300 },
  heightCm: { min: 100, max: 230 },
  age: { min: 14, max: 99 },
  bodyFatPercentage: { min: 3, max: 60 },
  proteinGramsPerKg: { min: 1.6, max: 2.8 },
  fatPercentOfCalories: { min: 18, max: 35 }
} as const;

export const SUPPORTED_SEXES = ['male', 'female', 'other', 'unspecified'] as const;

export const ACTIVITY_MULTIPLIERS: Record<ActivityLevel, { multiplier: number; label: string; desc: string }> = {
  sedentary: { multiplier: 1.2, label: 'Sedentary', desc: 'Desk job, <5,000 steps/day, minimal deliberate movement' },
  light: { multiplier: 1.375, label: 'Lightly Active', desc: '1–3 training sessions/week or 6,000–8,000 steps/day' },
  moderate: { multiplier: 1.55, label: 'Moderately Active', desc: '3–5 hard training sessions/week or 8,000–11,000 steps/day' },
  very_active: { multiplier: 1.725, label: 'Very Active', desc: '6–7 strenuous training sessions/week or physical trade job' },
  extra_active: { multiplier: 1.9, label: 'Extra Active / Two-a-Days', desc: 'Competitive athletic training or high-demand manual labor' }
};

/**
 * Calculates detailed BMR (Mifflin-St Jeor or Katch-McArdle if body fat % is provided),
 * daily TDEE, and weekly total TDEE.
 */
export function calculateDetailedTDEE(params: {
  weightKg: number;
  heightCm: number;
  age: number;
  sex: 'male' | 'female' | 'other' | 'unspecified';
  activityLevel: ActivityLevel;
  bodyFatPercentage?: number;
}): DetailedTDEEResult {
  const { weightKg, heightCm, age, sex, activityLevel, bodyFatPercentage } = params;
  
  // Mifflin-St Jeor formula
  let mifflinBmr = 10 * weightKg + 6.25 * heightCm - 5 * age;
  if (sex === 'male') {
    mifflinBmr += 5;
  } else if (sex === 'female') {
    mifflinBmr -= 161;
  } else {
    mifflinBmr -= 78; // neutral midpoint
  }
  mifflinBmr = Math.max(900, Math.round(mifflinBmr));

  let finalBmr = mifflinBmr;
  let formulaUsed: 'katch_mcardle' | 'mifflin_st_jeor' = 'mifflin_st_jeor';
  let leanBodyMassKg: number | undefined = undefined;
  let katchBmr: number | undefined = undefined;

  // Katch-McArdle formula when body fat % is provided
  if (typeof bodyFatPercentage === 'number' && bodyFatPercentage >= 3 && bodyFatPercentage <= 60) {
    leanBodyMassKg = Number((weightKg * (1 - bodyFatPercentage / 100)).toFixed(1));
    // Katch-McArdle BMR = 370 + (21.6 * LBM)
    katchBmr = Math.max(900, Math.round(370 + 21.6 * leanBodyMassKg));
    finalBmr = katchBmr;
    formulaUsed = 'katch_mcardle';
  }

  const activity = ACTIVITY_MULTIPLIERS[activityLevel] || ACTIVITY_MULTIPLIERS.moderate;
  const dailyTdee = Math.round(finalBmr * activity.multiplier);
  const weeklyTdee = dailyTdee * 7;

  return {
    bmr: finalBmr,
    dailyTdee,
    weeklyTdee,
    activityMultiplier: activity.multiplier,
    activityLabel: activity.label,
    formulaUsed,
    bodyFatPercentage,
    leanBodyMassKg,
    bmrKatchMcArdle: katchBmr,
    bmrMifflinStJeor: mifflinBmr
  };
}

function isFiniteNumber(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

function inRange(v: unknown, b: { min: number; max: number }): v is number {
  return isFiniteNumber(v) && v >= b.min && v <= b.max;
}

export function isActivityLevel(v: unknown): v is ActivityLevel {
  return typeof v === 'string' && Object.prototype.hasOwnProperty.call(ACTIVITY_MULTIPLIERS, v);
}

/** Parses a text field. Empty or malformed text (including Infinity) returns NaN; it never becomes 0. */
export function parseNumericInput(raw: string): number {
  const t = (raw ?? '').trim();
  if (t === '') return NaN;
  const n = Number(t);
  return Number.isFinite(n) ? n : NaN;
}

export type WizardInputField =
  | 'weight'
  | 'height'
  | 'age'
  | 'sex'
  | 'bodyFat'
  | 'activityLevel'
  | 'proteinRatio'
  | 'fatPercent'
  | 'customCalorieAdjustment'
  | 'calculation';

export type WizardInputErrors = Partial<Record<WizardInputField, string>>;

export interface WizardInputs {
  weightKg: number;
  heightCm: number;
  age: number;
  sex: string;
  activityLevel: string;
  /** undefined = not provided (Mifflin-St Jeor fallback). NaN or out-of-range = invalid. */
  bodyFatPercentage?: number;
  proteinRatioGramsPerKg: number;
  fatPercentOfCalories: number;
  goal: NutritionGoal;
  pace: DeficitOrSurplusPace;
  customCalorieAdjustment?: number;
}

/**
 * Validates wizard inputs against INPUT_BOUNDS. Required fields are never defaulted;
 * an omitted body-fat value is valid (fallback formula), a malformed or out-of-range one is not.
 */
export function validateWizardInputs(
  i: WizardInputs,
  opts: { weightUnit?: 'kg' | 'lbs' } = {}
): { valid: boolean; errors: WizardInputErrors } {
  const errors: WizardInputErrors = {};
  const b = INPUT_BOUNDS;
  if (!inRange(i.weightKg, b.weightKg)) {
    errors.weight =
      opts.weightUnit === 'lbs'
        ? `Enter a weight between ${Math.ceil(b.weightKg.min * 2.20462)} and ${Math.floor(b.weightKg.max * 2.20462)} lbs.`
        : `Enter a weight between ${b.weightKg.min} and ${b.weightKg.max} kg.`;
  }
  if (!inRange(i.heightCm, b.heightCm)) {
    errors.height = `Enter a height between ${b.heightCm.min} and ${b.heightCm.max} cm.`;
  }
  if (!inRange(i.age, b.age) || !Number.isInteger(i.age)) {
    errors.age = `Enter a whole-number age between ${b.age.min} and ${b.age.max}.`;
  }
  if (!(SUPPORTED_SEXES as readonly string[]).includes(i.sex)) {
    errors.sex = 'Select a supported option.';
  }
  if (i.bodyFatPercentage !== undefined && !inRange(i.bodyFatPercentage, b.bodyFatPercentage)) {
    errors.bodyFat = `Body fat must be between ${b.bodyFatPercentage.min}% and ${b.bodyFatPercentage.max}%, or leave it blank if you don't know it.`;
  }
  if (!isActivityLevel(i.activityLevel)) {
    errors.activityLevel = 'Select an activity level.';
  }
  if (!inRange(i.proteinRatioGramsPerKg, b.proteinGramsPerKg)) {
    errors.proteinRatio = `Protein must be between ${b.proteinGramsPerKg.min} and ${b.proteinGramsPerKg.max} g/kg.`;
  }
  if (!inRange(i.fatPercentOfCalories, b.fatPercentOfCalories)) {
    errors.fatPercent = `Fat must be between ${b.fatPercentOfCalories.min}% and ${b.fatPercentOfCalories.max}% of calories.`;
  }
  if (i.customCalorieAdjustment !== undefined && !isFiniteNumber(i.customCalorieAdjustment)) {
    errors.customCalorieAdjustment = 'Calorie adjustment must be a finite number.';
  }
  return { valid: Object.keys(errors).length === 0, errors };
}

export type NutritionPlanResult =
  | { ok: true; tdee: DetailedTDEEResult; plan: WizardMacroPlan }
  | { ok: false; errors: WizardInputErrors };

/**
 * Validated entry point used by the wizard. Never throws: invalid input or a non-finite derived
 * value yields { ok: false } so nothing downstream can display or persist it.
 */
export function computeNutritionPlan(
  i: WizardInputs,
  opts: { weightUnit?: 'kg' | 'lbs' } = {}
): NutritionPlanResult {
  const v = validateWizardInputs(i, opts);
  if (!v.valid) return { ok: false, errors: v.errors };
  try {
    const tdee = calculateDetailedTDEE({
      weightKg: i.weightKg,
      heightCm: i.heightCm,
      age: i.age,
      sex: i.sex as 'male' | 'female' | 'other' | 'unspecified',
      activityLevel: i.activityLevel as ActivityLevel,
      bodyFatPercentage: i.bodyFatPercentage
    });
    if (![tdee.bmr, tdee.dailyTdee, tdee.weeklyTdee].every((n) => isFiniteNumber(n) && n > 0)) {
      return { ok: false, errors: { calculation: 'The energy estimate could not be calculated from these inputs.' } };
    }
    const plan = calculateWizardMacroPlan({
      dailyTdee: tdee.dailyTdee,
      weightKg: i.weightKg,
      goal: i.goal,
      pace: i.pace,
      customCalorieAdjustment: i.customCalorieAdjustment,
      proteinRatioGramsPerKg: i.proteinRatioGramsPerKg,
      fatPercentOfCalories: i.fatPercentOfCalories,
      bodyFatPercentage: i.bodyFatPercentage
    });
    return { ok: true, tdee, plan };
  } catch {
    return { ok: false, errors: { calculation: 'The targets could not be calculated from these inputs.' } };
  }
}

const signed = (n: number) => (n > 0 ? `+${n}` : `${n}`);

/**
 * Computes calibrated calories and macros for Cut, Maintain, and Bulk goals.
 * Throws RangeError on invalid or non-finite input and never returns negative or non-finite targets.
 * When a guardrail (calorie floor, fat floor, carb floor) changes the requested result, the plan
 * reports the actual values and sets `constrained`.
 */
export function calculateWizardMacroPlan(params: {
  dailyTdee: number;
  weightKg: number;
  goal: NutritionGoal;
  pace: DeficitOrSurplusPace;
  customCalorieAdjustment?: number;
  proteinRatioGramsPerKg?: number;
  fatPercentOfCalories?: number;
  bodyFatPercentage?: number;
}): WizardMacroPlan {
  const {
    dailyTdee,
    weightKg,
    goal,
    pace,
    customCalorieAdjustment,
    proteinRatioGramsPerKg,
    fatPercentOfCalories,
    bodyFatPercentage
  } = params;

  if (!isFiniteNumber(dailyTdee) || dailyTdee <= 0) throw new RangeError('dailyTdee must be a positive finite number');
  if (!inRange(weightKg, INPUT_BOUNDS.weightKg)) throw new RangeError('weightKg is outside the supported range');
  if (proteinRatioGramsPerKg !== undefined && !inRange(proteinRatioGramsPerKg, INPUT_BOUNDS.proteinGramsPerKg)) {
    throw new RangeError('proteinRatioGramsPerKg is outside the supported range');
  }
  if (fatPercentOfCalories !== undefined && !inRange(fatPercentOfCalories, INPUT_BOUNDS.fatPercentOfCalories)) {
    throw new RangeError('fatPercentOfCalories is outside the supported range');
  }
  if (customCalorieAdjustment !== undefined && !isFiniteNumber(customCalorieAdjustment)) {
    throw new RangeError('customCalorieAdjustment must be finite');
  }

  // Lean body mass only when body fat is valid
  const leanBodyMassKg = inRange(bodyFatPercentage, INPUT_BOUNDS.bodyFatPercentage)
    ? Number((weightKg * (1 - bodyFatPercentage / 100)).toFixed(1))
    : undefined;

  // Requested calorie delta
  let calorieDelta = 0;
  if (customCalorieAdjustment !== undefined) {
    calorieDelta = customCalorieAdjustment;
  } else if (goal === 'cut') {
    if (pace === 'conservative') calorieDelta = -300;
    else if (pace === 'moderate') calorieDelta = -500;
    else calorieDelta = -750;
  } else if (goal === 'bulk') {
    if (pace === 'conservative') calorieDelta = 250;
    else if (pace === 'moderate') calorieDelta = 400;
    else calorieDelta = 600;
  }

  // Final calorie target after the calorie floor; every budget below derives from this value
  const rawTarget = Math.round(dailyTdee + calorieDelta);
  const calorieFloorApplied = rawTarget < CALORIE_FLOOR_KCAL;
  const targetCalories = calorieFloorApplied ? CALORIE_FLOOR_KCAL : rawTarget;
  const actualCalorieDelta = targetCalories - dailyTdee;
  const weeklyTargetCalories = targetCalories * 7;
  const weeklyTdee = dailyTdee * 7;
  const weeklyDeficitOrSurplus = weeklyTargetCalories - weeklyTdee;

  // Approximation: 1 kg of body-weight change ~ 7,700 kcal
  const estimatedWeeklyWeightChangeKg = Number((weeklyDeficitOrSurplus / 7700).toFixed(2));

  // Protein (total body weight basis)
  const defaultProteinRatio = goal === 'cut' ? 2.2 : goal === 'bulk' ? 2.0 : 1.9;
  const finalProteinRatio = proteinRatioGramsPerKg ?? defaultProteinRatio;
  const proteinGrams = Math.round(weightKg * finalProteinRatio);
  const proteinCals = proteinGrams * 4;

  // Fat: percent of calories, with a grams/day floor
  const finalFatPercent = fatPercentOfCalories ?? 25;
  const fatCals = Math.round(targetCalories * (finalFatPercent / 100));
  const fatFloor = Math.max(40, Math.round(weightKg * 0.6));
  const unflooredFat = Math.round(fatCals / 9);
  const fatFloorApplied = fatFloor > unflooredFat;
  const fatGrams = Math.max(fatFloor, unflooredFat);
  const actualFatCals = fatGrams * 9;

  // Carbs: remainder, with a minimum
  const remainingCals = targetCalories - (proteinCals + actualFatCals);
  const unflooredCarbs = Math.round(remainingCals / 4);
  const carbFloorApplied = unflooredCarbs < CARB_FLOOR_GRAMS;
  const carbsGrams = Math.max(CARB_FLOOR_GRAMS, unflooredCarbs);
  const actualCarbCals = carbsGrams * 4;

  // 4/4/9 reconciliation against the final calorie target
  const macroCalories = proteinCals + actualCarbCals + actualFatCals;
  const macroCalorieMismatch = macroCalories - targetCalories;
  const macrosReconciled = Math.abs(macroCalorieMismatch) <= MACRO_RECONCILE_TOLERANCE_KCAL;

  const warnings: string[] = [];
  if (calorieFloorApplied) {
    const requestedLabel = calorieDelta < 0 ? 'deficit' : calorieDelta > 0 ? 'surplus' : 'adjustment';
    warnings.push(
      `Calorie floor applied: the requested ${Math.abs(calorieDelta)} kcal/day ${requestedLabel} would give ${rawTarget} kcal, so the target is held at ${CALORIE_FLOOR_KCAL} kcal. ` +
        `The actual change versus estimated maintenance is ${signed(Math.round(actualCalorieDelta))} kcal/day (${signed(weeklyDeficitOrSurplus)} kcal/week), not the requested ${signed(calorieDelta)}. ` +
        `The floor is a software safeguard, not a medically validated minimum.`
    );
    if (goal === 'cut' && actualCalorieDelta >= 0) {
      warnings.push('After the floor this target is not below estimated maintenance, so it is not a calorie deficit.');
    }
    if (goal === 'bulk' && actualCalorieDelta <= 0) {
      warnings.push('After the floor this target is not above estimated maintenance, so it is not a calorie surplus.');
    }
  }
  if (!macrosReconciled) {
    const causes: string[] = [];
    if (carbFloorApplied) causes.push(`carbohydrates are held at the ${CARB_FLOOR_GRAMS} g minimum`);
    if (fatFloorApplied) causes.push(`fat is held at the ${fatFloor} g minimum`);
    warnings.push(
      `Macros do not reconcile: protein, carbohydrate and fat add up to ${macroCalories} kcal, ` +
        `${Math.abs(macroCalorieMismatch)} kcal ${macroCalorieMismatch > 0 ? 'above' : 'below'} the ${targetCalories} kcal target` +
        `${causes.length ? ` because ${causes.join(' and ')}` : ''}. ` +
        `Lowering the protein setting or raising calories would bring them closer.`
    );
  }
  const constrained = calorieFloorApplied || !macrosReconciled;

  // Re-normalize percentages on actual macro calories
  const totalMacroCals = proteinCals + actualCarbCals + actualFatCals;
  const proteinPercent = Math.round((proteinCals / totalMacroCals) * 100);
  const fatPercent = Math.round((actualFatCals / totalMacroCals) * 100);
  const carbsPercent = Math.max(0, 100 - (proteinPercent + fatPercent));

  const actualRounded = Math.round(actualCalorieDelta);
  let rationale = '';
  if (calorieFloorApplied) {
    rationale = `Calorie floor applied: target ${targetCalories} kcal/day is ${signed(actualRounded)} kcal/day versus estimated maintenance (${signed(weeklyDeficitOrSurplus)} kcal/week), not the requested ${signed(calorieDelta)}.`;
  } else if (goal === 'cut') {
    rationale = `Targeting a ${Math.abs(actualRounded)} kcal/day deficit (${Math.abs(weeklyDeficitOrSurplus).toLocaleString()} kcal/week), roughly ${Math.abs(estimatedWeeklyWeightChangeKg)} kg/week of scale-weight change (an approximation, not a guaranteed result), with protein at ${finalProteinRatio}g/kg${leanBodyMassKg ? ` / ${(proteinGrams / leanBodyMassKg).toFixed(1)}g per kg LBM` : ''}.`;
  } else if (goal === 'bulk') {
    rationale = `Targeting a ${signed(actualRounded)} kcal/day surplus (${signed(weeklyDeficitOrSurplus)} kcal/week), roughly ${estimatedWeeklyWeightChangeKg} kg/week of scale-weight change (an approximation, not a guaranteed result).`;
  } else {
    rationale = `Targeting estimated energy balance at ${dailyTdee} kcal/day (${weeklyTdee.toLocaleString()} kcal/week) to maintain body weight.`;
  }

  // Never hand back negative or non-finite values
  const outputs = [targetCalories, weeklyTargetCalories, proteinGrams, carbsGrams, fatGrams, macroCalories];
  if (!outputs.every((n) => isFiniteNumber(n) && n >= 0) || !(targetCalories > 0)) {
    throw new RangeError('Calculated targets are not valid');
  }

  return {
    dailyTdee,
    weeklyTdee,
    targetCalories,
    weeklyTargetCalories,
    weeklyDeficitOrSurplus,
    estimatedWeeklyWeightChangeKg,
    goal,
    pace,
    proteinGrams,
    carbsGrams,
    fatGrams,
    proteinPercent,
    carbsPercent,
    fatPercent,
    rationale,
    leanBodyMassKg,
    bodyFatPercentage,
    requestedCalorieDelta: calorieDelta,
    actualCalorieDelta: Math.round(actualCalorieDelta),
    calorieFloorApplied,
    macroCalories,
    macroCalorieMismatch,
    macrosReconciled,
    constrained,
    warnings
  };
}
