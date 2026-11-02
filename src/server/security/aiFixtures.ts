/** Valid model outputs, one per validated route. Shared by security.test.ts and aiSchemas.test.ts. */
const planDays = [
  { dayName: 'Day 1', exercises: [{ name: 'Bench Press', muscleGroup: 'Chest', equipment: 'barbell', workingSets: 3, repRange: '8-12', targetRir: 2, restSeconds: 90, tempo: '3-0-1-0', notes: 'Retract scapulae' }] }
];

export const aiFixtures = {
  generatePlan: { planName: 'P', trainingSplit: 'PPL', description: 'A plan', days: planDays },
  exerciseCoach: {
    cues: ['Brace', 'Drive through the floor', 'Control the descent'],
    warmupProtocol: ['Set 1: Bar x 10'],
    substitutions: [{ name: 'Dumbbell Press', equipment: 'dumbbell', reason: 'Station occupied' }],
    coachTip: 'Add a rep before adding load.'
  },
  generateAiRoutine: {
    routineName: 'Adaptive Push',
    targetSplit: 'Push',
    durationMinutes: 55,
    summaryRationale: 'Chest is fresh.',
    targetedMuscles: ['Chest'],
    restedMuscles: ['Back'],
    exercises: [
      { name: 'Bench Press', muscleGroup: 'Chest', muscleRegionId: 'chest', equipment: 'barbell', workingSets: 3, repRange: '6-8', targetRir: 2, restSeconds: 120, tempo: '3-0-1-0', notes: 'cue', fatigueRationale: 'Fresh pecs', substitutes: [{ name: 'DB Press', equipment: 'dumbbell', reason: 'busy' }] }
    ]
  },
  foodParser: { items: [{ name: 'Whole Egg', quantity: 2, servingUnit: 'egg', calories: 140, protein: 12, carbs: 1, fat: 10, fiber: 0 }] },
  workoutInsights: { headline: 'Strong push day', volumeTakeaway: 'Volume up 5%', fatigueAssessment: 'RIR held', nextSessionAction: 'Add 2.5kg', recoveryAdvice: 'Eat protein' },
  planOverloadTuning: {
    planStrategySummary: 'Double progression',
    recommendedPhase: 'hypertrophy',
    exerciseCalibrations: [{ exerciseName: 'Bench Press', recommendedRepRange: '6-8', recommendedWorkingSets: 3, recommendedRir: 2, recommendedStrategy: 'double_progression', recommendedIncrement: 2.5, rationale: 'Compound' }]
  },
  nutritionCoach: { dailyCalories: 2800, proteinGrams: 170, carbGrams: 330, fatGrams: 80, proteinPerKg: 2.1, tdeeEstimate: 2600, strategyRationale: 'Lean surplus' },
  recoveryInsights: {
    systemicFatigueScore: 40,
    systemicFatigueLevel: 'Optimal',
    overallReadiness: 70,
    headline: 'Ready to train',
    muscleRecovery: [{ muscleGroup: 'Chest', recoveryPercentage: 80, status: 'fresh', hoursSinceLastTrained: 72, totalSetsLast7Days: 9, recoveryTrend: 'improving', recoveryHoursRemaining: 0, exercisesTrained: ['Bench Press'] }],
    optimalRestDays: { recommendedRestDays: ['Sunday'], isRestRecommendedToday: false, todayAdvice: 'Train', rationale: 'Recovered' },
    suggestedNextWorkout: { splitDay: 'Push', reasoning: 'Fresh chest' },
    recoveryTips: ['Sleep 8h']
  },
  warmupGenerator: {
    routineName: 'Push warm-up',
    totalDurationSeconds: 300,
    targetMuscles: ['Chest'],
    coachTip: 'Move with intent',
    phases: [{ phase: 'Raise', name: 'Jumping jacks', durationSeconds: 60, purpose: 'Raise HR', cues: ['Light feet'], musclesTargeted: ['Full body'] }]
  },
  physiqueBlueprint: {
    gapAnalysis: { currentStatsSummary: '75kg', targetStatsSummary: '10% BF', bodyCompositionVerdict: 'Recomp', estTimelineWeeks: '16-20 weeks', keyFocusAreas: ['Shoulders'] },
    nutritionPlan: {
      calorieTarget: 2500,
      strategy: 'Slight surplus',
      macros: { proteinGrams: 165, proteinPerKg: '2.2', carbsGrams: 280, fatsGrams: 70, hydrationLiters: 3 },
      nutrientTiming: ['Protein every 4h'],
      sampleMealPlan: [{ meal: 'Breakfast', foods: 'Eggs, oats', calories: 600, protein: 40 }],
      recommendedSupplements: ['Creatine']
    },
    workoutPlan: { planName: 'Plan', trainingSplit: 'PPL', description: 'd', days: planDays },
    coachMessage: 'Keep going.'
  }
} as const;

/**
 * One object that satisfies every route's schema at once (keys do not conflict). Used as the default Gemini mock so
 * tests about auth/quota/prompting are not coupled to a particular route's output shape. Unknown keys are dropped.
 */
export const UNIVERSAL_MODEL_OUTPUT = Object.assign({}, ...Object.values(aiFixtures)) as Record<string, unknown>;
