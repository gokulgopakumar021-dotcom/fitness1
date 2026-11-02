/** Request payloads shaped like the ones the real clients send, one per AI route. Shared by the security test files. */
import { buildCoachingContext } from '../../utils/adaptiveCoach/context';
import { DEFAULT_PROFILE } from '../../storage/db';

const realContext = buildCoachingContext({
  profile: DEFAULT_PROFILE,
  plans: [{ id: 'p1', name: 'PP', trainingSplit: 'PP', createdAt: '2026-09-01T00:00:00.000Z', updatedAt: '2026-09-01T00:00:00.000Z', isActive: true, days: [{ id: 'd1', dayName: 'Push', dayOrder: 1, exercises: [{ id: 'e1', name: 'Barbell Bench Press', muscleGroup: 'Chest', equipment: 'barbell', workingSets: 3, repRange: '8-12', targetRir: 2, restSeconds: 90, notes: '' }] }] }],
  activePlanId: 'p1',
  sessions: [],
  activeSession: null,
  sleepLogs: [],
  now: new Date('2026-10-25T10:00:00.000Z')
});

// Payloads shaped like the ones the real clients send.
export const VALID: Record<string, unknown> = {
  'POST /extract-plan': { text: 'Day 1: Bench 3x8' },
  'POST /generate-plan': { goal: 'Hypertrophy', split: 'PPL', daysPerWeek: 4, equipment: 'Full gym', experience: 'Intermediate', injuries: 'None', specialRequests: '' },
  'POST /exercise-coach': { exerciseName: 'Bench Press', equipment: 'barbell', targetReps: '8-12', targetRir: 2, notes: '' },
  'POST /generate-ai-routine': { muscleRecoveryData: [{ label: 'Chest', recoveryStatus: 'recovered', setsPast7Days: 6, daysSinceLastTrained: null }], availableEquipment: ['barbell'], recentEquipmentUsed: [], equipmentNotes: '', trainingSplitFocus: 'Push', sessionDurationMinutes: 60, targetExerciseCount: 6, experienceLevel: 'Intermediate', primaryGoal: 'Muscle Gain', injuriesOrDeload: '' },
  'POST /ai-food-parser': { query: '2 eggs and toast', mealCategory: 'breakfast' },
  'POST /ai-workout-insights': { session: { dayName: 'Push', date: '2026-10-01', exercises: [] }, profile: { name: 'A' } },
  'POST /ai-plan-overload-tuning': { plan: { name: 'PPL', trainingSplit: 'PPL', days: [] }, profile: { preferredUnit: 'kg' }, historySummary: 'Completed sessions logged: 3.' },
  'POST /ai-nutrition-coach': { profile: { age: 30, heightCm: 180 }, recentWeightTrend: [80, 79.5] },
  'POST /ai-recovery-insights': { sessions: [], profile: { name: 'A' }, activePlan: { name: 'PPL' } },
  'POST /ai-personal-trainer': { messages: [{ role: 'user', text: 'hi' }, { role: 'model', text: 'hello' }], userMessage: 'how deep should I squat?', profile: { name: 'A' }, activeSession: null, bluetooth: { isConnected: false }, mirrorInsights: [] },
  'POST /adaptive-coach/explain': { context: realContext },
  'POST /ai-form-analyzer': { exerciseName: 'Squat', userQuestion: 'knees?', experience: 'Beginner', goal: 'Strength' },
  'POST /ai-warmup-generator': { muscleGroups: ['Chest'], exercises: ['Bench Press'], workoutName: 'Push', intensity: 'moderate' },
  'POST /ai-generate-physique': { archetype: 'v_taper', gender: 'male', targetBodyFat: 10, customPrompt: '', muscleEmphasis: ['Lats'] },
  'POST /ai-physique-analysis': { dreamPhysique: { archetype: 'v_taper', title: 'x' }, currentProfile: { name: 'A' } }
};
