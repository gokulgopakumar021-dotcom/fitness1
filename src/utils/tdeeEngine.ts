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
}

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

/**
 * Computes calibrated calories and macros for Cut, Maintain, and Bulk goals
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

  // Lean body mass if body fat percentage is valid
  const leanBodyMassKg =
    typeof bodyFatPercentage === 'number' && bodyFatPercentage >= 3 && bodyFatPercentage <= 60
      ? Number((weightKg * (1 - bodyFatPercentage / 100)).toFixed(1))
      : undefined;

  // Calorie Delta
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
  } else {
    calorieDelta = 0; // maintain
  }

  // Target calories with physiological lower safety floor
  const rawTarget = dailyTdee + calorieDelta;
  const targetCalories = Math.max(1200, Math.round(rawTarget));
  const weeklyTargetCalories = targetCalories * 7;
  const weeklyTdee = dailyTdee * 7;
  const weeklyDeficitOrSurplus = weeklyTargetCalories - weeklyTdee;

  // 1 kg of adipose/tissue tissue flux ≈ 7,700 kcal
  const estimatedWeeklyWeightChangeKg = Number((weeklyDeficitOrSurplus / 7700).toFixed(2));

  // Protein calculation
  const defaultProteinRatio = goal === 'cut' ? 2.2 : goal === 'bulk' ? 2.0 : 1.9;
  const finalProteinRatio = proteinRatioGramsPerKg || defaultProteinRatio;
  const proteinGrams = Math.round(weightKg * finalProteinRatio);
  const proteinCals = proteinGrams * 4;

  // Fat calculation (default 25% of calories or custom)
  const finalFatPercent = fatPercentOfCalories !== undefined ? fatPercentOfCalories : 25;
  const fatCals = Math.round(targetCalories * (finalFatPercent / 100));
  // Keep fat at least 45g or 0.6g/kg for endocrine health
  const fatFloor = Math.max(40, Math.round(weightKg * 0.6));
  const fatGrams = Math.max(fatFloor, Math.round(fatCals / 9));
  const actualFatCals = fatGrams * 9;

  // Carbs = Remaining calories
  const remainingCals = targetCalories - (proteinCals + actualFatCals);
  const carbsGrams = Math.max(50, Math.round(remainingCals / 4));
  const actualCarbCals = carbsGrams * 4;

  // Re-normalize exact percentages based on actual macronutrient calories
  const totalMacroCals = proteinCals + actualCarbCals + actualFatCals;
  const proteinPercent = Math.round((proteinCals / totalMacroCals) * 100);
  const fatPercent = Math.round((actualFatCals / totalMacroCals) * 100);
  const carbsPercent = Math.max(0, 100 - (proteinPercent + fatPercent));

  let rationale = '';
  if (goal === 'cut') {
    rationale = `Targeting a ${Math.abs(calorieDelta)} kcal/day deficit (${Math.abs(weeklyDeficitOrSurplus).toLocaleString()} kcal/week) for an estimated ~${Math.abs(estimatedWeeklyWeightChangeKg)} kg/week fat reduction while holding protein high (${finalProteinRatio}g/kg${leanBodyMassKg ? ` / ${(proteinGrams / leanBodyMassKg).toFixed(1)}g per kg LBM` : ''}) to safeguard muscle tissue.`;
  } else if (goal === 'bulk') {
    rationale = `Targeting a controlled +${calorieDelta} kcal/day surplus (+${weeklyDeficitOrSurplus.toLocaleString()} kcal/week) to maximize lean myofibrillar hypertrophy while keeping adipose accumulation minimal.`;
  } else {
    rationale = `Targeting exact energy balance at ${dailyTdee} kcal/day (${weeklyTdee.toLocaleString()} kcal/week) to maintain body mass, optimize glycogen replenishment, and elevate gym training output.`;
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
    bodyFatPercentage
  };
}

