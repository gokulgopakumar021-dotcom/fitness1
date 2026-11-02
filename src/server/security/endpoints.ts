import { schemas, type Schema } from './validation';

/**
 * Single source of truth for per-endpoint policy: rate limit, daily AI quota, body-size limit and request schema.
 * Every limit is a DEFAULT PROPOSAL, overridable at deploy time via AI_QUOTA_OVERRIDES (see config.ts).
 * A path that is not listed here is rejected with 404 after authentication, so new routes must be registered here.
 */
export interface EndpointPolicy {
  bucket: string;
  /** Calls Gemini: counts against the daily quota. */
  ai: boolean;
  dailyQuota?: number;
  perMinute: number;
  /** express.json `limit` value. */
  bodyLimit: string;
  schema?: Schema;
}

const SMALL = '64kb';
const MEDIUM = '256kb';
const LARGE = '1mb';
const XLARGE = '4mb'; // full session history (recovery insights); proposal, verify against real data volumes

export const ENDPOINTS: Record<string, EndpointPolicy> = {
  'POST /extract-plan': { bucket: 'extract-plan', ai: true, dailyQuota: 10, perMinute: 3, bodyLimit: '14mb', schema: schemas.extractPlan },
  'POST /generate-plan': { bucket: 'generate-plan', ai: true, dailyQuota: 20, perMinute: 5, bodyLimit: SMALL, schema: schemas.generatePlan },
  'POST /exercise-coach': { bucket: 'exercise-coach', ai: true, dailyQuota: 60, perMinute: 10, bodyLimit: SMALL, schema: schemas.exerciseCoach },
  'POST /generate-ai-routine': { bucket: 'generate-ai-routine', ai: true, dailyQuota: 20, perMinute: 5, bodyLimit: MEDIUM, schema: schemas.generateAiRoutine },
  'POST /ai-food-parser': { bucket: 'ai-food-parser', ai: true, dailyQuota: 100, perMinute: 15, bodyLimit: SMALL, schema: schemas.foodParser },
  'POST /ai-workout-insights': { bucket: 'ai-workout-insights', ai: true, dailyQuota: 40, perMinute: 8, bodyLimit: LARGE, schema: schemas.workoutInsights },
  'POST /ai-plan-overload-tuning': { bucket: 'ai-plan-overload-tuning', ai: true, dailyQuota: 30, perMinute: 5, bodyLimit: LARGE, schema: schemas.planOverloadTuning },
  'POST /ai-nutrition-coach': { bucket: 'ai-nutrition-coach', ai: true, dailyQuota: 40, perMinute: 8, bodyLimit: MEDIUM, schema: schemas.nutritionCoach },
  'POST /ai-recovery-insights': { bucket: 'ai-recovery-insights', ai: true, dailyQuota: 40, perMinute: 8, bodyLimit: XLARGE, schema: schemas.recoveryInsights },
  'POST /ai-personal-trainer': { bucket: 'ai-personal-trainer', ai: true, dailyQuota: 100, perMinute: 12, bodyLimit: LARGE, schema: schemas.personalTrainer },
  'POST /adaptive-coach/explain': { bucket: 'adaptive-coach-explain', ai: true, dailyQuota: 60, perMinute: 10, bodyLimit: MEDIUM, schema: schemas.adaptiveCoachExplain },
  'POST /ai-form-analyzer': { bucket: 'ai-form-analyzer', ai: true, dailyQuota: 40, perMinute: 8, bodyLimit: SMALL, schema: schemas.formAnalyzer },
  'POST /ai-warmup-generator': { bucket: 'ai-warmup-generator', ai: true, dailyQuota: 30, perMinute: 6, bodyLimit: SMALL, schema: schemas.warmupGenerator },
  'POST /ai-generate-physique': { bucket: 'ai-generate-physique', ai: true, dailyQuota: 10, perMinute: 3, bodyLimit: SMALL, schema: schemas.generatePhysique },
  'POST /ai-physique-analysis': { bucket: 'ai-physique-analysis', ai: true, dailyQuota: 10, perMinute: 3, bodyLimit: MEDIUM, schema: schemas.physiqueAnalysis }
};

export const BARCODE_POLICY: EndpointPolicy = { bucket: 'barcode', ai: false, perMinute: 30, bodyLimit: SMALL };

export function resolvePolicy(method: string, path: string): EndpointPolicy | undefined {
  const clean = path.length > 1 ? path.replace(/\/+$/, '') : path;
  const hit = ENDPOINTS[`${method.toUpperCase()} ${clean}`];
  if (hit) return hit;
  if (method.toUpperCase() === 'GET' && /^\/nutrition\/barcode\/[^/]+$/.test(clean)) return BARCODE_POLICY;
  return undefined;
}
