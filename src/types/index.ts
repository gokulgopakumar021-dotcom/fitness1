export type PrimaryGoal = 'muscle_gain' | 'fat_loss' | 'maintenance' | 'recomposition';
export type TrainingExperience = 'beginner' | 'intermediate' | 'advanced';
export type TrainingPhase = 're_entry' | 'adaptation' | 'hypertrophy' | 'strength' | 'deload';
export type PreferredUnit = 'kg' | 'lbs';
export type EquipmentType = 'barbell' | 'dumbbell' | 'machine' | 'cable' | 'bodyweight' | 'other';
export type SetType = 'warmup' | 'working' | 'drop' | 'failure';
export type SetStatus = 'planned' | 'completed' | 'skipped';

export interface UserProfile {
  name: string;
  age: number;
  sex: 'male' | 'female' | 'other' | 'unspecified';
  heightCm: number;
  currentWeightKg: number;
  goalWeightKg: number;
  primaryGoal: PrimaryGoal;
  trainingExperience: TrainingExperience;
  trainingDaysPerWeek: number;
  preferredUnit: PreferredUnit;
  dailyCalorieTarget: number;
  dailyProteinTarget: number;
  dailyCarbsTarget: number;
  dailyFatTarget: number;
  targetDate?: string;
  preferredTrainingTime?: string;
  trainingSplitName: string;
  trainingPhase: TrainingPhase;
  defaultTargetRir: number;
  minBarbellIncrement: number; // in kg (e.g. 2.5)
  minDumbbellIncrement: number; // in kg (e.g. 2.0)
  minMachineIncrement: number; // in kg (e.g. 2.5)
  excludeWarmupFromVolume: boolean;
  onboardingCompleted: boolean;
}

export type ProgressionStrategy =
  | 'double_progression'
  | 'top_set_only'
  | 'consecutive_sessions'
  | 'linear_load'
  | 'rep_accumulation';

export interface PlannedExercise {
  id: string;
  name: string;
  muscleGroup: string;
  equipment: EquipmentType;
  workingSets: number;
  repRange: string; // e.g. "8-12", "5", "6-8"
  targetRir: number;
  restSeconds: number;
  tempo?: string;
  notes?: string;
  isUnilateral?: boolean;
  progressionStrategy?: ProgressionStrategy;
  customIncrement?: number;
  targetVolumeGoal?: number;
}

export interface WorkoutDay {
  id: string;
  dayName: string;
  dayOrder: number;
  exercises: PlannedExercise[];
}

export interface WorkoutPlan {
  id: string;
  name: string;
  trainingSplit: string;
  description?: string;
  createdAt: string;
  updatedAt: string;
  isActive: boolean;
  isStarter?: boolean;
  isUploaded?: boolean;
  progressionPhase?: TrainingPhase;
  defaultStrategy?: ProgressionStrategy;
  planNotes?: string;
  days: WorkoutDay[];
}

export interface LoggedSet {
  id: string;
  setNumber: number;
  type: SetType;
  weight: number;
  reps: number;
  rir?: number;
  rpe?: number;
  completed: boolean;
  skipped?: boolean;
  side?: 'both' | 'left' | 'right';
  notes?: string;
  dropPercentage?: number;
  timestamp: string;
}

export interface LoggedExercise {
  id: string;
  exercisePlanId?: string;
  name: string;
  muscleGroup: string;
  equipment: EquipmentType;
  repRange: string;
  targetRir: number;
  restSeconds: number;
  notes?: string;
  isUnilateral?: boolean;
  supersetGroup?: string; // e.g. "A", "B" to link into superset circuits
  sets: LoggedSet[];
}

export interface WorkoutSession {
  id: string;
  planId?: string;
  dayId?: string;
  dayName: string;
  date: string; // YYYY-MM-DD
  startTime: string; // ISO string
  endTime?: string; // ISO string
  status: 'in_progress' | 'completed' | 'abandoned';
  notes?: string;
  isDemo?: boolean;
  exercises: LoggedExercise[];
  isPaused?: boolean;
  pausedElapsedSeconds?: number;
  pausedAt?: string;
}

export type ProgressionRuleCode =
  | 'A_TOP_REPS_ACHIEVED'
  | 'B_REPS_IMPROVED'
  | 'C_REPS_DECLINED'
  | 'D_MULTI_SESSION_DECLINE'
  | 'E_NEW_BASELINE'
  | 'F_BODYWEIGHT'
  | 'G_INCREMENT_CONSTRAINT';

export interface ProgressiveOverloadRecommendation {
  id: string;
  exerciseName: string;
  equipment: EquipmentType;
  ruleApplied: ProgressionRuleCode;
  ruleTitle: string;
  currentWeight: number;
  currentRepsSummary: string;
  previousWeight?: number;
  previousRepsSummary?: string;
  recommendedWeight: number;
  recommendedRepTarget: string;
  explanation: string;
  trainingPhase: TrainingPhase;
  planId?: string;
  planName?: string;
  strategyUsed?: ProgressionStrategy;
  flags: {
    isProvisional?: boolean;
    recoveryAlert?: boolean;
    volumeWarning?: boolean;
  };
  userAction: 'pending' | 'accepted' | 'modified' | 'rejected';
  chosenWeight?: number;
  chosenRepTarget?: string;
  timestamp: string;
}

export type MealCategory =
  | 'breakfast'
  | 'lunch'
  | 'pre_workout'
  | 'post_workout'
  | 'dinner'
  | 'snacks'
  | 'custom';

export interface ScannedFoodNutrients {
  calories: number | null;
  protein: number | null;
  carbs: number | null;
  fat: number | null;
  fiber: number | null;
}

export interface ScannedFoodProduct {
  barcode: string;
  name: string;
  brand?: string;
  imageUrl?: string;
  servingSizeText?: string;
  servingQuantity?: number;
  servingUnit?: string;
  hasServingData: boolean;
  perServing: ScannedFoodNutrients;
  per100g: ScannedFoodNutrients;
  isLiquid?: boolean;
  categories?: string[];
  incompleteDataWarning?: string;
}

export interface FoodItem {
  id: string;
  name: string;
  brand?: string;
  barcode?: string;
  imageUrl?: string;
  servingSize: number;
  servingUnit: string; // e.g. "g", "ml", "scoop", "egg"
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
  fiber?: number;
  isVerified?: boolean;
  isCustom?: boolean;
}

export interface FoodEntry {
  id: string;
  foodId?: string;
  barcode?: string;
  brand?: string;
  imageUrl?: string;
  name: string;
  mealCategory: MealCategory;
  quantity: number; // multiplier of servingSize
  servingUnit: string;
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
  fiber?: number;
  isEstimate?: boolean;
  notes?: string;
  timeLogged?: string;
}

export interface DailyNutritionLog {
  id: string;
  date: string; // YYYY-MM-DD
  entries: FoodEntry[];
  waterMl: number;
  targetCalories: number;
  targetProtein: number;
  targetCarbs: number;
  targetFat: number;
  isDemo?: boolean;
}

export interface BodyMetricEntry {
  id: string;
  date: string; // YYYY-MM-DD
  weightKg: number;
  waistCm?: number;
  bodyFatPercentage?: number;
  bmi: number;
  notes?: string;
  isDemo?: boolean;
}

export interface UploadedDoc {
  id: string;
  fileName: string;
  fileType: string;
  fileSize: number;
  uploadDate: string;
  status: 'pending' | 'parsed' | 'failed' | 'imported';
  rawText?: string;
  parsedPlan?: Partial<WorkoutPlan>;
  errorMessage?: string;
}

export interface PersonalRecord {
  exerciseName: string;
  maxWeight: number;
  bestOneRepMax: number;
  date: string;
}

export interface ExercisePerformanceSummary {
  exerciseName: string;
  lastSessionDate: string;
  lastSessionWeight: number;
  lastSessionReps: number[];
  lastSessionVolume: number;
  estimated1RM: number;
  previousWeekBestWeight: number;
  previousWeekBestReps: number[];
  personalRecordWeight: number;
  personalRecord1RM: number;
  sessionsCount: number;
  progressionTrend: 'improving' | 'stable' | 'declining' | 'new';
}

export interface MuscleGroupRecovery {
  muscleGroup: string;
  recoveryPercentage: number; // 0 to 100
  status: 'fresh' | 'recovering' | 'fatigued';
  lastTrainedDate?: string;
  hoursSinceLastTrained?: number;
  totalSetsLast7Days: number;
  recoveryTrend: 'improving' | 'stable' | 'needs_rest';
  recoveryHoursRemaining: number;
  exercisesTrained: string[];
}

export interface SystemicRecoveryData {
  systemicFatigueScore: number; // 0 to 100
  systemicFatigueLevel: 'Low' | 'Optimal' | 'Elevated' | 'High';
  overallReadiness: number; // 0 to 100
  headline: string;
  muscleRecovery: MuscleGroupRecovery[];
  optimalRestDays: {
    recommendedRestDays: string[];
    isRestRecommendedToday: boolean;
    todayAdvice: string;
    rationale: string;
  };
  suggestedNextWorkout?: {
    splitDay: string;
    reasoning: string;
  };
  recoveryTips: string[];
  lastCalculated: string;
}

export interface DailySleepLog {
  id: string;
  date: string; // YYYY-MM-DD
  hoursSlept: number; // e.g. 7.5
  quality: number; // 0 to 100 percentage rating
  deepSleepMinutes?: number;
  remSleepMinutes?: number;
  restingHeartRate?: number;
  hrvMs?: number;
  notes?: string;
  isDemo?: boolean;
}

export interface DynamicExpenditureEstimate {
  currentTdee: number;
  staticBmr: number;
  staticTdee: number;
  difference: number;
  adaptationStatus: 'accelerated' | 'neutral' | 'downregulated';
  confidence: 'high' | 'medium' | 'calibrating';
  daysSampled: number;
  avgDailyIntake: number;
  rollingWeightDeltaKg: number;
  recommendedCalories: number;
  recommendedProtein: number;
  recommendedCarbs: number;
  recommendedFat: number;
  rationale: string;
}

