import { MuscleGroupRecovery, SystemicRecoveryData, UserProfile, WorkoutPlan, WorkoutSession } from '../types';

// Map common exercises to muscle groups if not explicitly marked
export function inferMuscleGroup(exerciseName: string, explicitMuscle?: string): string {
  if (explicitMuscle && explicitMuscle.trim().length > 0 && explicitMuscle !== 'General') {
    const norm = explicitMuscle.toLowerCase();
    if (norm.includes('chest') || norm.includes('pec')) return 'Chest';
    if (norm.includes('back') || norm.includes('lat') || norm.includes('trap') || norm.includes('rhomboid')) return 'Back / Lats';
    if (norm.includes('quad') || norm.includes('thigh')) return 'Quads';
    if (norm.includes('hamstring') || norm.includes('glute') || norm.includes('posterior')) return 'Hamstrings & Glutes';
    if (norm.includes('shoulder') || norm.includes('delt')) return 'Shoulders';
    if (norm.includes('bicep') || norm.includes('tricep') || norm.includes('arm')) return 'Arms (Biceps & Triceps)';
    if (norm.includes('core') || norm.includes('ab') || norm.includes('erector') || norm.includes('lower back')) return 'Core & Lower Back';
    return explicitMuscle;
  }

  const name = exerciseName.toLowerCase();
  if (name.includes('bench') || name.includes('push-up') || name.includes('fly') || name.includes('pec') || name.includes('dip')) {
    return 'Chest';
  }
  if (name.includes('row') || name.includes('pulldown') || name.includes('pull-up') || name.includes('chin-up') || name.includes('deadlift') || name.includes('lat') || name.includes('shrug')) {
    return 'Back / Lats';
  }
  if (name.includes('squat') || name.includes('leg press') || name.includes('lunge') || name.includes('leg extension') || name.includes('quad')) {
    return 'Quads';
  }
  if (name.includes('romanian') || name.includes('rdl') || name.includes('curl') && name.includes('leg') || name.includes('hip thrust') || name.includes('glute')) {
    return 'Hamstrings & Glutes';
  }
  if (name.includes('overhead') || name.includes('press') && (name.includes('shoulder') || name.includes('military') || name.includes('arnold')) || name.includes('lateral raise') || name.includes('delt')) {
    return 'Shoulders';
  }
  if (name.includes('curl') || name.includes('tricep') || name.includes('skull crusher') || name.includes('pushdown')) {
    return 'Arms (Biceps & Triceps)';
  }
  if (name.includes('plank') || name.includes('crunch') || name.includes('ab') || name.includes('hanging leg') || name.includes('hyper')) {
    return 'Core & Lower Back';
  }

  return 'Chest'; // Fallback
}

const TRACKED_MUSCLE_GROUPS = [
  'Chest',
  'Back / Lats',
  'Quads',
  'Hamstrings & Glutes',
  'Shoulders',
  'Arms (Biceps & Triceps)',
  'Core & Lower Back'
];

/**
 * Calculates evidence-based muscle recovery trends, systemic fatigue, and optimal rest days.
 */
export function calculateLocalRecoveryInsights(
  sessions: WorkoutSession[],
  profile: UserProfile,
  activePlan: WorkoutPlan | null
): SystemicRecoveryData {
  const completedSessions = sessions
    .filter((s) => s.status === 'completed')
    .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

  const now = new Date();
  const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

  // Analyze each muscle group
  const muscleRecovery: MuscleGroupRecovery[] = TRACKED_MUSCLE_GROUPS.map((group) => {
    let lastTrainedTime: number | null = null;
    let lastTrainedDateStr: string | undefined = undefined;
    let totalSets7d = 0;
    const exercisesFound = new Set<string>();

    for (const session of completedSessions) {
      const sessionDate = new Date(session.date);
      let sessionHitGroup = false;

      for (const ex of session.exercises || []) {
        const assignedGroup = inferMuscleGroup(ex.name, ex.muscleGroup);
        if (assignedGroup === group) {
          exercisesFound.add(ex.name);
          const completedWorkingSets = (ex.sets || []).filter((s) => s.completed && s.type !== 'warmup').length;
          if (completedWorkingSets > 0) {
            sessionHitGroup = true;
            if (sessionDate >= sevenDaysAgo) {
              totalSets7d += completedWorkingSets;
            }
          }
        }
      }

      if (sessionHitGroup && lastTrainedTime === null) {
        lastTrainedTime = sessionDate.getTime();
        lastTrainedDateStr = session.date;
      }
    }

    if (lastTrainedTime === null) {
      return {
        muscleGroup: group,
        recoveryPercentage: 100,
        status: 'fresh',
        hoursSinceLastTrained: undefined,
        totalSetsLast7Days: 0,
        recoveryTrend: 'stable',
        recoveryHoursRemaining: 0,
        exercisesTrained: []
      };
    }

    const hoursSince = Math.max(1, Math.round((now.getTime() - lastTrainedTime) / (1000 * 60 * 60)));
    // Standard recovery window is 48-72 hours depending on volume
    const fullRecoveryWindow = totalSets7d > 12 ? 72 : totalSets7d > 6 ? 60 : 48;
    const recoveryFraction = Math.min(1, hoursSince / fullRecoveryWindow);
    const recoveryPercentage = Math.round(recoveryFraction * 100);

    const hoursRemaining = Math.max(0, fullRecoveryWindow - hoursSince);
    const status: 'fresh' | 'recovering' | 'fatigued' =
      recoveryPercentage >= 85 ? 'fresh' : recoveryPercentage >= 45 ? 'recovering' : 'fatigued';

    const recoveryTrend: 'improving' | 'stable' | 'needs_rest' =
      status === 'fatigued' ? 'needs_rest' : status === 'recovering' ? 'improving' : 'stable';

    return {
      muscleGroup: group,
      recoveryPercentage,
      status,
      lastTrainedDate: lastTrainedDateStr,
      hoursSinceLastTrained: hoursSince,
      totalSetsLast7Days: totalSets7d,
      recoveryTrend,
      recoveryHoursRemaining: hoursRemaining,
      exercisesTrained: Array.from(exercisesFound)
    };
  });

  // Calculate Systemic Fatigue
  const recentSessions7d = completedSessions.filter((s) => new Date(s.date) >= sevenDaysAgo);
  const totalVolume7d = recentSessions7d.reduce((sum, s) => {
    return (
      sum +
      (s.exercises || []).reduce((eSum, e) => {
        return (
          eSum +
          (e.sets || []).reduce((sSum, st) => {
            if (!st.completed) return sSum;
            return sSum + (st.weight || 0) * (st.reps || 0);
          }, 0)
        );
      }, 0)
    );
  }, 0);

  // Check consecutive days trained
  let consecutiveDays = 0;
  const checkDate = new Date();
  for (let i = 0; i < 7; i++) {
    const dStr = checkDate.toISOString().split('T')[0];
    const hasWorkout = completedSessions.some((s) => s.date.startsWith(dStr));
    if (hasWorkout) {
      consecutiveDays++;
      checkDate.setDate(checkDate.getDate() - 1);
    } else {
      break;
    }
  }

  const daysPerWeek = profile.trainingDaysPerWeek || 4;
  const sessionsThisWeek = recentSessions7d.length;

  let systemicFatigueScore = 20; // baseline
  if (consecutiveDays >= 3) systemicFatigueScore += 35;
  else if (consecutiveDays >= 2) systemicFatigueScore += 20;

  if (sessionsThisWeek >= daysPerWeek) systemicFatigueScore += 25;
  if (totalVolume7d > 25000) systemicFatigueScore += 20;
  else if (totalVolume7d > 15000) systemicFatigueScore += 10;

  systemicFatigueScore = Math.min(100, Math.max(5, systemicFatigueScore));

  const systemicFatigueLevel: 'Low' | 'Optimal' | 'Elevated' | 'High' =
    systemicFatigueScore < 30
      ? 'Low'
      : systemicFatigueScore < 60
      ? 'Optimal'
      : systemicFatigueScore < 80
      ? 'Elevated'
      : 'High';

  const overallReadiness = Math.round(100 - systemicFatigueScore * 0.7);

  // Optimal Rest Days
  const daysOfWeek = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const todayDayName = daysOfWeek[now.getDay()];

  // Recommended rest days based on frequency
  let recommendedRestDays: string[] = [];
  if (daysPerWeek <= 3) {
    recommendedRestDays = ['Tuesday', 'Thursday', 'Saturday', 'Sunday'];
  } else if (daysPerWeek === 4) {
    recommendedRestDays = ['Wednesday', 'Saturday', 'Sunday'];
  } else if (daysPerWeek === 5) {
    recommendedRestDays = ['Thursday', 'Sunday'];
  } else {
    recommendedRestDays = ['Sunday'];
  }

  const isRestRecommendedToday =
    consecutiveDays >= 3 ||
    (systemicFatigueScore >= 70 && consecutiveDays >= 2) ||
    recommendedRestDays.includes(todayDayName);

  let todayAdvice = '';
  if (isRestRecommendedToday) {
    todayAdvice = `Optimal Rest Day (${todayDayName}) — Prioritize sleep, light active recovery walking, and ${profile.dailyProteinTarget || 160}g protein to consolidate muscle tissue adaptations.`;
  } else {
    todayAdvice = `Readiness is ${overallReadiness}% (${systemicFatigueLevel} fatigue) — Fully primed for a high-intensity session with progressive overload.`;
  }

  const rationale = `Based on your ${daysPerWeek}-day target split, ${consecutiveDays} consecutive training days, and ${sessionsThisWeek} sessions completed over the last 7 days. Muscle protein synthesis peaks 24-36h post-workout, requiring designated non-lifting rest periods for CNS recovery and joint deloading.`;

  // Suggested next workout based on muscle group freshness
  let suggestedNextWorkout: { splitDay: string; reasoning: string } | undefined;
  if (activePlan && activePlan.days && activePlan.days.length > 0) {
    // Pick the plan day whose exercises have the highest average recovery percentage
    let bestDay = activePlan.days[0];
    let bestScore = -1;

    for (const day of activePlan.days) {
      let dayRecoverySum = 0;
      let count = 0;
      for (const ex of day.exercises || []) {
        const group = inferMuscleGroup(ex.name, ex.muscleGroup);
        const rec = muscleRecovery.find((m) => m.muscleGroup === group);
        dayRecoverySum += rec ? rec.recoveryPercentage : 100;
        count++;
      }
      const avg = count > 0 ? dayRecoverySum / count : 100;
      if (avg > bestScore) {
        bestScore = avg;
        bestDay = day;
      }
    }

    suggestedNextWorkout = {
      splitDay: bestDay.dayName,
      reasoning: `Targeted muscles (${bestDay.exercises?.slice(0, 3).map((e) => inferMuscleGroup(e.name, e.muscleGroup)).join(', ')}) average ${Math.round(bestScore)}% recovery readiness.`
    };
  }

  const headline = isRestRecommendedToday
    ? 'Muscle Recovery In Progress — Strategic Rest Day Recommended'
    : `Systemic Readiness at ${overallReadiness}% — Primed for Performance`;

  const recoveryTips = [
    `Ensure 1.6-2.2g of protein per kg of bodyweight (${profile.dailyProteinTarget || 160}g) to support myofibrillar repair.`,
    'Aim for 7-9 hours of consolidated sleep to maximize growth hormone release and CNS restoration.',
    'Hydrate with electrolytes and engage in 15-20 minutes of zone-1 walking or soft tissue mobility on rest days.'
  ];

  return {
    systemicFatigueScore,
    systemicFatigueLevel,
    overallReadiness,
    headline,
    muscleRecovery,
    optimalRestDays: {
      recommendedRestDays,
      isRestRecommendedToday,
      todayAdvice,
      rationale
    },
    suggestedNextWorkout,
    recoveryTips,
    lastCalculated: new Date().toISOString()
  };
}
