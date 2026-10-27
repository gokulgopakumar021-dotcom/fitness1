import {
  BodyMetricEntry,
  DailyNutritionLog,
  DailySleepLog,
  FoodItem,
  ProgressiveOverloadRecommendation,
  UploadedDoc,
  UserProfile,
  WorkoutPlan,
  WorkoutSession
} from '../types';
import { STARTER_PPL_PLAN, STARTER_UPPER_LOWER_PLAN } from '../data/starterPlans';
import { COMMON_FOOD_DATABASE } from '../data/foodDatabase';

const STORAGE_KEYS = {
  PROFILE: 'ironlog_profile_v1',
  PLANS: 'ironlog_plans_v1',
  ACTIVE_PLAN_ID: 'ironlog_active_plan_id_v1',
  SESSIONS: 'ironlog_sessions_v1',
  ACTIVE_SESSION: 'ironlog_active_session_v1',
  NUTRITION_LOGS: 'ironlog_nutrition_logs_v1',
  CUSTOM_FOODS: 'ironlog_custom_foods_v1',
  BODY_METRICS: 'ironlog_body_metrics_v1',
  RECOMMENDATIONS: 'ironlog_recommendations_v1',
  UPLOADED_DOCS: 'ironlog_uploaded_docs_v1',
  DEMO_MODE: 'ironlog_demo_mode_active_v1',
  SLEEP_LOGS: 'ironlog_sleep_logs_v1',
};

export const DEFAULT_PROFILE: UserProfile = {
  name: '',
  age: 26,
  sex: 'unspecified',
  heightCm: 178,
  currentWeightKg: 78.5,
  goalWeightKg: 82.0,
  primaryGoal: 'muscle_gain',
  trainingExperience: 'intermediate',
  trainingDaysPerWeek: 4,
  preferredUnit: 'kg',
  dailyCalorieTarget: 2600,
  dailyProteinTarget: 165,
  dailyCarbsTarget: 300,
  dailyFatTarget: 65,
  trainingSplitName: 'Push / Pull / Legs',
  trainingPhase: 'hypertrophy',
  defaultTargetRir: 2,
  minBarbellIncrement: 2.5,
  minDumbbellIncrement: 2.0,
  minMachineIncrement: 2.5,
  excludeWarmupFromVolume: true,
  onboardingCompleted: false
};

class IronLogDB {
  // --- Profile ---
  getProfile(): UserProfile {
    try {
      const data = localStorage.getItem(STORAGE_KEYS.PROFILE);
      if (data) return JSON.parse(data);
    } catch (e) {
      console.error('Failed reading profile', e);
    }
    return { ...DEFAULT_PROFILE };
  }

  /** Returns true only when the write actually succeeded. */
  saveProfile(profile: UserProfile): boolean {
    try {
      localStorage.setItem(STORAGE_KEYS.PROFILE, JSON.stringify(profile));
      return true;
    } catch (e) {
      console.error('Failed saving profile', e);
      return false;
    }
  }

  // --- Plans ---
  getPlans(): WorkoutPlan[] {
    try {
      const data = localStorage.getItem(STORAGE_KEYS.PLANS);
      if (data) {
        const parsed = JSON.parse(data);
        if (Array.isArray(parsed) && parsed.length > 0) return parsed;
      }
    } catch (e) {
      console.error('Failed reading plans', e);
    }
    // Return starter templates by default
    const starters = [{ ...STARTER_PPL_PLAN }, { ...STARTER_UPPER_LOWER_PLAN }];
    this.savePlans(starters);
    return starters;
  }

  savePlans(plans: WorkoutPlan[]): void {
    try {
      localStorage.setItem(STORAGE_KEYS.PLANS, JSON.stringify(plans));
    } catch (e) {
      console.error('Failed saving plans', e);
    }
  }

  getActivePlanId(): string | null {
    return localStorage.getItem(STORAGE_KEYS.ACTIVE_PLAN_ID);
  }

  setActivePlanId(id: string | null): void {
    if (id) {
      localStorage.setItem(STORAGE_KEYS.ACTIVE_PLAN_ID, id);
    } else {
      localStorage.removeItem(STORAGE_KEYS.ACTIVE_PLAN_ID);
    }
  }

  // --- Workout Sessions ---
  getSessions(): WorkoutSession[] {
    try {
      const data = localStorage.getItem(STORAGE_KEYS.SESSIONS);
      if (data) {
        const parsed = JSON.parse(data);
        if (Array.isArray(parsed)) return parsed;
      }
    } catch (e) {
      console.error('Failed reading sessions', e);
    }
    return [];
  }

  saveSessions(sessions: WorkoutSession[]): void {
    try {
      localStorage.setItem(STORAGE_KEYS.SESSIONS, JSON.stringify(sessions));
    } catch (e) {
      console.error('Failed saving sessions', e);
    }
  }

  addOrUpdateSession(session: WorkoutSession): void {
    const list = this.getSessions();
    const index = list.findIndex((s) => s.id === session.id);
    if (index >= 0) {
      list[index] = session;
    } else {
      list.push(session);
    }
    this.saveSessions(list);
  }

  deleteSession(sessionId: string): void {
    const list = this.getSessions().filter((s) => s.id !== sessionId);
    this.saveSessions(list);
  }

  // Active (in-progress) session preservation
  getActiveSession(): WorkoutSession | null {
    try {
      const data = localStorage.getItem(STORAGE_KEYS.ACTIVE_SESSION);
      if (data) return JSON.parse(data);
    } catch (e) {
      console.error('Failed reading active session', e);
    }
    return null;
  }

  saveActiveSession(session: WorkoutSession | null): void {
    try {
      if (session) {
        localStorage.setItem(STORAGE_KEYS.ACTIVE_SESSION, JSON.stringify(session));
      } else {
        localStorage.removeItem(STORAGE_KEYS.ACTIVE_SESSION);
      }
    } catch (e) {
      console.error('Failed saving active session', e);
    }
  }

  // --- Nutrition Logs ---
  getNutritionLogs(): DailyNutritionLog[] {
    try {
      const data = localStorage.getItem(STORAGE_KEYS.NUTRITION_LOGS);
      if (data) return JSON.parse(data);
    } catch (e) {
      console.error('Failed reading nutrition logs', e);
    }
    return [];
  }

  /** Returns true only when the write actually succeeded. */
  saveNutritionLogs(logs: DailyNutritionLog[]): boolean {
    try {
      localStorage.setItem(STORAGE_KEYS.NUTRITION_LOGS, JSON.stringify(logs));
      return true;
    } catch (e) {
      console.error('Failed saving nutrition logs', e);
      return false;
    }
  }

  getNutritionLogForDate(dateStr: string): DailyNutritionLog {
    const logs = this.getNutritionLogs();
    const existing = logs.find((l) => l.date === dateStr);
    if (existing) return existing;

    const profile = this.getProfile();
    return {
      id: `nutr-${dateStr}`,
      date: dateStr,
      entries: [],
      waterMl: 0,
      targetCalories: profile.dailyCalorieTarget || 2600,
      targetProtein: profile.dailyProteinTarget || 165,
      targetCarbs: profile.dailyCarbsTarget || 300,
      targetFat: profile.dailyFatTarget || 65
    };
  }

  /** Returns true only when the write actually succeeded. */
  saveNutritionLogForDate(log: DailyNutritionLog): boolean {
    const logs = this.getNutritionLogs();
    const idx = logs.findIndex((l) => l.date === log.date);
    if (idx >= 0) {
      logs[idx] = log;
    } else {
      logs.push(log);
    }
    return this.saveNutritionLogs(logs);
  }

  // --- Custom Foods ---
  getCustomFoods(): FoodItem[] {
    try {
      const data = localStorage.getItem(STORAGE_KEYS.CUSTOM_FOODS);
      if (data) return JSON.parse(data);
    } catch (e) {
      console.error('Failed reading custom foods', e);
    }
    return [];
  }

  saveCustomFoods(foods: FoodItem[]): void {
    try {
      localStorage.setItem(STORAGE_KEYS.CUSTOM_FOODS, JSON.stringify(foods));
    } catch (e) {
      console.error('Failed saving custom foods', e);
    }
  }

  getAllFoods(): FoodItem[] {
    return [...COMMON_FOOD_DATABASE, ...this.getCustomFoods()];
  }

  // --- Body Metrics ---
  getBodyMetrics(): BodyMetricEntry[] {
    try {
      const data = localStorage.getItem(STORAGE_KEYS.BODY_METRICS);
      if (data) {
        const parsed = JSON.parse(data);
        if (Array.isArray(parsed)) {
          return parsed.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
        }
      }
    } catch (e) {
      console.error('Failed reading body metrics', e);
    }
    return [];
  }

  /** Returns true only when the write actually succeeded. */
  saveBodyMetrics(metrics: BodyMetricEntry[]): boolean {
    try {
      localStorage.setItem(STORAGE_KEYS.BODY_METRICS, JSON.stringify(metrics));
      return true;
    } catch (e) {
      console.error('Failed saving body metrics', e);
      return false;
    }
  }

  /**
   * One record per date. An update to an existing same-day record is merged:
   * - the existing id is kept;
   * - fields the new entry leaves undefined (waist, notes, body fat, ...) keep their stored values,
   *   so a blank optional input never erases a stored measurement (no UI currently clears a single
   *   field; delete the entry with deleteBodyMetric instead);
   * - a real entry replaces a same-day demo record outright rather than inheriting its fabricated
   *   fields, and a demo entry never overwrites a real record.
   * Returns true only when the write actually succeeded.
   */
  addOrUpdateBodyMetric(entry: BodyMetricEntry): boolean {
    const list = this.getBodyMetrics();
    const idx = list.findIndex((m) => m.date === entry.date);
    let next: BodyMetricEntry[];
    if (idx < 0) {
      next = [...list, entry];
    } else {
      const existing = list[idx];
      let merged: BodyMetricEntry;
      if (existing.isDemo && !entry.isDemo) {
        merged = entry;
      } else if (!existing.isDemo && entry.isDemo) {
        return true; // real data wins; nothing to write
      } else {
        merged = { ...existing };
        (Object.keys(entry) as (keyof BodyMetricEntry)[]).forEach((k) => {
          if (entry[k] !== undefined) {
            (merged as unknown as Record<string, unknown>)[k] = entry[k];
          }
        });
        merged.id = existing.id;
      }
      next = list.map((m, i) => (i === idx ? merged : m));
    }
    next = [...next].sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
    return this.saveBodyMetrics(next);
  }

  deleteBodyMetric(id: string): void {
    const list = this.getBodyMetrics().filter((m) => m.id !== id);
    this.saveBodyMetrics(list);
  }

  // --- Sleep & Recovery Logs ---
  getSleepLogs(): DailySleepLog[] {
    try {
      const data = localStorage.getItem(STORAGE_KEYS.SLEEP_LOGS);
      if (data) {
        const parsed = JSON.parse(data);
        if (Array.isArray(parsed)) {
          return parsed.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
        }
      }
    } catch (e) {
      console.error('Failed reading sleep logs', e);
    }
    return [];
  }

  saveSleepLogs(logs: DailySleepLog[]): void {
    try {
      localStorage.setItem(STORAGE_KEYS.SLEEP_LOGS, JSON.stringify(logs));
    } catch (e) {
      console.error('Failed saving sleep logs', e);
    }
  }

  getSleepLogForDate(dateStr: string): DailySleepLog | null {
    const logs = this.getSleepLogs();
    return logs.find((l) => l.date === dateStr) || null;
  }

  saveSleepLog(entry: DailySleepLog): void {
    const list = this.getSleepLogs();
    const idx = list.findIndex((l) => l.date === entry.date);
    if (idx >= 0) {
      list[idx] = entry;
    } else {
      list.push(entry);
    }
    list.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
    this.saveSleepLogs(list);
  }

  deleteSleepLog(id: string): void {
    const list = this.getSleepLogs().filter((l) => l.id !== id);
    this.saveSleepLogs(list);
  }

  // --- Uploaded Docs ---
  getUploadedDocs(): UploadedDoc[] {
    try {
      const data = localStorage.getItem(STORAGE_KEYS.UPLOADED_DOCS);
      if (data) return JSON.parse(data);
    } catch (e) {
      console.error('Failed reading uploaded docs', e);
    }
    return [];
  }

  saveUploadedDocs(docs: UploadedDoc[]): void {
    try {
      localStorage.setItem(STORAGE_KEYS.UPLOADED_DOCS, JSON.stringify(docs));
    } catch (e) {
      console.error('Failed saving uploaded docs', e);
    }
  }

  addUploadedDoc(doc: UploadedDoc): void {
    const docs = this.getUploadedDocs();
    docs.unshift(doc);
    this.saveUploadedDocs(docs);
  }

  deleteUploadedDoc(id: string): void {
    const docs = this.getUploadedDocs().filter((d) => d.id !== id);
    this.saveUploadedDocs(docs);
  }

  // --- Recommendations Log ---
  getRecommendations(): ProgressiveOverloadRecommendation[] {
    try {
      const data = localStorage.getItem(STORAGE_KEYS.RECOMMENDATIONS);
      if (data) return JSON.parse(data);
    } catch (e) {
      console.error('Failed reading recommendations', e);
    }
    return [];
  }

  saveRecommendations(recs: ProgressiveOverloadRecommendation[]): void {
    try {
      localStorage.setItem(STORAGE_KEYS.RECOMMENDATIONS, JSON.stringify(recs));
    } catch (e) {
      console.error('Failed saving recommendations', e);
    }
  }

  recordRecommendationDecision(
    recId: string,
    action: 'accepted' | 'modified' | 'rejected',
    chosenWeight?: number,
    chosenRepTarget?: string
  ): void {
    const recs = this.getRecommendations();
    const idx = recs.findIndex((r) => r.id === recId);
    if (idx >= 0) {
      recs[idx].userAction = action;
      recs[idx].chosenWeight = chosenWeight;
      recs[idx].chosenRepTarget = chosenRepTarget;
      this.saveRecommendations(recs);
    }
  }

  // --- Demo Mode Status ---
  isDemoModeActive(): boolean {
    return localStorage.getItem(STORAGE_KEYS.DEMO_MODE) === 'true';
  }

  setDemoModeActive(active: boolean): void {
    localStorage.setItem(STORAGE_KEYS.DEMO_MODE, active ? 'true' : 'false');
  }

  loadDemoData(): void {
    this.setDemoModeActive(true);

    // Seed realistic 3-week progressive training history clearly labeled as demo
    const demoSessions: WorkoutSession[] = [
      // Week 1 Push A
      {
        id: 'demo-s1',
        isDemo: true,
        dayName: 'Day 1 — Push A',
        date: '2026-09-24',
        startTime: '2026-09-24T17:30:00Z',
        endTime: '2026-09-24T18:45:00Z',
        status: 'completed',
        notes: 'Good session, focusing on chest drive.',
        exercises: [
          {
            id: 'de-1',
            name: 'Barbell Bench Press',
            muscleGroup: 'Chest',
            equipment: 'barbell',
            repRange: '8-12',
            targetRir: 2,
            restSeconds: 120,
            sets: [
              { id: 'ds-1', setNumber: 1, type: 'warmup', weight: 40, reps: 10, completed: true, timestamp: '' },
              { id: 'ds-2', setNumber: 2, type: 'working', weight: 80, reps: 10, rir: 2, completed: true, timestamp: '' },
              { id: 'ds-3', setNumber: 3, type: 'working', weight: 80, reps: 9, rir: 2, completed: true, timestamp: '' },
              { id: 'ds-4', setNumber: 4, type: 'working', weight: 80, reps: 8, rir: 1, completed: true, timestamp: '' },
            ]
          },
          {
            id: 'de-2',
            name: 'Incline Dumbbell Press',
            muscleGroup: 'Chest',
            equipment: 'dumbbell',
            repRange: '8-12',
            targetRir: 2,
            restSeconds: 90,
            sets: [
              { id: 'ds-5', setNumber: 1, type: 'working', weight: 26, reps: 10, rir: 2, completed: true, timestamp: '' },
              { id: 'ds-6', setNumber: 2, type: 'working', weight: 26, reps: 9, rir: 2, completed: true, timestamp: '' },
              { id: 'ds-7', setNumber: 3, type: 'working', weight: 26, reps: 8, rir: 2, completed: true, timestamp: '' },
            ]
          },
          {
            id: 'de-3',
            name: 'Standing Overhead Barbell Press',
            muscleGroup: 'Shoulders',
            equipment: 'barbell',
            repRange: '6-10',
            targetRir: 2,
            restSeconds: 120,
            sets: [
              { id: 'ds-8', setNumber: 1, type: 'working', weight: 45, reps: 8, rir: 2, completed: true, timestamp: '' },
              { id: 'ds-9', setNumber: 2, type: 'working', weight: 45, reps: 7, rir: 2, completed: true, timestamp: '' },
              { id: 'ds-10', setNumber: 3, type: 'working', weight: 45, reps: 6, rir: 1, completed: true, timestamp: '' },
            ]
          }
        ]
      },
      // Week 2 Push A (Progressing reps)
      {
        id: 'demo-s2',
        isDemo: true,
        dayName: 'Day 1 — Push A',
        date: '2026-10-01',
        startTime: '2026-10-01T17:30:00Z',
        endTime: '2026-10-01T18:40:00Z',
        status: 'completed',
        notes: 'Felt strong on bench, added reps across all 3 working sets.',
        exercises: [
          {
            id: 'de-4',
            name: 'Barbell Bench Press',
            muscleGroup: 'Chest',
            equipment: 'barbell',
            repRange: '8-12',
            targetRir: 2,
            restSeconds: 120,
            sets: [
              { id: 'ds-11', setNumber: 1, type: 'warmup', weight: 40, reps: 10, completed: true, timestamp: '' },
              { id: 'ds-12', setNumber: 2, type: 'working', weight: 80, reps: 11, rir: 2, completed: true, timestamp: '' },
              { id: 'ds-13', setNumber: 3, type: 'working', weight: 80, reps: 11, rir: 2, completed: true, timestamp: '' },
              { id: 'ds-14', setNumber: 4, type: 'working', weight: 80, reps: 10, rir: 2, completed: true, timestamp: '' },
            ]
          },
          {
            id: 'de-5',
            name: 'Incline Dumbbell Press',
            muscleGroup: 'Chest',
            equipment: 'dumbbell',
            repRange: '8-12',
            targetRir: 2,
            restSeconds: 90,
            sets: [
              { id: 'ds-15', setNumber: 1, type: 'working', weight: 26, reps: 11, rir: 2, completed: true, timestamp: '' },
              { id: 'ds-16', setNumber: 2, type: 'working', weight: 26, reps: 10, rir: 2, completed: true, timestamp: '' },
              { id: 'ds-17', setNumber: 3, type: 'working', weight: 26, reps: 9, rir: 2, completed: true, timestamp: '' },
            ]
          },
          {
            id: 'de-6',
            name: 'Standing Overhead Barbell Press',
            muscleGroup: 'Shoulders',
            equipment: 'barbell',
            repRange: '6-10',
            targetRir: 2,
            restSeconds: 120,
            sets: [
              { id: 'ds-18', setNumber: 1, type: 'working', weight: 45, reps: 9, rir: 2, completed: true, timestamp: '' },
              { id: 'ds-19', setNumber: 2, type: 'working', weight: 45, reps: 8, rir: 2, completed: true, timestamp: '' },
              { id: 'ds-20', setNumber: 3, type: 'working', weight: 45, reps: 7, rir: 2, completed: true, timestamp: '' },
            ]
          }
        ]
      },
      // Week 3 Push A (Hits 12, 12, 12 on bench! Triggers Rule A)
      {
        id: 'demo-s3',
        isDemo: true,
        dayName: 'Day 1 — Push A',
        date: '2026-10-08',
        startTime: '2026-10-08T17:30:00Z',
        endTime: '2026-10-08T18:48:00Z',
        status: 'completed',
        notes: 'Target top of range unlocked on Bench Press! 80kg x 12, 12, 12 with 2 RIR.',
        exercises: [
          {
            id: 'de-7',
            name: 'Barbell Bench Press',
            muscleGroup: 'Chest',
            equipment: 'barbell',
            repRange: '8-12',
            targetRir: 2,
            restSeconds: 120,
            sets: [
              { id: 'ds-21', setNumber: 1, type: 'warmup', weight: 40, reps: 10, completed: true, timestamp: '' },
              { id: 'ds-22', setNumber: 2, type: 'working', weight: 80, reps: 12, rir: 2, completed: true, timestamp: '' },
              { id: 'ds-23', setNumber: 3, type: 'working', weight: 80, reps: 12, rir: 2, completed: true, timestamp: '' },
              { id: 'ds-24', setNumber: 4, type: 'working', weight: 80, reps: 12, rir: 2, completed: true, timestamp: '' },
            ]
          },
          {
            id: 'de-8',
            name: 'Incline Dumbbell Press',
            muscleGroup: 'Chest',
            equipment: 'dumbbell',
            repRange: '8-12',
            targetRir: 2,
            restSeconds: 90,
            sets: [
              { id: 'ds-25', setNumber: 1, type: 'working', weight: 26, reps: 12, rir: 2, completed: true, timestamp: '' },
              { id: 'ds-26', setNumber: 2, type: 'working', weight: 26, reps: 11, rir: 2, completed: true, timestamp: '' },
              { id: 'ds-27', setNumber: 3, type: 'working', weight: 26, reps: 10, rir: 2, completed: true, timestamp: '' },
            ]
          },
          {
            id: 'de-9',
            name: 'Standing Overhead Barbell Press',
            muscleGroup: 'Shoulders',
            equipment: 'barbell',
            repRange: '6-10',
            targetRir: 2,
            restSeconds: 120,
            sets: [
              { id: 'ds-28', setNumber: 1, type: 'working', weight: 45, reps: 10, rir: 2, completed: true, timestamp: '' },
              { id: 'ds-29', setNumber: 2, type: 'working', weight: 45, reps: 9, rir: 2, completed: true, timestamp: '' },
              { id: 'ds-30', setNumber: 3, type: 'working', weight: 45, reps: 8, rir: 1, completed: true, timestamp: '' },
            ]
          }
        ]
      }
    ];

    // Seed Demo Body Metrics (14 days of realistic entries)
    const demoMetrics: BodyMetricEntry[] = [
      { id: 'dm-1', isDemo: true, date: '2026-09-28', weightKg: 78.0, waistCm: 81.5, bmi: 24.62, notes: 'Morning fasting' },
      { id: 'dm-2', isDemo: true, date: '2026-09-30', weightKg: 78.2, waistCm: 81.5, bmi: 24.68 },
      { id: 'dm-3', isDemo: true, date: '2026-10-02', weightKg: 78.1, waistCm: 81.4, bmi: 24.65 },
      { id: 'dm-4', isDemo: true, date: '2026-10-04', weightKg: 78.4, waistCm: 81.5, bmi: 24.74 },
      { id: 'dm-5', isDemo: true, date: '2026-10-06', weightKg: 78.3, waistCm: 81.3, bmi: 24.71 },
      { id: 'dm-6', isDemo: true, date: '2026-10-08', weightKg: 78.5, waistCm: 81.4, bmi: 24.77 },
      { id: 'dm-7', isDemo: true, date: '2026-10-10', weightKg: 78.6, waistCm: 81.4, bmi: 24.81 },
      { id: 'dm-8', isDemo: true, date: '2026-10-12', weightKg: 78.7, waistCm: 81.5, bmi: 24.84, notes: 'Post leg day fullness' }
    ];

    // Seed Demo Nutrition for today
    const todayStr = new Date().toISOString().split('T')[0];
    const demoNutrition: DailyNutritionLog = {
      id: `demo-nutr-${todayStr}`,
      isDemo: true,
      date: todayStr,
      waterMl: 2750,
      targetCalories: 2600,
      targetProtein: 165,
      targetCarbs: 300,
      targetFat: 65,
      entries: [
        {
          id: 'dne-1',
          name: 'Rolled Oats (Dry)',
          mealCategory: 'breakfast',
          quantity: 1.5, // 75g
          servingUnit: '50g',
          calories: 285,
          protein: 9.75,
          carbs: 51,
          fat: 4.8,
          fiber: 7.5,
          timeLogged: '08:00'
        },
        {
          id: 'dne-2',
          name: 'Whey Protein Isolate Powder',
          mealCategory: 'breakfast',
          quantity: 1,
          servingUnit: 'scoop (30g)',
          calories: 115,
          protein: 25,
          carbs: 1.5,
          fat: 0.8,
          timeLogged: '08:15'
        },
        {
          id: 'dne-3',
          name: 'Chicken Breast (Cooked, Skinless)',
          mealCategory: 'lunch',
          quantity: 2, // 200g
          servingUnit: '100g',
          calories: 330,
          protein: 62,
          carbs: 0,
          fat: 7.2,
          timeLogged: '12:30'
        },
        {
          id: 'dne-4',
          name: 'White Jasmine Rice (Cooked)',
          mealCategory: 'lunch',
          quantity: 1.5, // 225g
          servingUnit: '150g',
          calories: 292,
          protein: 6,
          carbs: 64.5,
          fat: 0.6,
          timeLogged: '12:30'
        },
        {
          id: 'dne-5',
          name: 'Banana (Medium Fresh)',
          mealCategory: 'pre_workout',
          quantity: 1,
          servingUnit: 'medium',
          calories: 105,
          protein: 1.3,
          carbs: 27,
          fat: 0.3,
          timeLogged: '16:00'
        },
        {
          id: 'dne-6',
          name: 'Atlantic Salmon Fillet (Cooked)',
          mealCategory: 'dinner',
          quantity: 1.5, // 150g
          servingUnit: '100g',
          calories: 312,
          protein: 33,
          carbs: 0,
          fat: 19.5,
          timeLogged: '19:30'
        },
        {
          id: 'dne-7',
          name: 'Sweet Potato (Baked, Flesh)',
          mealCategory: 'dinner',
          quantity: 1.5, // 225g
          servingUnit: '150g',
          calories: 202,
          protein: 4.5,
          carbs: 46.5,
          fat: 0.3,
          timeLogged: '19:30'
        }
      ]
    };

    // Seed Demo Sleep Logs (14 days of realistic entries)
    const demoSleepLogs: DailySleepLog[] = [
      { id: 'dsl-1', isDemo: true, date: '2026-09-28', hoursSlept: 7.8, quality: 86, restingHeartRate: 54, hrvMs: 68, notes: 'Restful recovery sleep' },
      { id: 'dsl-2', isDemo: true, date: '2026-09-29', hoursSlept: 7.2, quality: 80, restingHeartRate: 56, hrvMs: 62 },
      { id: 'dsl-3', isDemo: true, date: '2026-09-30', hoursSlept: 8.1, quality: 92, restingHeartRate: 52, hrvMs: 75, notes: 'Deep sleep peak before heavy pull' },
      { id: 'dsl-4', isDemo: true, date: '2026-10-01', hoursSlept: 7.5, quality: 84, restingHeartRate: 55, hrvMs: 65 },
      { id: 'dsl-5', isDemo: true, date: '2026-10-02', hoursSlept: 6.8, quality: 72, restingHeartRate: 58, hrvMs: 58, notes: 'Stayed up late' },
      { id: 'dsl-6', isDemo: true, date: '2026-10-03', hoursSlept: 8.4, quality: 90, restingHeartRate: 53, hrvMs: 72 },
      { id: 'dsl-7', isDemo: true, date: '2026-10-04', hoursSlept: 7.6, quality: 85, restingHeartRate: 54, hrvMs: 67 },
      { id: 'dsl-8', isDemo: true, date: '2026-10-05', hoursSlept: 7.9, quality: 88, restingHeartRate: 53, hrvMs: 70 },
      { id: 'dsl-9', isDemo: true, date: '2026-10-06', hoursSlept: 6.2, quality: 65, restingHeartRate: 60, hrvMs: 52, notes: 'Poor REM quality' },
      { id: 'dsl-10', isDemo: true, date: '2026-10-07', hoursSlept: 8.2, quality: 94, restingHeartRate: 51, hrvMs: 78, notes: 'Felt primed for squat session' },
      { id: 'dsl-11', isDemo: true, date: '2026-10-08', hoursSlept: 7.7, quality: 87, restingHeartRate: 54, hrvMs: 69 },
      { id: 'dsl-12', isDemo: true, date: '2026-10-09', hoursSlept: 7.4, quality: 82, restingHeartRate: 55, hrvMs: 64 },
      { id: 'dsl-13', isDemo: true, date: '2026-10-10', hoursSlept: 8.0, quality: 89, restingHeartRate: 52, hrvMs: 74 },
      { id: 'dsl-14', isDemo: true, date: '2026-10-12', hoursSlept: 7.8, quality: 88, restingHeartRate: 53, hrvMs: 71, notes: 'Solid optimal sleep recovery' }
    ];

    // Save demo entries without overwriting existing real records
    const realSessions = this.getSessions().filter((s) => !s.isDemo);
    this.saveSessions([...realSessions, ...demoSessions]);

    const realMetrics = this.getBodyMetrics().filter((m) => !m.isDemo);
    this.saveBodyMetrics([...realMetrics, ...demoMetrics]);

    const realNutrition = this.getNutritionLogs().filter((n) => !n.isDemo);
    this.saveNutritionLogs([...realNutrition, demoNutrition]);

    const realSleep = this.getSleepLogs().filter((s) => !s.isDemo);
    this.saveSleepLogs([...realSleep, ...demoSleepLogs]);

    // Activate the starter PPL plan for demo
    this.setActivePlanId('starter-ppl-6day');
  }

  clearDemoData(): void {
    this.setDemoModeActive(false);
    const cleanSessions = this.getSessions().filter((s) => !s.isDemo);
    this.saveSessions(cleanSessions);

    const cleanMetrics = this.getBodyMetrics().filter((m) => !m.isDemo);
    this.saveBodyMetrics(cleanMetrics);

    const cleanNutrition = this.getNutritionLogs().filter((n) => !n.isDemo);
    this.saveNutritionLogs(cleanNutrition);

    const cleanSleep = this.getSleepLogs().filter((s) => !s.isDemo);
    this.saveSleepLogs(cleanSleep);
  }

  // --- Export and Import ---
  exportFullBackupJSON(): string {
    const backup = {
      app: 'IRON LOG — Personal Fitness OS',
      version: '1.0.0',
      exportedAt: new Date().toISOString(),
      profile: this.getProfile(),
      plans: this.getPlans(),
      activePlanId: this.getActivePlanId(),
      sessions: this.getSessions().filter((s) => !s.isDemo),
      nutritionLogs: this.getNutritionLogs().filter((n) => !n.isDemo),
      sleepLogs: this.getSleepLogs().filter((s) => !s.isDemo),
      customFoods: this.getCustomFoods(),
      bodyMetrics: this.getBodyMetrics().filter((m) => !m.isDemo),
      recommendations: this.getRecommendations()
    };
    return JSON.stringify(backup, null, 2);
  }

  importBackupJSON(jsonStr: string): { success: boolean; message: string } {
    try {
      const data = JSON.parse(jsonStr);
      if (!data || typeof data !== 'object') {
        return { success: false, message: 'Invalid JSON file format.' };
      }
      if (data.profile) this.saveProfile(data.profile);
      if (Array.isArray(data.plans)) this.savePlans(data.plans);
      if (data.activePlanId) this.setActivePlanId(data.activePlanId);
      if (Array.isArray(data.sessions)) this.saveSessions(data.sessions);
      if (Array.isArray(data.nutritionLogs)) this.saveNutritionLogs(data.nutritionLogs);
      if (Array.isArray(data.customFoods)) this.saveCustomFoods(data.customFoods);
      if (Array.isArray(data.bodyMetrics)) this.saveBodyMetrics(data.bodyMetrics);
      if (Array.isArray(data.recommendations)) this.saveRecommendations(data.recommendations);
      return { success: true, message: 'Backup successfully restored.' };
    } catch (e: any) {
      return { success: false, message: `Failed to parse backup: ${e?.message || 'Unknown error'}` };
    }
  }

  exportWorkoutsCSV(): string {
    const sessions = this.getSessions().filter((s) => !s.isDemo);
    const headers = [
      'Date',
      'Session Day',
      'Exercise',
      'Muscle Group',
      'Equipment',
      'Set Number',
      'Set Type',
      'Weight (kg)',
      'Reps',
      'RIR',
      'Volume (kg)',
      'Completed'
    ];
    const rows: string[] = [headers.join(',')];

    for (const session of sessions) {
      for (const ex of session.exercises) {
        for (const set of ex.sets) {
          const vol = (Number(set.weight) || 0) * (Number(set.reps) || 0);
          rows.push(
            [
              `"${session.date}"`,
              `"${session.dayName.replace(/"/g, '""')}"`,
              `"${ex.name.replace(/"/g, '""')}"`,
              `"${ex.muscleGroup}"`,
              `"${ex.equipment}"`,
              set.setNumber,
              set.type,
              set.weight,
              set.reps,
              set.rir !== undefined ? set.rir : '',
              vol,
              set.completed ? 'TRUE' : 'FALSE'
            ].join(',')
          );
        }
      }
    }
    return rows.join('\n');
  }

  exportNutritionCSV(): string {
    const logs = this.getNutritionLogs().filter((n) => !n.isDemo);
    const headers = ['Date', 'Meal Category', 'Food Name', 'Quantity', 'Calories', 'Protein (g)', 'Carbs (g)', 'Fat (g)'];
    const rows: string[] = [headers.join(',')];

    for (const log of logs) {
      for (const entry of log.entries) {
        rows.push(
          [
            `"${log.date}"`,
            `"${entry.mealCategory}"`,
            `"${entry.name.replace(/"/g, '""')}"`,
            entry.quantity,
            entry.calories,
            entry.protein,
            entry.carbs,
            entry.fat
          ].join(',')
        );
      }
    }
    return rows.join('\n');
  }

  exportBodyMetricsCSV(): string {
    const metrics = this.getBodyMetrics().filter((m) => !m.isDemo);
    const headers = ['Date', 'Weight (kg)', 'Waist (cm)', 'BMI', 'Body Fat %', 'Notes'];
    const rows: string[] = [headers.join(',')];

    for (const m of metrics) {
      rows.push(
        [
          `"${m.date}"`,
          m.weightKg,
          m.waistCm || '',
          m.bmi,
          m.bodyFatPercentage || '',
          `"${(m.notes || '').replace(/"/g, '""')}"`
        ].join(',')
      );
    }
    return rows.join('\n');
  }

  resetAllData(): void {
    localStorage.clear();
    this.saveProfile({ ...DEFAULT_PROFILE });
    this.savePlans([{ ...STARTER_PPL_PLAN }, { ...STARTER_UPPER_LOWER_PLAN }]);
  }
}

export const db = new IronLogDB();
