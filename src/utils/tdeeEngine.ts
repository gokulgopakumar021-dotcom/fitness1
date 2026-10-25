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
